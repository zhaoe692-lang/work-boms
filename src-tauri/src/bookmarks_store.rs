use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::models::SCHEMA_VERSION;

pub const PROJECT_ROOT_KEY: &str = "project-root";

pub fn artifact_key(artifact_id: &str) -> String {
    format!("artifact:{artifact_id}")
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookmarkEntry {
    pub path: String,
    pub bookmark_base64: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BookmarksDocument {
    pub schema_version: String,
    pub entries: HashMap<String, BookmarkEntry>,
}

impl BookmarksDocument {
    pub fn empty() -> Self {
        Self {
            schema_version: SCHEMA_VERSION.to_string(),
            entries: HashMap::new(),
        }
    }
}

pub struct BookmarkStore {
    path: PathBuf,
    doc: BookmarksDocument,
}

impl BookmarkStore {
    pub fn load(package_dir: &Path) -> Self {
        let path = package_dir.join(".vault").join("bookmarks.json");
        let doc = if path.exists() {
            fs::read_to_string(&path)
                .ok()
                .and_then(|s| serde_json::from_str(&s).ok())
                .unwrap_or_else(BookmarksDocument::empty)
        } else {
            BookmarksDocument::empty()
        };
        Self { path, doc }
    }

    pub fn save(&self) -> Result<(), String> {
        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("无法创建 .vault: {e}"))?;
        }
        let content = serde_json::to_string_pretty(&self.doc)
            .map_err(|e| format!("书签序列化失败: {e}"))?;
        fs::write(&self.path, content).map_err(|e| format!("无法写入书签: {e}"))
    }

    pub fn upsert(&mut self, key: &str, file_path: &str, bookmark: &[u8]) -> Result<(), String> {
        use base64::{engine::general_purpose::STANDARD, Engine as _};
        self.doc.entries.insert(
            key.to_string(),
            BookmarkEntry {
                path: file_path.to_string(),
                bookmark_base64: STANDARD.encode(bookmark),
            },
        );
        self.save()
    }

    pub fn get(&self, key: &str) -> Option<&BookmarkEntry> {
        self.doc.entries.get(key)
    }

    pub fn activate_all(&self) -> BookmarkAccessSession {
        BookmarkAccessSession::new(&self.doc)
    }
}

pub struct BookmarkAccessSession {
    _guards: Vec<crate::bookmark::AccessGuard>,
}

impl BookmarkAccessSession {
    fn new(doc: &BookmarksDocument) -> Self {
        let mut guards = Vec::new();
        for entry in doc.entries.values() {
            if let Ok(guard) = crate::bookmark::access_from_stored(entry) {
                guards.push(guard);
            }
        }
        Self { _guards: guards }
    }

    pub fn retain_in_pool(self) {
        crate::bookmark_pool::extend_pool(self._guards);
    }
}

pub fn create_bookmark_for_path(path: &str) -> Result<Vec<u8>, String> {
    crate::bookmark::create_bookmark(path)
}

pub fn sync_package_bookmarks(
    package_dir: &Path,
    project_root: Option<&str>,
    artifact_paths: &[(String, String)],
) -> Result<(), String> {
    let mut store = BookmarkStore::load(package_dir);

    if let Some(root) = project_root {
        let root_path = PathBuf::from(root);
        if root_path.exists() {
            let bookmark = create_bookmark_for_path(root)?;
            store.upsert(PROJECT_ROOT_KEY, root, &bookmark)?;
        }
    }

    for (artifact_id, abs_path) in artifact_paths {
        let path = PathBuf::from(abs_path);
        if path.is_file() {
            let bookmark = create_bookmark_for_path(abs_path)?;
            store.upsert(&artifact_key(artifact_id), abs_path, &bookmark)?;
        }
    }

    Ok(())
}
