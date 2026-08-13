//! LAN 大厅（联机会话 Control）。
//!
//! 房间生命周期：创建/加入/列表/选择/队伍/就绪/离开/主机数据/模组共享。
//! 战斗开始后的结算不在这里 —— 由 `super::battle`（服务端权威）负责。

use super::{base64_encode, elapsed, ServerState, LIST_TTL};
use serde::{Deserialize, Serialize};

use tiny_http::Request;

/// 联机房间
#[derive(Debug, Clone)]
pub struct Room {
    pub name: String,
    pub mods: bool,
    /// 服务端权威对局（开始后才有值）—— 见 `super::battle::RoomBattle`
    pub battle: Option<super::battle::RoomBattle>,
    pub picks: [Option<Pick>; 4],
    pub teams: [Option<u8>; 4],
    pub ready: [bool; 4],
    pub capacity: u8,
    pub t: f64,
    pub data: Option<serde_json::Value>,
}

/// 单个席位的选择（子阵营 + 卡组 + 效果类型）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Pick {
    pub subfaction: serde_json::Value,
    pub cards: Vec<serde_json::Value>,
    pub effects: Vec<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_human: Option<bool>,
}

impl ServerState {
    pub(crate) fn handle_create(&self, mut request: Request) {
        let (name, mods, capacity) = {
            let body = Self::read_body(&mut request);
            if body.is_empty() {
                ("卡牌对决".to_string(), true, 4)
            } else {
                let data: serde_json::Value = serde_json::from_str(&body).unwrap_or_default();
                let n = data
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("卡牌对决")
                    .to_string();
                let m = data.get("mods").and_then(|v| v.as_bool()).unwrap_or(true);
                let c = data.get("capacity").and_then(|v| v.as_u64()).unwrap_or(4) as u8;
                let c = c.clamp(2, 4);
                (n, m, c)
            }
        };
        let room = Self::gen_code();
        {
            let mut rooms = self.rooms.lock();
            rooms.insert(
                room.clone(),
                Room {
                    name,
                    mods,
                    battle: None,
                    picks: [None, None, None, None],
                    teams: [None, None, None, None],
                    ready: [false, false, false, false],
                    capacity,
                    t: elapsed(),
                    data: None,
                },
            );
        }
        self.slog(&format!("CREATE room={}", room));
        self.respond_json( request, 200, &serde_json::json!({"ok": true, "room": room}));
    }

    pub(crate) fn handle_join(&self, request: Request, query: &str) {
        let room = Self::extract_param(query, "room").to_uppercase();
        if room.is_empty() {
            self.respond_json(
                request,
                400,
                &serde_json::json!({"ok": false, "err": "room required"}),
            );
            return;
        }
        {
            let mut rooms = self.rooms.lock();
            if let Some(r) = rooms.get_mut(&room) {
                if r.battle.is_some() {
                    self.respond_json(
                        request,
                        400,
                        &serde_json::json!({"ok": false, "err": "game already started"}),
                    );
                    return;
                }
                // Assign first empty seat
                let side = r.picks.iter().position(|p| p.is_none());
                match side {
                    Some(s) => {
                        r.t = elapsed();
                        self.slog(&format!("JOIN room={} side={}", room, s));
                        self.respond_json(
                            request,
                            200,
                            &serde_json::json!({"ok": true, "side": s}),
                        );
                    }
                    None => {
                        self.respond_json(
                            request,
                            400,
                            &serde_json::json!({"ok": false, "err": "room full"}),
                        );
                    }
                }
            } else {
                self.respond_json(
                    request,
                    404,
                    &serde_json::json!({"ok": false, "err": "room not found"}),
                );
            }
        }
    }

    pub(crate) fn handle_rooms(&self, request: Request) {
        let now = elapsed();
        let rooms = self.rooms.lock();
        let room_list: Vec<serde_json::Value> = rooms
            .iter()
            .filter(|(_, r)| now - r.t <= LIST_TTL.as_secs_f64())
            .map(|(code, r)| {
                let picks = r.picks.iter().filter(|x| x.is_some()).count();
                let ready_count = r.ready.iter().filter(|x| **x).count();
                serde_json::json!({
                    "room": code,
                    "name": r.name,
                    "mods": r.mods,
                    "picks": picks,
                    "capacity": r.capacity,
                    "ready": ready_count,
                    "playing": r.battle.is_some()
                })
            })
            .collect();
        self.respond_json(
            request,
            200,
            &serde_json::json!({"ok": true, "rooms": room_list}),
        );
    }

    pub(crate) fn handle_get_state(&self, request: Request, query: &str) {
        let room = Self::extract_param(query, "room").to_uppercase();
        if room.is_empty() {
            self.respond_json(
                request,
                400,
                &serde_json::json!({"ok": false, "err": "room required"}),
            );
            return;
        }
        {
            let rooms = self.rooms.lock();
            if let Some(r) = rooms.get(&room) {
                let pk = serde_json::to_string(&r.picks).unwrap_or_default();
                let mut last_pk = self.last_pk.lock();
                if last_pk.get(&room) != Some(&pk) {
                    last_pk.insert(room.clone(), pk.clone());
                    self.slog(&format!(
                        "STATE room={} picks={}",
                        room,
                        &pk[..120.min(pk.len())]
                    ));
                }
                // 按观众席位投影：本人席位附带完整手牌，其余只给计数；
                // 未提供 side 参数时不泄露任何手牌
                let viewer = match Self::extract_param(query, "side").parse::<u8>().ok() {
                    Some(s) => r
                        .picks
                        .iter()
                        .enumerate()
                        .filter(|(_, p)| p.is_some())
                        .position(|(i, _)| i as u8 == s),
                    None => None,
                };
                let state = r
                    .battle
                    .as_ref()
                    .map(|rb| super::battle::project_state(rb, viewer));
                self.respond_json(
                    request,
                    200,
                    &serde_json::json!({
                        "ok": true,
                        "state": state,
                        "picks": r.picks,
                        "teams": r.teams,
                        "ready": r.ready,
                        "capacity": r.capacity
                    }),
                );
                return;
            }
        }
        self.respond_json(
            request,
            404,
            &serde_json::json!({"ok": false, "err": "room not found"}),
        );
    }

    pub(crate) fn handle_pick(&self, mut request: Request) {
        let data: serde_json::Value = match serde_json::from_str(&Self::read_body(&mut request)) {
            Ok(d) => d,
            Err(_) => {
                self.respond_json(
                    request,
                    400,
                    &serde_json::json!({"ok": false, "err": "bad json"}),
                );
                return;
            }
        };

        let room = data
            .get("room")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_uppercase();
        let side: u8 = data.get("side").and_then(|v| v.as_u64()).unwrap_or(255) as u8;
        {
            let mut rooms = self.rooms.lock();
            let r = match rooms.get_mut(&room) {
                Some(r) => r,
                None => {
                    self.respond_json(
                        request,
                        404,
                        &serde_json::json!({"ok": false, "err": "room not found"}),
                    );
                    return;
                }
            };
            if side >= r.capacity {
                self.respond_json(
                    request,
                    400,
                    &serde_json::json!({"ok": false, "err": "side invalid"}),
                );
                return;
            }

            let cards = match data
                .get("cards")
                .cloned()
                .unwrap_or(serde_json::Value::Array(vec![]))
            {
                serde_json::Value::Array(arr) => arr,
                _ => Vec::new(),
            };
            let effects = match data
                .get("effects")
                .cloned()
                .unwrap_or(serde_json::Value::Array(vec![]))
            {
                serde_json::Value::Array(arr) => arr,
                _ => Vec::new(),
            };
            let pick = Pick {
                subfaction: data
                    .get("subfaction")
                    .cloned()
                    .unwrap_or(data.get("role").cloned().unwrap_or_default()),
                cards,
                effects,
                is_human: data.get("is_human").and_then(|v| v.as_bool()),
            };
            r.picks[side as usize] = Some(pick);
            if let Some(team) = data.get("team").and_then(|v| v.as_u64()) {
                r.teams[side as usize] = Some(team as u8);
            }
            r.t = elapsed();
        }
        self.slog(&format!("PICK room={} side={}", room, side));
        self.respond_json( request, 200, &serde_json::json!({"ok": true}));
    }

    pub(crate) fn handle_team(&self, mut request: Request) {
        let data: serde_json::Value = match serde_json::from_str(&Self::read_body(&mut request)) {
            Ok(d) => d,
            Err(_) => {
                self.respond_json(
                    request,
                    400,
                    &serde_json::json!({"ok": false, "err": "bad json"}),
                );
                return;
            }
        };
        let room = data
            .get("room")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_uppercase();
        let side = data.get("side").and_then(|v| v.as_u64()).unwrap_or(255) as u8;
        let team = data.get("team").and_then(|v| v.as_u64()).unwrap_or(0) as u8;
        {
            let mut rooms = self.rooms.lock();
            if let Some(r) = rooms.get_mut(&room) {
                if side < r.capacity {
                    r.teams[side as usize] = Some(team);
                    r.t = elapsed();
                }
            }
        }
        self.respond_json( request, 200, &serde_json::json!({"ok": true}));
    }

    pub(crate) fn handle_ready(&self, mut request: Request) {
        let data: serde_json::Value = match serde_json::from_str(&Self::read_body(&mut request)) {
            Ok(d) => d,
            Err(_) => {
                self.respond_json(
                    request,
                    400,
                    &serde_json::json!({"ok": false, "err": "bad json"}),
                );
                return;
            }
        };
        let room = data
            .get("room")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_uppercase();
        let side = data.get("side").and_then(|v| v.as_u64()).unwrap_or(255) as u8;
        let ready = data.get("ready").and_then(|v| v.as_bool()).unwrap_or(true);
        {
            let mut rooms = self.rooms.lock();
            if let Some(r) = rooms.get_mut(&room) {
                if side < r.capacity {
                    r.ready[side as usize] = ready;
                    r.t = elapsed();
                }
            }
        }
        self.respond_json( request, 200, &serde_json::json!({"ok": true}));
    }

    pub(crate) fn handle_get_hostdata(&self, request: Request, query: &str) {
        let room = Self::extract_param(query, "room").to_uppercase();
        if room.is_empty() {
            self.respond_json( request, 400, &serde_json::json!({"ok": false}));
            return;
        }
        let rooms = self.rooms.lock();
        let data = rooms.get(&room).and_then(|r| r.data.clone());
        self.respond_json( request, 200, &serde_json::json!({"ok": true, "data": data}));
    }

    pub(crate) fn handle_post_hostdata(&self, mut request: Request) {
        let data: serde_json::Value = match serde_json::from_str(&Self::read_body(&mut request)) {
            Ok(d) => d,
            Err(_) => {
                self.respond_json(
                    request,
                    400,
                    &serde_json::json!({"ok": false, "err": "bad json"}),
                );
                return;
            }
        };

        let room = data
            .get("room")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_uppercase();
        let host_data = data.get("data").cloned();
        {
            let mut rooms = self.rooms.lock();
            if let Some(r) = rooms.get_mut(&room) {
                r.data = host_data;
                r.t = elapsed();
            }
        }
        self.slog(&format!("HOSTDATA_SET room={}", room));
        self.respond_json( request, 200, &serde_json::json!({"ok": true}));
    }

    pub(crate) fn handle_ping(&self, request: Request) {
        self.respond_json( request, 200, &serde_json::json!({"ok": true}));
    }

    pub(crate) fn handle_leave(&self, mut request: Request) {
        let data: serde_json::Value = match serde_json::from_str(&Self::read_body(&mut request)) {
            Ok(d) => d,
            Err(_) => {
                self.respond_json(
                    request,
                    400,
                    &serde_json::json!({"ok": false, "err": "bad json"}),
                );
                return;
            }
        };

        let room = data
            .get("room")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_uppercase();
        let side: u8 = data.get("side").and_then(|v| v.as_u64()).unwrap_or(0) as u8;
        {
            let mut rooms = self.rooms.lock();
            if side == 0 || side == 255 {
                rooms.remove(&room);
            } else if let Some(r) = rooms.get_mut(&room) {
                r.picks[side as usize] = None;
            }
        }
        self.slog(&format!("LEAVE room={} side={}", room, side));
        self.respond_json( request, 200, &serde_json::json!({"ok": true}));
    }

    pub(crate) fn handle_mod_list(&self, mut request: Request) {
        let data: serde_json::Value = match serde_json::from_str(&Self::read_body(&mut request)) {
            Ok(d) => d,
            Err(_) => {
                self.respond_json(
                    request,
                    400,
                    &serde_json::json!({"ok": false, "err": "bad json"}),
                );
                return;
            }
        };
        let room = data
            .get("room")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_uppercase();
        let mods = data
            .get("mods")
            .and_then(|v| v.as_array())
            .cloned()
            .unwrap_or_default();
        {
            let mut rooms = self.rooms.lock();
            if let Some(r) = rooms.get_mut(&room) {
                r.data = Some(serde_json::json!({"mods": mods}));
            }
        }
        self.respond_json( request, 200, &serde_json::json!({"ok": true}));
    }

    pub(crate) fn handle_mod_upload(&self, mut request: Request) {
        let data: serde_json::Value = match serde_json::from_str(&Self::read_body(&mut request)) {
            Ok(d) => d,
            Err(_) => {
                self.respond_json(
                    request,
                    400,
                    &serde_json::json!({"ok": false, "err": "bad json"}),
                );
                return;
            }
        };
        let mod_id = data
            .get("mod_id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let content = data.get("content").and_then(|v| v.as_str()).unwrap_or("");
        if mod_id.is_empty() || content.is_empty() {
            self.respond_json(
                request,
                400,
                &serde_json::json!({"ok": false, "err": "mod_id and content required"}),
            );
            return;
        }
        let bytes = content.as_bytes().to_vec();
        {
            let mut mods = self.shared_mods.lock();
            mods.insert(mod_id.clone(), bytes);
        }
        self.slog(&format!("MOD_UPLOAD mod_id={}", mod_id));
        self.respond_json( request, 200, &serde_json::json!({"ok": true}));
    }

    pub(crate) fn handle_mod_download(&self, request: Request, query: &str) {
        let mod_id = Self::extract_param(query, "mod_id").to_string();
        let mods = self.shared_mods.lock();
        if let Some(content) = mods.get(&mod_id) {
            let b64 = base64_encode(content);
            self.respond_json(
                request,
                200,
                &serde_json::json!({"ok": true, "content": b64}),
            );
        } else {
            self.respond_json(
                request,
                404,
                &serde_json::json!({"ok": false, "err": "mod not found"}),
            );
        }
    }
}
