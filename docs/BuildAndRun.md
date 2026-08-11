# BuildAndRun.md

## 本地构建

### Rust 服务端

在 `src-tauri/` 目录下执行：

```bash
cargo build --release --bin card-duel-server
```-

输出：`src-tauri/target/release/card-duel-server.exe`

**重要**：编译前若 exe 正在运行，必须先杀进程：

```powershell
Stop-Process -Name card-duel-server -Force
```

cargo 无法覆盖被占用的 exe 文件，否则构建失败。

### WASM 引擎（浏览器单机）

```powershell
scripts/build_wasm.ps1
```

- 构建 `src-tauri/wasm/` crate（release 模式）
- 生成 `app/js/card_duel_wasm*.js` + `.wasm` 到 `app/js/`

### Tauri 桌面端

```bash
cd src-tauri
cargo build
```

或：

```bash
pnpm tauri build
```

### JS 验证

```bash
node --check app/js/*.js
```


### 规则测试

```bash
cd src-tauri
cargo test --lib --release
```

`game.rs` 内置基础规则测试（伤害计算、出牌结算、效果元数据、日志事件）。修改规则后必须运行。

## CI 构建

项目使用 GitHub Actions 自动构建，配置文件 `.github/workflows/build.yml`。

### 触发条件

| 事件 | 分支/标签 | 运行任务 |
|------|-----------|----------|
| push | `main`, `dev` | lint, build-server, build-windows, build-android, deploy-pages (仅 main) |
| push | `v*` tag | lint + 全部构建 + release |
| PR | `main`, `dev` | lint 仅 |
| workflow_dispatch | 任意 | 手动触发 |

### 任务说明

| 任务 | 平台 | 作用 |
|------|------|------|
| `lint` | ubuntu | `cargo fmt --check`, `cargo clippy -- -D warnings`, `node --check app/js/*.js` |
| `build-server` | ubuntu | 编译 `card-duel-server`（`--features tls`），产出 Linux 可执行文件 |
| `build-windows` | windows | `npx tauri build`，产出 NSIS 安装包 + exe |
| `build-android` | ubuntu | `npx tauri android build`，产出 APK |
| `deploy-pages` | ubuntu | 将 `app/` 部署到 GitHub Pages |
| `release` | ubuntu | 从 tag 创建 Release，上传所有构建产物 |

### 产物下载

构建完成后，从对应 workflow run 的 Artifacts 下载：

- `CardDuel-Windows`：NSIS 安装包 + `card-duel.exe` + `run.bat`
- `CardDuel-Android`：`CardDuel-Android.apk`
- `card-duel-server`：Linux 可执行文件 + `run.sh`

## 查看 CI 日志 (gh CLI)

安装 [GitHub CLI](https://cli.github.com/) 后：

```bash
# 查看最近一次 workflow run 状态
gh run view

# 查看具体 workflow run（按编号）
gh run view <run-id>

# 查看最近一次 CI 的完整日志
gh run view --log

# 查看特定 job 的日志
gh run view --log --job lint

# 列出最近 workflow runs
gh run list

# 列出最近 10 次 runs，包含分支和状态
gh run list --limit 10

# 重新运行失败的 jobs
gh run rerun --failed

# 查看 workflow 文件
gh workflow view
```

在项目根目录执行即可，`gh` 自动读取当前目录的 git remote 确定仓库。

## 运行

### Web/LAN 服务器

```batch
:: 项目根目录
cardduel.bat
```

- 自动 `cd /d "%~dp0"` 确保 CWD 正确
- 端口：8788
- 访问：`http://localhost:8788`

### CLI 终端模式

```bash
cd src-tauri
cargo run --release --bin card-duel-server -- --cli
```

或直接使用 CI 构建好的 exe：

```bash
./target/release/card-duel-server --cli
```

- AI vs 人类，stdin/stdout 交互
- 用于快速验证 Rust 引擎逻辑

### Tauri 桌面模式

```bash
pnpm tauri dev
```

或运行 CI 构建好的安装包。

桌面模式会自动启动 LAN 服务器（背景线程），且设为磁盘模式。

## LLM API

服务器启动后，端口 8788 提供 REST 接口：

| 端点 | 方法 | 参数 | 说明 |
|------|------|------|------|
| `/api/game/new` | GET | `p0=<名称或索引>&p1=<名称或索引>` | 创建新游戏 |
| `/api/game/{id}/state` | GET | `viewer=<0\|1>` | 获取状态，viewer 控制谁在下半屏 |
| `/api/game/{id}/act` | POST | `{"player":N,"action":"play","card":N}` / `"endturn"` / `"ai"` | 执行动作 |

## 修改规则后的验证流程

修改游戏规则、效果结算或状态变更时：

1. 只改 `game.rs` 一处。
2. 执行 `scripts/build_wasm.ps1` 编译 WASM（浏览器单机）。
3. 执行 `cargo build --release --bin card-duel-server` 编译服务端。
4. 执行 `cargo test --lib --release` 验证基础规则。
5. 执行 `node --check app/js/*.js` 验证 JS 语法。
6. 推送前运行本地 linter 检查（CI lint 也会执行，但提前发现更快）：
   ```bash
   cd src-tauri
   cargo fmt --check
   cargo clippy -- -D warnings
   ```
7. WASM 导出接口（`bindings.rs`）仅在新增导出时修改，`engine.js` 门面同步更新。

## 本地验证清单

修改后必须执行：

- [ ] 若修改了 `game.rs`：`scripts/build_wasm.ps1` 成功生成 wasm
- [ ] 若修改了 `game.rs`：`cargo test --lib --release` 通过
- [ ] `cargo build --release --bin card-duel-server` 零 error（或推送后 CI lint 通过）
- [ ] `node --check app/js/*.js` 零 error（CI lint 也会检查）
- [ ] 启动 `cardduel.bat`，浏览器能正常访问
- [ ] 开一局对战，基本流程正常（抽牌、出牌、回合结束）
- [ ] 若修改了 Rust 引擎逻辑：运行 `card-duel-server --cli`，AI vs 人类一局正常
- [ ] 若涉及 LAN：两端状态一致，无分叉

## 常见陷阱

| 问题 | 原因 | 解决 |
|------|------|------|
| cargo 无法覆盖 exe | 旧进程未退出 | `Stop-Process -Name card-duel-server -Force` |
| 双击 exe 找不到数据文件 | 依赖 CWD | 确保使用 `web_root()` 解析路径 |
| JS import 404 | `?v=__VERSION__` 未替换 | 检查是否通过 `server.rs` 访问 |
| 浏览器缓存旧 JS | 版本戳未更新 | 确认 `CARGO_PKG_VERSION` 已变更 |
| 音频不播放 | 格式错误 | 必须是 OGG Vorbis 192kbps |
| CI 构建失败 | 见 `gh run view --log` | 定位失败 job，查看报错日志 |