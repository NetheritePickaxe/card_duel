/* tslint:disable */
/* eslint-disable */

export function battle_state_json(): string;

export function card_cost(pi: number, idx: number): number;

export function cpu_step(): string;

export function end_turn(pi: number): string;

export function init_battle(mode: string, defs_json: string, indices_json: string, teams_json: string, humans_json: string, seed: bigint, first_actor: number): string;

export function list_effects(): string;

export function play_card(pi: number, idx: number, target: number): string;

export function start_turn(): string;

export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

export interface InitOutput {
    readonly memory: WebAssembly.Memory;
    readonly battle_state_json: (a: number) => void;
    readonly card_cost: (a: number, b: number) => number;
    readonly cpu_step: (a: number) => void;
    readonly end_turn: (a: number, b: number) => void;
    readonly init_battle: (a: number, b: number, c: number, d: number, e: number, f: number, g: number, h: number, i: number, j: number, k: number, l: bigint, m: number) => void;
    readonly list_effects: (a: number) => void;
    readonly play_card: (a: number, b: number, c: number, d: number) => void;
    readonly start_turn: (a: number) => void;
    readonly __wbindgen_add_to_stack_pointer: (a: number) => number;
    readonly __wbindgen_export: (a: number, b: number, c: number) => void;
    readonly __wbindgen_export2: (a: number, b: number) => number;
    readonly __wbindgen_export3: (a: number, b: number, c: number, d: number) => number;
}

export type SyncInitInput = BufferSource | WebAssembly.Module;

/**
 * Instantiates the given `module`, which can either be bytes or
 * a precompiled `WebAssembly.Module`.
 *
 * @param {{ module: SyncInitInput }} module - Passing `SyncInitInput` directly is deprecated.
 *
 * @returns {InitOutput}
 */
export function initSync(module: { module: SyncInitInput } | SyncInitInput): InitOutput;

/**
 * If `module_or_path` is {RequestInfo} or {URL}, makes a request and
 * for everything else, calls `WebAssembly.instantiate` directly.
 *
 * @param {{ module_or_path: InitInput | Promise<InitInput> }} module_or_path - Passing `InitInput` directly is deprecated.
 *
 * @returns {Promise<InitOutput>}
 */
export default function __wbg_init (module_or_path?: { module_or_path: InitInput | Promise<InitInput> } | InitInput | Promise<InitInput>): Promise<InitOutput>;
