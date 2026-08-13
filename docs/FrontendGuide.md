# FrontendGuide.md

## 前端架构

Vanilla JS，无框架。模块按职责分层，依赖图无环。所有游戏规则由 Rust `game/`（WASM）执行，
JS 层只做门面、意图提交与渲染。

## 分层映射

| 架构层 | JS 模块 |
|--------|---------|
| Layer 4 Control | `battle.js`（战斗控制）、`lan.js`（LAN 客户端适配器）、`pick.js`（选人流程） |
| Layer 3 Event | `battle.js` 的 `lan-battle-state` 监听（表现处理器）、`render.js`（渲染/动画）、日志渲染 |
| Layer 2 Core | WASM 引擎（`game/`），经 `engine.js` → `core.js` 门面调用 |
| Layer 1 Action | WASM 导出函数（本地）；`lanAct({type: play/endturn/start})`（LAN 意图） |
| Layer 0 State | `state.js`（全局状态容器，零逻辑） |

## 模块职责

### `engine.js` — WASM 引擎加载器

**唯一职责**：加载 `card_duel_wasm.js` + `.wasm`，暴露 WASM 导出函数。
禁止操作 DOM、发起网络请求、读写 `localStorage`。

### `core.js` — WASM 引擎门面

**唯一职责**：业务 API 门面。无 DOM，无 IO。
- 调用 `engine.js` 的 WASM 接口执行本地对局
- `applyState` 全量重建状态快照（禁止 JS 侧增量修改）
- `cardCost` 支持 LAN 模式：手牌由服务端投影，直接读服务端计算的 `curCost`（单一规则源）

### `battle.js` — 战斗控制（Layer 4 Control 浏览器形态）

**职责**：
- 接收输入（出牌/结束回合），按模式分发：
  - 本地：经 `core.js` → WASM 结算
  - LAN：经 `lanAct` 提交意图，服务端权威结算
- 监听 `lan-battle-state` 事件：渲染、播放表现事件（play/fd）、切换战斗屏幕
- CPU 本地模式思考循环

**边界**：
- 禁止直接修改游戏状态（必须经 `core.js` API 或服务端状态回传）

### `lan.js` — LAN 客户端（网络适配器）

**职责**：
- 服务器地址管理、连接、扫描、房间列表
- 大厅操作（创建/加入/选择/队伍/就绪/加电脑）
- 战斗意图提交 `lanAct(side, action)` 与公开状态轮询 `lanPoll`
- `applyPublic`：公开状态 → 本地状态对象的数据同步（含本人手牌、强制弃牌模拟）

**边界**：
- **禁止反向依赖 `battle.js` / `pick.js`**（通过 `lan-battle-state` / `lan-room-ready` 事件解耦）
- 禁止本地结算任何战斗规则（唯一权威是服务端 `game::Battle`）
- 禁止驱动 UI/动画（只派发事件，表现层消费）

### `pick.js` — 选人流程

**职责**：模式选择、掷骰、选人界面；LAN 开战改为提交 `start` 意图。
监听 `lan-room-ready` 事件进入选人界面（由 lan.js 在建房/加入后派发）。

### `render.js` — DOM 渲染

**唯一职责**：将游戏状态映射为 DOM。
- LAN 模式下本人席位始终亮出手牌（`canOperate(pi)`），他人只显示计数

### `data.js` / `sound.js` / `i18n.js` / `modloader.js` / `util.js` / `state.js`

数据加载与持久化 / 音频管理 / 国际化 / 模组数据层 / DOM 工具 / 全局状态。职责同前。

### 组件（UI 单元，各自导出 `actions` 或自注册监听）

| 组件 | 职责 |
|------|------|
| `app.js` | 入口与路由：actionMap 合并分发、启动编排、屏幕路由（**不实现业务逻辑**） |
| `settings.js` | 设置页：主题/主题色（含取色器）/音量/页签/标语开关，导出 `settingsActions` |
| `share.js` | 主界面分享：局域网 IP 探测/复制地址/一言提示 |
| `mods-ui.js` | 模组管理 UI（数据层在 `modloader.js`） |
| `editor.js` / `library.js` | 编辑器 / 图鉴，导出 `editorActions` / `libraryActions` |

## JS 模块依赖图（无环）

```
engine.js ──→ WASM (game/)
core.js   ──→ engine.js
lan.js    ──→ core.js, render.js, data.js
battle.js ──→ core.js, render.js, lan.js
pick.js   ──→ core.js, render.js, lan.js
render.js ──→ core.js, data.js, sound.js
settings.js → sound.js, share.js
share.js  ──→ util.js, i18n.js
mods-ui.js ─→ modloader.js
app.js     ──→ 以上全部（actionMap 合并 + 启动编排）
```

事件解耦（替代模块间直接调用）：
- `lan-battle-state`：lan.js 同步完状态后派发，battle.js 消费（渲染/动画）
- `lan-room-ready`：lan.js 建房/加入后派发，pick.js 消费（进入选人）
- `locale-changed` / `mods-reloaded` / `screen-changed`：app.js 与各组件响应

## 前端约定

### 版本戳

所有 JS `import` 语句带 `?v=__VERSION__` 后缀（服务器在 `index.html` 中替换为 `CARGO_PKG_VERSION`）。
Node.js 直接 `require` 前需先剥离此后缀。

### 术语

- 统一使用 `subfaction`，禁止引入 `role`（已废弃）

### 事件流

```
本地：用户输入 → app.js（actionMap）→ battle.js → core.js → WASM(game/) → 状态快照 → render.js
LAN ：用户输入 → app.js → battle.js → lanAct(POST /act) → 服务端结算 → 状态回传
      → lan.js applyPublic → 'lan-battle-state' 事件 → battle.js → render.js
      其他客户端：轮询 GET /state → applyPublic → 事件 → 渲染
```

### 国际化 (i18n)

翻译文件：`app/card_duel/assets/lang/{code}.json`，键值对结构，`data-i18n` 属性绑定，
`t(key, params)` 读取，模组翻译通过 `addTranslation` 注册。键名按模块分层（`menu.`/`lan.`/`battle.`）。
