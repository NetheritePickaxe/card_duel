//! 房间战斗 —— 服务端权威结算（Layer 4 Control 的服务端形态）。
//!
//! 服务器持有 `game::Battle` 的唯一权威引用，客户端只提交意图（`/act`），
//! 服务器经 `game::action::execute` 结算后投影公开状态（隐藏手牌），
//! 客户端轮询 `/state` 消费。表现事件（play/fd）随状态下发，
//! 客户端只读渲染，禁止本地结算。

use super::{elapsed, ServerState};
use crate::game;
use serde::{Deserialize, Serialize};
use tiny_http::Request;

// ============ 公开状态结构（HTTP 契约，客户端 applyPublic 消费） ============

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct State {
    pub seq: u64,
    pub turn: u32,
    pub actor: u8,
    pub winner: Option<u8>,
    pub phase: String,
    pub defs: serde_json::Value,
    pub p: Vec<PlayerState>,
    pub log: Vec<serde_json::Value>,
    pub play: Option<PlayEvent>,
    pub fd: Option<ForceDiscardEvent>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayerState {
    pub hp: u32,
    pub def: i32,
    pub energy: u32,
    pub buffs: Vec<Buff>,
    pub draw_count: u32,
    pub hand_count: u32,
    pub discard: Vec<String>,
    /// 仅观众本人席位附带完整手牌（含服务端计算的当前费用），其余为 None
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hand: Option<Vec<serde_json::Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Buff {
    #[serde(rename = "type")]
    pub btype: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration: Option<u32>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PlayEvent {
    pub seq: u64,
    pub pi: u8,
    pub card: serde_json::Value,
    pub events: Vec<EventFx>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EventFx {
    pub target: u8,
    pub fx: serde_json::Value,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ForceDiscardEvent {
    pub seq: u64,
    pub side: u8,
    pub count: u32,
}

/// 房间内的一局服务端权威战斗（内部状态，不序列化；`state` 才是对外投影）
#[derive(Debug, Clone)]
pub struct RoomBattle {
    pub b: game::Battle,
    pub seq: u64,
    /// 注入 seatMap 后的 GameDefs（客户端本地对象重建用）
    pub defs: serde_json::Value,
    pub humans: Vec<bool>,
    /// 最近一次行动的表现事件（客户端按 seq 匹配消费）
    pub play: Option<PlayEvent>,
    pub fd: Option<ForceDiscardEvent>,
}

fn fx_color(kind: &str) -> String {
    let meta = game::effect_metadata_map();
    meta.get(kind)
        .and_then(|m| m.get("fx"))
        .and_then(|fx| fx.get("color"))
        .and_then(|c| c.as_str())
        .unwrap_or("#ffffff")
        .to_string()
}

/// 效果颜色（与 bindings 保持一致）
fn event_fx(kind: &str) -> serde_json::Value {
    serde_json::json!({ "form": game::effects::default_fx_form(kind), "color": fx_color(kind) })
}

impl ServerState {
    /// POST /act — 提交战斗意图（start / play / endturn）
    pub(crate) fn handle_act(&self, mut request: Request) {
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
        let action = data.get("action").cloned().unwrap_or_default();
        let atype = action
            .get("type")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

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

        match atype.as_str() {
            "start" => self.act_start(&room, r, request, side, &action),
            "play" | "endturn" => self.act_play(&room, r, request, side, &action, &atype),
            _ => self.respond_json(
                request,
                400,
                &serde_json::json!({"ok": false, "err": "unknown action"}),
            ),
        }
    }

    /// 房主（side 0）掷骰后开战：从房间选择构建服务端权威对局
    fn act_start(
        &self,
        room: &str,
        r: &mut super::rooms::Room,
        request: Request,
        side: u8,
        action: &serde_json::Value,
    ) {
        if side != 0 {
            self.respond_json(
                request,
                403,
                &serde_json::json!({"ok": false, "err": "only host can start"}),
            );
            return;
        }
        if r.battle.is_some() {
            self.respond_json(
                request,
                400,
                &serde_json::json!({"ok": false, "err": "game already started"}),
            );
            return;
        }
        let first = action.get("first").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
        let seats: Vec<usize> = (0..r.capacity as usize)
            .filter(|&i| r.picks[i].is_some())
            .collect();
        if seats.len() < 2 {
            self.respond_json(
                request,
                400,
                &serde_json::json!({"ok": false, "err": "need at least 2 players"}),
            );
            return;
        }
        if first > 1 {
            self.respond_json(
                request,
                400,
                &serde_json::json!({"ok": false, "err": "invalid first"}),
            );
            return;
        }

        // 从各席位的选择重建 GameDefs（子阵营 + 卡牌池去重）
        let mut subfactions: Vec<game::SubfactionDef> = Vec::new();
        let mut cards: Vec<game::Card> = Vec::new();
        let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
        for &i in &seats {
            let pick = r.picks[i].as_ref().unwrap();
            match serde_json::from_value::<game::SubfactionDef>(pick.subfaction.clone()) {
                Ok(sub) => subfactions.push(sub),
                Err(e) => {
                    self.respond_json(
                        request,
                        400,
                        &serde_json::json!({"ok": false, "err": format!("bad subfaction: {}", e)}),
                    );
                    return;
                }
            }
            for c in &pick.cards {
                if let Ok(card) = serde_json::from_value::<game::Card>(c.clone()) {
                    if seen.insert(card.id.clone()) {
                        cards.push(card);
                    }
                }
            }
        }
        let teams: Vec<usize> = seats
            .iter()
            .map(|&i| r.teams[i].unwrap_or(0) as usize)
            .collect();
        let humans: Vec<bool> = seats
            .iter()
            .map(|&i| r.picks[i].as_ref().unwrap().is_human != Some(false))
            .collect();

        let defs = game::GameDefs {
            subfactions,
            cards,
            factions: vec![],
        };
        let seed = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos() as u64;

        let mut b = game::new_battle_teams("lan", &defs, seats.clone(), teams, seed);
        if first < b.order.len() {
            b.actor = b.order[first];
        }
        if let Err(e) = game::action::execute(&mut b, game::action::Action::StartTurn) {
            self.respond_json(request, 400, &serde_json::json!({"ok": false, "err": e}));
            return;
        }

        // 注入 seatMap 便于客户端映射席位
        let mut defs_json = serde_json::to_value(&defs).unwrap_or_default();
        defs_json["seatMap"] =
            serde_json::Value::Array(seats.iter().map(|&i| serde_json::json!(i)).collect());

        let mut rb = RoomBattle {
            b,
            seq: 1,
            defs: defs_json,
            humans,
            play: None,
            fd: None,
        };
        // 开局后若先手是 CPU 席位，服务器直接代跑
        self.drive_cpu(&mut rb);
        let viewer = seats.iter().position(|&s| s == 0);
        let state = project_state(&rb, viewer);
        r.battle = Some(rb);
        r.t = elapsed();

        self.slog(&format!("BATTLE_START room={} seats={:?}", room, seats));
        self.respond_json(
            request,
            200,
            &serde_json::json!({"ok": true, "state": state}),
        );
    }

    /// 玩家出牌 / 结束回合（只允许自己的回合，经 Layer 1 校验）
    fn act_play(
        &self,
        room: &str,
        r: &mut super::rooms::Room,
        request: Request,
        side: u8,
        action: &serde_json::Value,
        atype: &str,
    ) {
        // 每次行动先清空上一次的表现事件（客户端按 seq 匹配）
        if let Some(rb) = r.battle.as_mut() {
            rb.play = None;
            rb.fd = None;
        }
        let rb = match r.battle.as_mut() {
            Some(rb) => rb,
            None => {
                self.respond_json(
                    request,
                    400,
                    &serde_json::json!({"ok": false, "err": "game not started"}),
                );
                return;
            }
        };
        // side → 对局内座位索引
        let seats: Vec<usize> = (0..r.capacity as usize)
            .filter(|&i| r.picks[i].is_some())
            .collect();
        let pi = match seats.iter().position(|&s| s == side as usize) {
            Some(pi) => pi,
            None => {
                self.respond_json(
                    request,
                    403,
                    &serde_json::json!({"ok": false, "err": "you are not in this game"}),
                );
                return;
            }
        };

        let result = if atype == "play" {
            let idx = action.get("idx").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
            let target = action
                .get("target")
                .and_then(|v| v.as_i64())
                .filter(|&t| t >= 0)
                .map(|t| t as usize);
            // 记录打出的卡牌，供其他客户端播放动画
            let card_json =
                rb.b.players
                    .get(pi)
                    .and_then(|p| p.hand.get(idx))
                    .map(|c| serde_json::to_value(c).unwrap_or_default());
            let events = game::action::execute(
                &mut rb.b,
                game::action::Action::PlayCard { pi, idx, target },
            )
            .map_err(|e| serde_json::json!({"ok": false, "err": e}));
            match events {
                Ok(ev) => {
                    rb.play = card_json.map(|card| PlayEvent {
                        seq: rb.seq + 1,
                        pi: pi as u8,
                        card,
                        events: ev
                            .iter()
                            .map(|e| EventFx {
                                target: e.target as u8,
                                fx: event_fx(&e.kind),
                            })
                            .collect(),
                    });
                    // 强制弃牌事件（客户端据此同步本地手牌）
                    if let Some(fd) = ev
                        .iter()
                        .find(|e| e.kind == "force_discard")
                        .and_then(|e| e.value)
                    {
                        rb.fd = Some(ForceDiscardEvent {
                            seq: rb.seq + 1,
                            side: pi as u8,
                            count: fd as u32,
                        });
                    }
                    Ok(())
                }
                Err(json) => Err(json),
            }
        } else {
            game::action::execute(&mut rb.b, game::action::Action::EndTurn { pi })
                .map(|_| ())
                .map_err(|e| serde_json::json!({"ok": false, "err": e}))
        };

        match result {
            Ok(()) => {
                rb.seq += 1;
                self.drive_cpu(rb);
                let state = project_state(rb, Some(pi));
                r.t = elapsed();
                self.slog(&format!("ACT room={} side={} {}", room, side, atype));
                self.respond_json(
                    request,
                    200,
                    &serde_json::json!({"ok": true, "state": state}),
                );
            }
            Err(body) => self.respond_json(request, 400, &body),
        }
    }

    /// 服务器代跑 CPU 席位：直到轮到人类席位或分出胜负（有上限防死循环）
    fn drive_cpu(&self, rb: &mut RoomBattle) {
        let mut guard = 0;
        while rb.b.winner.is_none() {
            let actor = rb.b.actor;
            if actor >= rb.humans.len() || rb.humans[actor] {
                break;
            }
            if guard >= 64 {
                break;
            }
            guard += 1;
            if game::action::execute(&mut rb.b, game::action::Action::CpuStep).is_err() {
                // 出牌失败（理论不可达）→ 直接结束该席位回合，避免卡死
                let _ =
                    game::action::execute(&mut rb.b, game::action::Action::EndTurn { pi: actor });
            }
            rb.seq += 1;
        }
    }
}

/// 公开状态投影：按观众席位裁剪隐藏信息。
/// 非观众席位只给手牌计数 + 近 14 张弃牌；观众本人席位附带完整手牌
/// （含服务端计算的当前费用 `curCost`，JS 不自行计算规则）。
pub(crate) fn project_state(rb: &RoomBattle, viewer_seat: Option<usize>) -> State {
    let b = &rb.b;
    let log_start = b.log.len().saturating_sub(80);
    let hand_of = |seat: usize, p: &game::PlayerState| -> Option<Vec<serde_json::Value>> {
        if viewer_seat != Some(seat) {
            return None;
        }
        Some(
            p.hand
                .iter()
                .map(|c| {
                    let mut v = serde_json::to_value(c).unwrap_or_default();
                    v["curCost"] = serde_json::json!(game::card_cost(b, seat, c));
                    v
                })
                .collect(),
        )
    };
    State {
        seq: rb.seq,
        turn: b.turn.max(1) as u32,
        actor: b.actor as u8,
        winner: b.winner.map(|w| w as u8),
        phase: if b.winner.is_some() {
            "over".into()
        } else {
            "playing".into()
        },
        defs: rb.defs.clone(),
        p: b.players
            .iter()
            .enumerate()
            .map(|(seat, p)| {
                let discard_start = p.discard.len().saturating_sub(14);
                PlayerState {
                    hp: p.hp.max(0) as u32,
                    def: p.def,
                    energy: p.energy.max(0) as u32,
                    buffs: p
                        .buffs
                        .iter()
                        .map(|x| Buff {
                            btype: x.kind.clone(),
                            value: Some(x.value),
                            duration: Some(x.duration.max(0) as u32),
                        })
                        .collect(),
                    draw_count: p.draw.len() as u32,
                    hand_count: p.hand.len() as u32,
                    discard: p.discard[discard_start..]
                        .iter()
                        .map(|c| c.id.clone())
                        .collect(),
                    hand: hand_of(seat, p),
                }
            })
            .collect(),
        log: b.log[log_start..]
            .iter()
            .map(|e| serde_json::json!({"key": e.key, "params": e.params}))
            .collect(),
        play: rb.play.clone(),
        fd: rb.fd.clone(),
    }
}
