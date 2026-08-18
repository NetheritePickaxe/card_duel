# EngineSyncContract.md

> 本文档是 WASM 引擎（`game/` 模块，规则唯一实现）与 JS 前端门面（`engine.js` / `core.js`）之间的正式契约。规则引擎通过 `bindings.rs`（Layer 4 Control 适配器）导出到浏览器；所有结算统一经 `game::action::execute`（Layer 1 唯一入口）。

## 契约原则

1. **单一规则源**：所有规则、效果结算、CPU 决策只存在于 `game/`（Core 层）。JS 层禁止实现任何游戏规则逻辑。
2. **导出接口是唯一通道**：`bindings.rs` 的 `#[wasm_bindgen]` 导出函数是 WASM 与 JS 之间的唯一接口。`engine.js` 包装这些导出，`core.js` 提供业务级门面。
3. **状态快照承载全部状态**：每个导出函数返回 `battle_state_json()` 的完整状态字符串，JS 侧通过 `applyState` 重建快照。禁止 JS 侧自行维护游戏状态。
4. **随机数来源一致**：`init_battle` 接受 `seed` 参数，`game.rs` 内部使用可种子 PRNG，保证相同种子下流程确定。

## WASM 导出接口

`bindings.rs` 的 `#[wasm_bindgen]` 函数（Rust 侧 snake_case）经 `wasm-bindgen` 生成 JS 绑定；`engine.js` 再包装为 camelCase 业务函数。下表左侧为 Rust 名，右侧为 `engine.js` 暴露的名字。

| Rust 导出 | engine.js 包装 | 参数 | 返回 | 说明 |
|-----------|----------------|------|------|------|
| `init_battle` | `newBattle` | `(mode, defs_json, indices_json, teams_json, humans_json, seed, first_actor, order_json, names_json)` | `Result<String, JsValue>` | 创建对局并开始首回合，`names_json` 为各席位显示名数组（真人名/电脑N），空时节模型 |
| `battle_state_json` | `battleStateJson` | 无 | `String` | 完整对局状态 JSON |
| `play_card` | `playCard` | `(pi, idx, target)` | `Result<String, JsValue>` | 玩家 `pi` 打出第 `idx` 张手牌，`target` 为 -1 表示无目标 |
| `end_turn` | `endTurn` | `(pi)` | `Result<String, JsValue>` | 玩家 `pi` 结束回合；非本人回合（`not your turn`）或对局已结束时报错 |
| `start_turn` | `startTurn` | 无 | `Result<String, JsValue>` | 开始当前 actor 的回合；对局已结束时报错 |
| `cpu_step` | `cpuStep` | 无 | `Result<String, JsValue>` | 执行当前 actor 的 CPU 决策（出牌或结束回合）|
| `list_effects` | `listEffects` | 无 | `String` | 效果元数据 JSON（`effect_metadata_map`）|
| `card_cost` | `cardCost` | `(pi, idx)` | `i32` | 玩家 `pi` 第 `idx` 张手牌的费用 |

**修改时**：新增导出必须在 `bindings.rs` 添加 `#[wasm_bindgen]` 函数、在 `engine.js` 包装、在 `core.js` 暴露业务 API，并更新本文档表格。

## 状态快照结构

`battle_state_json()` 返回的 JSON 包含：

| 字段 | 说明 |
|------|------|
| `mode` | 对局模式 |
| `seq` | 状态序列号 |
| `turn` | 回合数 |
| `actor` | 当前行动方 |
| `phase` | 阶段（`playing` / `over`） |
| `winner` | 胜者，未决为 `null` |
| `players` | 玩家数组（`role`/`name`/`hp`/`def`/`energy`/`buffs`/`draw`/`hand`/`discard`），`name` 为显示名（玩家名/电脑N） |
| `teams` | 队伍划分 |
| `order` | 行动顺序 |
| `humans` | 各席位是否人类 |
| `seatMap` | 席位映射 |
| `defs` | 游戏定义（`GameDefs` 反序列化） |
| `players[].role.heroes` | 子阵营绑定的英雄卡 id 列表 |
| `players[].hand[]` | 卡牌含 `passive`（被动效果）与 `hero`（是否英雄卡）字段 |
| `log` | 对战日志 |
| `_events` | 最近一次操作的事件（`target` + `fx`） |

**约束**：
- 字段名变更必须同时更新 `bindings.rs` 与 `core.js` 的 `applyState`。
- 隐藏信息保护：WASM 状态是完整状态（含双方手牌），仅在本地单机模式使用；LAN 模式必须通过服务端视图裁剪（见 `server.rs`）。

## 状态一致性与错误处理

- 所有可失败操作（`init_battle`/`play_card`/`end_turn`/`start_turn`/`cpu_step`）返回 `Result<String, JsValue>`，错误时 JS 侧必须 `console.error` 并停止操作，禁止猜测默认状态继续。
- 每次操作后调用方必须重新读取返回的状态 JSON，禁止在 JS 侧缓存旧状态后自行增量修改。
- `core.js` 的 `applyState` 是全量重建快照，不做局部补丁。

## 支持的效果类型

`list_effects()` 返回的元数据（`effect_metadata_map`）当前包含：

`damage` / `heal` / `gain_def` / `gain_atk` / `weaken_def` / `cost_up` / `dmg_reduce` / `skip_turn` / `extra_turn` / `draw` / `force_discard` / `energy` / **`aoe_damage`**

- `aoe_damage`：对己方之外的所有存活敌军结算伤害，支持 `pierce` 真伤，`descKey: desc.aoe_damage`，`cpuWeight` 按敌方存活数加权。
- 卡牌的 `passive` 字段与 `effects` 同构；打出时先结算 `effects` 再结算 `passive`（英雄卡多一个附加触发）。
- 牌组构建：`make_player` 将 `sub.deck`（专属）+ `faction.deck`（阵营通用）合并。

## 修改流程

修改任何涉及契约的内容（新增导出、改状态字段、改规则）时：

1. 只改 `game/` 一处（规则/效果，通常在 `core.rs` / `effects.rs`）。
2. 若新增行动类型：改 `game/action.rs`（Action + validate + execute），再改 `bindings.rs`。
3. 若新增导出：改 `bindings.rs`，在 `engine.js` 包装，在 `core.js` 暴露 API。
4. 执行 `scripts\build_wasm.bat`。
5. 执行 `cargo test --lib --release` 验证规则测试。
6. 执行 `node --check app/js/*.js`。
7. 更新本文档中的导出接口表与状态快照表。

## 常见错误

- **JS 侧实现规则**：绕过 WASM 自行结算，导致与 `game.rs` 分叉。禁止。
- **JS 侧增量修改快照**：在 `applyState` 之外手工改状态字段，导致渲染与实际状态不一致。
- **吞掉返回的错误**：`play_card` 等返回 `Result`，失败必须报错，不能静默跳过。
- **接口参数顺序不一致**：`bindings.rs` 导出参数顺序与 `engine.js` 调用顺序必须一致。