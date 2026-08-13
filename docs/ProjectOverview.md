# ProjectOverview.md

## 项目定位

Card Duel 是一个基于 Tauri v2 的卡牌对战游戏，支持本地 LAN 联机、Web 浏览器访问和 CLI 终端模式。

## 技术栈

| 层级 | 技术 |
|------|------|
| 桌面壳 | Tauri v2 (Rust) |
| 前端 | Vanilla JS，无框架 |
| 后端逻辑 | Rust |
| 数据 | JSON 文件 (`app/card_duel/data/*.json`) |
| 网络 | 自研 HTTP 服务器（`server.rs`），端口 8788 |

## 关键特征

- **单引擎规则源**：`game/` 模块（五层架构：State/Action/Core/Event/Control）是所有战斗规则、效果结算、CPU 决策的唯一事实来源，编译为 WASM（浏览器）与原生（服务端/CLI/Tauri）
- **LAN 服务端权威**：联机对局由服务器持有权威 `Battle` 结算（`/act` 意图 → Action → 公开状态投影），客户端只提交意图并消费公开状态
- **数据驱动**：卡牌、阵营、子阵营、效果全部从 JSON 读取，引擎不硬编码数值
- **多入口**：Web 服务器、Tauri 桌面、CLI 终端、LLM API 四种运行模式
- **有限自动化测试**：`game.rs` 内置基础规则测试（`cargo test --lib --release`），其余验证依赖 `cargo build` + `node --check` + 人工运行

## 目录结构

```
项目根/
├── AGENTS.md                 # AI 行为约束
├── CONTRIBUTING.md           # 贡献指南
├── cardduel.bat              # Web/LAN 服务器启动脚本
├── app/                      # 前端静态文件
│   ├── js/                   # JS 源码
│   │   ├── engine.js         # WASM 引擎加载器（门面）
│   │   ├── core.js           # WASM 引擎门面 + LAN 监控
│   │   ├── battle.js         # 战斗控制（Control：本地 WASM / LAN 意图）
│   │   ├── render.js         # DOM 渲染（表现层）
│   │   ├── lan.js            # LAN 客户端（网络适配器，无环依赖）
│   │   ├── settings.js       # 设置组件（主题/主题色/音量）
│   │   ├── share.js          # 分享组件（局域网地址/复制）
│   │   ├── mods-ui.js        # 模组管理 UI 组件
│   │   ├── data.js           # 数据加载 + localStorage
│   │   ├── sound.js          # 音频管理
│   │   └── ...               # 其他模块
│   └── card_duel/
│       ├── data/             # 游戏数据（JSON）
│       │   ├── cards/        # 卡牌：每张一张 card.json
│       │   ├── factions/     # 阵营：faction.json + 子阵营 subfaction.json
│       │   └── effects.json  # 效果元数据（editor/fx 配置）
│       └── assets/
│           └── sound/
│               ├── bgm/      # OGG 背景音乐
│               └── sound.json # 音轨注册表
├── src-tauri/
│   ├── src/
│   │   ├── game/             # 规则引擎（五层架构，唯一事实来源）
│   │   │   ├── state.rs      #   Layer 0 纯数据模型
│   │   │   ├── action.rs     #   Layer 1 Action 契约 + validate + execute
│   │   │   ├── core.rs       #   Layer 2 战斗引擎
│   │   │   ├── effects.rs    #   Layer 2 效果结算子系统
│   │   │   ├── ai.rs         #   Layer 2 CPU 决策子系统
│   │   │   ├── view.rs       #   只读状态格式化
│   │   │   └── data.rs       #   JSON 数据加载
│   │   ├── server/           # HTTP 服务（入口层）
│   │   │   ├── mod.rs        #   路由分发 + ServerState + 日志
│   │   │   ├── rooms.rs      #   LAN 大厅（联机会话 Control）
│   │   │   ├── battle.rs     #   房间战斗（服务端权威结算 + 公开状态投影）
│   │   │   ├── gameapi.rs    #   /api/game/*（LLM API）
│   │   │   ├── assets.rs     #   静态文件服务
│   │   │   └── discover.rs   #   UDP 局域网发现
│   │   ├── bindings.rs       # WASM 适配器（Layer 4 Control）
│   │   ├── net.rs            # 局域网 IP 工具
│   │   ├── main.rs           # Tauri 桌面入口
│   │   └── bin/
│   │       └── server.rs     # 独立 exe 入口（--server / --cli）
│   ├── wasm/
│   │   ├── Cargo.toml        # WASM 独立 crate
│   │   └── src/
│   │       └── lib.rs        # WASM 入口，调用 src/game/
│   └── Cargo.toml
└── docs/                     # 本文档目录
```

## 运行模式

| 模式 | 入口 | 用途 |
|------|------|------|
| Web/LAN 服务器 | `cardduel.bat` | 浏览器访问，端口 8788 |
| Tauri 桌面 | `src-tauri/src/main.rs` | 桌面应用，可嵌入服务器 |
| CLI 终端 | `card-duel-server --cli` | AI vs 人类，stdin/stdout |
| LLM API | 端口 8788 REST | 外部 AI 对接 |

## 核心约定

- 术语统一使用 `subfaction`，`role` 已废弃
- `localStorage` 键：`cardgame_db_v4`
- JS `import` 带 `?v=__VERSION__` 后缀
- 音频格式：OGG Vorbis 192kbps，无元数据
