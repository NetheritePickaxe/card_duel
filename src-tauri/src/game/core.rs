//! Layer 2 — Core（核心领域层）。
//!
//! 纯函数战斗引擎：唯一有权计算状态变更。输入当前 State 与 Action，
//! 输出新的 State 与事件列表。无副作用、无外部 IO、无隐式随机
//! （随机性通过 `Battle.rng` 注入，可种子复现）。

use super::effects::resolve_effects_target;
use super::state::*;
use rand::rngs::StdRng;
use rand::seq::SliceRandom;
use rand::{Rng, SeedableRng};

/// 写入一条结构化日志事件（领域处理器消费）
pub(crate) fn log_event(b: &mut Battle, key: &str, params: serde_json::Value) {
    b.log.push(LogEvent {
        key: key.to_string(),
        params,
    });
}

pub(crate) fn shuffle<T: Clone>(v: &mut [T], rng: &mut impl Rng) {
    v.shuffle(rng);
}

pub(crate) fn rand_int(rng: &mut impl Rng, n: usize) -> usize {
    if n == 0 {
        return 0;
    }
    rng.gen_range(0..n)
}

/// 按队伍交替生成行动顺序（按队伍编号 0..N 轮转，每轮按队伍号各取一名玩家）
fn build_order(teams: &[usize]) -> Vec<usize> {
    let group_n = teams.iter().copied().max().map(|m| m + 1).unwrap_or(0);
    let mut groups: Vec<Vec<usize>> = (0..group_n).map(|_| vec![]).collect();
    for (i, &t) in teams.iter().enumerate() {
        if t < group_n {
            groups[t].push(i);
        }
    }
    let max_len = groups.iter().map(|g| g.len()).max().unwrap_or(0);
    let mut order = Vec::new();
    for i in 0..max_len {
        for g in &groups {
            if i < g.len() {
                order.push(g[i]);
            }
        }
    }
    order
}

/// 推进到下一个存活角色
fn advance_actor(b: &mut Battle) {
    if b.players.is_empty() || b.order.is_empty() {
        return;
    }
    let pos = b.order.iter().position(|&x| x == b.actor).unwrap_or(0);
    for i in 1..b.order.len() {
        let next = b.order[(pos + i) % b.order.len()];
        if b.players[next].hp > 0 {
            b.actor = next;
            return;
        }
    }
}

/// 胜负判定：只剩一个队伍存活即分出胜负
pub(crate) fn check_team_winner(b: &mut Battle) -> bool {
    if b.winner.is_some() {
        return true;
    }
    let alive_teams: std::collections::HashSet<usize> = b
        .players
        .iter()
        .enumerate()
        .filter(|(_, p)| p.hp > 0)
        .map(|(i, _)| b.teams[i])
        .collect();
    if alive_teams.len() <= 1 {
        if let Some(winner) = b.players.iter().position(|p| p.hp > 0) {
            b.winner = Some(winner);
            return true;
        }
    }
    false
}

// ============ 对局创建 ============

pub fn new_battle(mode: &str, defs: &GameDefs, p0: usize, p1: usize, seed: u64) -> Battle {
    new_battle_teams(mode, defs, vec![p0, p1], vec![0, 1], seed)
}

pub fn new_battle_teams(
    mode: &str,
    defs: &GameDefs,
    indices: Vec<usize>,
    teams: Vec<usize>,
    seed: u64,
) -> Battle {
    let order = build_order(&teams);
    let mut b = Battle {
        mode: mode.to_string(),
        seq: 0,
        turn: 1,
        actor: order.first().copied().unwrap_or(0),
        winner: None,
        players: vec![],
        teams,
        order,
        log: vec![],
        rng: StdRng::seed_from_u64(seed),
    };
    for &i in &indices {
        let mut p = make_player(&defs.subfactions[i], defs);
        shuffle(&mut p.draw, &mut b.rng);
        b.players.push(p);
    }
    b
}

fn make_player(r: &SubfactionDef, defs: &GameDefs) -> PlayerState {
    let mut d = vec![];
    if let Some(ref deck) = r.deck {
        for cid in deck {
            if let Some(c) = defs.cards.iter().find(|x| x.id == *cid) {
                d.push(c.clone());
            }
        }
    } else {
        for c in &defs.cards {
            d.push(c.clone());
            d.push(c.clone());
        }
    }
    PlayerState {
        role: r.clone(),
        hp: r.hp,
        def: r.def,
        energy: 0,
        buffs: vec![],
        draw: d,
        hand: vec![],
        discard: vec![],
    }
}

// ============ 数值计算（纯函数） ============

pub fn sum_buff(p: &PlayerState, kind: &str) -> i32 {
    p.buffs
        .iter()
        .filter(|x| x.kind == kind)
        .map(|x| x.value)
        .sum()
}

pub fn card_cost(b: &Battle, pi: usize, card: &Card) -> i32 {
    (card.cost + sum_buff(&b.players[pi], "cost_up")).max(0)
}

pub fn calc_damage(att: &PlayerState, tgt: &PlayerState, value: i32, pierce: bool) -> i32 {
    let v = value + sum_buff(att, "gain_atk");
    let effective_def = (tgt.def - sum_buff(tgt, "weaken_def")).max(0);
    let dmg = if pierce {
        v
    } else {
        (v - effective_def).max(0)
    };
    let red = sum_buff(tgt, "dmg_reduce");
    if red > 0 {
        ((dmg * (100 - red)) as f64 / 100.0).round() as i32
    } else {
        dmg
    }
}

// ============ 牌库操作 ============

pub(crate) fn draw_cards(b: &mut Battle, pi: usize, n: i32, overflow: bool) {
    let p = &mut b.players[pi];
    for _ in 0..n {
        if p.hand.len() >= HAND_MAX as usize && !overflow {
            break;
        }
        if p.draw.is_empty() {
            if p.discard.is_empty() {
                break;
            }
            let mut rd = std::mem::take(&mut p.discard);
            shuffle(&mut rd, &mut b.rng);
            p.draw = rd;
        }
        if let Some(c) = p.draw.pop() {
            if p.hand.len() >= HAND_MAX as usize {
                p.discard.push(c);
                continue;
            }
            p.hand.push(c);
        }
    }
}

pub(crate) fn force_discard(b: &mut Battle, t: usize, n: i32) {
    let p = &mut b.players[t];
    for _ in 0..n {
        if p.hand.is_empty() {
            break;
        }
        let idx = rand_int(&mut b.rng, p.hand.len());
        let c = p.hand.remove(idx);
        p.discard.push(c);
    }
}

// ============ 回合流转 ============

pub fn start_turn(b: &mut Battle) {
    if b.winner.is_some() {
        return;
    }
    let pi = b.actor;
    if b.players[pi].hp <= 0 {
        advance_actor(b);
        if check_team_winner(b) {
            return;
        }
        b.turn += 1;
        start_turn(b);
        return;
    }
    let sk = b.players[pi]
        .buffs
        .iter()
        .position(|x| x.kind == "skip_turn");
    if let Some(idx) = sk {
        b.players[pi].buffs.remove(idx);
        log_event(
            b,
            "log.blocked",
            serde_json::json!({ "name": b.players[pi].role.name.clone() }),
        );
        advance_actor(b);
        if check_team_winner(b) {
            return;
        }
        b.turn += 1;
        start_turn(b);
        return;
    }
    tick_buffs(b, pi);
    b.players[pi].energy = b.players[pi].role.eng;
    let count = if b.turn == 1 { 5 } else { 2 };
    draw_cards(b, pi, count, false);
    log_event(
        b,
        "log.turn",
        serde_json::json!({ "n": b.turn, "name": b.players[pi].role.name.clone() }),
    );
}

pub fn end_turn(b: &mut Battle, pi: usize) {
    let ex = b.players[pi]
        .buffs
        .iter()
        .position(|x| x.kind == "extra_turn");
    if let Some(idx) = ex {
        b.players[pi].buffs.remove(idx);
        log_event(
            b,
            "log.haste",
            serde_json::json!({ "name": b.players[pi].role.name.clone() }),
        );
        start_turn(b);
        return;
    }
    advance_actor(b);
    if check_team_winner(b) {
        return;
    }
    b.turn += 1;
    start_turn(b);
}

/// Find the first alive opponent (different team) for default targeting.
pub(crate) fn first_opponent(b: &Battle, pi: usize) -> Option<usize> {
    b.players
        .iter()
        .enumerate()
        .find(|(i, p)| *i != pi && b.teams[*i] != b.teams[pi] && p.hp > 0)
        .map(|(i, _)| i)
}

// ============ 行动执行（Core 入口，由 Layer 1 Action 分发） ============

pub fn play_card(b: &mut Battle, pi: usize, idx: usize) -> Result<Vec<GameEvent>, String> {
    play_card_target(b, pi, idx, None)
}

pub fn play_card_target(
    b: &mut Battle,
    pi: usize,
    idx: usize,
    target: Option<usize>,
) -> Result<Vec<GameEvent>, String> {
    let cost = {
        let p = &b.players[pi];
        if idx >= p.hand.len() {
            return Err("invalid card index".into());
        }
        let card = &p.hand[idx];
        if p.energy < card_cost(b, pi, card) {
            return Err("not enough energy".into());
        }
        if b.winner.is_some() {
            return Err("game already ended".into());
        }
        card_cost(b, pi, card)
    };
    let card = b.players[pi].hand.remove(idx);
    b.players[pi].energy -= cost;
    let events = resolve_effects_target(b, pi, &card, target);
    let card_name = card.name.clone();
    log_event(
        b,
        "log.play_card",
        serde_json::json!({ "name": b.players[pi].role.name.clone(), "card": card_name }),
    );
    b.players[pi].discard.push(card);
    Ok(events)
}

pub fn tick_buffs(b: &mut Battle, pi: usize) {
    let p = &mut b.players[pi];
    let mut i = p.buffs.len();
    while i > 0 {
        i -= 1;
        if p.buffs[i].kind == "skip_turn" || p.buffs[i].kind == "extra_turn" {
            continue;
        }
        p.buffs[i].duration -= 1;
        if p.buffs[i].duration <= 0 {
            if p.buffs[i].kind == "gain_def" {
                p.def = (p.def - p.buffs[i].value).max(0);
            }
            p.buffs.remove(i);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn mk_sub(id: &str, hp: i32, def: i32, eng: i32) -> SubfactionDef {
        SubfactionDef {
            id: id.into(),
            name: id.into(),
            faction: None,
            hp,
            def,
            eng,
            intro: "".into(),
            img: "".into(),
            deck: None,
        }
    }
    fn mk_card(id: &str, cost: i32, kind: &str, val: i32) -> Card {
        Card {
            id: id.into(),
            name: id.into(),
            cost,
            img: "".into(),
            desc: "".into(),
            effects: vec![Effect {
                kind: kind.into(),
                value: Some(val),
                duration: None,
                pierce: None,
                target: None,
                fx: None,
            }],
        }
    }
    fn mk_defs(sub: SubfactionDef, card: Card) -> GameDefs {
        GameDefs {
            subfactions: vec![sub.clone(), sub],
            cards: vec![card],
            factions: vec![],
        }
    }

    // ===== calc_damage =====

    #[test]
    fn calc_damage_zero_def_no_reduction() {
        let att = PlayerState {
            role: mk_sub("a", 10, 0, 0),
            hp: 10,
            def: 0,
            energy: 0,
            buffs: vec![],
            draw: vec![],
            hand: vec![],
            discard: vec![],
        };
        let tgt = PlayerState {
            role: mk_sub("t", 10, 0, 0),
            hp: 10,
            def: 0,
            energy: 0,
            buffs: vec![],
            draw: vec![],
            hand: vec![],
            discard: vec![],
        };
        assert_eq!(calc_damage(&att, &tgt, 8, false), 8);
    }

    #[test]
    fn calc_damage_def_absorbs_partial() {
        let att = PlayerState {
            role: mk_sub("a", 10, 0, 0),
            hp: 10,
            def: 0,
            energy: 0,
            buffs: vec![],
            draw: vec![],
            hand: vec![],
            discard: vec![],
        };
        let tgt = PlayerState {
            role: mk_sub("t", 10, 0, 0),
            hp: 10,
            def: 5,
            energy: 0,
            buffs: vec![],
            draw: vec![],
            hand: vec![],
            discard: vec![],
        };
        assert_eq!(calc_damage(&att, &tgt, 8, false), 3); // 8-5=3
    }

    #[test]
    fn calc_damage_def_absorbs_all() {
        let att = PlayerState {
            role: mk_sub("a", 10, 0, 0),
            hp: 10,
            def: 0,
            energy: 0,
            buffs: vec![],
            draw: vec![],
            hand: vec![],
            discard: vec![],
        };
        let tgt = PlayerState {
            role: mk_sub("t", 10, 0, 0),
            hp: 10,
            def: 10,
            energy: 0,
            buffs: vec![],
            draw: vec![],
            hand: vec![],
            discard: vec![],
        };
        assert_eq!(calc_damage(&att, &tgt, 5, false), 0);
    }

    #[test]
    fn calc_damage_atk_buff_adds() {
        let att = PlayerState {
            role: mk_sub("a", 10, 0, 0),
            hp: 10,
            def: 0,
            energy: 0,
            buffs: vec![Buff {
                kind: "gain_atk".into(),
                value: 3,
                duration: 99,
            }],
            draw: vec![],
            hand: vec![],
            discard: vec![],
        };
        let tgt = PlayerState {
            role: mk_sub("t", 10, 0, 0),
            hp: 10,
            def: 0,
            energy: 0,
            buffs: vec![],
            draw: vec![],
            hand: vec![],
            discard: vec![],
        };
        assert_eq!(calc_damage(&att, &tgt, 5, false), 8); // 5+3=8
    }

    #[test]
    fn calc_damage_weaken_def_reduces() {
        let att = PlayerState {
            role: mk_sub("a", 10, 0, 0),
            hp: 10,
            def: 0,
            energy: 0,
            buffs: vec![],
            draw: vec![],
            hand: vec![],
            discard: vec![],
        };
        let tgt = PlayerState {
            role: mk_sub("t", 10, 0, 0),
            hp: 10,
            def: 4,
            energy: 0,
            buffs: vec![Buff {
                kind: "weaken_def".into(),
                value: 2,
                duration: 99,
            }],
            draw: vec![],
            hand: vec![],
            discard: vec![],
        };
        assert_eq!(calc_damage(&att, &tgt, 6, false), 4); // def 4-2=2, dmg 6-2=4
    }

    #[test]
    fn calc_damage_dmg_reduce_pct() {
        let att = PlayerState {
            role: mk_sub("a", 10, 0, 0),
            hp: 10,
            def: 0,
            energy: 0,
            buffs: vec![],
            draw: vec![],
            hand: vec![],
            discard: vec![],
        };
        let tgt = PlayerState {
            role: mk_sub("t", 10, 0, 0),
            hp: 10,
            def: 0,
            energy: 0,
            buffs: vec![Buff {
                kind: "dmg_reduce".into(),
                value: 50,
                duration: 99,
            }],
            draw: vec![],
            hand: vec![],
            discard: vec![],
        };
        assert_eq!(calc_damage(&att, &tgt, 10, false), 5);
    }

    #[test]
    fn calc_damage_def_floor_at_zero() {
        let att = PlayerState {
            role: mk_sub("a", 10, 0, 0),
            hp: 10,
            def: 0,
            energy: 0,
            buffs: vec![],
            draw: vec![],
            hand: vec![],
            discard: vec![],
        };
        let tgt = PlayerState {
            role: mk_sub("t", 10, 0, 0),
            hp: 10,
            def: 0,
            energy: 0,
            buffs: vec![Buff {
                kind: "weaken_def".into(),
                value: 99,
                duration: 99,
            }],
            draw: vec![],
            hand: vec![],
            discard: vec![],
        };
        // def clamped at 0 → no reduction
        assert_eq!(calc_damage(&att, &tgt, 10, false), 10);
    }

    // ===== sum_buff =====

    #[test]
    fn sum_buff_matches_kind() {
        let p = PlayerState {
            role: mk_sub("x", 10, 0, 0),
            hp: 10,
            def: 0,
            energy: 0,
            buffs: vec![
                Buff {
                    kind: "gain_def".into(),
                    value: 3,
                    duration: 2,
                },
                Buff {
                    kind: "gain_def".into(),
                    value: 2,
                    duration: 1,
                },
                Buff {
                    kind: "gain_atk".into(),
                    value: 5,
                    duration: 99,
                },
            ],
            draw: vec![],
            hand: vec![],
            discard: vec![],
        };
        assert_eq!(sum_buff(&p, "gain_def"), 5);
        assert_eq!(sum_buff(&p, "gain_atk"), 5);
        assert_eq!(sum_buff(&p, "unknown"), 0);
    }

    // ===== card_cost =====

    #[test]
    fn card_cost_with_cost_up_buff() {
        let d = mk_defs(mk_sub("x", 10, 0, 3), mk_card("c", 2, "damage", 3));
        let mut b = new_battle_teams("cpu", &d, vec![0], vec![0], 1);
        start_turn(&mut b);
        // add cost_up buff
        b.players[0].buffs.push(Buff {
            kind: "cost_up".into(),
            value: 2,
            duration: 99,
        });
        assert_eq!(card_cost(&b, 0, &b.players[0].hand[0]), 4); // 2+2=4
    }

    // ===== draw_cards =====

    #[test]
    fn draw_cards_respects_hand_max() {
        let d = mk_defs(mk_sub("x", 10, 0, 3), mk_card("c", 1, "damage", 1));
        let mut b = new_battle_teams("cpu", &d, vec![0, 1], vec![0, 1], 1);
        start_turn(&mut b);
        let pi = 0;
        // fill hand to max by drawing extra
        draw_cards(&mut b, pi, HAND_MAX * 2, false);
        assert!(b.players[pi].hand.len() <= HAND_MAX as usize);
    }

    #[test]
    fn draw_cards_recreates_deck_from_discard() {
        let d = mk_defs(mk_sub("x", 10, 0, 1), mk_card("c", 1, "damage", 1));
        let mut b = new_battle_teams("cpu", &d, vec![0, 1], vec![0, 1], 42);
        start_turn(&mut b);
        // play all cards in hand to build discard
        let pi = 0;
        let hand_len = b.players[pi].hand.len();
        for _ in 0..hand_len {
            let card = b.players[pi].hand.remove(0);
            b.players[pi].discard.push(card);
        }
        assert!(b.players[pi].draw.is_empty());
        // now draw should rebuild from discard
        draw_cards(&mut b, pi, 1, true);
        assert!(!b.players[pi].draw.is_empty() || !b.players[pi].hand.is_empty());
    }

    #[test]
    fn draw_cards_stops_when_empty() {
        let d = mk_defs(mk_sub("x", 10, 0, 1), mk_card("c", 1, "damage", 1));
        let mut b = new_battle_teams("cpu", &d, vec![0, 1], vec![0, 1], 42);
        start_turn(&mut b);
        let pi = 0;
        // exhaust draw and discard
        for _ in 0..20 {
            draw_cards(&mut b, pi, 1, true);
        }
        let before = b.players[pi].hand.len();
        draw_cards(&mut b, pi, 5, false);
        // cannot draw more than available
        assert_eq!(b.players[pi].hand.len(), before);
    }

    // ===== force_discard =====

    #[test]
    fn force_discard_removes_correct_count() {
        let d = mk_defs(mk_sub("x", 10, 0, 1), mk_card("c", 1, "damage", 1));
        let mut b = new_battle_teams("cpu", &d, vec![0, 1], vec![0, 1], 1);
        start_turn(&mut b);
        let pi = 0;
        let before = b.players[pi].hand.len();
        force_discard(&mut b, pi, 2);
        assert_eq!(b.players[pi].hand.len(), before.saturating_sub(2));
    }

    #[test]
    fn force_discard_empty_hand_no_error() {
        let d = mk_defs(mk_sub("x", 10, 0, 1), mk_card("c", 1, "damage", 1));
        let mut b = new_battle_teams("cpu", &d, vec![0, 1], vec![0, 1], 1);
        start_turn(&mut b);
        // empty hand
        b.players[0].hand.clear();
        b.players[0].discard.clear();
        b.players[0].draw.clear();
        force_discard(&mut b, 0, 5);
        assert!(b.players[0].hand.is_empty());
    }

    // ===== check_team_winner =====

    #[test]
    fn check_team_winner_returns_false_with_both_alive() {
        let d = mk_defs(mk_sub("a", 10, 0, 0), mk_card("c", 1, "damage", 1));
        let mut b = new_battle_teams("cpu", &d, vec![0, 1], vec![0, 1], 1);
        assert!(!check_team_winner(&mut b));
        assert!(b.winner.is_none());
    }

    #[test]
    fn check_team_winner_returns_true_when_one_team_dies() {
        let d = mk_defs(mk_sub("a", 5, 0, 0), mk_card("c", 1, "damage", 99));
        let mut b = new_battle_teams("cpu", &d, vec![0, 1], vec![0, 1], 1);
        // kill player 1
        b.players[1].hp = 0;
        assert!(check_team_winner(&mut b));
        assert_eq!(b.winner, Some(0));
    }

    #[test]
    fn check_team_winner_early_return_when_already_decided() {
        let d = mk_defs(mk_sub("a", 10, 0, 0), mk_card("c", 1, "damage", 1));
        let mut b = new_battle_teams("cpu", &d, vec![0, 1], vec![0, 1], 1);
        b.winner = Some(0);
        assert!(check_team_winner(&mut b));
    }

    // ===== start_turn / end_turn turn flow =====

    #[test]
    fn start_turn_deducts_energy_and_draws_cards() {
        let d = mk_defs(mk_sub("a", 20, 0, 3), mk_card("c", 1, "damage", 1));
        let mut b = new_battle_teams("cpu", &d, vec![0, 1], vec![0, 1], 1);
        start_turn(&mut b);
        assert_eq!(b.players[0].energy, 3);
        assert!(!b.players[0].hand.is_empty());
    }

    #[test]
    fn turn_counter_increases_each_turn() {
        let d = mk_defs(mk_sub("a", 20, 0, 1), mk_card("c", 1, "damage", 1));
        let mut b = new_battle_teams("cpu", &d, vec![0, 1], vec![0, 1], 1);
        start_turn(&mut b);
        assert_eq!(b.turn, 1);
        execute(&mut b, Action::EndTurn { pi: 0 }).unwrap();
        execute(&mut b, Action::StartTurn).unwrap();
        // after end_turn+start_turn, turn increments
        assert_eq!(b.turn, 2);
    }

    #[test]
    fn first_turn_draws_cards_from_deck() {
        let d = mk_defs(mk_sub("a", 20, 0, 10), mk_card("c", 1, "damage", 1));
        let mut b = new_battle_teams("cpu", &d, vec![0, 1], vec![0, 1], 1);
        start_turn(&mut b);
        // With 1 card in defs.cards and no custom deck, each player gets 2 copies.
        // First turn draws min(5, draw_pile_count) = min(5, 2) = 2 cards.
        assert_eq!(b.players[0].hand.len(), 2);
        assert!(!b.players[0].hand.is_empty());
    }

    // ===== action import for integration tests =====
    use super::super::action::{execute, Action};
}
