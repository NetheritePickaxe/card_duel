# BackendStructure.md

## 模块职责

### `game.rs` — 游戏引擎

**唯一职责**：纯游戏逻辑。无 IO，无平台依赖。

包含：
- 游戏状态定义（`GameState`、`Card`、`Unit` 等）
- 效果系统（12 种效果的结算逻辑）
- AI 决策逻辑
- 数据加载（从 JSON 反序列化）
- 状态格式化（输出给前端或 CLI 的视图）

**边界**：
- 禁止引入 `tauri`、`tokio::net`、`warp`、`axum` 等 HTTP/Tauri 依赖
- 禁止直接读写文件（数据加载通过调用者传入路径或字节）
- 禁止打印到 stdout（返回 `Result`，由调用者决定如何输出）

### `server.rs` — HTTP 服务器

**唯一职责**：HTTP 路由、静态文件服务、游戏 API 暴露。

包含：
- 静态文件路由（`app/` 目录）
- 游戏 API（`/api/game/new`、`/api/game/{id}/state`、`/api/game/{id}/act`）
- LAN 联机支持
- `index.html` 中的 `__VERSION__` 替换

**边界**：
- 禁止直接操作游戏状态（必须通过 `game.rs` 的 API）
- 禁止在路由处理函数中实现业务逻辑（只负责解析请求、调用 `game.rs`、序列化响应）

### `net.rs` — 网络工具

**唯一职责**：局域网 IP 发现、网络辅助函数。

**边界**：
- 禁止引入游戏逻辑
- 纯工具函数，无状态

### `main.rs` — Tauri 桌面入口

**唯一职责**：启动 Tauri 应用，可选启动嵌入服务器。

包含：
- Tauri 命令注册（如有）
- `--server` 参数解析，启动后台 LAN 服务器
- 磁盘模式设置

**边界**：
- 禁止实现业务逻辑
- 禁止直接操作 `game.rs` 的内部状态

### `bin/server.rs` — 独立 exe 入口

**唯一职责**：启动独立 HTTP 服务器或 CLI 模式。

包含：
- 命令行参数解析（`--cli`、`--port` 等）
- 调用 `server.rs` 启动服务
- CLI 模式下的 stdin/stdout 交互循环

**边界**：
- 禁止实现业务逻辑
- 禁止直接操作 `game.rs` 的内部状态

## 数据流

```
请求 → server.rs（路由） → game.rs（逻辑） → server.rs（序列化） → 响应
                ↑                              ↓
           net.rs（IP）                  JSON 数据文件
```

## 错误传播

- `game.rs` 内部使用 `Result<T, GameError>`，错误类型精确
- `server.rs` 将 `GameError` 映射为 HTTP 状态码（400/500）
- 禁止在 `game.rs` 中使用 `unwrap()` 或 `expect()` 处理可恢复错误

## 文件路径解析

- 所有文件路径必须通过 `web_root()` 解析，禁止依赖 `std::env::current_dir()`
- `web_root()` 应基于可执行文件路径或编译期嵌入的路径计算
- 确保双击 exe 或从任意目录启动时都能正确找到 `app/card_duel/data/`
