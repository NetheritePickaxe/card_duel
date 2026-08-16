import init, * as wasm from './card_duel_wasm.js?v=__VERSION__';

let ready = false;

export async function loadEngine() {
  if (ready) return;
  await init();
  ready = true;
}

export function newBattle(mode, defsJson, indicesJson, teamsJson, humansJson, seed, firstActor, order) {
  return wasm.init_battle(mode, defsJson, indicesJson, teamsJson, humansJson, seed, firstActor != null ? firstActor : -1, order ? JSON.stringify(order) : '');
}

export function playCard(pi, idx, target) {
  return wasm.play_card(pi, idx, target);
}

export function endTurn(pi) {
  return wasm.end_turn(pi);
}

export function startTurn() {
  return wasm.start_turn();
}

export function cpuStep() {
  return wasm.cpu_step();
}

export function battleStateJson() {
  return wasm.battle_state_json();
}

export function listEffects() {
  return wasm.list_effects();
}

export function cardCost(pi, idx) {
  return wasm.card_cost(pi, idx);
}