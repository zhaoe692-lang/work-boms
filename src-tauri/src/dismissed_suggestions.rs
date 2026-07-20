use std::collections::HashSet;
use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DismissedSuggestionsDocument {
    #[serde(default)]
    pub keys: Vec<String>,
}

fn path(package_dir: &Path) -> std::path::PathBuf {
    package_dir.join(".vault").join("dismissed-suggestions.json")
}

pub fn suggestion_key(from: &str, to: &str) -> String {
    format!("{from}->{to}")
}

pub fn load_dismissed(package_dir: &Path) -> HashSet<String> {
    let file = path(package_dir);
    if !file.exists() {
        return HashSet::new();
    }
    let Ok(content) = fs::read_to_string(&file) else {
        return HashSet::new();
    };
    let Ok(doc) = serde_json::from_str::<DismissedSuggestionsDocument>(&content) else {
        return HashSet::new();
    };
    doc.keys.into_iter().collect()
}

pub fn dismiss(package_dir: &Path, from: &str, to: &str) -> Result<(), String> {
    let mut keys = load_dismissed(package_dir);
    keys.insert(suggestion_key(from, to));
    save(package_dir, &keys)
}

pub fn save(package_dir: &Path, keys: &HashSet<String>) -> Result<(), String> {
    let file = path(package_dir);
    if let Some(parent) = file.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("无法创建 .vault: {e}"))?;
    }
    let mut list: Vec<String> = keys.iter().cloned().collect();
    list.sort();
    let doc = DismissedSuggestionsDocument { keys: list };
    let content =
        serde_json::to_string_pretty(&doc).map_err(|e| format!("序列化失败: {e}"))?;
    fs::write(&file, content).map_err(|e| format!("无法写入忽略建议: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dismiss_roundtrip() {
        let dir = std::env::temp_dir().join(format!("workboms-dismiss-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dismiss(&dir, "a", "b").unwrap();
        let set = load_dismissed(&dir);
        assert!(set.contains("a->b"));
        let _ = fs::remove_dir_all(&dir);
    }
}
