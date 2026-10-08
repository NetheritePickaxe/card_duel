# BoardgameIoNotes.md

> boardgame.io 0.50.2 在本项目的适配笔记。阶段 0 Spike（`app/src/spike/`）实证得出，后续阶段必须遵守。

## 打包与运行时

- boardgame.io **没有 `exports` 映射**，子路径导入（`boardgame.io/client` 等）依赖目录代理包。
  - Vite / vitest / 浏览器端：正常解析。
  - **纯 Node ESM：报 `ERR_UNSUPPORTED_DIR_IMPORT`**。Node 侧（server/CLI）需 `createRequire(import.meta.url)('boardgame.io/server')` 或走包主入口。
  - 包主入口 `boardgame.io` 只导出 `Client, Local, RandomBot, MCTSBot, SocketIO, TurnOrder, Simulate, Step`；`Server`、`Game 方法` 等必须走子路径。
- `react` 19 + `@vitejs/plugin-react` 6 + `vite` 8 + `vitest` 5 已装。

## Game 定义 API（0.50 形态）

- Game = 普通对象 `{name, setup, moves, phases, turn, playerView, endIf, ai, plugins}`，**没有 `Game()` 工厂**。
- **move 签名是 `(context, ...args)` 位置参数**：
  ```js
  playCard: ({ G, ctx, playerID, events, random }, cardId) => { ... }
  ```
  （写成 context 内解构 `cardId` 是静默 bug：参数 undefined → 全部 INVALID_MOVE。）
- `setup: ({ ctx, random, ...pluginAPIs }, setupData) => G`；随机用 `random.Shuffle/Number/Die`（Alea 可种子复现）。
- `ctx` **没有 `playerIDs`**；玩家 id 由 `ctx.numPlayers` 派生为 `'0'..'n-1'`。
- hooks（`setup`/`onBegin`/`endIf` 等）与 moves 均被 Immer plugin 包装，**可原地修改 G**。
- `INVALID_MOVE` 从 `boardgame.io/core` 导入（值为字符串 `'INVALID_MOVE'`），move 返回它即拒绝且状态不变。

## 约束与坑

1. **moves 只能放 game 级 / phase 级 / stage 级**；`turn` 配置没有 `moves` 字段（写了被静默忽略）。
2. **phase 级 `onBegin` 只在阶段开始执行一次**；每回合逻辑（回费/抽牌/阶段判定）必须放 `turn.onBegin`。
3. **`Local({ bots })` 的 bots 传 Bot 类而非实例**：LocalMaster 执行 `new BotClass({game, enumerate, seed})`。
4. **`GetBotPlayer` 在 `activePlayers` 模式下永远返回字典序第一个活跃玩家** → 「全员同时活跃 + bots」会死循环。
   多人并发选人若要 bot 驱动，改用 `turn.order: TurnOrder.ALL` + `turn.maxMoves: 1` 串行回合。
5. **`playerView` 在单机（无 multiplayer）client 上也会执行，且 `playerID` 为 `undefined`**：
   观众/单机守卫必须写 `playerID == null`（`=== null` 漏 undefined）。
   单机对局要看到自己的手牌，必须 `Client({ playerID: '0' })`。
6. Local transport 首次 sync 是**异步**的，测试/脚本在 `client.start()` 后需等待（~50ms）再操作。
7. `enumerate` 返回 `[{move, args} | {event, args}]`；`events.endTurn()` 也可作为 `{event: 'endTurn'}` 枚举。

## 能力对位（替代自研部分）

| 项目现状 | boardgame.io 对应 |
|----------|-------------------|
| `project_state` 按席位裁剪手牌 | `playerView({G, playerID})` |
| pick → battle 两段流程 | `phases: {pick: {start: true, next: 'battle'}}` |
| `/act` 服务端权威结算 | Master + socket.io transport（服务端跑 moves） |
| rooms.rs 大厅 | Lobby API + Koa 自定义路由 |
| `drive_cpu` 服务器代跑 CPU | server 进程内 bot 客户端 或 Local({bots})（单机） |
| `Battle.rng` 种子可复现 | `ctx.random` / `random` plugin（seed 在 game.seed） |
| `/act` + 状态回传的指令溯源 | 框架内置 log（时间旅行/回放） |

## Spike 结论（2026-10-08）

`npm test`（`app/src/spike/`）4 项全过：隐藏信息裁剪、pick→battle 流转、INVALID_MOVE 拒绝、Local bots 完整对局。
Spike 游戏为假规则，阶段 1 真实规则测试落地后删除该目录。
