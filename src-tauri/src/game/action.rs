//! Layer 1 — Action（动作/指令层）。
//!
//! 定义所有战斗指令的数据结构，并把「玩家意图」与「执行逻辑」分离：
//! - `Action`：指令契约（出牌/结束回合/开始回合/CPU 决策）
//! - `validate`：前置校验，判断指令在当前 State 下是否可被接受
//! - `execute`：唯一行动入口，`(state, action) → (newState, events[])`
//!
//! 所有外部入口（WASM 绑定、HTTP API、CLI）都必须经由 `execute`
//! 结算战斗，禁止绕过本层直接调用 Core 细节函数。

use super::ai::CpuAction;
use super::core::{self, end_turn, play_card_target, start_turn};
use super::state::*;

/// 战斗指令契约
#[derive(Debug, Clone)]
pub enum Action {
    /// 打出第 `idx` 张手牌，`target` 为 None 表示自动选敌
    PlayCard {
        pi: usize,
        idx: usize,
        target: Option<usize>,
    },
    /// 结束玩家 `pi` 的回合
    EndTurn { pi: usize },
    /// 开始当前行动方的回合
    StartTurn,
    /// 执行当前行动方的 CPU 决策
    CpuStep,
}

/// 前置校验：判断 Action 在当前 State 下是否可被接受。
///
/// 校验失败返回错误信息（供调用方直接展示），不修改状态。
pub fn validate(b: &Battle, action: &Action) -> Result<(), String> {
    match action {
        Action::PlayCard { pi, idx, .. } => {
            let p = b
                .players
                .get(*pi)
                .ok_or_else(|| "invalid player".to_string())?;
            if *idx >= p.hand.len() {
                return Err("invalid card index".into());
            }
            if b.winner.is_some() {
                return Err("game already ended".into());
            }
            if p.energy < core::card_cost(b, *pi, &p.hand[*idx]) {
                return Err("not enough energy".into());
            }
            Ok(())
        }
        Action::EndTurn { pi } => {
            if b.winner.is_some() {
                return Err("game already ended".into());
            }
            if b.players.get(*pi).is_none() {
                return Err("invalid player".into());
            }
            if *pi != b.actor {
                return Err("not your turn".into());
            }
            Ok(())
        }
        Action::StartTurn => {
            if b.winner.is_some() {
                return Err("game already ended".into());
            }
            Ok(())
        }
        Action::CpuStep => {
            if b.winner.is_some() {
                return Err("game already ended".into());
            }
            Ok(())
        }
    }
}

/// 唯一战斗入口：校验 → 结算 → 返回事件列表。
///
/// 状态变更的唯一来源。返回的事件由 Layer 3 事件系统按序消费，
/// 调用方负责原子替换 State 快照。
pub fn execute(b: &mut Battle, action: Action) -> Result<Vec<GameEvent>, String> {
    validate(b, &action)?;
    match action {
        Action::PlayCard { pi, idx, target } => play_card_target(b, pi, idx, target),
        Action::EndTurn { pi } => {
            end_turn(b, pi);
            Ok(vec![])
        }
        Action::StartTurn => {
            start_turn(b);
            Ok(vec![])
        }
        Action::CpuStep => match super::ai::choose_cpu_action(b) {
            CpuAction::PlayCard(idx, tgt) => play_card_target(b, b.actor, idx, tgt),
            CpuAction::EndTurn => {
                end_turn(b, b.actor);
                Ok(vec![])
            }
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::core::{new_battle_teams, start_turn};

    fn make_defs_with_cards(cost: i32, effect_kind: &str, effect_value: i32) -> GameDefs {
        let sub = SubfactionDef {
            id: "p".into(), name: "P".into(), faction: None,
            hp: 40, def: 0, eng: 5, intro: "".into(), img: "".into(),
            deck: None,
        };
        let card = Card {
            id: "atk".into(), name: "Atk".into(), cost,
            img: "".into(), desc: "".into(),
            effects: vec![Effect {
                kind: effect_kind.into(), value: Some(effect_value),
                duration: None, pierce: None, target: None, fx: None,
            }],
        };
        GameDefs { subfactions: vec![sub; 2], cards: vec![card], factions: vec![] }
    }

    #[test]
    fn validate_play_card_invalid_player() {
        let d = make_defs_with_cards(1, "damage", 5);
        let b = new_battle_teams("cpu", &d, vec![0, 1], vec![0, 1], 1);
        assert!(validate(&b, &Action::PlayCard { pi: 99, idx: 0, target: None }).is_err());
    }

    #[test]
    fn validate_play_card_invalid_index() {
        let d = make_defs_with_cards(1, "damage", 5);
        let mut b = new_battle_teams("cpu", &d, vec![0, 1], vec![0, 1], 1);
        start_turn(&mut b);
        assert!(validate(&b, &Action::PlayCard { pi: 0, idx: 99, target: None }).is_err());
    }

    #[test]
    fn validate_play_card_not_enough_energy() {
        let d = make_defs_with_cards(10, "damage", 1);
        let mut b = new_battle_teams("cpu", &d, vec![0, 1], vec![0, 1], 1);
        start_turn(&mut b);
        assert!(validate(&b, &Action::PlayCard { pi: 0, idx: 0, target: None }).is_err());
    }

    #[test]
    fn validate_play_card_ok_with_enough_energy() {
        let d = make_defs_with_cards(3, "damage", 5);
        let mut b = new_battle_teams("cpu", &d, vec![0, 1], vec![0, 1], 1);
        start_turn(&mut b);
        assert!(validate(&b, &Action::PlayCard { pi: 0, idx: 0, target: None }).is_ok());
    }

    #[test]
    fn validate_end_turn_game_already_ended() {
        let d = make_defs_with_cards(1, "damage", 99);
        let mut b = new_battle_teams("cpu", &d, vec![0, 1], vec![0, 1], 1);
        start_turn(&mut b);
        b.winner = Some(0);
        assert!(validate(&b, &Action::EndTurn { pi: 0 }).is_err());
    }

    #[test]
    fn validate_end_turn_invalid_player() {
        let d = make_defs_with_cards(1, "damage", 1);
        let b = new_battle_teams("cpu", &d, vec![0, 1], vec![0, 1], 1);
        assert!(validate(&b, &Action::EndTurn { pi: 99 }).is_err());
    }

    #[test]
    fn validate_end_turn_not_your_turn() {
        let d = make_defs_with_cards(1, "damage", 1);
        let b = new_battle_teams("cpu", &d, vec![0, 1], vec![0, 1], 1);
        assert!(validate(&b, &Action::EndTurn { pi: 1 }).is_err());
    }

    #[test]
    fn validate_start_turn_game_already_ended() {
        let d = make_defs_with_cards(1, "damage", 1);
        let mut b = new_battle_teams("cpu", &d, vec![0, 1], vec![0, 1], 1);
        b.winner = Some(0);
        assert!(validate(&b, &Action::StartTurn).is_err());
    }

    #[test]
    fn validate_cpu_step_game_already_ended() {
        let d = make_defs_with_cards(1, "damage", 1);
        let mut b = new_battle_teams("cpu", &d, vec![0, 1], vec![0, 1], 1);
        b.winner = Some(0);
        assert!(validate(&b, &Action::CpuStep).is_err());
    }

    #[test]
    fn execute_starts_turn_succeeds() {
        let d = make_defs_with_cards(1, "damage", 1);
        let mut b = new_battle_teams("cpu", &d, vec![0, 1], vec![0, 1], 1);
        let events = execute(&mut b, Action::StartTurn).expect("start turn should succeed");
        assert_eq!(events.len(), 0);
        assert_eq!(b.turn, 1);
    }

    #[test]
    fn execute_play_card_succeeds_and_changes_state() {
        let d = make_defs_with_cards(1, "damage", 99);
        let mut b = new_battle_teams("cpu", &d, vec![0, 1], vec![0, 1], 1);
        start_turn(&mut b);
        let events = execute(&mut b, Action::PlayCard { pi: 0, idx: 0, target: Some(1) })
            .expect("play should succeed");
        assert!(!events.is_empty());
        assert_eq!(events[0].kind, "damage");
        assert!(b.players[1].hp < b.players[1].role.hp);
    }

    #[test]
    fn execute_end_turn_succeeds_advances_actor() {
        let d = make_defs_with_cards(1, "damage", 1);
        let mut b = new_battle_teams("cpu", &d, vec![0, 1], vec![0, 1], 1);
        start_turn(&mut b);
        execute(&mut b, Action::EndTurn { pi: 0 }).expect("end turn should succeed");
        assert_eq!(b.actor, 1);
    }

    #[test]
    fn execute_rejects_out_of_turn_end_turn() {
        let d = make_defs_with_cards(1, "damage", 1);
        let mut b = new_battle_teams("cpu", &d, vec![0, 1], vec![0, 1], 1);
        start_turn(&mut b);
        assert!(execute(&mut b, Action::EndTurn { pi: 1 }).is_err());
    }

    #[test]
    fn cpu_step_plays_card_when_affordable() {
        let d = make_defs_with_cards(1, "damage", 99);
        let mut b = new_battle_teams("cpu", &d, vec![0, 1], vec![0, 1], 1);
        start_turn(&mut b);
        let events = execute(&mut b, Action::CpuStep).expect("cpu step should succeed");
        assert!(!events.is_empty(), "cpu should play the high-value damage card");
    }
}
