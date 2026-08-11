#![allow(dead_code)]
use rand::seq::SliceRandom;
use rand::Rng;
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

#[derive(Debug, Clone)]
pub struct Battle {
    pub mode: String,
    pub seq: i32,
    pub turn: i32,
    pub actor: usize,
    pub winner: Option<usize>,
    pub players: [PlayerState; 2],
    pub log: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameDefs {
    pub subfactions: Vec<SubfactionDef>,
    pub cards: Vec<Card>,
    pub factions: Vec<FactionDef>,
}

const HAND_MAX: i32 = 7;

// ============ Utility ============

fn shuffle<T: Clone>(v: &mut Vec<T>) {
    let mut rng = rand::thread_rng();
    v.shuffle(&mut rng);
}

fn rand_int(n: usize) -> usize {
    if n == 0 { return 0; }
    rand::thread_rng().gen_range(0..n)
}

// ============ Battle engine ============

pub fn new_battle(mode: &str, defs: &GameDefs, p0: usize, p1: usize) -> Battle {
    let sub0 = &defs.subfactions[p0];
    let sub1 = &defs.subfactions[p1];
    let players = [make_player(sub0, defs), make_player(sub1, defs)];
    Battle {
        mode: mode.to_string(),
        seq: 0,
        turn: 1,
        actor: 0,
        winner: None,
        players,
        log: vec![],
    }
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
    shuffle(&mut d);
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

pub fn sum_buff(P: &PlayerState, kind: &str) -> i32 {
    P.buffs.iter().filter(|x| x.kind == kind).map(|x| x.value).sum()
}

pub fn card_cost(b: &Battle, pi: usize, card: &Card) -> i32 {
    (card.cost + sum_buff(&b.players[pi], "cost_up")).max(0)
}

pub fn calc_damage(att: &PlayerState, tgt: &PlayerState, value: i32, pierce: bool) -> i32 {
    let v = value + sum_buff(att, "gain_atk");
    let effective_def = (tgt.def - sum_buff(tgt, "weaken_def")).max(0);
    let dmg = if pierce { v } else { (v - effective_def).max(0) };
    let red = sum_buff(tgt, "dmg_reduce");
    if red > 0 { ((dmg * (100 - red)) as f64 / 100.0).round() as i32 } else { dmg }
}

pub fn draw_cards(b: &mut Battle, pi: usize, n: i32, overflow: bool) {
    let P = &mut b.players[pi];
    for _ in 0..n {
        if P.hand.len() >= HAND_MAX as usize && !overflow { break; }
        if P.draw.is_empty() {
            if P.discard.is_empty() { break; }
            let mut rd = std::mem::take(&mut P.discard);
            shuffle(&mut rd);
            P.draw = rd;
        }
        if let Some(c) = P.draw.pop() {
            if P.hand.len() >= HAND_MAX as usize { P.discard.push(c); continue; }
            P.hand.push(c);
        }
    }
}

pub fn force_discard(b: &mut Battle, t: usize, n: i32) {
    let P = &mut b.players[t];
    for _ in 0..n {
        if P.hand.is_empty() { break; }
        let idx = rand_int(P.hand.len());
        let c = P.hand.remove(idx);
        P.discard.push(c);
    }
}

pub fn start_turn(b: &mut Battle) {
    let pi = b.actor;
    if b.players[pi].hp <= 0 {
        b.winner = Some(1 - pi);
        return;
    }
    let sk = b.players[pi].buffs.iter().position(|x| x.kind == "skip_turn");
    if let Some(idx) = sk {
        b.players[pi].buffs.remove(idx);
        b.log.push(format!("{} 被禁行，本回合跳过", b.players[pi].role.name));
        b.actor = 1 - pi;
        b.turn += 1;
        start_turn(b);
        return;
    }
    tick_buffs(b, pi);
    b.players[pi].energy = b.players[pi].role.eng;
    let count = if b.turn == 1 { 5 } else { 2 };
    draw_cards(b, pi, count, false);
    b.log.push(format!("—— 第 {} 回合 · {} ——", b.turn, b.players[pi].role.name));
    // Check for extra_turn after end_turn triggers it
}

pub fn end_turn(b: &mut Battle, pi: usize) {
    let ex = b.players[pi].buffs.iter().position(|x| x.kind == "extra_turn");
    if let Some(idx) = ex {
        b.players[pi].buffs.remove(idx);
        b.log.push(format!("{} 发动【时间裂隙】继续行动", b.players[pi].role.name));
        start_turn(b);
        return;
    }
    b.actor = 1 - pi;
    b.turn += 1;
    start_turn(b);
}

pub fn play_card(b: &mut Battle, pi: usize, idx: usize) -> Result<(), String> {
    let cost = {
        let P = &b.players[pi];
        if idx >= P.hand.len() { return Err("invalid card index".into()); }
        let card = &P.hand[idx];
        if P.energy < card_cost(b, pi, card) { return Err("not enough energy".into()); }
        if b.winner.is_some() { return Err("game already ended".into()); }
        card_cost(b, pi, card)
    };
    let card = b.players[pi].hand.remove(idx);
    b.players[pi].energy -= cost;
    let _events = resolve_effects(b, pi, &card);
    b.log.push(format!("{} 打出【{}】", b.players[pi].role.name, card.name));
    b.players[pi].discard.push(card);
    if b.winner.is_some() {
        let w = b.winner.unwrap();
        b.log.push(format!("{} 生命归零，{} 获胜！", b.players[1 - w].role.name, b.players[w].role.name));
    }
    Ok(())
}

pub fn resolve_effects(b: &mut Battle, pi: usize, card: &Card) -> Vec<(usize, String)> {
    let foe = 1 - pi;
    let mut events = vec![];
    for e in &card.effects {
        if b.winner.is_some() { break; }
        let tgt = if e.target.as_deref() == Some("self") { pi } else { foe };
        apply_effect(b, pi, tgt, e);
        events.push((tgt, eff_fx(e)));
    }
    events
}

pub fn tick_buffs(b: &mut Battle, pi: usize) {
    let P = &mut b.players[pi];
    let mut i = P.buffs.len();
    while i > 0 {
        i -= 1;
        if P.buffs[i].kind == "skip_turn" || P.buffs[i].kind == "extra_turn" { continue; }
        P.buffs[i].duration -= 1;
        if P.buffs[i].duration <= 0 {
            if P.buffs[i].kind == "gain_def" {
                P.def = (P.def - P.buffs[i].value).max(0);
            }
            P.buffs.remove(i);
        }
    }
}

// ============ Effect system ============

fn eff_fx(e: &Effect) -> String {
    if let Some(ref fx) = e.fx {
        if fx.form.is_some() { return fx.form.clone().unwrap_or_default(); }
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
    b.log.push(format!("{} 对 {} 造成 {} 点伤害{}", b.players[a].role.name, b.players[tp].role.name, dmg, if pierce { "（真伤）" } else { "" }));
    if b.players[tp].hp <= 0 {
        b.players[tp].hp = 0;
        b.winner = Some(a);
    }
}

fn apply_heal(b: &mut Battle, tp: usize, e: &Effect) {
    let v = e.value.unwrap_or(0);
    let max_hp = b.players[tp].role.hp;
    b.players[tp].hp = (b.players[tp].hp + v).min(max_hp);
    b.log.push(format!("{} 恢复 {} 点生命", b.players[tp].role.name, v));
}

fn apply_gain_def(b: &mut Battle, tp: usize, e: &Effect) {
    let v = e.value.unwrap_or(0);
    let dur = e.duration.unwrap_or(999);
    b.players[tp].def += v;
    b.players[tp].buffs.push(Buff { kind: "gain_def".into(), value: v, duration: dur });
    b.log.push(format!("{} 防御+{}", b.players[tp].role.name, v));
}

fn apply_gain_atk(b: &mut Battle, tp: usize, e: &Effect) {
    let v = e.value.unwrap_or(0);
    let dur = e.duration.unwrap_or(999);
    b.players[tp].buffs.push(Buff { kind: "gain_atk".into(), value: v, duration: dur });
    b.log.push(format!("{} 攻击+{}", b.players[tp].role.name, v));
}

fn apply_weaken_def(b: &mut Battle, tp: usize, e: &Effect) {
    let v = e.value.unwrap_or(0);
    let dur = e.duration.unwrap_or(3);
    b.players[tp].buffs.push(Buff { kind: "weaken_def".into(), value: v, duration: dur });
    b.log.push(format!("{} 防御-{}（{}回合）", b.players[tp].role.name, v, dur));
}

fn apply_cost_up(b: &mut Battle, tp: usize, e: &Effect) {
    let v = e.value.unwrap_or(0);
    let dur = e.duration.unwrap_or(2);
    b.players[tp].buffs.push(Buff { kind: "cost_up".into(), value: v, duration: dur });
    b.log.push(format!("{} 卡牌费用+{}（{}回合）", b.players[tp].role.name, v, dur));
}

fn apply_dmg_reduce(b: &mut Battle, tp: usize, e: &Effect) {
    let v = e.value.unwrap_or(0);
    let dur = e.duration.unwrap_or(3);
    b.players[tp].buffs.push(Buff { kind: "dmg_reduce".into(), value: v, duration: dur });
    b.log.push(format!("{} 获得 {}% 减伤（{}回合）", b.players[tp].role.name, v, dur));
}

fn apply_skip_turn(b: &mut Battle, tp: usize) {
    b.players[tp].buffs.push(Buff { kind: "skip_turn".into(), value: 0, duration: 0 });
    b.log.push(format!("{} 下一回合被跳过", b.players[tp].role.name));
}

fn apply_extra_turn(b: &mut Battle, a: usize) {
    b.players[a].buffs.push(Buff { kind: "extra_turn".into(), value: 0, duration: 0 });
    b.log.push(format!("{} 获得额外回合", b.players[a].role.name));
}

fn apply_draw(b: &mut Battle, a: usize, e: &Effect) {
    let v = e.value.unwrap_or(0);
    draw_cards(b, a, v, true);
    b.log.push(format!("{} 抽 {} 张牌", b.players[a].role.name, v));
}

fn apply_force_discard(b: &mut Battle, tp: usize, e: &Effect) {
    let v = e.value.unwrap_or(0);
    force_discard(b, tp, v);
    b.log.push(format!("{} 被迫弃置 {} 张手牌", b.players[tp].role.name, v));
}

fn apply_energy(b: &mut Battle, a: usize, e: &Effect) {
    let v = e.value.unwrap_or(0);
    b.players[a].energy = (b.players[a].energy + v).max(0);
    let sign = if v >= 0 { "+" } else { "" };
    b.log.push(format!("{} 能量{}{}", b.players[a].role.name, sign, v));
}

// ============ AI ============

fn score_card(b: &Battle, c: &Card) -> f64 {
    let mut s = 0.0;
    for e in &c.effects {
        let v = e.value.unwrap_or(0) as f64;
        s += match e.kind.as_str() {
            "damage" => v * if e.pierce.unwrap_or(false) { 1.4 } else { 1.0 },
            "heal" => {
                if (b.players[0].hp as f64) < b.players[0].role.hp as f64 * 0.7 { v * 0.9 } else { -2.0 }
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

pub fn choose_ai_action(b: &mut Battle) -> AiAction {
    let P = &b.players[0];
    if P.hand.is_empty() {
        return AiAction::EndTurn;
    }
    let mut best_idx = None;
    let mut best_score = -1e9f64;
    for (i, c) in P.hand.iter().enumerate() {
        if card_cost(b, 0, c) <= P.energy {
            let s = score_card(b, c);
            if s > best_score {
                best_score = s;
                best_idx = Some(i);
            }
        }
    }
    match best_idx {
        Some(idx) => AiAction::PlayCard(idx),
        None => AiAction::EndTurn,
    }
}

#[derive(Debug, Clone)]
pub enum AiAction {
    PlayCard(usize),
    EndTurn,
}

// ============ Game state display ============

pub fn format_battle_state(b: &Battle) -> String {
    format_battle_state_for(b, 1)
}

pub fn format_battle_state_for(b: &Battle, local_player: usize) -> String {
    let mut s = String::new();
    let foe = 1 - local_player;
    s.push_str(&format!("=== 回合 {} — {} 行动 ===\n\n", b.turn,
        b.players[b.actor].role.name));

    // 对手（上半屏），不暴露手牌内容
    let fp = &b.players[foe];
    s.push_str(&format!("对手 {}: HP {}/{}  DEF {}  能量 {}/{}\n",
        fp.role.name, fp.hp, fp.role.hp, fp.def, fp.energy, fp.role.eng));
    if !fp.hand.is_empty() {
        s.push_str(&format!("手牌: {} 张\n", fp.hand.len()));
    }
    s.push_str(&format!("牌堆 {} 张 | 弃牌 {} 张\n", fp.draw.len(), fp.discard.len()));
    if !fp.buffs.is_empty() {
        let buffs: Vec<String> = fp.buffs.iter().map(|b| format!("{}", b.kind)).collect();
        s.push_str(&format!("状态: {}\n", buffs.join(", ")));
    }
    s.push_str("\n");

    // 本地玩家（下半屏），显示完整手牌
    let lp = &b.players[local_player];
    s.push_str(&format!("你 {}: HP {}/{}  DEF {}  能量 {}/{}\n",
        lp.role.name, lp.hp, lp.role.hp, lp.def, lp.energy, lp.role.eng));
    let hand: Vec<String> = lp.hand.iter().enumerate()
        .map(|(j, c)| format!("{}({})", c.name, j)).collect();
    if !hand.is_empty() {
        s.push_str(&format!("手牌: {}\n", hand.join(" ")));
    }
    s.push_str(&format!("牌堆 {} 张 | 弃牌 {} 张\n", lp.draw.len(), lp.discard.len()));
    if !lp.buffs.is_empty() {
        let buffs: Vec<String> = lp.buffs.iter().map(|b| format!("{}", b.kind)).collect();
        s.push_str(&format!("状态: {}\n", buffs.join(", ")));
    }
    s.push_str("\n");

    if b.winner.is_some() {
        let w = b.winner.unwrap();
        s.push_str(&format!("{} 获胜！\n", b.players[w].role.name));
    }
    s
}

pub fn format_log(b: &Battle) -> String {
    let start = if b.log.len() > 10 { b.log.len() - 10 } else { 0 };
    b.log[start..].join("\n")
}

// ============ Data loading ============

pub fn load_defs(app_dir: &str) -> Result<GameDefs, String> {
    let subfactions: Vec<SubfactionDef> = serde_json::from_str(
        &fs::read_to_string(format!("{}/card_duel/data/subfactions.json", app_dir))
            .map_err(|e| format!("subfactions.json: {}", e))?)
        .map_err(|e| format!("subfactions.json parse: {}", e))?;
    let cards: Vec<Card> = serde_json::from_str(
        &fs::read_to_string(format!("{}/card_duel/data/cards.json", app_dir))
            .map_err(|e| format!("cards.json: {}", e))?)
        .map_err(|e| format!("cards.json parse: {}", e))?;
    let factions: Vec<FactionDef> = serde_json::from_str(
        &fs::read_to_string(format!("{}/card_duel/data/factions.json", app_dir))
            .map_err(|e| format!("factions.json: {}", e))?)
        .map_err(|e| format!("factions.json parse: {}", e))?;
    Ok(GameDefs { subfactions, cards, factions })
}

pub fn list_subfactions(defs: &GameDefs) -> String {
    let mut s = String::new();
    for (i, sub) in defs.subfactions.iter().enumerate() {
        let faction = defs.factions.iter().find(|f| f.id == sub.faction.as_deref().unwrap_or(""));
        let fname = faction.map(|f| f.name.as_str()).unwrap_or("散人");
        s.push_str(&format!("  {}. {} [{}] HP:{} DEF:{} ENG:{}\n", i, sub.name, fname, sub.hp, sub.def, sub.eng));
    }
    s
}

pub fn get_subfaction_index(defs: &GameDefs, name: &str) -> Option<usize> {
    defs.subfactions.iter().position(|s| s.name == name || s.id == name)
}