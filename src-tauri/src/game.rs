#![allow(dead_code)]
use rand::rngs::StdRng;
use rand::seq::SliceRandom;
use rand::{Rng, SeedableRng};
use serde::{Deserialize, Serialize};
use std::fs;

// ============ Data structures ============

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Card {
    pub id: String,
    pub name: String,
    pub cost: i32,
    pub img: String,
    pub effects: Vec<Effect>,
    pub desc: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Effect {
    #[serde(rename = "type")]
    pub kind: String,
    pub value: Option<i32>,
    pub duration: Option<i32>,
    pub pierce: Option<bool>,
    pub target: Option<String>,
    pub fx: Option<FxOverride>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FxOverride {
    pub form: Option<String>,
    pub color: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubfactionDef {
    pub id: String,
    pub name: String,
    pub faction: Option<String>,
    pub hp: i32,
    pub def: i32,
    pub eng: i32,
    pub intro: String,
    pub img: String,
    pub deck: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FactionDef {
    pub id: String,
    pub name: String,
    pub desc: String,
    pub img: String,
    pub deck: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct Buff {
    pub kind: String,
    pub value: i32,
    pub duration: i32,
}

#[derive(Debug, Clone)]
pub struct PlayerState {
    pub role: SubfactionDef,
    pub hp: i32,
    pub def: i32,
    pub energy: i32,
    pub buffs: Vec<Buff>,
    pub draw: Vec<Card>,
    pub hand: Vec<Card>,
    pub discard: Vec<Card>,
}

#[derive(Debug, Clone, Serialize)]
pub struct LogEvent {
    pub key: String,
    pub params: serde_json::Value,
}

#[derive(Debug, Clone)]
pub struct Battle {
    pub mode: String,
    pub seq: i32,
    pub turn: i32,
    pub actor: usize,
    pub winner: Option<usize>,
    pub players: Vec<PlayerState>,
    pub teams: Vec<usize>,
    pub order: Vec<usize>,
    pub log: Vec<LogEvent>,
    pub rng: StdRng,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameDefs {
    pub subfactions: Vec<SubfactionDef>,
    pub cards: Vec<Card>,
    pub factions: Vec<FactionDef>,
}

const HAND_MAX: i32 = 7;

fn log_event(b: &mut Battle, key: &str, params: serde_json::Value) {
    b.log.push(LogEvent {
        key: key.to_string(),
        params,
    });
}

// ============ Utility ============

fn shuffle<T: Clone>(v: &mut [T], rng: &mut impl Rng) {
    v.shuffle(rng);
}

fn rand_int(rng: &mut impl Rng, n: usize) -> usize {
    if n == 0 {
        return 0;
    }
    rng.gen_range(0..n)
}

fn build_order(teams: &[usize]) -> Vec<usize> {
    let team0: Vec<usize> = teams
        .iter()
        .enumerate()
        .filter(|(_, t)| **t == 0)
        .map(|(i, _)| i)
        .collect();
    let team1: Vec<usize> = teams
        .iter()
        .enumerate()
        .filter(|(_, t)| **t == 1)
        .map(|(i, _)| i)
        .collect();
    let mut order = Vec::new();
    let max_len = team0.len().max(team1.len());
    for i in 0..max_len {
        if i < team0.len() {
            order.push(team0[i]);
        }
        if i < team1.len() {
            order.push(team1[i]);
        }
    }
    order
}

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

fn check_team_winner(b: &mut Battle) -> bool {
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

// ============ Battle engine ============

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

pub fn draw_cards(b: &mut Battle, pi: usize, n: i32, overflow: bool) {
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

pub fn force_discard(b: &mut Battle, t: usize, n: i32) {
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
fn first_opponent(b: &Battle, pi: usize) -> Option<usize> {
    b.players
        .iter()
        .enumerate()
        .find(|(i, p)| *i != pi && b.teams[*i] != b.teams[pi] && p.hp > 0)
        .map(|(i, _)| i)
}

pub fn play_card(
    b: &mut Battle,
    pi: usize,
    idx: usize,
) -> Result<Vec<(usize, String, String)>, String> {
    play_card_target(b, pi, idx, None)
}

pub fn play_card_target(
    b: &mut Battle,
    pi: usize,
    idx: usize,
    target: Option<usize>,
) -> Result<Vec<(usize, String, String)>, String> {
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

pub fn resolve_effects(b: &mut Battle, pi: usize, card: &Card) -> Vec<(usize, String, String)> {
    resolve_effects_target(b, pi, card, None)
}

pub fn resolve_effects_target(
    b: &mut Battle,
    pi: usize,
    card: &Card,
    target: Option<usize>,
) -> Vec<(usize, String, String)> {
    let mut events = vec![];
    for e in &card.effects {
        if b.winner.is_some() {
            break;
        }
        let tgt = if e.target.as_deref() == Some("self") {
            pi
        } else {
            target.unwrap_or_else(|| {
                first_opponent(b, pi)
                    .unwrap_or_else(|| (0..b.players.len()).find(|&i| i != pi).unwrap_or(0))
            })
        };
        apply_effect(b, pi, tgt, e);
        events.push((tgt, eff_fx(e), e.kind.clone()));
    }
    events
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

// ============ Effect system ============

fn eff_fx(e: &Effect) -> String {
    if let Some(ref fx) = e.fx {
        if fx.form.is_some() {
            return fx.form.clone().unwrap_or_default();
        }
    }
    match e.kind.as_str() {
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

// ============ CPU AI ============

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

#[derive(Debug, Clone)]
pub enum CpuAction {
    PlayCard(usize, Option<usize>),
    EndTurn,
}

// ============ Game state display ============

pub fn format_battle_state(b: &Battle) -> String {
    format_battle_state_for(b, 1)
}

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

// ============ Data loading ============

pub fn defs_from_strings(
    cards_json: &str,
    subfactions_json: &str,
    factions_json: &str,
) -> Result<GameDefs, String> {
    let subfactions: Vec<SubfactionDef> = serde_json::from_str(subfactions_json)
        .map_err(|e| format!("subfactions.json parse: {}", e))?;
    let cards: Vec<Card> =
        serde_json::from_str(cards_json).map_err(|e| format!("cards.json parse: {}", e))?;
    let factions: Vec<FactionDef> =
        serde_json::from_str(factions_json).map_err(|e| format!("factions.json parse: {}", e))?;
    Ok(GameDefs {
        subfactions,
        cards,
        factions,
    })
}

/// Parse a single JSON object `{ "subfactions": [...], "cards": [...], "factions": [...] }`.
pub fn defs_from_json(defs_json: &str) -> Result<GameDefs, String> {
    serde_json::from_str(defs_json).map_err(|e| format!("defs parse: {}", e))
}

pub fn load_defs(app_dir: &str) -> Result<GameDefs, String> {
    let subfactions = fs::read_to_string(format!("{}/card_duel/data/subfactions.json", app_dir))
        .map_err(|e| format!("subfactions.json: {}", e))?;
    let cards = fs::read_to_string(format!("{}/card_duel/data/cards.json", app_dir))
        .map_err(|e| format!("cards.json: {}", e))?;
    let factions = fs::read_to_string(format!("{}/card_duel/data/factions.json", app_dir))
        .map_err(|e| format!("factions.json: {}", e))?;
    defs_from_strings(&cards, &subfactions, &factions)
}

pub fn list_subfactions(defs: &GameDefs) -> String {
    let mut s = String::new();
    for (i, sub) in defs.subfactions.iter().enumerate() {
        let faction = defs
            .factions
            .iter()
            .find(|f| f.id == sub.faction.as_deref().unwrap_or(""));
        let fname = faction.map(|f| f.name.as_str()).unwrap_or("散人");
        s.push_str(&format!(
            "  {}. {} [{}] HP:{} DEF:{} ENG:{}\n",
            i, sub.name, fname, sub.hp, sub.def, sub.eng
        ));
    }
    s
}

pub fn get_subfaction_index(defs: &GameDefs, name: &str) -> Option<usize> {
    defs.subfactions
        .iter()
        .position(|s| s.name == name || s.id == name)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_defs() -> GameDefs {
        let sub = SubfactionDef {
            id: "test".into(),
            name: "Test".into(),
            faction: None,
            hp: 30,
            def: 2,
            eng: 3,
            intro: "".into(),
            img: "".into(),
            deck: None,
        };
        let card = Card {
            id: "strike".into(),
            name: "Strike".into(),
            cost: 1,
            img: "".into(),
            desc: "".into(),
            effects: vec![
                Effect {
                    kind: "damage".into(),
                    value: Some(5),
                    duration: None,
                    pierce: None,
                    target: None,
                    fx: None,
                },
                Effect {
                    kind: "draw".into(),
                    value: Some(1),
                    duration: None,
                    pierce: None,
                    target: None,
                    fx: None,
                },
            ],
        };
        let card2 = Card {
            id: "defend".into(),
            name: "Defend".into(),
            cost: 1,
            img: "".into(),
            desc: "".into(),
            effects: vec![Effect {
                kind: "gain_def".into(),
                value: Some(3),
                duration: Some(2),
                pierce: None,
                target: None,
                fx: None,
            }],
        };
        GameDefs {
            subfactions: vec![sub; 2],
            cards: vec![card, card2],
            factions: vec![],
        }
    }

    #[test]
    fn test_calc_damage_basic() {
        let d = test_defs();
        let mut b = new_battle("cpu", &d, 0, 1, 42);
        let dmg = calc_damage(&b.players[0], &b.players[1], 5, false);
        assert_eq!(dmg, 3, "damage with def reduction");
    }

    #[test]
    fn test_calc_damage_pierce() {
        let d = test_defs();
        let mut b = new_battle("cpu", &d, 0, 1, 42);
        let dmg = calc_damage(&b.players[0], &b.players[1], 5, true);
        assert_eq!(dmg, 5, "pierce ignores def");
    }

    #[test]
    fn test_play_card_damage() {
        let d = test_defs();
        let mut b = new_battle("cpu", &d, 0, 1, 42);
        start_turn(&mut b);
        assert!(
            !b.players[0].hand.is_empty(),
            "should have cards after start_turn"
        );
        let idx = b.players[0]
            .hand
            .iter()
            .position(|c| c.id == "strike")
            .unwrap_or(0);
        let hp_before = b.players[1].hp;
        let _ = play_card_target(&mut b, 0, idx, Some(1));
        assert!(b.players[1].hp < hp_before, "target should take damage");
    }

    #[test]
    fn test_effect_metadata() {
        let meta = effect_metadata_map();
        assert!(meta.get("damage").is_some(), "damage effect should exist");
        assert!(meta.get("heal").is_some(), "heal effect should exist");
        let dmg = meta.get("damage").unwrap();
        assert_eq!(dmg["hasValue"], true);
        assert_eq!(dmg["hasPierce"], true);
    }

    #[test]
    fn test_log_events() {
        let d = test_defs();
        let mut b = new_battle("cpu", &d, 0, 1, 42);
        start_turn(&mut b);
        let idx = b.players[0]
            .hand
            .iter()
            .position(|c| c.id == "strike")
            .unwrap_or(0);
        let _ = play_card_target(&mut b, 0, idx, Some(1));
        assert!(!b.log.is_empty(), "log should have entries");
        assert!(
            b.log.iter().any(|e| e.key == "log.turn"),
            "log should contain turn event"
        );
        assert!(
            b.log.iter().any(|e| e.key == "log.play_card"),
            "log should contain play_card event"
        );
        let rendered = format_log(&b);
        assert!(rendered.len() > 10, "rendered log should not be empty");
    }
}
