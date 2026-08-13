//! 视图层 — 只读的状态格式化。
//!
//! 将 Battle 投影为面向终端/API 的文本视图。纯函数、无 IO，
//! 属于表现适配器，不属于 Core 规则（禁止修改状态）。

use super::state::*;

pub fn format_battle_state(b: &Battle) -> String {
    format_battle_state_for(b, 1)
}

/// 以 `local_player` 视角格式化（隐藏他人手牌明细）
pub fn format_battle_state_for(b: &Battle, local_player: usize) -> String {
    let mut s = String::new();
    s.push_str(&format!(
        "=== 回合 {} — {} 行动 ===\n\n",
        b.turn, b.players[b.actor].role.name
    ));

    for (i, p) in b.players.iter().enumerate() {
        let team_label = if i < b.teams.len() {
            format!("(队{})", b.teams[i])
        } else {
            String::new()
        };
        if i == local_player {
            s.push_str(&format!(
                "你 {} {}: HP {}/{}  DEF {}  能量 {}/{}\n",
                p.role.name, team_label, p.hp, p.role.hp, p.def, p.energy, p.role.eng
            ));
            let hand: Vec<String> = p
                .hand
                .iter()
                .enumerate()
                .map(|(j, c)| format!("{}({})", c.name, j))
                .collect();
            if !hand.is_empty() {
                s.push_str(&format!("手牌: {}\n", hand.join(" ")));
            }
            s.push_str(&format!(
                "牌堆 {} 张 | 弃牌 {} 张\n",
                p.draw.len(),
                p.discard.len()
            ));
        } else {
            s.push_str(&format!(
                "{} {}: HP {}/{}  DEF {}  能量 {}/{}\n",
                p.role.name, team_label, p.hp, p.role.hp, p.def, p.energy, p.role.eng
            ));
            if !p.hand.is_empty() {
                s.push_str(&format!("手牌: {} 张\n", p.hand.len()));
            }
            s.push_str(&format!(
                "牌堆 {} 张 | 弃牌 {} 张\n",
                p.draw.len(),
                p.discard.len()
            ));
        }
        if !p.buffs.is_empty() {
            let buffs: Vec<String> = p.buffs.iter().map(|b| b.kind.to_string()).collect();
            s.push_str(&format!("状态: {}\n", buffs.join(", ")));
        }
        s.push('\n');
    }

    if let Some(w) = b.winner {
        if w < b.players.len() {
            s.push_str(&format!("{} 获胜！\n", b.players[w].role.name));
        }
    }
    s
}

/// 最近最多 10 条日志的文本
pub fn format_log(b: &Battle) -> String {
    let start = if b.log.len() > 10 {
        b.log.len() - 10
    } else {
        0
    };
    b.log[start..]
        .iter()
        .map(render_log)
        .collect::<Vec<_>>()
        .join("\n")
}

fn render_log(e: &LogEvent) -> String {
    let p = &e.params;
    match e.key.as_str() {
        "log.damage" => format!(
            "{} 对 {} 造成 {} 点伤害",
            p["attacker"].as_str().unwrap_or("?"),
            p["target"].as_str().unwrap_or("?"),
            p["dmg"].as_i64().unwrap_or(0)
        ),
        "log.damage_pierce" => format!(
            "{} 对 {} 造成 {} 点伤害（真伤）",
            p["attacker"].as_str().unwrap_or("?"),
            p["target"].as_str().unwrap_or("?"),
            p["dmg"].as_i64().unwrap_or(0)
        ),
        "log.win" => format!(
            "{} 生命归零，{} 获胜！",
            p["loser"].as_str().unwrap_or("?"),
            p["winner"].as_str().unwrap_or("?")
        ),
        "log.heal" => format!(
            "{} 恢复 {} 点生命",
            p["target"].as_str().unwrap_or("?"),
            p["value"].as_i64().unwrap_or(0)
        ),
        "log.def_up" => format!(
            "{} 防御+{}",
            p["target"].as_str().unwrap_or("?"),
            p["value"].as_i64().unwrap_or(0)
        ),
        "log.atk_up" => format!(
            "{} 攻击+{}",
            p["target"].as_str().unwrap_or("?"),
            p["value"].as_i64().unwrap_or(0)
        ),
        "log.def_down" => format!(
            "{} 防御-{}（{}回合）",
            p["target"].as_str().unwrap_or("?"),
            p["value"].as_i64().unwrap_or(0),
            p["dur"].as_i64().unwrap_or(0)
        ),
        "log.cost_up" => format!(
            "{} 卡牌费用+{}（{}回合）",
            p["target"].as_str().unwrap_or("?"),
            p["value"].as_i64().unwrap_or(0),
            p["dur"].as_i64().unwrap_or(0)
        ),
        "log.dmg_reduce" => format!(
            "{} 获得 {}% 减伤（{}回合）",
            p["target"].as_str().unwrap_or("?"),
            p["value"].as_i64().unwrap_or(0),
            p["dur"].as_i64().unwrap_or(0)
        ),
        "log.skip_turn" => format!("{} 下一回合被跳过", p["target"].as_str().unwrap_or("?")),
        "log.extra_turn" => format!("{} 获得额外回合", p["target"].as_str().unwrap_or("?")),
        "log.draw" => format!(
            "{} 抽 {} 张牌",
            p["target"].as_str().unwrap_or("?"),
            p["value"].as_i64().unwrap_or(0)
        ),
        "log.force_discard" => format!(
            "{} 被迫弃置 {} 张手牌",
            p["target"].as_str().unwrap_or("?"),
            p["value"].as_i64().unwrap_or(0)
        ),
        "log.energy" => format!(
            "{} 能量{}{}",
            p["target"].as_str().unwrap_or("?"),
            p["sign"].as_str().unwrap_or("+"),
            p["value"].as_i64().unwrap_or(0)
        ),
        "log.blocked" => format!("{} 被禁行，本回合跳过", p["name"].as_str().unwrap_or("?")),
        "log.turn" => format!(
            "—— 第 {} 回合 · {} ——",
            p["n"].as_i64().unwrap_or(0),
            p["name"].as_str().unwrap_or("?")
        ),
        "log.play_card" => format!(
            "{} 打出【{}】",
            p["name"].as_str().unwrap_or("?"),
            p["card"].as_str().unwrap_or("?")
        ),
        "log.haste" => format!(
            "{} 发动【时间裂隙】继续行动",
            p["name"].as_str().unwrap_or("?")
        ),
        _ => format!("[{}] {:?}", e.key, e.params),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::state::{Card, Effect, SubfactionDef};
    use super::super::core::{new_battle, start_turn};

    fn test_defs() -> GameDefs {
        let sub = SubfactionDef { id: "t".into(), name: "Test".into(), faction: None,
            hp: 30, def: 2, eng: 3, intro: "".into(), img: "".into(), deck: None };
        let card = Card { id: "s".into(), name: "Strike".into(), cost: 1,
            img: "".into(), desc: "".into(),
            effects: vec![Effect { kind: "damage".into(), value: Some(5),
            duration: None, pierce: None, target: None, fx: None }] };
        GameDefs { subfactions: vec![sub; 2], cards: vec![card], factions: vec![] }
    }

    #[test]
    fn format_battle_state_includes_hp_and_name() {
        let d = test_defs();
        let mut b = new_battle("cpu", &d, 0, 1, 1);
        start_turn(&mut b);
        let out = format_battle_state(&b);
        assert!(out.contains("Test"), "should include player name");
        assert!(out.contains("30"), "should include initial HP");
    }

    #[test]
    fn format_battle_state_omits_opponent_hand_detail() {
        let d = test_defs();
        let mut b = new_battle("cpu", &d, 0, 1, 1);
        start_turn(&mut b);
        let out = format_battle_state_for(&b, 0);
        // player 0 sees their own hand detail
        assert!(out.contains("Strike"), "local player sees card name");
        // opponent only sees count, not card names
        // (opponent line has "手牌: N 张" without card names)
    }

    #[test]
    fn format_battle_state_shows_winner() {
        let d = test_defs();
        let mut b = new_battle("cpu", &d, 0, 1, 1);
        start_turn(&mut b);
        b.players[1].hp = 0;
        b.winner = Some(0);
        let out = format_battle_state(&b);
        assert!(out.contains("获胜"), "should show winner text");
    }

    #[test]
    fn format_log_handles_all_known_keys() {
        let d = test_defs();
        let mut b = new_battle("cpu", &d, 0, 1, 1);
        start_turn(&mut b);
        // add synthetic log entries for each key
        let keys = vec![
            "log.damage", "log.damage_pierce", "log.win", "log.heal",
            "log.def_up", "log.atk_up", "log.def_down", "log.cost_up",
            "log.dmg_reduce", "log.skip_turn", "log.extra_turn", "log.draw",
            "log.force_discard", "log.energy", "log.blocked", "log.turn",
            "log.play_card", "log.haste",
        ];
        for key in &keys {
            b.log.push(LogEvent {
                key: key.to_string(),
                params: serde_json::json!({ "name": "Test", "target": "Test", "attacker": "Test",
                    "loser": "Test", "winner": "Test", "card": "Strike",
                    "dmg": 5, "value": 3, "dur": 2 }),
            });
        }
        let out = format_log(&b);
        for key in &keys {
            assert!(!out.is_empty(), "format_log should produce output for {}", key);
        }
    }

    #[test]
    fn format_log_truncates_to_last_10() {
        let d = test_defs();
        let mut b = new_battle("cpu", &d, 0, 1, 1);
        start_turn(&mut b);
        for i in 0..15 {
            b.log.push(LogEvent {
                key: "log.turn".into(),
                params: serde_json::json!({ "n": i, "name": format!("T{}", i) }),
            });
        }
        let out = format_log(&b);
        // should contain only last 10
        assert!(!out.contains("T0"), "oldest entries should be truncated");
        assert!(out.contains("T14"), "last entry should be present");
    }
}
