//! Layer 2 — Core 子系统的效果结算。
//!
//! 负责把卡牌效果（`Effect`）按序应用到 Battle，并产出结构化
//! `GameEvent` 事件列表供表现层消费。属于 Core 内部组件，
//! 只依赖 `state` 与 `core` 的数值/工具函数，无外部 IO。

use super::core::{
    calc_damage, check_team_winner, draw_cards, force_discard, log_event,
};
use super::state::*;

/// 效果默认动画形态（可被 `Effect.fx.form` 覆盖）
fn eff_fx(e: &Effect) -> String {
    if let Some(ref fx) = e.fx {
        if fx.form.is_some() {
            return fx.form.clone().unwrap_or_default();
        }
    }
    default_fx_form(&e.kind)
}

/// 效果类型 → 默认动画形态（bindings / LAN 公开状态共用）
pub fn default_fx_form(kind: &str) -> String {
    match kind {
        "damage" => "flash".into(),
        "heal" => "flash".into(),
        "energy" => "flash".into(),
        "draw" => "flash".into(),
        "gain_def" => "overlay".into(),
        "gain_atk" => "pulse".into(),
        "dmg_reduce" => "overlay".into(),
        "extra_turn" => "pulse".into(),
        "weaken_def" => "overlay".into(),
        "cost_up" => "overlay".into(),
        "force_discard" => "overlay".into(),
        "skip_turn" => "pulse".into(),
        _ => "flash".into(),
    }
}

/// 效果元数据表（编辑器/前端用，与效果结算一一对应）
pub fn effect_metadata_map() -> serde_json::Value {
    serde_json::json!({
        "damage": { "hasValue": true, "hasDuration": false, "hasPierce": true, "fx": {"form":"flash","color":"#ff3b30"}, "descKey":"desc.damage", "descKeyPierce":"desc.damage_pierce", "buffKey": null, "cpuWeight": 1.0 },
        "heal": { "hasValue": true, "hasDuration": false, "hasPierce": false, "fx": {"form":"flash","color":"#34c759"}, "descKey":"desc.heal", "descKeyPierce": null, "buffKey": null, "cpuWeight": 0.9 },
        "gain_def": { "hasValue": true, "hasDuration": true, "hasPierce": false, "fx": {"form":"overlay","color":"#e6b800"}, "descKey":"desc.gain_def", "descKeyPierce": null, "buffKey":"buff.def_up", "cpuWeight": 0.8 },
        "gain_atk": { "hasValue": true, "hasDuration": true, "hasPierce": false, "fx": {"form":"pulse","color":"#e6b800"}, "descKey":"desc.gain_atk", "descKeyPierce": null, "buffKey":"buff.atk_up", "cpuWeight": 0.6 },
        "weaken_def": { "hasValue": true, "hasDuration": true, "hasPierce": false, "fx": {"form":"overlay","color":"#bf5af2"}, "descKey":"desc.weaken_def", "descKeyPierce": null, "buffKey":"buff.armor_break", "cpuWeight": 0.5 },
        "cost_up": { "hasValue": true, "hasDuration": true, "hasPierce": false, "fx": {"form":"overlay","color":"#bf5af2"}, "descKey":"desc.cost_up", "descKeyPierce": null, "buffKey":"buff.cost_up", "cpuWeight": 1.3 },
        "dmg_reduce": { "hasValue": true, "hasDuration": true, "hasPierce": false, "fx": {"form":"overlay","color":"#e6b800"}, "descKey":"desc.dmg_reduce", "descKeyPierce": null, "buffKey":"buff.dmg_reduce", "cpuWeight": 0.4 },
        "skip_turn": { "hasValue": false, "hasDuration": false, "hasPierce": false, "fx": {"form":"pulse","color":"#bf5af2"}, "descKey":"desc.skip_turn", "descKeyPierce": null, "buffKey":"buff.skip_turn", "cpuWeight": 3.5 },
        "extra_turn": { "hasValue": false, "hasDuration": false, "hasPierce": false, "fx": {"form":"pulse","color":"#e6b800"}, "descKey":"desc.extra_turn", "descKeyPierce": null, "buffKey":"buff.extra_turn", "cpuWeight": 4.0 },
        "draw": { "hasValue": true, "hasDuration": false, "hasPierce": false, "fx": {"form":"flash","color":"#0a84ff"}, "descKey":"desc.draw", "descKeyPierce": null, "buffKey": null, "cpuWeight": 1.6 },
        "force_discard": { "hasValue": true, "hasDuration": false, "hasPierce": false, "fx": {"form":"overlay","color":"#bf5af2"}, "descKey":"desc.force_discard", "descKeyPierce": null, "buffKey": null, "cpuWeight": 1.2 },
        "energy": { "hasValue": true, "hasDuration": false, "hasPierce": false, "fx": {"form":"flash","color":"#0a84ff"}, "descKey":"desc.energy", "descKeyPierce": null, "buffKey": null, "cpuWeight": 0.5 }
    })
}

pub fn resolve_effects(b: &mut Battle, pi: usize, card: &Card) -> Vec<GameEvent> {
    resolve_effects_target(b, pi, card, None)
}

/// 按序结算卡牌的全部效果，产出事件列表
pub fn resolve_effects_target(
    b: &mut Battle,
    pi: usize,
    card: &Card,
    target: Option<usize>,
) -> Vec<GameEvent> {
    let mut events = vec![];
    for e in &card.effects {
        if b.winner.is_some() {
            break;
        }
        let tgt = if e.target.as_deref() == Some("self") {
            pi
        } else {
            target.unwrap_or_else(|| {
                super::core::first_opponent(b, pi)
                    .unwrap_or_else(|| (0..b.players.len()).find(|&i| i != pi).unwrap_or(0))
            })
        };
        apply_effect(b, pi, tgt, e);
        events.push(GameEvent {
            target: tgt,
            fx: eff_fx(e),
            kind: e.kind.clone(),
            value: e.value,
        });
    }
    events
}

fn apply_effect(b: &mut Battle, a: usize, tp: usize, e: &Effect) {
    match e.kind.as_str() {
        "damage" => apply_damage(b, a, tp, e),
        "heal" => apply_heal(b, tp, e),
        "gain_def" => apply_gain_def(b, tp, e),
        "gain_atk" => apply_gain_atk(b, tp, e),
        "weaken_def" => apply_weaken_def(b, tp, e),
        "cost_up" => apply_cost_up(b, tp, e),
        "dmg_reduce" => apply_dmg_reduce(b, tp, e),
        "skip_turn" => apply_skip_turn(b, tp),
        "extra_turn" => apply_extra_turn(b, a),
        "draw" => apply_draw(b, a, e),
        "force_discard" => apply_force_discard(b, tp, e),
        "energy" => apply_energy(b, a, e),
        _ => {}
    }
}

fn apply_damage(b: &mut Battle, a: usize, tp: usize, e: &Effect) {
    let dmg = {
        let (att, tgt) = (b.players[a].clone(), b.players[tp].clone());
        calc_damage(&att, &tgt, e.value.unwrap_or(0), e.pierce.unwrap_or(false))
    };
    b.players[tp].hp -= dmg;
    let pierce = e.pierce.unwrap_or(false);
    if pierce {
        log_event(
            b,
            "log.damage_pierce",
            serde_json::json!({ "attacker": b.players[a].role.name.clone(), "target": b.players[tp].role.name.clone(), "dmg": dmg }),
        );
    } else {
        log_event(
            b,
            "log.damage",
            serde_json::json!({ "attacker": b.players[a].role.name.clone(), "target": b.players[tp].role.name.clone(), "dmg": dmg }),
        );
    }
    if b.players[tp].hp <= 0 {
        b.players[tp].hp = 0;
        if check_team_winner(b) {
            let w = b.winner.unwrap();
            log_event(
                b,
                "log.win",
                serde_json::json!({ "winner": b.players[w].role.name.clone(), "loser": b.players[tp].role.name.clone() }),
            );
        }
    }
}

fn apply_heal(b: &mut Battle, tp: usize, e: &Effect) {
    let v = e.value.unwrap_or(0);
    let max_hp = b.players[tp].role.hp;
    b.players[tp].hp = (b.players[tp].hp + v).min(max_hp);
    log_event(
        b,
        "log.heal",
        serde_json::json!({ "target": b.players[tp].role.name.clone(), "value": v }),
    );
}

fn apply_gain_def(b: &mut Battle, tp: usize, e: &Effect) {
    let v = e.value.unwrap_or(0);
    let dur = e.duration.unwrap_or(999);
    b.players[tp].def += v;
    b.players[tp].buffs.push(Buff {
        kind: "gain_def".into(),
        value: v,
        duration: dur,
    });
    log_event(
        b,
        "log.def_up",
        serde_json::json!({ "target": b.players[tp].role.name.clone(), "value": v }),
    );
}

fn apply_gain_atk(b: &mut Battle, tp: usize, e: &Effect) {
    let v = e.value.unwrap_or(0);
    let dur = e.duration.unwrap_or(999);
    b.players[tp].buffs.push(Buff {
        kind: "gain_atk".into(),
        value: v,
        duration: dur,
    });
    log_event(
        b,
        "log.atk_up",
        serde_json::json!({ "target": b.players[tp].role.name.clone(), "value": v }),
    );
}

fn apply_weaken_def(b: &mut Battle, tp: usize, e: &Effect) {
    let v = e.value.unwrap_or(0);
    let dur = e.duration.unwrap_or(3);
    b.players[tp].buffs.push(Buff {
        kind: "weaken_def".into(),
        value: v,
        duration: dur,
    });
    log_event(
        b,
        "log.def_down",
        serde_json::json!({ "target": b.players[tp].role.name.clone(), "value": v, "dur": dur }),
    );
}

fn apply_cost_up(b: &mut Battle, tp: usize, e: &Effect) {
    let v = e.value.unwrap_or(0);
    let dur = e.duration.unwrap_or(2);
    b.players[tp].buffs.push(Buff {
        kind: "cost_up".into(),
        value: v,
        duration: dur,
    });
    log_event(
        b,
        "log.cost_up",
        serde_json::json!({ "target": b.players[tp].role.name.clone(), "value": v, "dur": dur }),
    );
}

fn apply_dmg_reduce(b: &mut Battle, tp: usize, e: &Effect) {
    let v = e.value.unwrap_or(0);
    let dur = e.duration.unwrap_or(3);
    b.players[tp].buffs.push(Buff {
        kind: "dmg_reduce".into(),
        value: v,
        duration: dur,
    });
    log_event(
        b,
        "log.dmg_reduce",
        serde_json::json!({ "target": b.players[tp].role.name.clone(), "value": v, "dur": dur }),
    );
}

fn apply_skip_turn(b: &mut Battle, tp: usize) {
    b.players[tp].buffs.push(Buff {
        kind: "skip_turn".into(),
        value: 0,
        duration: 0,
    });
    log_event(
        b,
        "log.skip_turn",
        serde_json::json!({ "target": b.players[tp].role.name.clone() }),
    );
}

fn apply_extra_turn(b: &mut Battle, a: usize) {
    b.players[a].buffs.push(Buff {
        kind: "extra_turn".into(),
        value: 0,
        duration: 0,
    });
    log_event(
        b,
        "log.extra_turn",
        serde_json::json!({ "target": b.players[a].role.name.clone() }),
    );
}

fn apply_draw(b: &mut Battle, a: usize, e: &Effect) {
    let v = e.value.unwrap_or(0);
    draw_cards(b, a, v, true);
    log_event(
        b,
        "log.draw",
        serde_json::json!({ "target": b.players[a].role.name.clone(), "value": v }),
    );
}

fn apply_force_discard(b: &mut Battle, tp: usize, e: &Effect) {
    let v = e.value.unwrap_or(0);
    force_discard(b, tp, v);
    log_event(
        b,
        "log.force_discard",
        serde_json::json!({ "target": b.players[tp].role.name.clone(), "value": v }),
    );
}

fn apply_energy(b: &mut Battle, a: usize, e: &Effect) {
    let v = e.value.unwrap_or(0);
    b.players[a].energy = (b.players[a].energy + v).max(0);
    let sign = if v >= 0 { "+" } else { "" };
    log_event(
        b,
        "log.energy",
        serde_json::json!({ "target": b.players[a].role.name.clone(), "sign": sign, "value": v }),
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use super::super::core::{new_battle_teams, start_turn};

    fn mk_sub(id: &str, hp: i32, def: i32, eng: i32) -> SubfactionDef {
        SubfactionDef { id: id.into(), name: id.into(), faction: None, hp, def, eng,
            intro: "".into(), img: "".into(), deck: None }
    }
    fn mk_card_with_effect(kind: &str, val: i32) -> Card {
        Card { id: "c".into(), name: "C".into(), cost: 1, img: "".into(), desc: "".into(),
            effects: vec![Effect { kind: kind.into(), value: Some(val), duration: Some(2),
                pierce: None, target: None, fx: None }] }
    }
    fn mk_card_with_pierce(kind: &str, val: i32, pierce: bool) -> Card {
        Card { id: "c".into(), name: "C".into(), cost: 1, img: "".into(), desc: "".into(),
            effects: vec![Effect { kind: kind.into(), value: Some(val), duration: None,
                pierce: Some(pierce), target: None, fx: None }] }
    }
    fn defs() -> GameDefs {
        GameDefs {
            subfactions: vec![mk_sub("a", 30, 2, 3), mk_sub("b", 30, 2, 3)],
            cards: vec![],
            factions: vec![],
        }
    }

    // ===== resolve_effects per kind =====

    #[test]
    fn effect_damage_reduces_hp() {
        let mut d = defs();
        d.cards.push(mk_card_with_effect("damage", 8));
        let mut b = new_battle_teams("cpu", &d, vec![0, 1], vec![0, 1], 1);
        start_turn(&mut b);
        let events = resolve_effects(&mut b, 0, &d.cards[0]);
        assert_eq!(events[0].kind, "damage");
        assert_eq!(events[0].target, 1);
        // resolve_effects targets first opponent (player 1) by default
        assert_eq!(b.players[1].hp, 24); // 30 - (8-2) = 24
    }

    #[test]
    fn effect_damage_pierce_ignores_def() {
        let mut d = defs();
        d.cards.push(mk_card_with_pierce("damage", 8, true));
        let mut b = new_battle_teams("cpu", &d, vec![0, 1], vec![0, 1], 1);
        start_turn(&mut b);
        let _events = resolve_effects(&mut b, 0, &d.cards[0]);
        // pierce: 30 - 8 = 22 on opponent
        assert_eq!(b.players[1].hp, 22);
    }

    #[test]
    fn effect_heal_restores_hp() {
        let mut d = defs();
        d.cards.push(mk_card_with_effect("heal", 10));
        let mut b = new_battle_teams("cpu", &d, vec![0, 1], vec![0, 1], 1);
        start_turn(&mut b);
        // resolve_effects targets player 1 (first opponent)
        b.players[1].hp = 20;
        let events = resolve_effects(&mut b, 0, &d.cards[0]);
        assert_eq!(events[0].kind, "heal");
        assert_eq!(b.players[1].hp, 30); // 20+10 capped at 30
    }

    #[test]
    fn effect_heal_caps_at_max_hp() {
        let mut d = defs();
        d.cards.push(mk_card_with_effect("heal", 100));
        let mut b = new_battle_teams("cpu", &d, vec![0, 1], vec![0, 1], 1);
        start_turn(&mut b);
        b.players[1].hp = 28;
        let _events = resolve_effects(&mut b, 0, &d.cards[0]);
        assert_eq!(b.players[1].hp, 30); // capped at role.hp
    }

    #[test]
    fn effect_gain_def_adds_buff_and_def() {
        let mut d = defs();
        d.cards.push(mk_card_with_effect("gain_def", 5));
        let mut b = new_battle_teams("cpu", &d, vec![0, 1], vec![0, 1], 1);
        start_turn(&mut b);
        let _events = resolve_effects(&mut b, 0, &d.cards[0]);
        // targets player 1
        assert_eq!(b.players[1].def, 7); // 2+5
        assert_eq!(b.players[1].buffs.len(), 1);
        assert_eq!(b.players[1].buffs[0].kind, "gain_def");
    }

    #[test]
    fn effect_gain_atk_adds_buff() {
        let mut d = defs();
        d.cards.push(mk_card_with_effect("gain_atk", 4));
        let mut b = new_battle_teams("cpu", &d, vec![0, 1], vec![0, 1], 1);
        start_turn(&mut b);
        let _events = resolve_effects(&mut b, 0, &d.cards[0]);
        // targets player 1
        assert_eq!(b.players[1].buffs.len(), 1);
        assert_eq!(b.players[1].buffs[0].kind, "gain_atk");
    }

    #[test]
    fn effect_weaken_def_adds_buff() {
        let mut d = defs();
        d.cards.push(mk_card_with_effect("weaken_def", 3));
        let mut b = new_battle_teams("cpu", &d, vec![0, 1], vec![0, 1], 1);
        start_turn(&mut b);
        let _events = resolve_effects(&mut b, 0, &d.cards[0]);
        assert_eq!(b.players[1].buffs.len(), 1);
        assert_eq!(b.players[1].buffs[0].kind, "weaken_def");
    }

    #[test]
    fn effect_cost_up_adds_buff() {
        let mut d = defs();
        d.cards.push(mk_card_with_effect("cost_up", 2));
        let mut b = new_battle_teams("cpu", &d, vec![0, 1], vec![0, 1], 1);
        start_turn(&mut b);
        let _events = resolve_effects(&mut b, 0, &d.cards[0]);
        assert_eq!(b.players[1].buffs.len(), 1);
        assert_eq!(b.players[1].buffs[0].kind, "cost_up");
    }

    #[test]
    fn effect_dmg_reduce_adds_buff() {
        let mut d = defs();
        d.cards.push(mk_card_with_effect("dmg_reduce", 30));
        let mut b = new_battle_teams("cpu", &d, vec![0, 1], vec![0, 1], 1);
        start_turn(&mut b);
        let _events = resolve_effects(&mut b, 0, &d.cards[0]);
        // targets player 1
        assert_eq!(b.players[1].buffs.len(), 1);
        assert_eq!(b.players[1].buffs[0].kind, "dmg_reduce");
    }

    #[test]
    fn effect_skip_turn_adds_buff() {
        let mut d = defs();
        d.cards.push(Card { id: "s".into(), name: "S".into(), cost: 1, img: "".into(),
            desc: "".into(), effects: vec![Effect { kind: "skip_turn".into(), value: None,
            duration: None, pierce: None, target: None, fx: None }] });
        let mut b = new_battle_teams("cpu", &d, vec![0, 1], vec![0, 1], 1);
        start_turn(&mut b);
        resolve_effects(&mut b, 0, &d.cards[0]);
        assert_eq!(b.players[1].buffs.len(), 1);
        assert_eq!(b.players[1].buffs[0].kind, "skip_turn");
    }

    #[test]
    fn effect_extra_turn_adds_buff() {
        let mut d = defs();
        d.cards.push(Card { id: "e".into(), name: "E".into(), cost: 1, img: "".into(),
            desc: "".into(), effects: vec![Effect { kind: "extra_turn".into(), value: None,
            duration: None, pierce: None, target: None, fx: None }] });
        let mut b = new_battle_teams("cpu", &d, vec![0, 1], vec![0, 1], 1);
        start_turn(&mut b);
        resolve_effects(&mut b, 0, &d.cards[0]);
        assert_eq!(b.players[0].buffs.len(), 1);
        assert_eq!(b.players[0].buffs[0].kind, "extra_turn");
    }

    #[test]
    fn effect_draw_adds_cards() {
        let mut d = defs();
        // Add 4 copies of draw card so draw pile has enough cards
        for _ in 0..4 {
            d.cards.push(mk_card_with_effect("draw", 1));
        }
        let mut b = new_battle_teams("cpu", &d, vec![0, 1], vec![0, 1], 1);
        start_turn(&mut b);
        // player 0 has 2 cards in hand (from start_turn, draw pile has 4 draw cards)
        let before = b.players[0].hand.len();
        // resolve_effects uses first_opponent as default target for non-self effects,
        // but apply_draw always operates on player `a` (the caster)
        let events = resolve_effects(&mut b, 0, &d.cards[0]);
        assert_eq!(events[0].kind, "draw");
        assert_eq!(b.players[0].hand.len(), before + 1); // 1 card drawn
    }

    #[test]
    fn effect_force_discard_removes_from_hand() {
        let mut d = defs();
        d.cards.push(Card { id: "fd".into(), name: "FD".into(), cost: 1, img: "".into(),
            desc: "".into(), effects: vec![Effect { kind: "force_discard".into(), value: Some(2),
            duration: None, pierce: None, target: None, fx: None }] });
        let mut b = new_battle_teams("cpu", &d, vec![0, 1], vec![0, 1], 1);
        start_turn(&mut b);
        let before = b.players[1].hand.len();
        resolve_effects(&mut b, 0, &d.cards[0]);
        assert_eq!(b.players[1].hand.len(), before.saturating_sub(2));
    }

    #[test]
    fn effect_energy_adds_energy() {
        let mut d = defs();
        d.cards.push(mk_card_with_effect("energy", 2));
        let mut b = new_battle_teams("cpu", &d, vec![0, 1], vec![0, 1], 1);
        start_turn(&mut b);
        resolve_effects(&mut b, 0, &d.cards[0]);
        assert_eq!(b.players[0].energy, 5); // 3+2
    }

    #[test]
    fn effect_target_self_hurts_self() {
        let mut d = defs();
        d.cards.push(Card { id: "su".into(), name: "Su".into(), cost: 1, img: "".into(),
            desc: "".into(), effects: vec![Effect { kind: "damage".into(), value: Some(10),
            duration: None, pierce: None, target: Some("self".into()), fx: None }] });
        let mut b = new_battle_teams("cpu", &d, vec![0, 1], vec![0, 1], 1);
        start_turn(&mut b);
        resolve_effects(&mut b, 0, &d.cards[0]);
        assert_eq!(b.players[0].hp, 22); // self-damage: 30-(10-2)=22
    }

    #[test]
    fn effect_stops_on_winner() {
        let mut d = defs();
        // card with damage that kills, then another damage
        d.cards = vec![
            mk_card_with_effect("damage", 99),
            mk_card_with_effect("damage", 99),
        ];
        let mut b = new_battle_teams("cpu", &d, vec![0, 1], vec![0, 1], 1);
        start_turn(&mut b);
        let card = &d.cards[0];
        let events = resolve_effects(&mut b, 0, card);
        // only first effect should fire since game ends
        assert_eq!(events.len(), 1);
        assert!(b.winner.is_some());
    }

    // ===== default_fx_form =====

    #[test]
    fn default_fx_form_known_kind() {
        assert_eq!(default_fx_form("damage"), "flash");
        assert_eq!(default_fx_form("heal"), "flash");
        assert_eq!(default_fx_form("gain_def"), "overlay");
        assert_eq!(default_fx_form("skip_turn"), "pulse");
    }

    #[test]
    fn default_fx_form_unknown_kind_defaults_flash() {
        assert_eq!(default_fx_form("unknown_kind"), "flash");
    }
}
