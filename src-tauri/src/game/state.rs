//! Layer 0 — State 层。
//!
//! 纯数据模型，零行为：仅承载战斗所需的全部数据实体，不含任何方法、
//! 计算或业务逻辑。结构设计为快照友好（全部 `Clone` + 可序列化），
//! 便于回溯、断线重连与战斗回放。

use rand::rngs::StdRng;
use serde::{Deserialize, Serialize};

/// 单张卡牌定义（来自 cards.json）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Card {
    pub id: String,
    pub name: String,
    pub cost: i32,
    pub img: String,
    pub effects: Vec<Effect>,
    pub desc: String,
}

/// 单个效果定义
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Effect {
    #[serde(rename = "type")]
    pub kind: String,
    pub value: Option<i32>,
    pub duration: Option<i32>,
    pub pierce: Option<bool>,
    pub target: Option<String>,
    pub fx: Option<FxOverride>,
}

/// 效果的表现覆盖（动画形态 / 颜色）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FxOverride {
    pub form: Option<String>,
    pub color: Option<String>,
}

/// 子阵营定义（来自 subfaction.json）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SubfactionDef {
    pub id: String,
    pub name: String,
    pub faction: Option<String>,
    pub hp: i32,
    pub def: i32,
    pub eng: i32,
    pub intro: String,
    pub img: String,
    pub deck: Option<Vec<String>>,
}

/// 阵营定义（来自 faction.json）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FactionDef {
    pub id: String,
    pub name: String,
    pub desc: String,
    pub img: String,
    pub deck: Vec<String>,
}

/// 战斗中附加的持续状态（增益/减益）
#[derive(Debug, Clone)]
pub struct Buff {
    pub kind: String,
    pub value: i32,
    pub duration: i32,
}

/// 单个玩家的战斗快照
#[derive(Debug, Clone)]
pub struct PlayerState {
    pub role: SubfactionDef,
    pub hp: i32,
    pub def: i32,
    pub energy: i32,
    pub buffs: Vec<Buff>,
    pub draw: Vec<Card>,
    pub hand: Vec<Card>,
    pub discard: Vec<Card>,
}

/// 结构化日志条目（key + 参数，由表现层本地化渲染）
#[derive(Debug, Clone, Serialize)]
pub struct LogEvent {
    pub key: String,
    pub params: serde_json::Value,
}

/// 整场战斗的权威状态快照
#[derive(Debug, Clone)]
pub struct Battle {
    pub mode: String,
    pub seq: i32,
    pub turn: i32,
    pub actor: usize,
    pub winner: Option<usize>,
    pub players: Vec<PlayerState>,
    pub teams: Vec<usize>,
    pub order: Vec<usize>,
    pub log: Vec<LogEvent>,
    pub rng: StdRng,
}

/// 全局游戏定义（数据驱动：全部来自 JSON，引擎不硬编码数值）
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GameDefs {
    pub subfactions: Vec<SubfactionDef>,
    pub cards: Vec<Card>,
    pub factions: Vec<FactionDef>,
}

/// Layer 3 — Core 产出的结构化事件。
///
/// 由 Core 结算产生，供表现处理器（动画/飘字）与领域处理器（日志/统计）
/// 按序消费；表现层禁止据此修改 Battle 状态。
#[derive(Debug, Clone, Serialize)]
pub struct GameEvent {
    pub target: usize,
    /// 动画形态（flash / overlay / pulse …）
    pub fx: String,
    /// 效果类型（damage / heal / force_discard …）
    pub kind: String,
    /// 效果数值（force_discard 的弃牌数等），无值为 None
    #[serde(skip_serializing_if = "Option::is_none")]
    pub value: Option<i32>,
}

/// 手牌上限
pub const HAND_MAX: i32 = 7;

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn game_defs_serializes_and_round_trips() {
        let defs = GameDefs {
            subfactions: vec![SubfactionDef {
                id: "test".into(),
                name: "Test".into(),
                faction: Some("f1".into()),
                hp: 50,
                def: 5,
                eng: 3,
                intro: "intro".into(),
                img: "".into(),
                deck: Some(vec!["c1".into(), "c2".into()]),
            }],
            cards: vec![Card {
                id: "c1".into(),
                name: "Strike".into(),
                cost: 1,
                img: "".into(),
                effects: vec![Effect {
                    kind: "damage".into(),
                    value: Some(5),
                    duration: None,
                    pierce: Some(false),
                    target: None,
                    fx: None,
                }],
                desc: "".into(),
            }],
            factions: vec![FactionDef {
                id: "f1".into(),
                name: "Faction One".into(),
                desc: "desc".into(),
                img: "".into(),
                deck: vec!["c1".into()],
            }],
        };
        let json = serde_json::to_string(&defs).expect("serialize");
        let back: GameDefs = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(back.subfactions[0].id, "test");
        assert_eq!(back.subfactions[0].hp, 50);
        assert_eq!(back.cards[0].cost, 1);
        assert_eq!(back.factions[0].name, "Faction One");
    }

    #[test]
    fn game_event_skips_none_value() {
        let ev = GameEvent {
            target: 0,
            fx: "flash".into(),
            kind: "damage".into(),
            value: None,
        };
        let json = serde_json::to_string(&ev).unwrap();
        assert!(
            !json.contains("value"),
            "None value should be skipped in JSON"
        );
    }

    #[test]
    fn game_event_keeps_some_value() {
        let ev = GameEvent {
            target: 1,
            fx: "flash".into(),
            kind: "draw".into(),
            value: Some(2),
        };
        let json = serde_json::to_string(&ev).unwrap();
        assert!(json.contains("value"), "Some value must appear in JSON");
    }

    #[test]
    fn hand_max_constant() {
        assert_eq!(HAND_MAX, 7);
    }
}
