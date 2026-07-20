use std::collections::HashMap;
use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphNodePosition {
    pub x: f64,
    pub y: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub z: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphLayoutDocument {
    pub schema_version: String,
    pub mode: String,
    pub width: f64,
    pub height: f64,
    pub fingerprint: String,
    pub positions: HashMap<String, GraphNodePosition>,
}

fn sanitize_mode(mode: &str) -> String {
    mode.chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c
            } else {
                '_'
            }
        })
        .collect()
}

fn layout_path(package_dir: &Path, mode: &str) -> std::path::PathBuf {
    package_dir
        .join(".vault")
        .join(format!("graph-layout-{}.json", sanitize_mode(mode)))
}

fn legacy_layout_path(package_dir: &Path) -> std::path::PathBuf {
    package_dir.join(".vault").join("graph-layout.json")
}

pub fn load_graph_layout(
    package_dir: &Path,
    mode: &str,
    fingerprint: &str,
) -> Option<GraphLayoutDocument> {
    let primary = layout_path(package_dir, mode);
    let content = if primary.exists() {
        fs::read_to_string(&primary).ok()?
    } else if mode == "local:v1" {
        let legacy = legacy_layout_path(package_dir);
        if !legacy.exists() {
            return None;
        }
        fs::read_to_string(&legacy).ok()?
    } else {
        return None;
    };
    let doc: GraphLayoutDocument = serde_json::from_str(&content).ok()?;
    if doc.mode == mode && doc.fingerprint == fingerprint {
        Some(doc)
    } else {
        None
    }
}

pub fn save_graph_layout(package_dir: &Path, doc: &GraphLayoutDocument) -> Result<(), String> {
    let path = layout_path(package_dir, &doc.mode);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| format!("无法创建 .vault: {e}"))?;
    }
    let content =
        serde_json::to_string_pretty(doc).map_err(|e| format!("布局序列化失败: {e}"))?;
    fs::write(&path, content).map_err(|e| format!("无法写入布局: {e}"))
}

pub fn delete_graph_layout(package_dir: &Path) -> Result<(), String> {
    let vault = package_dir.join(".vault");
    if !vault.exists() {
        return Ok(());
    }
    let legacy = legacy_layout_path(package_dir);
    if legacy.exists() {
        fs::remove_file(&legacy).map_err(|e| format!("无法删除布局缓存: {e}"))?;
    }
    let entries = fs::read_dir(&vault).map_err(|e| format!("无法读取 .vault: {e}"))?;
    for entry in entries.flatten() {
        let name = entry.file_name();
        let name = name.to_string_lossy();
        if name.starts_with("graph-layout-") && name.ends_with(".json") {
            fs::remove_file(entry.path()).map_err(|e| format!("无法删除布局缓存: {e}"))?;
        }
    }
    Ok(())
}
