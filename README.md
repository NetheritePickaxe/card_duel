<div align="center">

<img src="src-tauri/icons/icon.png" width="120" alt="Card Duel Logo" />

# 卡牌对决 · Card Duel

[![Tauri](https://img.shields.io/badge/Tauri-2.x-ff4c15?style=for-the-badge&logo=tauri)](https://tauri.app)
[![Rust](https://img.shields.io/badge/Rust-1.75+-yellow?style=for-the-badge&logo=rust)](https://www.rust-lang.org)
[![GitHub release](https://img.shields.io/github/v/release/NetheritePickaxe/card_duel?style=for-the-badge)](https://github.com/NetheritePickaxe/card_duel/releases)
[![Platform](https://img.shields.io/badge/Platform-Windows%20%7C%20Android%20%7C%20Web-6e40c9?style=for-the-badge)](https://github.com/NetheritePickaxe/card_duel)
[![License](https://img.shields.io/github/license/NetheritePickaxe/card_duel?style=for-the-badge)](https://github.com/NetheritePickaxe/card_duel/blob/main/LICENSE)

**跨平台卡牌对战游戏** · Tauri + Rust 后端 · 支持 Windows / Android / Web 浏览器

[截图展示](#截图展示) · [功能特性](#功能特性) · [开始游戏](#开始游戏) · [网络联机](#网络联机) · [项目结构](#项目结构)

</div>

---

## 截图展示

| 菜单界面 | 战斗界面 |
|----------|----------|
| ![菜单](screenshots/menu.png) | ![战斗](screenshots/battle.png) |

| 角色编辑 | 卡牌编辑 |
|----------|----------|
| ![编辑角色](screenshots/edit-role.png) | ![编辑卡牌](screenshots/edit-card.png) |

> 截图路径待补充，运行游戏后截图放入 `screenshots/` 目录

---

## 功能特性

| 特性 | 说明 |
|------|------|
| 🎲 安全随机先手 | 基于 `crypto.getRandomValues` 密码学安全骰子 |
| ❤️ 三属性系统 | 生命 / 防御 / 能量，能量每回合回满 |
| 🃏 抽牌/弃牌堆 | 参考《杀戮尖塔》的牌库管理机制 |
| 👤 角色自定义 | 名字 / 血量 / 防御 / 能量 / 立绘 / 专属牌组 |
| 🎴 卡牌编辑器 | 多效果组合 · 自定义特效颜色与动画形式 |
| 🤖 三种对战模式 | 单人 AI · 本地双人 · 局域网联机 |
| 📱 跨平台支持 | Windows 桌面 / Android / Web 浏览器 |
| 💾 数据持久化 | 自定义数据自动保存在浏览器本地 |

---

## 开始游戏

### 下载安装

- **Windows**: 从 [Releases](https://github.com/NetheritePickaxe/card_duel/releases) 下载 `CardDuel_x64-setup.exe`，安装后运行
- **Android**: 下载 `app-universal-release.apk`，安装后打开
- **Web 浏览器**: 服务端启动后，同一局域网内打开 `http://<服务端IP>:8788` 即可

### 游戏规则

1. **先手**由随机骰子决定（相同则重掷）
2. 每回合开始时，玩家恢复全部能量并抽 2 张牌
3. 使用能量打出卡牌，对敌方造成伤害、为自己提供防御/治疗等效果
4. 将对手生命值降至 0 即获胜
5. 支持自定义角色和卡牌，数据自动保存

### 对战模式

| 模式 | 说明 |
|------|------|
| 🤖 **单人 AI** | 主菜单点击「单人对战 · AI」，选择双方角色后自动开局 |
| 👥 **本地双人** | 主菜单点击「本地对战」，同屏轮流操作，适合朋友面对面 |
| 🌐 **局域网联机** | 一台电脑开房，其他设备通过局域网加入 |

---

## 网络联机

### 工作原理

游戏内置局域网服务器（端口 `8788`），启动后自动在后台运行。房主与加入方通过 HTTP 请求与服务器同步状态。

### 联机步骤

1. **房主（电脑）**: 启动游戏 → 主菜单点击「局域网对战」→「创建房间」
2. **加入方（电脑/手机）**: 同一局域网内，打开游戏 → 点击「局域网对战」→ 输入房间号加入
3. 双方选好角色后，房主点击「掷骰子决定先手」开始对战

### 说明

- 服务端启动后，界面底部自动显示本机 IP 地址和局域网入口
- 电脑端访问 `http://127.0.0.1:8788` 可接入同一局
- 手机等设备通过 WiFi 连接，自动发现房间列表，或手动输入房间号加入
- 非局域网环境需自行配置端口转发或内网穿透

---

## 快速开始开发

### 环境要求

- Node.js 18+
- Rust 1.75+
- Android SDK（构建 Android 包时）

### 开发模式（桌面）

```bash
npx tauri dev
```

### 构建 Windows 安装包

```bash
npx tauri build
# 产物: src-tauri/target/release/bundle/nsis/CardDuel_1.0.0_x64-setup.exe
```

### 构建 Android APK

```bash
npx tauri android build
# 产物: src-tauri/gen/android/app/build/outputs/apk/universal/release/app-universal-release-unsigned.apk
```

### 纯服务器模式（Web 托管）

```bash
cargo run --release -- --server
# 或编译后运行:
# target/release/card-duel.exe --server
```

---

## 项目结构

```
card_duel/
├── app/                        # 前端静态资源
│   ├── index.html              # 主页面 (单文件应用)
│   ├── icon-192.png            # PWA 图标
│   ├── icon-512.png
│   ├── manifest.json           # PWA 配置
│   └── sw.js                   # Service Worker
├── src-tauri/                  # Tauri / Rust 后端
│   ├── src/
│   │   ├── main.rs             # Windows/桌面入口 (含 --server 头部模式)
│   │   ├── lib.rs              # Android 入口
│   │   ├── net.rs              # 局域网 IP 检测
│   │   └── server.rs           # 局域网房间服务器
│   ├── icons/                  # 应用图标集
│   ├── capabilities/           # Tauri 权限配置
│   ├── tauri.conf.json         # Tauri 配置
│   ├── Cargo.toml              # Rust 依赖
│   └── build.rs                # 构建脚本
├── package.json
└── README.md
```

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 前端 | Vanilla JS + CSS (单文件架构，无框架依赖) |
| 后端 | Rust 2021 Edition |
| 框架 | Tauri v2 (Windows / Android 原生壳) |
| 网络 | tiny_http (内置局域网服务器) |
| 随机 | `crypto.getRandomValues` (密码学安全随机) |

---

## 鸣谢

本项目基于 [南宫墨铭](https://github.com/NanGongXunLi) 的原版 Web 实现移植至 Tauri 跨平台架构。

> 原版项目以纯 Web 技术栈实现局域网对战核心逻辑，Tauri 版本在其基础上增加了原生桌面与移动端打包能力，并将局域网服务器内置至 Rust 后端。

---

## 许可证

本项目仅供学习参考，版权归原作者所有。