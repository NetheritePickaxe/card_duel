# FrontendGuide.md

## 前端架构

Vanilla JS，无框架。模块按职责严格分层。所有游戏规则由 Rust `game.rs` 编译为 WASM 执行，JS 层只做门面与渲染。

## 模块职责

### `engine.js` — WASM 引擎加载器

**唯一职责**：加载 `card_duel_wasm.js` + `.wasm`，暴露 WASM 导出函数。

包含：
- WASM 初始化与实例化
- 将 `bindings.rs` 的导出接口（`newBattle`/`playCard`/`endTurn`/`startTurn`/`cpuStep`/`battleStateJson`/`listEffects`/`cardCost`）包装为异步可用的 JS 函数

**边界**：
- 禁止操作 DOM、发起网络请求、读写 `localStorage`
- 只负责 WASM 调用，不实现游戏规则

### `core.js` — WASM 引擎门面

**唯一职责**：业务 API 门面 + LAN 模式监控。无 DOM，无 IO。

包含：
- 调用 `engine.js` 的 WASM 接口执行游戏操作
- 将 WASM 返回的状态快照（`state.BATTLE` 等）同步到 JS 侧（`applyState`）
- LAN 模式下轮询服务端状态并重建快照

**边界**：
- 禁止操作 `document`
- 禁止读写 `localStorage`
- 禁止引入 `battle.js`、`render.js`、`app.js`
- 不实现任何游戏规则（只转发到 WASM）

### `battle.js` — 战斗 UI 与动画编排

**职责**：
- 战斗场景的事件处理（点击、拖拽）
- 调用 `core.js` 执行游戏操作
- 编排动画与特效
- 调用 `render.js` 更新界面

**边界**：
- 禁止直接修改游戏状态（必须通过 `core.js` API）
- 禁止直接调用 `game.rs`/WASM（必须通过 `core.js`）

### `render.js` — DOM 渲染

**唯一职责**：将游戏状态映射为 DOM。

**边界**：
- 禁止修改游戏状态
- 只读 `core.js` 的状态或接收 `battle.js` 传入的数据

### `lan.js` — LAN 联机客户端

**职责**：
- 连接本地服务器
- 发送玩家操作（`POST /api/game/{id}/act`）
- 接收游戏状态更新（`GET /api/game/{id}/state`）

**边界**：
- 禁止引入游戏逻辑（只负责网络通信，不解释规则）
- 禁止直接操作 `core.js`（通过 `battle.js` 或 `app.js` 中转）

### `data.js` — 数据加载与持久化

**职责**：
- 从 `app/card_duel/data/*.json` 加载游戏数据
- `localStorage` 读写（牌组、设置）
- 数据迁移（`v3` → `v4` 的 `roles` → `subfactions`）

**边界**：
- 游戏运行时数据（当前对局状态）不走 `localStorage`
- `localStorage` 键名：`cardgame_db_v4`

### `sound.js` — 音频管理

**职责**：
- BGM 切换（根据当前屏幕：menu / battle / victory / defeat）
- 音效播放

**边界**：
- 音轨注册表来源：`app/card_duel/assets/sound/sound.json`
- BGM 文件格式：OGG Vorbis 192kbps，无元数据

### `app.js` — 入口与路由

**职责**：
- 页面初始化
- 事件委托
- 屏幕路由（menu → pick → battle → editor → library）
- `actionMap` 定义

**边界**：
- 禁止实现游戏逻辑（委托给 `core.js` 或 `battle.js`）
- 禁止直接操作 DOM（委托给 `render.js`）

## JS 模块依赖图

```
engine.js ──→ WASM (game.rs)
core.js   ──→ engine.js
app.js
├── core.js
├── battle.js ───→ core.js
├── render.js ←─── battle.js
├── lan.js ─────→ server (HTTP)
├── data.js
├── sound.js
├── pick.js
├── editor.js
├── library.js
├── modloader.js
├── i18n.js
└── util.js
```

箭头表示「调用/依赖」方向。`engine.js` + `core.js` 在依赖图最底层，禁止反向依赖。

## 前端约定

### 版本戳

所有 JS `import` 语句带 `?v=__VERSION__` 后缀：

```javascript
import { GameState } from './core.js?v=__VERSION__';
```

`server.rs` 在返回 `index.html` 时，将 `__VERSION__` 替换为 `CARGO_PKG_VERSION`。

**注意**：Node.js 直接 `require` 前需先剥离此后缀，否则路径解析失败。

### 术语

- 统一使用 `subfaction`
- 禁止引入 `role`（已废弃）

### 事件流

```
用户输入 → app.js（路由/委托） → battle.js（处理） → core.js → engine.js → WASM(game.rs)
                                              ↓
                                       render.js（更新 UI）
```

WASM 结算后返回状态快照，`core.js` 的 `applyState` 同步到 JS 侧，`battle.js` 再驱动 `render.js` 更新 UI。
