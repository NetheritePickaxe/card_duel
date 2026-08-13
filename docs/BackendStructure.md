# BackendStructure.md

## 分层架构（参考 `.opencode/battle_system_architecture.md`）

Rust 侧按五层架构组织。**依赖方向严格单向向下**，下层不感知上层：

```
Layer 4 Control ─── bindings.rs（WASM 适配器）
                ─── server/battle.rs（LAN 房间战斗，服务端权威）
                ─── server/rooms.rs（联机会话）
Layer 3 Event   ─── game/action::execute 产出 GameEvent → 各适配器投影
Layer 2 Core    ─── game/core.rs + game/effects.rs + game/ai.rs
Layer 1 Action  ─── game/action.rs（Action 契约 + validate + execute）
Layer 0 State   ─── game/state.rs（纯数据，零行为）
```

**唯一战斗入口**：所有外部入口（WASM、HTTP、CLI）都必须经 `game::action::execute` 结算，禁止绕过 Action 层直接调用 Core 细节函数。

## 模块职责

### `game/` — 规则引擎（唯一事实来源，编译为原生 + WASM）

| 模块 | 层 | 职责 |
|------|----|------|
| `game/state.rs` | L0 | 纯数据模型：`Card`/`Effect`/`Buff`/`PlayerState`/`Battle`/`GameDefs`/`GameEvent` |
| `game/action.rs` | L1 | `Action` 枚举（PlayCard/EndTurn/StartTurn/CpuStep）+ `validate` + `execute` |
| `game/core.rs` | L2 | 战斗引擎：对局创建、回合流转、出牌结算、数值计算、胜负判定 |
| `game/effects.rs` | L2 | 效果子系统：12 种效果结算 + 效果元数据 |
| `game/ai.rs` | L2 | CPU 决策：`choose_cpu_action` → `CpuAction` |
| `game/view.rs` | 适配器 | 只读状态格式化（CLI/API 文本视图），禁止修改状态 |
| `game/data.rs` | 适配器 | JSON 数据加载（`defs_from_strings`/`load_defs` 等），不依赖 CWD |

**边界**：
- 禁止引入 `tauri`、`tiny_http` 等平台/IO 依赖
- Core 无副作用：随机性只来自 `Battle.rng`（可种子复现）
- 数据驱动：卡牌/阵营/效果数值全部来自 `app/card_duel/data/*.json`，禁止硬编码

### `server/` — HTTP 服务（入口层，Layer 4 Control 的服务端形态）

| 模块 | 职责 |
|------|------|
| `server/mod.rs` | 路由分发、`ServerState`、HTTP 基础设施、日志（`logln!`）、`web_root()` |
| `server/rooms.rs` | LAN 大厅：创建/加入/列表/选择/队伍/就绪/离开/主机数据/模组共享 |
| `server/battle.rs` | 房间战斗（服务端权威）：`/act` 意图结算 + 按观众公开状态投影 |
| `server/gameapi.rs` | `/api/game/*`（LLM API 适配器） |
| `server/assets.rs` | 静态文件服务（磁盘/内嵌双模式） |
| `server/discover.rs` | UDP 局域网发现 |

**边界**：
- 禁止在路由处理函数中实现业务逻辑（结算必须经 `game::action::execute`）
- 房间战斗状态变更的唯一入口是 Action 结算；`project_state` 只读投影

### 其余文件

| 文件 | 职责 |
|------|------|
| `bindings.rs` | WASM 适配器（Layer 4 Control）：持有权威 Battle，构造 Action 交 `execute`，返回状态快照 |
| `net.rs` | 局域网 IP 工具（纯工具，无状态） |
| `main.rs` | Tauri 桌面入口：参数解析 + 后台服务器启动 |
| `bin/server.rs` | 独立 exe 入口：`--server` / `--cli` 两种模式，CLI 也走 `action::execute` |

## LAN 联机架构（服务端权威结算）

旧协议的「各端本地结算 + POST 公开状态」已废弃（单引擎重构后该链路损坏且隐藏信息不一致）。
新协议：

```
客户端（意图）  POST /act {room, side, action: {type: start|play|endturn, ...}}
    ↓
server/battle.rs  game::action::execute(权威 Battle)
    ↓
公开状态投影     State {seq, turn, actor, winner, phase, defs, p[], log, play, fd}
                —— 按观众席位裁剪：本人席位附带完整手牌（含服务端计算的 curCost），
                   其余席位只有手牌计数 + 近 14 张弃牌
    ↓
客户端          轮询 GET /state?room=X&side=Y 或直接消费 /act 响应
```

- CPU 席位由服务器代跑（`drive_cpu`），客户端不再本地驱动
- 表现事件（play/fd）随状态下发，客户端只读渲染
- `/act` 响应直接携带最新状态，行动方无需等下一次轮询
- 端点变更：`POST /state`（旧 peer-post 同步）已移除，改为 `/act`

## 数据流

```
请求 → server/mod.rs（路由） → game/action::execute（结算） → 状态投影 → 响应
                ↑                                          ↓
           net.rs（IP）                             JSON 数据文件（game/data.rs 加载）
```

## 错误传播

- `game/action::validate` 精确返回错误信息（如 `not your turn`），由调用方映射为 HTTP 400/403
- 状态无法确认时停止操作并返回错误，禁止猜测默认值继续
- 禁止在规则代码中使用 `unwrap()` 处理可恢复错误
