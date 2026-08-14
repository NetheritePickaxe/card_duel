//! `/api/game/*` — LLM API 适配器。
//!
//! 外部 AI 通过 REST 驱动一局完整对战（服务端 `game::Battle`）。
//! 结算一律经 `game::action::execute`，本层只做请求解析与响应序列化。

use super::ServerState;
use tiny_http::Request;

impl ServerState {
    pub(crate) fn handle_game_list(&self, request: Request) {
        let games = self.games.lock();
        let info: Vec<serde_json::Value> = games
            .keys()
            .map(|id| serde_json::json!({"id": id}))
            .collect();
        self.respond_json(
            request,
            200,
            &serde_json::json!({"ok": true, "games": info}),
        );
    }

    pub(crate) fn handle_game_new(&self, request: Request, query: &str) {
        let app_dir = "app";
        let defs = match crate::game::load_defs(app_dir) {
            Ok(d) => d,
            Err(e) => {
                self.respond_json(request, 400, &serde_json::json!({"ok": false, "err": e}));
                return;
            }
        };
        let p0 =
            crate::game::get_subfaction_index(&defs, Self::extract_param(query, "p0")).unwrap_or(0);
        let p1 = crate::game::get_subfaction_index(&defs, Self::extract_param(query, "p1"))
            .unwrap_or(if defs.subfactions.len() > 1 { 1 } else { 0 });
        let seed = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos() as u64;
        let mut b = crate::game::new_battle("cpu", &defs, p0, p1, seed);
        if let Err(e) = crate::game::action::execute(&mut b, crate::game::action::Action::StartTurn)
        {
            self.respond_json(request, 400, &serde_json::json!({"ok": false, "err": e}));
            return;
        }
        let id = format!(
            "g{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap_or_default()
                .as_secs()
        );
        self.games.lock().insert(id.clone(), b);
        self.respond_json(
            request,
            200,
            &serde_json::json!({"ok": true, "game_id": id}),
        );
    }

    pub(crate) fn handle_game_action(
        &self,
        request: Request,
        path: &str,
        method: &str,
        query: &str,
    ) {
        let parts: Vec<&str> = path.splitn(2, '/').collect();
        if parts.len() < 2 {
            self.respond_json(
                request,
                404,
                &serde_json::json!({"ok": false, "err": "not found"}),
            );
            return;
        }
        let game_id = parts[0].to_string();
        let action = parts[1].to_string();

        if action == "act" && method != "POST" {
            self.respond_json(
                request,
                405,
                &serde_json::json!({"ok": false, "err": "method not allowed"}),
            );
            return;
        }

        if action == "act" {
            let mut req = request;
            let b = Self::read_body(&mut req);
            let params: serde_json::Value =
                serde_json::from_str(&b).unwrap_or(serde_json::json!({}));
            let player = params["player"].as_i64().unwrap_or(1) as usize;
            let action_type = params["action"].as_str().unwrap_or("").to_string();
            let card_idx = params["card"].as_i64().unwrap_or(0) as usize;

            let mut games = self.games.lock();
            let b = match games.get_mut(&game_id) {
                Some(b) => b,
                None => {
                    self.respond_json(
                        req,
                        404,
                        &serde_json::json!({"ok": false, "err": "game not found"}),
                    );
                    return;
                }
            };

            match action_type.as_str() {
                "play" => match crate::game::action::execute(
                    b,
                    crate::game::action::Action::PlayCard {
                        pi: player,
                        idx: card_idx,
                        target: None,
                    },
                ) {
                    Ok(_) => self.respond_json(
                        req,
                        200,
                        &serde_json::json!({"ok": true, "winner": b.winner, "state": crate::game::format_battle_state(b)}),
                    ),
                    Err(e) => self.respond_json(
                        req,
                        400,
                        &serde_json::json!({"ok": false, "err": e}),
                    ),
                },
                "endturn" => match crate::game::action::execute(
                    b,
                    crate::game::action::Action::EndTurn { pi: player },
                ) {
                    Ok(_) => self.respond_json(
                        req,
                        200,
                        &serde_json::json!({"ok": true, "state": crate::game::format_battle_state(b)}),
                    ),
                    Err(e) => self.respond_json(
                        req,
                        400,
                        &serde_json::json!({"ok": false, "err": e}),
                    ),
                },
                "cpu" => {
                    if b.actor != 0 {
                        self.respond_json(
                            req,
                            400,
                            &serde_json::json!({"ok": false, "err": "not CPU turn"}),
                        );
                        return;
                    }
                    let actor_before = b.actor;
                    let action_name = match crate::game::action::execute(
                        b,
                        crate::game::action::Action::CpuStep,
                    ) {
                        Ok(_) => {
                            if b.winner.is_some() || b.actor != actor_before {
                                "endturn".to_string()
                            } else {
                                "play".to_string()
                            }
                        }
                        Err(e) => {
                            self.respond_json(
                                req,
                                400,
                                &serde_json::json!({"ok": false, "err": e}),
                            );
                            return;
                        }
                    };
                    self.respond_json( req, 200, &serde_json::json!({
                        "ok": true, "action": action_name,
                        "state": crate::game::format_battle_state(b),
                    }));
                }
                _ => self.respond_json(
                    req,
                    400,
                    &serde_json::json!({"ok": false, "err": "unknown action"}),
                ),
            }
            return;
        }

        let mut games = self.games.lock();
        let b = match games.get_mut(&game_id) {
            Some(b) => b,
            None => {
                self.respond_json(
                    request,
                    404,
                    &serde_json::json!({"ok": false, "err": "game not found"}),
                );
                return;
            }
        };

        match action.as_str() {
            "state" => {
                let viewer = Self::extract_param(query, "viewer")
                    .parse::<usize>()
                    .unwrap_or(1);
                let viewer = if viewer < 2 { viewer } else { 1 };
                self.respond_json(
                    request,
                    200,
                    &serde_json::json!({
                        "ok": true,
                        "state": crate::game::format_battle_state_for(b, viewer),
                        "log": crate::game::format_log(b),
                        "winner": b.winner,
                        "turn": b.turn,
                        "actor": b.actor,
                        "players": b.players.iter().map(|p| serde_json::json!({
                            "name": p.role.name,
                            "hp": p.hp,
                            "max_hp": p.role.hp,
                            "def": p.def,
                            "energy": p.energy,
                            "max_energy": p.role.eng,
                            "hand": p.hand.iter().enumerate().map(|(i, c)| serde_json::json!({
                                "index": i, "id": c.id, "name": c.name, "cost": c.cost,
                                "desc": c.desc
                            })).collect::<Vec<_>>(),
                            "deck_size": p.draw.len(),
                            "discard_size": p.discard.len(),
                        })).collect::<Vec<_>>(),
                    }),
                );
            }
            _ => self.respond_json(
                request,
                404,
                &serde_json::json!({"ok": false, "err": "not found"}),
            ),
        }
    }
}
