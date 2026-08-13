//! Layer 2 — Core 子系统的 CPU 决策。
//!
//! 纯函数：读取 Battle，产出 `CpuAction`（待执行的指令）。不直接修改
//! 状态，由 Layer 1 的 `execute` 执行。随机性只来自 `Battle.rng`。

use super::core::card_cost;
use super::state::*;

/// CPU 决策结果：下一步要执行的指令
#[derive(Debug, Clone)]
pub enum CpuAction {
    PlayCard(usize, Option<usize>),
    EndTurn,
}

/// 默认目标：血量最低的存活敌人
fn cpu_target(b: &Battle, pi: usize) -> Option<usize> {
    b.players
        .iter()
        .enumerate()
        .filter(|(i, p)| *i != pi && b.teams[*i] != b.teams[pi] && p.hp > 0)
        .min_by_key(|(_, p)| p.hp)
        .map(|(i, _)| i)
}

fn score_card(b: &Battle, pi: usize, c: &Card) -> f64 {
    let mut s = 0.0;
    for e in &c.effects {
        let v = e.value.unwrap_or(0) as f64;
        s += match e.kind.as_str() {
            "damage" => v * if e.pierce.unwrap_or(false) { 1.4 } else { 1.0 },
            "heal" => {
                if (b.players[pi].hp as f64) < b.players[pi].role.hp as f64 * 0.7 {
                    v * 0.9
                } else {
                    -2.0
                }
            }
            "gain_def" => v * 0.8,
            "gain_atk" => v * 0.6,
            "weaken_def" => v * 0.5,
            "cost_up" => v * 1.3,
            "dmg_reduce" => v * 0.4,
            "skip_turn" => 3.5,
            "extra_turn" => 4.0,
            "draw" => v * 1.6,
            "force_discard" => v * 1.2,
            "energy" => v * 0.5,
            _ => 0.0,
        };
    }
    s
}

/// 为当前行动方（`b.actor`）选择下一步指令
pub fn choose_cpu_action(b: &mut Battle) -> CpuAction {
    let pi = b.actor;
    let p = &b.players[pi];
    if p.hand.is_empty() {
        return CpuAction::EndTurn;
    }
    let mut best_idx = None;
    let mut best_score = -1e9f64;
    for (i, c) in p.hand.iter().enumerate() {
        if card_cost(b, pi, c) <= p.energy {
            let s = score_card(b, pi, c);
            if s > best_score {
                best_score = s;
                best_idx = Some(i);
            }
        }
    }
    match best_idx {
        Some(idx) => {
            let tgt = cpu_target(b, pi);
            CpuAction::PlayCard(idx, tgt)
        }
        None => CpuAction::EndTurn,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::core::{new_battle_teams, start_turn};

    fn mk_sub(hp: i32, def: i32, eng: i32) -> SubfactionDef {
        SubfactionDef { id: "x".into(), name: "X".into(), faction: None, hp, def, eng,
            intro: "".into(), img: "".into(), deck: None }
    }
    fn dmg_card(cost: i32, val: i32) -> Card {
        Card { id: "d".into(), name: "D".into(), cost, img: "".into(), desc: "".into(),
            effects: vec![Effect { kind: "damage".into(), value: Some(val), duration: None,
                pierce: None, target: None, fx: None }] }
    }
    fn defs() -> GameDefs {
        GameDefs {
            subfactions: vec![mk_sub(30, 2, 5), mk_sub(30, 2, 5)],
            cards: vec![dmg_card(1, 5), dmg_card(3, 10)],
            factions: vec![],
        }
    }

    #[test]
    fn cpu_ends_turn_when_hand_empty() {
        let mut b = new_battle_teams("cpu", &defs(), vec![0, 1], vec![0, 1], 1);
        start_turn(&mut b);
        // empty hand by clearing
        b.players[0].hand.clear();
        let action = choose_cpu_action(&mut b);
        assert!(matches!(action, CpuAction::EndTurn));
    }

    #[test]
    fn cpu_plays_highest_value_affordable_card() {
        let mut b = new_battle_teams("cpu", &defs(), vec![0, 1], vec![0, 1], 1);
        start_turn(&mut b);
        let action = choose_cpu_action(&mut b);
        // should prefer damage 10 (cost 3) over damage 5 (cost 1)
        match action {
            CpuAction::PlayCard(idx, _) => {
                assert_eq!(b.players[0].hand[idx].id, "d");
            }
            CpuAction::EndTurn => panic!("cpu should play a card"),
        }
    }

    #[test]
    fn cpu_skips_expensive_card() {
        let d = GameDefs {
            subfactions: vec![mk_sub(30, 0, 1), mk_sub(30, 0, 1)],
            cards: vec![dmg_card(1, 5), dmg_card(5, 20)],
            factions: vec![],
        };
        let mut b = new_battle_teams("cpu", &d, vec![0, 1], vec![0, 1], 1);
        start_turn(&mut b);
        let action = choose_cpu_action(&mut b);
        // energy=1, expensive card costs 5 → skip it
        match action {
            CpuAction::PlayCard(idx, _) => assert_eq!(b.players[0].hand[idx].id, "d"),
            CpuAction::EndTurn => panic!("cpu should play the affordable card"),
        }
    }
}
