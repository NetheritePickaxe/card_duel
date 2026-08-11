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

- **单引擎规则源**：`game.rs` 是所有战斗规则、效果结算、CPU 决策的唯一事实来源，编译为 WASM（浏览器）与原生（服务端/CLI/Tauri）
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
│   │   ├── battle.js         # 战斗 UI + 动画编排
│   │   ├── render.js         # DOM 渲染
│   │   ├── lan.js            # LAN 联机客户端
│   │   ├── data.js           # 数据加载 + localStorage
│   │   ├── sound.js          # 音频管理
│   │   └── ...               # 其他模块
│   └── card_duel/
│       ├── data/             # 游戏数据（JSON）
│       │   ├── cards.json
│       │   ├── factions.json
│       │   ├── subfactions.json
│       │   └── effects.json
│       └── assets/
│           └── sound/
│               ├── bgm/      # OGG 背景音乐
│               └── sound.json # 音轨注册表
├── src-tauri/
│   ├── src/
│   │   ├── game.rs           # Rust 游戏引擎（纯逻辑）
│   │   ├── server.rs         # HTTP 服务器
│   │   ├── net.rs            # 局域网 IP 工具
│   │   ├── bindings.rs       # WASM 导出接口
│   │   ├── main.rs           # Tauri 桌面入口
│   │   └── bin/
│   │       └── server.rs     # 独立 exe 入口
│   ├── wasm/
│   │   ├── Cargo.toml        # WASM 独立 crate
│   │   └── src/
│   │       └── lib.rs        # WASM 入口，调用 src/game.rs
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
