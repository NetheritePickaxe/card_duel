# KnownConstraints.md

> 以下约束不是临时问题，而是 AI 在本项目做决策时必须当作长期真理来遵守的条件。它们影响架构选择、修改范围和验证策略。

---

## 1. 术语迁移未完成

**现状**：`role` → `subfaction` 的迁移在代码中仍有遗留引用。`localStorage` 的 `v3` → `v4` 迁移逻辑保留在 `data.js` 中。

**影响**：
- 新代码必须统一使用 `subfaction`
- 发现旧引用时应顺手替换，而非在旁新增兼容代码
- JSON 字段名、代码变量名、注释必须一致

**应对**：
- 搜索 `role`（排除 `localStorage` 迁移逻辑）并替换
- 禁止为「兼容」引入新的 `role` 引用

---

## 3. 验证缺口

**现状**：无测试框架、无 lint、无类型检查。验证全靠 `cargo test --lib --release`（基础规则测试，当前 9 项）+ `cargo build` + `node --check` + 人工运行。开发环境无可用浏览器（虚拟显示适配器），前端视觉/交互无法自动验证；LAN 协议可用 curl / Node 驱动真实客户端模块对真实服务器做行为测试。

**影响**：
- 编译命令是唯一的自动防线
- 任何「看起来没问题」的代码都可能在运行时暴露
- 重构风险极高，因为没有回归测试保护

**应对**：
- 让错误在编译期暴露：Rust 用严格类型，JS 避免动态属性访问
- 每次修改后必须执行完整验证清单（见 `BuildAndRun.md`）
- 优先选择容易验证的简单结构，而非复杂但「强大」的方案
- 涉及 LAN 协议的修改，用 Node 剥离 `?v=__VERSION__` 后驱动真实 `lan.js` 对真实服务器验证

---

## 4. CWD 敏感历史

**现状**：旧代码依赖 `std::env::current_dir()` 解析路径，导致双击 exe 时找不到文件。`serve_disk_file` 已改用 `web_root()` 解析路径，`cardduel.bat` 仍做 `cd /d "%~dp0"` 作为保险。

**影响**：
- 新增任何文件路径解析时，必须沿用 `web_root()` 模式
- 禁止引入新的 CWD 依赖
- 路径问题只在「从非项目根目录启动」时暴露，极易遗漏

**应对**：
- 所有文件操作使用 `web_root()` 或等效函数
- 测试时故意从其他目录启动 exe，验证路径解析

---

## 5. 平台差异

**现状**：Web 端无 raw socket，Android 有权限墙与后台切断。网络层目前主要支持桌面 LAN，Web 端通过 HTTP 访问。

**影响**：
- 网络层必须按平台分实现
- 禁止用 `#[cfg]` 在业务逻辑里打补丁假装平台不存在
- Web 端的 LAN 发现受限（无法 UDP 广播）

**应对**：
- 网络代码集中在 `net.rs`（Rust）和 `lan.js`（JS）
- 若未来扩展 Web 端联机，需引入信令服务器或房间码方案
- 禁止在 `game.rs` 或 `core.js` 中嵌入平台相关网络代码

---

## 6. 无框架前端的代价

**现状**：Vanilla JS，无 React/Vue，无 TypeScript，无状态管理库。

**影响**：
- 没有类型系统保护 API 边界
- 没有虚拟 DOM 自动同步状态与视图
- 模块依赖靠人工维护，循环依赖不会自动报错

**应对**：
- 通过命名约定和模块边界人为维护契约
- `core.js`（WASM 门面）与 `engine.js` 必须保持纯逻辑，不触及 DOM
- `render.js` 只读状态，不修改状态
- 禁止在模块间引入隐式全局状态

---

## 7. 音频格式约束

**现状**：BGM 必须为 OGG Vorbis 192kbps，无元数据。音轨注册在 `sound.json`。

**影响**：
- 非标准格式（如 MP3、带元数据的 OGG）可能无法播放或行为异常
- `sound.js` 的 `updateBGM()` 根据当前屏幕和胜负状态切换，逻辑与音频文件耦合

**应对**：
- 新增 BGM 时必须用指定 ffmpeg 命令转换
- 修改 `sound.json` 时同步更新 `sound.js` 的切换逻辑

---

## 8. LAN 联机协议：服务端权威结算

**现状**：2026-08 分层重构后，LAN 对局改为**服务端权威结算**。服务器持有权威 `game::Battle`，客户端经 `POST /act` 提交意图（start/play/endturn），轮询 `GET /state?room=X&side=Y` 消费公开状态。

**背景**：旧的「各端本地结算 + POST /state 广播」链路在单引擎重构后已断裂（实测三处：WASM 未初始化 panic、`pick.js` 引用未导入的 `startTurn`、`lan.js` 调用未导出的 `cpuActOnce`），且公开状态与本地结算必然分叉。

**影响与应对**：
- `POST /state`（旧广播）已移除；客户端一律走 `/act` 意图 + 状态轮询
- 隐藏信息：公开状态按观众席位投影，本人手牌（含服务端计算的 `curCost`）只发给对应 `side`；不传 `side` 不泄露任何手牌
- 手牌费用等规则数值由服务端计算下发（`curCost`），JS 不自行实现规则；`core.js::cardCost` 对带 `curCost` 的卡直接读取
- CPU 席位由服务器 `drive_cpu` 代跑，客户端不再本地驱动（`battle.js` 不再导出 `cpuActOnce` 调用方）
- 若未来需要断线重连/回放，`/act` + 公开状态投影是天然的指令溯源基础

---

## 9. 锁与并发约定

**现状**：`server/` 内的锁统一使用 `parking_lot::Mutex`（`lock()` 直接返回 guard，无 poisoning 路径）。`ServerState` 字段均为 `Arc<parking_lot::Mutex<...>>`。
