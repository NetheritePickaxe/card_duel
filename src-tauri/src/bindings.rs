use crate::game;
use wasm_bindgen::prelude::*;

static mut BATTLE: Option<game::Battle> = None;
static mut DEFS: Option<game::GameDefs> = None;
static mut HUMANS: Vec<bool> = vec![];
static mut SEAT_MAP: Vec<usize> = vec![];
static mut LAST_EVENTS: Vec<(usize, String, String)> = vec![];

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
) -> Result<String, JsValue> {
    let defs = game::defs_from_json(defs_json)
        .map_err(|e| JsValue::from_str(&e))?;
    let indices: Vec<usize> = serde_json::from_str(indices_json).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let teams: Vec<usize> = serde_json::from_str(teams_json).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let humans: Vec<bool> = serde_json::from_str(humans_json).map_err(|e| JsValue::from_str(&e.to_string()))?;

    let mut b = game::new_battle_teams(mode, &defs, indices, teams, seed);
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
    game::start_turn(unsafe { BATTLE.as_mut().unwrap() });
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
            "hp": p.hp,
            "def": p.def,
            "energy": p.energy,
            "buffs": p.buffs.iter().map(|x| serde_json::json!({"type": x.kind, "value": x.value, "duration": x.duration})).collect::<Vec<_>>(),
            "draw": p.draw,
            "hand": p.hand,
            "discard": p.discard,
        })
    }).collect();

    let phase = if b.winner.is_some() { "over" } else {
        // facade phase tracking: derive from whether start_turn was called
        // For simplicity, treat as 'playing' if engine is active, else 'awaiting'
        // The JS facade will manage phase switching
        "playing"
    };

    let events: Vec<serde_json::Value> = unsafe { LAST_EVENTS.iter() }.map(|(tgt, form, kind)| {
        serde_json::json!({ "target": tgt, "fx": { "form": form, "color": fx_color(kind) } })
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
    }).to_string()
}

#[wasm_bindgen]
pub fn play_card(pi: usize, idx: usize, target: i32) -> Result<String, JsValue> {
    let b = battle();
    let tgt = if target >= 0 { Some(target as usize) } else { None };
    let events = game::play_card_target(b, pi, idx, tgt)
        .map_err(|e| JsValue::from_str(&e))?;
    unsafe { LAST_EVENTS = events; }
    Ok(battle_state_json())
}

#[wasm_bindgen]
pub fn end_turn(pi: usize) -> String {
    game::end_turn(battle(), pi);
    battle_state_json()
}

#[wasm_bindgen]
pub fn start_turn() -> String {
    game::start_turn(battle());
    battle_state_json()
}

#[wasm_bindgen]
pub fn cpu_step() -> Result<String, JsValue> {
    let b = battle();
    match game::choose_cpu_action(b) {
        game::CpuAction::PlayCard(idx, tgt) => {
            let _ = game::play_card_target(b, b.actor, idx, tgt);
            Ok(battle_state_json())
        }
        game::CpuAction::EndTurn => {
            game::end_turn(b, b.actor);
            Ok(battle_state_json())
        }
    }
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