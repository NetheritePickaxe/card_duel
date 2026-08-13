//! 战斗系统分层架构（参考 `.opencode/battle_system_architecture.md`）
//!
//! - `state`   (Layer 0)  纯数据模型，零行为
//! - `action`  (Layer 1)  指令契约 + 前置校验 + 唯一执行入口
//! - `core`    (Layer 2)  纯函数战斗引擎（唯一有权计算状态变更）
//! - `effects` (Layer 2)  Core 子系统：效果结算
//! - `ai`      (Layer 2)  Core 子系统：CPU 决策
//! - `view`    (Layer 3-) 只读状态格式化（表现适配器）
//! - `data`    (适配器)   JSON 数据加载
//!
//! 依赖方向严格向下：action → core/effects/ai → state；Core 不感知上层。
//! 所有外部入口（bindings/server/CLI）经由 `action::execute` 结算战斗。

#![allow(dead_code)]

pub mod action;
pub mod ai;
pub mod core;
pub mod data;
pub mod effects;
pub mod state;
pub mod view;

pub use core::*;
pub use data::*;
pub use effects::*;
pub use state::*;
pub use view::*;

#[cfg(test)]
mod tests {
    use super::*;

    /// 跨层集成测试：effect_metadata_map 与默认动画形态保持一致
    #[test]
    fn effect_metadata_consistent_with_default_fx_form() {
        let meta = effect_metadata_map();
        for kind in ["damage", "heal", "gain_def", "skip_turn", "extra_turn",
                     "draw", "force_discard", "energy", "gain_atk",
                     "weaken_def", "cost_up", "dmg_reduce"] {
            assert!(meta.get(kind).is_some(), "metadata missing for {}", kind);
            // default_fx_form should return a non-empty string for known kinds
            let form = default_fx_form(kind);
            assert!(!form.is_empty(), "default_fx_form empty for {}", kind);
        }
    }
}
