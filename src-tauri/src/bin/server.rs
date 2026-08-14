//! 独立联机的 Web 后端（纯 Rust，不链接 Tauri / 无图形界面）。
//! 与 `card-duel.exe --server` 共用同一份 server.rs / net.rs，
//! 但不依赖 tauri，体积小、可单独部署（局域网开房 / VPS）。
//!
//! 用法:
//!     card-duel-server                # HTTP 监听 0.0.0.0:8788
//!     card-duel-server --cli          # 终端交互模式（AI vs AI / LLM vs AI）
//!     card-duel-server --cert c.pem --key k.pem   # (--features tls) HTTPS

#![allow(dead_code)]

#[path = "../game/mod.rs"]
mod game;
#[path = "../net.rs"]
mod net;
#[path = "../server/mod.rs"]
mod server;

use std::io::{self, Write};
use std::sync::Arc;

fn main() {
    let args: Vec<String> = std::env::args().collect();

    if args.contains(&"--cli".to_string()) {
        run_cli();
        return;
    }

    let cert = args
        .iter()
        .position(|a| a == "--cert")
        .and_then(|i| args.get(i + 1));
    let key = args
        .iter()
        .position(|a| a == "--key")
        .and_then(|i| args.get(i + 1));

    server::set_disk_mode(true);
    let state = Arc::new(server::ServerState::default());
    match (cert, key) {
        #[cfg(feature = "tls")]
        (Some(c), Some(k)) => state.start_with_tls(c, k),
        _ => state.start(),
    }
    std::thread::park();
}

fn run_cli() {
    let app_dir = server::web_root()
        .map(|r| r.to_string_lossy().into_owned())
        .unwrap_or_else(|| "app".to_string());
    let defs = match game::load_defs(&app_dir) {
        Ok(d) => d,
        Err(e) => {
            eprintln!("加载数据失败: {}", e);
            std::process::exit(1);
        }
    };

    println!("=== 卡牌对决 CLI 模式 ===");
    println!("可用子阵营:\n{}", game::list_subfactions(&defs));

    // 选择 P0 子阵营（电脑）
    let p0 = loop {
        print!("选择 电脑(P0) 子阵营 (0-{}): ", defs.subfactions.len() - 1);
        io::stdout().flush().ok();
        let mut line = String::new();
        io::stdin().read_line(&mut line).ok();
        let idx = line.trim().parse::<usize>().ok();
        if let Some(i) = idx {
            if i < defs.subfactions.len() {
                break i;
            }
        }
    };

    // 选择 P1 子阵营
    let p1 = loop {
        print!("选择 P1 子阵营 (0-{}): ", defs.subfactions.len() - 1);
        io::stdout().flush().ok();
        let mut line = String::new();
        io::stdin().read_line(&mut line).ok();
        let idx = line.trim().parse::<usize>().ok();
        if let Some(i) = idx {
            if i < defs.subfactions.len() {
                break i;
            }
        }
    };

    println!(
        "\n对战开始: {} vs {}\n",
        defs.subfactions[p0].name, defs.subfactions[p1].name
    );

    let seed = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos() as u64;
    let mut b = game::new_battle("cpu", &defs, p0, p1, seed);
    let _ = game::action::execute(&mut b, game::action::Action::StartTurn);

    loop {
        println!("{}", game::format_battle_state(&b));
        if b.winner.is_some() {
            break;
        }

        // AI 回合自动执行（统一经 Layer 1，服务端权威代跑）
        if b.actor == 0 {
            let mut guard = 0;
            while b.winner.is_none() && b.actor == 0 && guard < 64 {
                guard += 1;
                let actor_before = b.actor;
                match game::action::execute(&mut b, game::action::Action::CpuStep) {
                    Ok(_) => {
                        let played = b.log.last().map(|e| e.key.as_str()) == Some("log.play_card");
                        if played {
                            let name = b.players[0]
                                .discard
                                .last()
                                .map(|c| c.name.clone())
                                .unwrap_or_else(|| "?".into());
                            println!("电脑 打出: {}", name);
                        }
                        if b.winner.is_some() || b.actor != actor_before {
                            println!("电脑 结束回合");
                        }
                    }
                    Err(e) => {
                        println!("电脑 出牌错误: {}", e);
                        break;
                    }
                }
            }
            continue;
        }

        // P1 人工输入
        print!("P1 动作 (play <idx> / endturn / state / log / help / quit): ");
        io::stdout().flush().ok();
        let mut line = String::new();
        io::stdin().read_line(&mut line).ok();
        let line = line.trim().to_string();

        if line == "quit" {
            break;
        }
        if line == "state" {
            continue;
        }
        if line == "log" {
            println!("日志:\n{}", game::format_log(&b));
            continue;
        }
        if line == "help" {
            println!("play <idx>  - 出牌 (idx 为手牌索引)");
            println!("endturn     - 结束回合");
            println!("state       - 显示当前状态");
            println!("log         - 显示最近日志");
            println!("quit        - 退出");
            continue;
        }
        if let Some(rest) = line.strip_prefix("play ") {
            let idx = rest.trim().parse::<usize>().ok();
            if let Some(idx) = idx {
                match game::action::execute(
                    &mut b,
                    game::action::Action::PlayCard {
                        pi: 1,
                        idx,
                        target: None,
                    },
                ) {
                    Ok(_) => {
                        println!("出牌成功");
                        if b.winner.is_some() {
                            break;
                        }
                    }
                    Err(e) => println!("出牌失败: {}", e),
                }
            } else {
                println!("无效的索引");
            }
            continue;
        }
        if line == "endturn" {
            match game::action::execute(&mut b, game::action::Action::EndTurn { pi: 1 }) {
                Ok(_) => {}
                Err(e) => println!("结束回合失败: {}", e),
            }
            continue;
        }
        println!("未知命令，输入 help 查看帮助");
    }

    println!("\n=== 游戏结束 ===");
    if let Some(w) = b.winner {
        println!("{} 获胜！", b.players[w].role.name);
    }
    println!("完整日志:\n{}", game::format_log(&b));
}
