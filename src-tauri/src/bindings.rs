//! Layer 4 — Control（WASM 适配器）。
//!
//! 持有战斗的权威引用，接收外部输入（JS 门面调用），构造 Layer 1
//! `Action` 并交给 `game::action::execute` 结算，原子替换状态，
//! 返回完整状态快照与事件。是浏览器端唯一入口。

#![allow(static_mut_refs)]

use crate::game;
use wasm_bindgen::prelude::*;

static mut BATTLE: Option<game::Battle> = None;
static mut DEFS: Option<game::GameDefs> = None;
static mut HUMANS: Vec<bool> = vec![];
static mut SEAT_MAP: Vec<usize> = vec![];
static mut LAST_EVENTS: Vec<game::GameEvent> = vec![];

fn battle() -> &'static mut game::Battle {
    unsafe { BATTLE.as_mut().expect("battle not initialized") }
}

fn defs() -> &'static game::GameDefs {
    unsafe { DEFS.as_ref().expect("defs not initialized") }
}

fn humans() -> &'static [bool] {
    unsafe { &HUMANS }
}

#[wasm_bindgen]
pub fn init_battle(
    mode: &str,
    defs_json: &str,
    indices_json: &str,
    teams_json: &str,
    humans_json: &str,
    seed: u64,
    first_actor: i32,
    order_json: &str,
    names_json: &str,
) -> Result<String, JsValue> {
    let defs = game::defs_from_json(defs_json).map_err(|e| JsValue::from_str(&e))?;
    let indices: Vec<usize> =
        serde_json::from_str(indices_json).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let teams: Vec<usize> =
        serde_json::from_str(teams_json).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let humans: Vec<bool> =
        serde_json::from_str(humans_json).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let names: Vec<String> =
        serde_json::from_str(names_json).map_err(|e| JsValue::from_str(&e.to_string()))?;

    let mut b = game::new_battle_teams(mode, &defs, indices, teams, seed);
    game::set_player_names(&mut b, names);
    // 可选：传入完整行动顺序（掷骰定先后），覆盖默认队伍交错顺序
    if !order_json.is_empty() {
        let order: Vec<usize> =
            serde_json::from_str(order_json).map_err(|e| JsValue::from_str(&e.to_string()))?;
        if !order.is_empty() {
            // order 必须覆盖所有玩家索引；首个为默认行动者
            b.order = order.clone();
            b.actor = order[0];
        }
    }
    if first_actor >= 0 {
        b.actor = first_actor as usize;
    }
    unsafe {
        BATTLE = Some(b);
        DEFS = Some(defs);
        HUMANS = humans;
        SEAT_MAP = vec![];
        LAST_EVENTS = vec![];
    }
    // 经统一入口开始首回合
    game::action::execute(
        unsafe { BATTLE.as_mut().unwrap() },
        game::action::Action::StartTurn,
    )
    .map_err(|e| JsValue::from_str(&e))?;
    Ok(battle_state_json())
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

#[wasm_bindgen]
pub fn battle_state_json() -> String {
    let b = battle();
    let d = defs();
    let players: Vec<serde_json::Value> = b.players.iter().map(|p| {
        serde_json::json!({
            "role": serde_json::to_value(&p.role).unwrap_or_default(),
            "name": p.name,
            "hp": p.hp,
            "def": p.def,
            "energy": p.energy,
            "buffs": p.buffs.iter().map(|x| serde_json::json!({"type": x.kind, "value": x.value, "duration": x.duration})).collect::<Vec<_>>(),
            "draw": p.draw,
            "hand": p.hand,
            "discard": p.discard,
        })
    }).collect();

    let phase = if b.winner.is_some() {
        "over"
    } else {
        // facade phase tracking: derive from whether start_turn was called
        // For simplicity, treat as 'playing' if engine is active, else 'awaiting'
        // The JS facade will manage phase switching
        "playing"
    };

    let events: Vec<serde_json::Value> = unsafe { LAST_EVENTS.iter() }.map(|ev| {
        serde_json::json!({ "target": ev.target, "fx": { "form": ev.fx, "color": fx_color(&ev.kind) } })
    }).collect();

    serde_json::json!({
        "mode": b.mode,
        "seq": b.seq,
        "turn": b.turn,
        "actor": b.actor,
        "phase": phase,
        "winner": b.winner,
        "players": players,
        "teams": b.teams,
        "order": b.order,
        "humans": humans(),
        "seatMap": unsafe { &SEAT_MAP },
        "defs": serde_json::to_value(d).unwrap_or_default(),
        "log": b.log,
        "_events": events,
    })
    .to_string()
}

#[wasm_bindgen]
pub fn play_card(pi: usize, idx: usize, target: i32) -> Result<String, JsValue> {
    let tgt = if target >= 0 {
        Some(target as usize)
    } else {
        None
    };
    let events = game::action::execute(
        battle(),
        game::action::Action::PlayCard {
            pi,
            idx,
            target: tgt,
        },
    )
    .map_err(|e| JsValue::from_str(&e))?;
    unsafe {
        LAST_EVENTS = events;
    }
    Ok(battle_state_json())
}

#[wasm_bindgen]
pub fn end_turn(pi: usize) -> Result<String, JsValue> {
    game::action::execute(battle(), game::action::Action::EndTurn { pi })
        .map_err(|e| JsValue::from_str(&e))?;
    Ok(battle_state_json())
}

#[wasm_bindgen]
pub fn start_turn() -> Result<String, JsValue> {
    game::action::execute(battle(), game::action::Action::StartTurn)
        .map_err(|e| JsValue::from_str(&e))?;
    Ok(battle_state_json())
}

#[wasm_bindgen]
pub fn cpu_step() -> Result<String, JsValue> {
    game::action::execute(battle(), game::action::Action::CpuStep)
        .map_err(|e| JsValue::from_str(&e))?;
    Ok(battle_state_json())
}

#[wasm_bindgen]
pub fn list_effects() -> String {
    game::effect_metadata_map().to_string()
}

#[wasm_bindgen]
pub fn card_cost(pi: usize, idx: usize) -> i32 {
    let b = battle();
    if pi < b.players.len() && idx < b.players[pi].hand.len() {
        game::card_cost(b, pi, &b.players[pi].hand[idx])
    } else {
        0
    }
}
