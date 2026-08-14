//! 数据加载适配器（基础设施）。
//!
//! 负责把 JSON 数据文件/字符串解析为 `GameDefs`。纯解析函数无 IO；
//! `load_defs` 从磁盘读取（由调用方传入目录，不依赖 CWD）。
//! 属于 Core 之外的适配器层，Core 只消费 `GameDefs`。

use super::state::*;
use std::fs;

/// 从三份 JSON 字符串构建游戏定义（web/测试路径）
pub fn defs_from_strings(
    cards_json: &str,
    subfactions_json: &str,
    factions_json: &str,
) -> Result<GameDefs, String> {
    let subfactions: Vec<SubfactionDef> = serde_json::from_str(subfactions_json)
        .map_err(|e| format!("subfactions.json parse: {}", e))?;
    let cards: Vec<Card> =
        serde_json::from_str(cards_json).map_err(|e| format!("cards.json parse: {}", e))?;
    let factions: Vec<FactionDef> =
        serde_json::from_str(factions_json).map_err(|e| format!("factions.json parse: {}", e))?;
    Ok(GameDefs {
        subfactions,
        cards,
        factions,
    })
}

/// 解析单个 JSON 对象 `{ "subfactions": [...], "cards": [...], "factions": [...] }`
pub fn defs_from_json(defs_json: &str) -> Result<GameDefs, String> {
    serde_json::from_str(defs_json).map_err(|e| format!("defs parse: {}", e))
}

/// 从磁盘加载游戏定义（目录结构：`app_dir/card_duel/data/`）
pub fn load_defs(app_dir: &str) -> Result<GameDefs, String> {
    let data_dir = format!("{}/card_duel/data", app_dir);

    let cards: Vec<Card> = load_json_dir(&format!("{}/cards", data_dir), "card.json")?;
    let factions: Vec<FactionDef> =
        load_json_dir(&format!("{}/factions", data_dir), "faction.json")?;

    let mut subfactions: Vec<SubfactionDef> = Vec::new();
    let factions_path = format!("{}/factions", data_dir);
    for entry in fs::read_dir(&factions_path).map_err(|e| format!("factions dir: {}", e))? {
        let entry = entry.map_err(|e| e.to_string())?;
        let faction_dir = entry.path();
        if !faction_dir.is_dir() {
            continue;
        }
        for sub_entry in fs::read_dir(&faction_dir).map_err(|e| format!("read faction: {}", e))? {
            let sub_entry = sub_entry.map_err(|e| e.to_string())?;
            let sub_dir = sub_entry.path();
            if !sub_dir.is_dir() {
                continue;
            }
            let sf_path = sub_dir.join("subfaction.json");
            if !sf_path.exists() {
                continue;
            }
            let content = fs::read_to_string(&sf_path).map_err(|e| e.to_string())?;
            let s: SubfactionDef = serde_json::from_str(&content)
                .map_err(|e| format!("{}: {}", sf_path.display(), e))?;
            subfactions.push(s);
        }
    }

    let cards_json = serde_json::to_string(&cards).map_err(|e| e.to_string())?;
    let sub_json = serde_json::to_string(&subfactions).map_err(|e| e.to_string())?;
    let fac_json = serde_json::to_string(&factions).map_err(|e| e.to_string())?;
    defs_from_strings(&cards_json, &sub_json, &fac_json)
}

fn load_json_dir<T: for<'de> serde::Deserialize<'de>>(
    dir: &str,
    filename: &str,
) -> Result<Vec<T>, String> {
    let mut items = Vec::new();
    for entry in fs::read_dir(dir).map_err(|e| format!("{}: {}", dir, e))? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let file_path = path.join(filename);
        if !file_path.exists() {
            continue;
        }
        let content = fs::read_to_string(&file_path).map_err(|e| e.to_string())?;
        let item: T = serde_json::from_str(&content)
            .map_err(|e| format!("{}: {}", file_path.display(), e))?;
        items.push(item);
    }
    Ok(items)
}

/// 列出可用子阵营（CLI 选择用）
pub fn list_subfactions(defs: &GameDefs) -> String {
    let mut s = String::new();
    for (i, sub) in defs.subfactions.iter().enumerate() {
        let faction = defs
            .factions
            .iter()
            .find(|f| f.id == sub.faction.as_deref().unwrap_or(""));
        let fname = faction.map(|f| f.name.as_str()).unwrap_or("散人");
        s.push_str(&format!(
            "  {}. {} [{}] HP:{} DEF:{} ENG:{}\n",
            i, sub.name, fname, sub.hp, sub.def, sub.eng
        ));
    }
    s
}

/// 按名字或 id 查找子阵营索引
pub fn get_subfaction_index(defs: &GameDefs, name: &str) -> Option<usize> {
    defs.subfactions
        .iter()
        .position(|s| s.name == name || s.id == name)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defs_from_strings_parses_valid_json() {
        let cards = serde_json::to_string(&vec![
            serde_json::json!({"id":"c1","name":"C","cost":1,"img":"","effects":[],	"desc":""}),
        ])
        .unwrap();
        let subs = serde_json::to_string(&vec![
            serde_json::json!({"id":"s1","name":"S","faction":null,"hp":30,"def":2,"eng":3,
                "intro":"","img":"","deck":null}),
        ])
        .unwrap();
        let facs = serde_json::to_string(&Vec::<serde_json::Value>::new()).unwrap();
        let defs = defs_from_strings(&cards, &subs, &facs).expect("parse ok");
        assert_eq!(defs.cards.len(), 1);
        assert_eq!(defs.cards[0].id, "c1");
        assert_eq!(defs.subfactions.len(), 1);
        assert_eq!(defs.subfactions[0].hp, 30);
    }

    #[test]
    fn defs_from_strings_rejects_invalid_json() {
        assert!(defs_from_strings("{bad", "[]", "[]").is_err());
        assert!(defs_from_strings("[]", "{bad}", "[]").is_err());
        assert!(defs_from_strings("[]", "[]", "{bad}").is_err());
    }

    #[test]
    fn defs_from_strings_empty_vectors_ok() {
        let d = defs_from_strings("[]", "[]", "[]").expect("empty is valid");
        assert!(d.cards.is_empty());
        assert!(d.subfactions.is_empty());
        assert!(d.factions.is_empty());
    }

    #[test]
    fn defs_from_json_single_object() {
        let json = r#"{"subfactions":[],"cards":[],"factions":[]}"#;
        let d = defs_from_json(json).expect("parse");
        assert!(d.cards.is_empty());
    }

    #[test]
    fn get_subfaction_index_by_id() {
        let defs = defs_from_strings(
            "[]",
            &serde_json::to_string(&[
                serde_json::json!({"id":"a","name":"A","faction":null,"hp":10,"def":0,"eng":1,"intro":"","img":"","deck":null}),
                serde_json::json!({"id":"b","name":"B","faction":null,"hp":10,"def":0,"eng":1,"intro":"","img":"","deck":null}),
            ]).unwrap(),
            "[]",
        ).unwrap();
        assert_eq!(get_subfaction_index(&defs, "a"), Some(0));
        assert_eq!(get_subfaction_index(&defs, "b"), Some(1));
        assert_eq!(get_subfaction_index(&defs, "notfound"), None);
    }

    #[test]
    fn get_subfaction_index_by_name() {
        let defs = defs_from_strings(
            "[]",
            &serde_json::to_string(&[
                serde_json::json!({"id":"x","name":"X-Name","faction":null,"hp":10,"def":0,"eng":1,"intro":"","img":"","deck":null}),
            ]).unwrap(),
            "[]",
        ).unwrap();
        assert_eq!(get_subfaction_index(&defs, "X-Name"), Some(0));
    }
}
