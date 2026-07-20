//! SQLite primary store for WorkBOM domain data.
//!
//! The `.wbom` package (JSON) remains the external import/interchange
//! format, but once imported the source of truth lives here in normalized
//! relational tables (real columns / child tables, not JSON blobs). The
//! full-text search index keeps its own `search.db` (see search_index.rs) to
//! avoid a table-name clash on `artifacts`.

use std::path::{Path, PathBuf};
use std::time::Duration;

use rusqlite::{params, Connection, OptionalExtension};

use crate::models::{
    Artifact, FileRef, Identity, IdentitiesDocument, PackageManifest, Provenance, Relation,
    RelationsDocument, Work, WorksDocument,
};

pub struct Store {
    pub(crate) conn: Connection,
}

#[cfg(test)]
mod migration_tests {
    use super::*;

    #[test]
    fn upgrades_legacy_artifacts_before_creating_trash_index() {
        let dir = std::env::temp_dir().join(format!(
            "workboms-legacy-{}",
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        ));
        std::fs::create_dir_all(&dir).unwrap();
        let conn = Connection::open(Store::db_path(&dir)).unwrap();
        conn.execute_batch(
            "CREATE TABLE artifacts (
                package_id TEXT NOT NULL, id TEXT NOT NULL, order_index INTEGER NOT NULL,
                display_name TEXT NOT NULL, kind TEXT NOT NULL, status TEXT NOT NULL,
                role TEXT, summary TEXT, work_id TEXT, file_path TEXT NOT NULL,
                file_path_kind TEXT NOT NULL, file_name TEXT, prov_tool TEXT,
                prov_session_label TEXT, prov_exported_at TEXT, prov_note TEXT,
                created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
                PRIMARY KEY (package_id, id)
            );"
        ).unwrap();
        drop(conn);
        let store = Store::open(&dir).unwrap();
        let columns: Vec<String> = store.conn.prepare("PRAGMA table_info(artifacts)").unwrap()
            .query_map([], |row| row.get(1)).unwrap().collect::<Result<_, _>>().unwrap();
        assert!(columns.contains(&"deleted_at".to_string()));
        assert!(columns.contains(&"delete_expires_at".to_string()));
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }
}

/// Import-time metadata that is not part of the source manifest.
pub struct PackageMeta {
    pub imported_at: String,
    /// Retained for provenance/UI even though not every caller reads it.
    #[allow(dead_code)]
    pub source_path: Option<String>,
}

impl Store {
    pub fn db_path(vault_path: &Path) -> PathBuf {
        vault_path.join("library.db")
    }

    pub fn open(vault_path: &Path) -> Result<Self, String> {
        std::fs::create_dir_all(vault_path).map_err(|e| format!("无法创建库目录: {e}"))?;
        let conn = Connection::open(Self::db_path(vault_path))
            .map_err(|e| format!("无法打开数据库: {e}"))?;
        conn.execute_batch("PRAGMA foreign_keys = ON;")
            .map_err(|e| format!("无法启用数据库外键: {e}"))?;
        conn.busy_timeout(Duration::from_secs(5))
            .map_err(|e| format!("无法设置数据库超时: {e}"))?;
        let store = Self { conn };
        store.init_schema()?;
        Ok(store)
    }

    fn init_schema(&self) -> Result<(), String> {
        self.conn
            .execute_batch(
                "
                CREATE TABLE IF NOT EXISTS packages (
                    id TEXT PRIMARY KEY,
                    schema_version TEXT NOT NULL,
                    title TEXT NOT NULL,
                    slug TEXT NOT NULL,
                    domain TEXT,
                    summary TEXT,
                    project_root TEXT,
                    created_at TEXT NOT NULL,
                    imported_at TEXT NOT NULL,
                    source_path TEXT
                );
                CREATE TABLE IF NOT EXISTS artifacts (
                    package_id TEXT NOT NULL,
                    id TEXT NOT NULL,
                    order_index INTEGER NOT NULL,
                    display_name TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    status TEXT NOT NULL,
                    role TEXT,
                    summary TEXT,
                    work_id TEXT,
                    file_path TEXT NOT NULL,
                    file_path_kind TEXT NOT NULL,
                    file_name TEXT,
                    prov_tool TEXT,
                    prov_session_label TEXT,
                    prov_exported_at TEXT,
                    prov_note TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    deleted_at INTEGER,
                    delete_expires_at INTEGER,
                    deleted_by TEXT,
                    PRIMARY KEY (package_id, id)
                );
                CREATE TABLE IF NOT EXISTS artifact_tags (
                    package_id TEXT NOT NULL,
                    artifact_id TEXT NOT NULL,
                    order_index INTEGER NOT NULL,
                    tag TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_artifact_tags
                    ON artifact_tags(package_id, artifact_id);
                CREATE TABLE IF NOT EXISTS relations (
                    package_id TEXT NOT NULL,
                    id TEXT NOT NULL,
                    order_index INTEGER NOT NULL,
                    from_id TEXT NOT NULL,
                    to_id TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    label TEXT,
                    inferred INTEGER,
                    PRIMARY KEY (package_id, id)
                );
                CREATE TABLE IF NOT EXISTS works (
                    package_id TEXT NOT NULL,
                    id TEXT NOT NULL,
                    title TEXT NOT NULL,
                    summary TEXT,
                    order_index INTEGER NOT NULL,
                    PRIMARY KEY (package_id, id)
                );
                CREATE TABLE IF NOT EXISTS work_artifacts (
                    package_id TEXT NOT NULL,
                    work_id TEXT NOT NULL,
                    artifact_id TEXT NOT NULL,
                    order_index INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_work_artifacts
                    ON work_artifacts(package_id, work_id);
                CREATE TABLE IF NOT EXISTS identities (
                    package_id TEXT NOT NULL,
                    id TEXT NOT NULL,
                    display_name TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    head_version_id TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    PRIMARY KEY (package_id, id)
                );
                CREATE TABLE IF NOT EXISTS identity_versions (
                    package_id TEXT NOT NULL,
                    identity_id TEXT NOT NULL,
                    artifact_id TEXT NOT NULL,
                    order_index INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_identity_versions
                    ON identity_versions(package_id, identity_id);
                CREATE TABLE IF NOT EXISTS package_metrics (
                    package_id TEXT PRIMARY KEY,
                    total INTEGER NOT NULL,
                    finals INTEGER NOT NULL,
                    completion INTEGER NOT NULL,
                    broken INTEGER NOT NULL,
                    broken_rate INTEGER NOT NULL,
                    relations INTEGER NOT NULL,
                    avg_degree REAL NOT NULL,
                    last_updated_at TEXT,
                    last_updated_name TEXT,
                    kind_breakdown TEXT NOT NULL,
                    growth TEXT NOT NULL,
                    top_connected TEXT NOT NULL,
                    hooks TEXT NOT NULL,
                    hook_targets TEXT NOT NULL,
                    computed_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS inspiration_boards (
                    id TEXT PRIMARY KEY,
                    package_id TEXT,
                    title TEXT NOT NULL,
                    zoom REAL NOT NULL DEFAULT 1.0,
                    pan_x REAL NOT NULL DEFAULT 0,
                    pan_y REAL NOT NULL DEFAULT 0,
                    version INTEGER NOT NULL DEFAULT 1,
                    created_at INTEGER NOT NULL,
                    updated_at INTEGER NOT NULL
                );
                CREATE INDEX IF NOT EXISTS idx_inspiration_boards_package
                    ON inspiration_boards(package_id, updated_at DESC);
                CREATE TABLE IF NOT EXISTS inspiration_board_items (
                    board_id TEXT NOT NULL,
                    id TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    title TEXT NOT NULL,
                    note TEXT,
                    artifact_package_id TEXT,
                    artifact_id TEXT,
                    x REAL NOT NULL,
                    y REAL NOT NULL,
                    width REAL NOT NULL,
                    height REAL NOT NULL,
                    rotation REAL NOT NULL DEFAULT 0,
                    z_index INTEGER NOT NULL DEFAULT 0,
                    color TEXT,
                    PRIMARY KEY (board_id, id),
                    FOREIGN KEY (board_id) REFERENCES inspiration_boards(id) ON DELETE CASCADE
                );
                CREATE TABLE IF NOT EXISTS inspiration_board_links (
                    board_id TEXT NOT NULL,
                    id TEXT NOT NULL,
                    from_item_id TEXT NOT NULL,
                    to_item_id TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    label TEXT,
                    PRIMARY KEY (board_id, id),
                    FOREIGN KEY (board_id) REFERENCES inspiration_boards(id) ON DELETE CASCADE
                );
                ",
            )
            .map_err(|e| format!("无法初始化数据库: {e}"))?;
        self.ensure_column("artifacts", "deleted_at", "INTEGER")?;
        self.ensure_column("artifacts", "delete_expires_at", "INTEGER")?;
        self.ensure_column("artifacts", "deleted_by", "TEXT")?;
        self.conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_artifacts_deleted
             ON artifacts(deleted_at, delete_expires_at)",
            [],
        ).map_err(|e| format!("创建回收站索引失败: {e}"))?;
        Ok(())
    }

    fn ensure_column(&self, table: &str, column: &str, definition: &str) -> Result<(), String> {
        let mut stmt = self
            .conn
            .prepare(&format!("PRAGMA table_info({table})"))
            .map_err(|e| e.to_string())?;
        let columns = stmt
            .query_map([], |row| row.get::<_, String>(1))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        if !columns.iter().any(|name| name == column) {
            self.conn
                .execute(
                    &format!("ALTER TABLE {table} ADD COLUMN {column} {definition}"),
                    [],
                )
                .map_err(|e| format!("数据库迁移失败 {table}.{column}: {e}"))?;
        }
        Ok(())
    }

    /// Persist the computed health metrics for a package. Scalar figures are
    /// stored as real columns; the inherently list-shaped parts (breakdowns,
    /// growth series, top-connected, hooks, hook targets) as compact JSON.
    pub fn save_metrics(
        &self,
        package_id: &str,
        metrics: &crate::metrics::Metrics,
    ) -> Result<(), String> {
        let kind_breakdown = serde_json::to_string(&metrics.kind_breakdown)
            .map_err(|e| format!("指标序列化失败: {e}"))?;
        let growth =
            serde_json::to_string(&metrics.growth).map_err(|e| format!("指标序列化失败: {e}"))?;
        let top_connected = serde_json::to_string(&metrics.top_connected)
            .map_err(|e| format!("指标序列化失败: {e}"))?;
        let hooks =
            serde_json::to_string(&metrics.hooks).map_err(|e| format!("指标序列化失败: {e}"))?;
        let hook_targets = serde_json::to_string(&metrics.hook_targets)
            .map_err(|e| format!("指标序列化失败: {e}"))?;
        let computed_at = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_secs().to_string())
            .unwrap_or_default();

        self.conn
            .execute(
                "INSERT OR REPLACE INTO package_metrics
                    (package_id, total, finals, completion, broken, broken_rate, relations,
                     avg_degree, last_updated_at, last_updated_name, kind_breakdown, growth,
                     top_connected, hooks, hook_targets, computed_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)",
                params![
                    package_id,
                    metrics.total as i64,
                    metrics.finals as i64,
                    metrics.completion as i64,
                    metrics.broken as i64,
                    metrics.broken_rate as i64,
                    metrics.relations as i64,
                    metrics.avg_degree,
                    metrics.last_updated_at,
                    metrics.last_updated_name,
                    kind_breakdown,
                    growth,
                    top_connected,
                    hooks,
                    hook_targets,
                    computed_at,
                ],
            )
            .map_err(|e| format!("写入指标失败: {e}"))?;
        Ok(())
    }

    /// Read the stored metrics for a package, if they've been computed.
    pub fn load_metrics(&self, package_id: &str) -> Result<Option<crate::metrics::Metrics>, String> {
        self.conn
            .query_row(
                "SELECT total, finals, completion, broken, broken_rate, relations, avg_degree,
                        last_updated_at, last_updated_name, kind_breakdown, growth, top_connected,
                        hooks, hook_targets
                 FROM package_metrics WHERE package_id = ?1",
                params![package_id],
                |row| {
                    let kind_breakdown: String = row.get(9)?;
                    let growth: String = row.get(10)?;
                    let top_connected: String = row.get(11)?;
                    let hooks: String = row.get(12)?;
                    let hook_targets: String = row.get(13)?;
                    Ok(crate::metrics::Metrics {
                        total: row.get::<_, i64>(0)? as usize,
                        finals: row.get::<_, i64>(1)? as usize,
                        completion: row.get::<_, i64>(2)? as u32,
                        broken: row.get::<_, i64>(3)? as usize,
                        broken_rate: row.get::<_, i64>(4)? as u32,
                        relations: row.get::<_, i64>(5)? as usize,
                        avg_degree: row.get(6)?,
                        last_updated_at: row.get(7)?,
                        last_updated_name: row.get(8)?,
                        kind_breakdown: serde_json::from_str(&kind_breakdown).unwrap_or_default(),
                        growth: serde_json::from_str(&growth).unwrap_or_default(),
                        top_connected: serde_json::from_str(&top_connected).unwrap_or_default(),
                        hooks: serde_json::from_str(&hooks).map_err(|_| {
                            rusqlite::Error::InvalidColumnType(
                                12,
                                "hooks".to_string(),
                                rusqlite::types::Type::Text,
                            )
                        })?,
                        hook_targets: serde_json::from_str(&hook_targets).map_err(|_| {
                            rusqlite::Error::InvalidColumnType(
                                13,
                                "hook_targets".to_string(),
                                rusqlite::types::Type::Text,
                            )
                        })?,
                    })
                },
            )
            .optional()
            .map_err(|e| format!("读取指标失败: {e}"))
    }

    pub fn list_package_ids(&self) -> Result<Vec<String>, String> {
        let mut stmt = self
            .conn
            .prepare("SELECT id FROM packages ORDER BY rowid")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        let mut ids = Vec::new();
        for row in rows {
            ids.push(row.map_err(|e| e.to_string())?);
        }
        Ok(ids)
    }

    pub fn has_packages(&self) -> Result<bool, String> {
        let count: i64 = self
            .conn
            .query_row("SELECT COUNT(*) FROM packages", [], |row| row.get(0))
            .map_err(|e| e.to_string())?;
        Ok(count > 0)
    }

    pub fn package_exists(&self, package_id: &str) -> Result<bool, String> {
        let found: Option<String> = self
            .conn
            .query_row(
                "SELECT id FROM packages WHERE id = ?1",
                params![package_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        Ok(found.is_some())
    }

    pub fn package_meta(&self, package_id: &str) -> Result<PackageMeta, String> {
        self.conn
            .query_row(
                "SELECT imported_at, source_path FROM packages WHERE id = ?1",
                params![package_id],
                |row| {
                    Ok(PackageMeta {
                        imported_at: row.get(0)?,
                        source_path: row.get(1)?,
                    })
                },
            )
            .optional()
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("成果包不存在: {package_id}"))
    }

    /// Replace a package and all its child rows in a single transaction.
    pub fn upsert_package(
        &self,
        manifest: &PackageManifest,
        relations: &RelationsDocument,
        works: &WorksDocument,
        identities: &IdentitiesDocument,
        imported_at: &str,
        source_path: Option<&str>,
    ) -> Result<(), String> {
        let tx = self
            .conn
            .unchecked_transaction()
            .map_err(|e| format!("事务开启失败: {e}"))?;
        let pid = &manifest.id;

        for table in [
            "artifact_tags",
            "artifacts",
            "relations",
            "works",
            "work_artifacts",
            "identities",
            "identity_versions",
        ] {
            tx.execute(
                &format!("DELETE FROM {table} WHERE package_id = ?1"),
                params![pid],
            )
            .map_err(|e| format!("清理 {table} 失败: {e}"))?;
        }
        tx.execute("DELETE FROM packages WHERE id = ?1", params![pid])
            .map_err(|e| e.to_string())?;

        tx.execute(
            "INSERT INTO packages
                (id, schema_version, title, slug, domain, summary, project_root, created_at, imported_at, source_path)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                pid,
                manifest.schema_version,
                manifest.title,
                manifest.slug,
                manifest.domain,
                manifest.summary,
                manifest.project_root,
                manifest.created_at,
                imported_at,
                source_path,
            ],
        )
        .map_err(|e| format!("写入 package 失败: {e}"))?;

        for (index, artifact) in manifest.artifacts.iter().enumerate() {
            let prov = artifact.provenance.as_ref();
            tx.execute(
                "INSERT INTO artifacts
                    (package_id, id, order_index, display_name, kind, status, role, summary, work_id,
                     file_path, file_path_kind, file_name,
                     prov_tool, prov_session_label, prov_exported_at, prov_note,
                     created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)",
                params![
                    pid,
                    artifact.id,
                    index as i64,
                    artifact.display_name,
                    artifact.kind,
                    artifact.status,
                    artifact.role,
                    artifact.summary,
                    artifact.work_id,
                    artifact.file_ref.path,
                    artifact.file_ref.path_kind,
                    artifact.file_ref.file_name,
                    prov.and_then(|p| p.tool.clone()),
                    prov.and_then(|p| p.session_label.clone()),
                    prov.and_then(|p| p.exported_at.clone()),
                    prov.and_then(|p| p.note.clone()),
                    artifact.created_at,
                    artifact.updated_at,
                ],
            )
            .map_err(|e| format!("写入 artifact 失败: {e}"))?;

            if let Some(tags) = &artifact.tags {
                for (tag_index, tag) in tags.iter().enumerate() {
                    tx.execute(
                        "INSERT INTO artifact_tags (package_id, artifact_id, order_index, tag)
                         VALUES (?1, ?2, ?3, ?4)",
                        params![pid, artifact.id, tag_index as i64, tag],
                    )
                    .map_err(|e| format!("写入 tag 失败: {e}"))?;
                }
            }
        }

        for (index, relation) in relations.relations.iter().enumerate() {
            tx.execute(
                "INSERT INTO relations
                    (package_id, id, order_index, from_id, to_id, kind, label, inferred)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    pid,
                    relation.id,
                    index as i64,
                    relation.from,
                    relation.to,
                    relation.kind,
                    relation.label,
                    relation.inferred.map(|b| b as i64),
                ],
            )
            .map_err(|e| format!("写入 relation 失败: {e}"))?;
        }

        for work in &works.works {
            tx.execute(
                "INSERT INTO works (package_id, id, title, summary, order_index)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![pid, work.id, work.title, work.summary, work.order as i64],
            )
            .map_err(|e| format!("写入 work 失败: {e}"))?;
            for (art_index, artifact_id) in work.artifact_ids.iter().enumerate() {
                tx.execute(
                    "INSERT INTO work_artifacts (package_id, work_id, artifact_id, order_index)
                     VALUES (?1, ?2, ?3, ?4)",
                    params![pid, work.id, artifact_id, art_index as i64],
                )
                .map_err(|e| format!("写入 work_artifacts 失败: {e}"))?;
            }
        }

        for identity in &identities.identities {
            tx.execute(
                "INSERT INTO identities
                    (package_id, id, display_name, kind, head_version_id, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                params![
                    pid,
                    identity.id,
                    identity.display_name,
                    identity.kind,
                    identity.head_version_id,
                    identity.created_at,
                    identity.updated_at,
                ],
            )
            .map_err(|e| format!("写入 identity 失败: {e}"))?;
            for (version_index, artifact_id) in identity.version_ids.iter().enumerate() {
                tx.execute(
                    "INSERT INTO identity_versions (package_id, identity_id, artifact_id, order_index)
                     VALUES (?1, ?2, ?3, ?4)",
                    params![pid, identity.id, artifact_id, version_index as i64],
                )
                .map_err(|e| format!("写入 identity_versions 失败: {e}"))?;
            }
        }

        tx.commit().map_err(|e| format!("事务提交失败: {e}"))?;
        Ok(())
    }

    pub fn load_manifest(&self, package_id: &str) -> Result<PackageManifest, String> {
        let base = self
            .conn
            .query_row(
                "SELECT schema_version, title, slug, domain, summary, project_root, created_at
                 FROM packages WHERE id = ?1",
                params![package_id],
                |row| {
                    Ok(PackageManifest {
                        schema_version: row.get(0)?,
                        id: package_id.to_string(),
                        title: row.get(1)?,
                        slug: row.get(2)?,
                        domain: row.get(3)?,
                        summary: row.get(4)?,
                        project_root: row.get(5)?,
                        created_at: row.get(6)?,
                        artifacts: Vec::new(),
                    })
                },
            )
            .optional()
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("成果包不存在: {package_id}"))?;

        let mut manifest = base;
        manifest.artifacts = self.load_artifacts(package_id)?;
        Ok(manifest)
    }

    fn load_artifacts(&self, package_id: &str) -> Result<Vec<Artifact>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, display_name, kind, status, role, summary, work_id,
                        file_path, file_path_kind, file_name,
                        prov_tool, prov_session_label, prov_exported_at, prov_note,
                        created_at, updated_at
                 FROM artifacts
                 WHERE package_id = ?1 AND deleted_at IS NULL
                 ORDER BY order_index",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![package_id], |row| {
                let prov_tool: Option<String> = row.get(10)?;
                let prov_session: Option<String> = row.get(11)?;
                let prov_exported: Option<String> = row.get(12)?;
                let prov_note: Option<String> = row.get(13)?;
                let provenance = if prov_tool.is_some()
                    || prov_session.is_some()
                    || prov_exported.is_some()
                    || prov_note.is_some()
                {
                    Some(Provenance {
                        tool: prov_tool,
                        session_label: prov_session,
                        exported_at: prov_exported,
                        note: prov_note,
                    })
                } else {
                    None
                };
                Ok(Artifact {
                    id: row.get(0)?,
                    display_name: row.get(1)?,
                    kind: row.get(2)?,
                    status: row.get(3)?,
                    role: row.get(4)?,
                    summary: row.get(5)?,
                    tags: None,
                    work_id: row.get(6)?,
                    file_ref: FileRef {
                        path: row.get(7)?,
                        path_kind: row.get(8)?,
                        file_name: row.get(9)?,
                    },
                    provenance,
                    created_at: row.get(14)?,
                    updated_at: row.get(15)?,
                })
            })
            .map_err(|e| e.to_string())?;

        let mut artifacts = Vec::new();
        for row in rows {
            artifacts.push(row.map_err(|e| e.to_string())?);
        }
        for artifact in &mut artifacts {
            artifact.tags = self.load_tags(package_id, &artifact.id)?;
        }
        Ok(artifacts)
    }

    fn load_tags(&self, package_id: &str, artifact_id: &str) -> Result<Option<Vec<String>>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT tag FROM artifact_tags
                 WHERE package_id = ?1 AND artifact_id = ?2 ORDER BY order_index",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![package_id, artifact_id], |row| {
                row.get::<_, String>(0)
            })
            .map_err(|e| e.to_string())?;
        let mut tags = Vec::new();
        for row in rows {
            tags.push(row.map_err(|e| e.to_string())?);
        }
        Ok(if tags.is_empty() { None } else { Some(tags) })
    }

    pub fn load_relations(&self, package_id: &str) -> Result<RelationsDocument, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, from_id, to_id, kind, label, inferred
                 FROM relations r
                 WHERE r.package_id = ?1
                   AND NOT EXISTS (
                     SELECT 1 FROM artifacts a
                     WHERE a.package_id = r.package_id AND a.id = r.from_id AND a.deleted_at IS NOT NULL
                   )
                   AND NOT EXISTS (
                     SELECT 1 FROM artifacts a
                     WHERE a.package_id = r.package_id AND a.id = r.to_id AND a.deleted_at IS NOT NULL
                   )
                 ORDER BY order_index",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![package_id], |row| {
                let inferred: Option<i64> = row.get(5)?;
                Ok(Relation {
                    id: row.get(0)?,
                    from: row.get(1)?,
                    to: row.get(2)?,
                    kind: row.get(3)?,
                    label: row.get(4)?,
                    inferred: inferred.map(|v| v != 0),
                })
            })
            .map_err(|e| e.to_string())?;
        let mut relations = Vec::new();
        for row in rows {
            relations.push(row.map_err(|e| e.to_string())?);
        }
        Ok(RelationsDocument {
            schema_version: crate::models::SCHEMA_VERSION.to_string(),
            relations,
        })
    }

    pub fn load_works(&self, package_id: &str) -> Result<WorksDocument, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, title, summary, order_index
                 FROM works WHERE package_id = ?1 ORDER BY order_index",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![package_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, i64>(3)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        let mut works = Vec::new();
        for row in rows {
            let (id, title, summary, order) = row.map_err(|e| e.to_string())?;
            let artifact_ids = self.load_work_artifacts(package_id, &id)?;
            works.push(Work {
                id,
                title,
                summary,
                order: order as i32,
                artifact_ids,
            });
        }
        Ok(WorksDocument {
            schema_version: crate::models::SCHEMA_VERSION.to_string(),
            works,
        })
    }

    fn load_work_artifacts(&self, package_id: &str, work_id: &str) -> Result<Vec<String>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT wa.artifact_id FROM work_artifacts wa
                 JOIN artifacts a ON a.package_id = wa.package_id AND a.id = wa.artifact_id
                 WHERE wa.package_id = ?1 AND wa.work_id = ?2 AND a.deleted_at IS NULL
                 ORDER BY wa.order_index",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![package_id, work_id], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        let mut ids = Vec::new();
        for row in rows {
            ids.push(row.map_err(|e| e.to_string())?);
        }
        Ok(ids)
    }

    pub fn load_identities(&self, package_id: &str) -> Result<IdentitiesDocument, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT id, display_name, kind, head_version_id, created_at, updated_at
                 FROM identities WHERE package_id = ?1 ORDER BY rowid",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![package_id], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                ))
            })
            .map_err(|e| e.to_string())?;
        let mut identities = Vec::new();
        for row in rows {
            let (id, display_name, kind, head_version_id, created_at, updated_at) =
                row.map_err(|e| e.to_string())?;
            let version_ids = self.load_identity_versions(package_id, &id)?;
            if version_ids.is_empty() {
                continue;
            }
            let active_head = if version_ids.contains(&head_version_id) {
                head_version_id
            } else {
                version_ids.last().cloned().unwrap_or_default()
            };
            identities.push(Identity {
                id,
                display_name,
                kind,
                head_version_id: active_head,
                version_ids,
                created_at,
                updated_at,
            });
        }
        Ok(IdentitiesDocument {
            schema_version: crate::models::SCHEMA_VERSION.to_string(),
            identities,
        })
    }

    fn load_identity_versions(
        &self,
        package_id: &str,
        identity_id: &str,
    ) -> Result<Vec<String>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT v.artifact_id FROM identity_versions v
                 JOIN artifacts a ON a.package_id = v.package_id AND a.id = v.artifact_id
                 WHERE v.package_id = ?1 AND v.identity_id = ?2 AND a.deleted_at IS NULL
                 ORDER BY v.order_index",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![package_id, identity_id], |row| {
                row.get::<_, String>(0)
            })
            .map_err(|e| e.to_string())?;
        let mut ids = Vec::new();
        for row in rows {
            ids.push(row.map_err(|e| e.to_string())?);
        }
        Ok(ids)
    }

    pub fn update_artifact_status(
        &self,
        package_id: &str,
        artifact_id: &str,
        status: &str,
        updated_at: &str,
    ) -> Result<(), String> {
        let affected = self
            .conn
            .execute(
                "UPDATE artifacts SET status = ?3, updated_at = ?4
                 WHERE package_id = ?1 AND id = ?2 AND deleted_at IS NULL",
                params![package_id, artifact_id, status, updated_at],
            )
            .map_err(|e| format!("更新状态失败: {e}"))?;
        if affected == 0 {
            return Err(format!("成果项不存在: {artifact_id}"));
        }
        Ok(())
    }

    pub fn update_artifact_file_ref(
        &self,
        package_id: &str,
        artifact_id: &str,
        file_ref: &FileRef,
        updated_at: &str,
    ) -> Result<(), String> {
        let affected = self
            .conn
            .execute(
                "UPDATE artifacts
                 SET file_path = ?3, file_path_kind = ?4, file_name = ?5, updated_at = ?6
                 WHERE package_id = ?1 AND id = ?2 AND deleted_at IS NULL",
                params![
                    package_id,
                    artifact_id,
                    file_ref.path,
                    file_ref.path_kind,
                    file_ref.file_name,
                    updated_at,
                ],
            )
            .map_err(|e| format!("更新文件链接失败: {e}"))?;
        if affected == 0 {
            return Err(format!("成果项不存在: {artifact_id}"));
        }
        Ok(())
    }

    pub fn update_artifact_meta(
        &self,
        package_id: &str,
        artifact_id: &str,
        role: Option<&str>,
        summary: Option<&str>,
        tags: &[String],
        updated_at: &str,
    ) -> Result<(), String> {
        let affected = self
            .conn
            .execute(
                "UPDATE artifacts SET role = ?3, summary = ?4, updated_at = ?5
                 WHERE package_id = ?1 AND id = ?2 AND deleted_at IS NULL",
                params![package_id, artifact_id, role, summary, updated_at],
            )
            .map_err(|e| format!("更新元数据失败: {e}"))?;
        if affected == 0 {
            return Err(format!("成果项不存在: {artifact_id}"));
        }
        self.conn
            .execute(
                "DELETE FROM artifact_tags WHERE package_id = ?1 AND artifact_id = ?2",
                params![package_id, artifact_id],
            )
            .map_err(|e| format!("清理标签失败: {e}"))?;
        for (i, tag) in tags.iter().enumerate() {
            let t = tag.trim();
            if t.is_empty() {
                continue;
            }
            self.conn
                .execute(
                    "INSERT INTO artifact_tags (package_id, artifact_id, order_index, tag)
                     VALUES (?1, ?2, ?3, ?4)",
                    params![package_id, artifact_id, i as i64, t],
                )
                .map_err(|e| format!("写入标签失败: {e}"))?;
        }
        Ok(())
    }

    pub fn batch_update_artifact_status(
        &self,
        package_id: &str,
        artifact_ids: &[String],
        status: &str,
        updated_at: &str,
    ) -> Result<usize, String> {
        let mut n = 0usize;
        for id in artifact_ids {
            let affected = self
                .conn
                .execute(
                    "UPDATE artifacts SET status = ?3, updated_at = ?4
                     WHERE package_id = ?1 AND id = ?2 AND deleted_at IS NULL",
                    params![package_id, id, status, updated_at],
                )
                .map_err(|e| format!("批量更新状态失败: {e}"))?;
            n += affected as usize;
        }
        Ok(n)
    }

    pub fn add_relation(
        &self,
        package_id: &str,
        relation: &Relation,
    ) -> Result<(), String> {
        let next_order: i64 = self
            .conn
            .query_row(
                "SELECT COALESCE(MAX(order_index), -1) + 1 FROM relations WHERE package_id = ?1",
                params![package_id],
                |row| row.get(0),
            )
            .unwrap_or(0);
        self.conn
            .execute(
                "INSERT INTO relations
                    (package_id, id, order_index, from_id, to_id, kind, label, inferred)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    package_id,
                    relation.id,
                    next_order,
                    relation.from,
                    relation.to,
                    relation.kind,
                    relation.label,
                    relation.inferred.map(|b| b as i64),
                ],
            )
            .map_err(|e| format!("添加关系失败: {e}"))?;
        Ok(())
    }

    pub fn remove_relation(&self, package_id: &str, relation_id: &str) -> Result<(), String> {
        let affected = self
            .conn
            .execute(
                "DELETE FROM relations WHERE package_id = ?1 AND id = ?2",
                params![package_id, relation_id],
            )
            .map_err(|e| format!("删除关系失败: {e}"))?;
        if affected == 0 {
            return Err(format!("关系不存在: {relation_id}"));
        }
        Ok(())
    }

    pub fn update_relation_kind(
        &self,
        package_id: &str,
        relation_id: &str,
        kind: &str,
        label: Option<&str>,
    ) -> Result<(), String> {
        let affected = self
            .conn
            .execute(
                "UPDATE relations SET kind = ?3, label = ?4
                 WHERE package_id = ?1 AND id = ?2",
                params![package_id, relation_id, kind, label],
            )
            .map_err(|e| format!("更新关系失败: {e}"))?;
        if affected == 0 {
            return Err(format!("关系不存在: {relation_id}"));
        }
        Ok(())
    }

    pub fn update_package_meta(
        &self,
        package_id: &str,
        title: &str,
        summary: Option<&str>,
    ) -> Result<(), String> {
        let affected = self
            .conn
            .execute(
                "UPDATE packages SET title = ?2, summary = ?3 WHERE id = ?1",
                params![package_id, title, summary],
            )
            .map_err(|e| format!("更新成果包失败: {e}"))?;
        if affected == 0 {
            return Err(format!("成果包不存在: {package_id}"));
        }
        Ok(())
    }

    pub fn delete_package(&self, package_id: &str) -> Result<(), String> {
        let tx = self
            .conn
            .unchecked_transaction()
            .map_err(|e| format!("事务开启失败: {e}"))?;
        tx.execute(
            "DELETE FROM inspiration_boards WHERE package_id = ?1",
            params![package_id],
        )
        .map_err(|e| format!("删除项目灵感板失败: {e}"))?;
        for table in [
            "artifact_tags",
            "artifacts",
            "relations",
            "works",
            "work_artifacts",
            "identities",
            "identity_versions",
            "package_metrics",
        ] {
            let _ = tx.execute(
                &format!("DELETE FROM {table} WHERE package_id = ?1"),
                params![package_id],
            );
        }
        let affected = tx
            .execute("DELETE FROM packages WHERE id = ?1", params![package_id])
            .map_err(|e| e.to_string())?;
        if affected == 0 {
            return Err(format!("成果包不存在: {package_id}"));
        }
        tx.commit().map_err(|e| format!("事务提交失败: {e}"))?;
        Ok(())
    }

    pub fn set_work_membership(
        &self,
        package_id: &str,
        work_id: &str,
        artifact_id: &str,
        include: bool,
    ) -> Result<(), String> {
        if include {
            let exists: i64 = self
                .conn
                .query_row(
                    "SELECT COUNT(1) FROM works WHERE package_id = ?1 AND id = ?2",
                    params![package_id, work_id],
                    |row| row.get(0),
                )
                .unwrap_or(0);
            if exists == 0 {
                return Err(format!("分组不存在: {work_id}"));
            }
            let next_order: i64 = self
                .conn
                .query_row(
                    "SELECT COALESCE(MAX(order_index), -1) + 1 FROM work_artifacts
                     WHERE package_id = ?1 AND work_id = ?2",
                    params![package_id, work_id],
                    |row| row.get(0),
                )
                .unwrap_or(0);
            self.conn
                .execute(
                    "DELETE FROM work_artifacts
                     WHERE package_id = ?1 AND artifact_id = ?2",
                    params![package_id, artifact_id],
                )
                .map_err(|e| e.to_string())?;
            self.conn
                .execute(
                    "INSERT INTO work_artifacts (package_id, work_id, artifact_id, order_index)
                     VALUES (?1, ?2, ?3, ?4)",
                    params![package_id, work_id, artifact_id, next_order],
                )
                .map_err(|e| format!("挂入分组失败: {e}"))?;
            self.conn
                .execute(
                    "UPDATE artifacts SET work_id = ?3 WHERE package_id = ?1 AND id = ?2",
                    params![package_id, artifact_id, work_id],
                )
                .map_err(|e| e.to_string())?;
        } else {
            self.conn
                .execute(
                    "DELETE FROM work_artifacts
                     WHERE package_id = ?1 AND work_id = ?2 AND artifact_id = ?3",
                    params![package_id, work_id, artifact_id],
                )
                .map_err(|e| e.to_string())?;
            self.conn
                .execute(
                    "UPDATE artifacts SET work_id = NULL
                     WHERE package_id = ?1 AND id = ?2 AND work_id = ?3",
                    params![package_id, artifact_id, work_id],
                )
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub fn rename_artifact(
        &self,
        package_id: &str,
        artifact_id: &str,
        display_name: &str,
        updated_at: &str,
    ) -> Result<(), String> {
        let name = display_name.trim();
        if name.is_empty() {
            return Err("名称不能为空".to_string());
        }
        let affected = self
            .conn
            .execute(
                "UPDATE artifacts SET display_name = ?3, updated_at = ?4
                 WHERE package_id = ?1 AND id = ?2 AND deleted_at IS NULL",
                params![package_id, artifact_id, name, updated_at],
            )
            .map_err(|e| format!("重命名失败: {e}"))?;
        if affected == 0 {
            return Err(format!("成果项不存在: {artifact_id}"));
        }
        Ok(())
    }

    pub fn touch_artifact(
        &self,
        package_id: &str,
        artifact_id: &str,
        updated_at: &str,
    ) -> Result<(), String> {
        let affected = self
            .conn
            .execute(
                "UPDATE artifacts SET updated_at = ?3
                 WHERE package_id = ?1 AND id = ?2 AND deleted_at IS NULL",
                params![package_id, artifact_id, updated_at],
            )
            .map_err(|e| format!("更新时间戳失败: {e}"))?;
        if affected == 0 {
            return Err(format!("成果项不存在: {artifact_id}"));
        }
        Ok(())
    }

    pub fn insert_artifact(
        &self,
        package_id: &str,
        artifact: &Artifact,
    ) -> Result<(), String> {
        let next_order: i64 = self
            .conn
            .query_row(
                "SELECT COALESCE(MAX(order_index), -1) + 1 FROM artifacts WHERE package_id = ?1",
                params![package_id],
                |row| row.get(0),
            )
            .unwrap_or(0);
        self.conn
            .execute(
                "INSERT INTO artifacts
                 (package_id, id, order_index, display_name, kind, status, role, summary, work_id,
                  file_path, file_path_kind, file_name,
                  prov_tool, prov_session_label, prov_exported_at, prov_note,
                  created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)",
                params![
                    package_id,
                    artifact.id,
                    next_order,
                    artifact.display_name,
                    artifact.kind,
                    artifact.status,
                    artifact.role,
                    artifact.summary,
                    artifact.work_id,
                    artifact.file_ref.path,
                    artifact.file_ref.path_kind,
                    artifact.file_ref.file_name,
                    artifact.provenance.as_ref().and_then(|p| p.tool.clone()),
                    artifact
                        .provenance
                        .as_ref()
                        .and_then(|p| p.session_label.clone()),
                    artifact
                        .provenance
                        .as_ref()
                        .and_then(|p| p.exported_at.clone()),
                    artifact.provenance.as_ref().and_then(|p| p.note.clone()),
                    artifact.created_at,
                    artifact.updated_at,
                ],
            )
            .map_err(|e| format!("追加资产失败: {e}"))?;
        Ok(())
    }

    pub fn create_work(
        &self,
        package_id: &str,
        work: &Work,
    ) -> Result<(), String> {
        let title = work.title.trim();
        if title.is_empty() {
            return Err("分组标题不能为空".to_string());
        }
        self.conn
            .execute(
                "INSERT INTO works (package_id, id, title, summary, order_index)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![package_id, work.id, title, work.summary, work.order],
            )
            .map_err(|e| format!("创建分组失败: {e}"))?;
        Ok(())
    }

    pub fn rename_work(
        &self,
        package_id: &str,
        work_id: &str,
        title: &str,
        summary: Option<&str>,
    ) -> Result<(), String> {
        let title = title.trim();
        if title.is_empty() {
            return Err("分组标题不能为空".to_string());
        }
        let affected = self
            .conn
            .execute(
                "UPDATE works SET title = ?3, summary = ?4
                 WHERE package_id = ?1 AND id = ?2",
                params![package_id, work_id, title, summary],
            )
            .map_err(|e| format!("重命名分组失败: {e}"))?;
        if affected == 0 {
            return Err(format!("分组不存在: {work_id}"));
        }
        Ok(())
    }

    pub fn delete_work(&self, package_id: &str, work_id: &str) -> Result<(), String> {
        let tx = self
            .conn
            .unchecked_transaction()
            .map_err(|e| format!("事务开启失败: {e}"))?;
        tx.execute(
            "UPDATE artifacts SET work_id = NULL
             WHERE package_id = ?1 AND work_id = ?2",
            params![package_id, work_id],
        )
        .map_err(|e| e.to_string())?;
        tx.execute(
            "DELETE FROM work_artifacts WHERE package_id = ?1 AND work_id = ?2",
            params![package_id, work_id],
        )
        .map_err(|e| e.to_string())?;
        let affected = tx
            .execute(
                "DELETE FROM works WHERE package_id = ?1 AND id = ?2",
                params![package_id, work_id],
            )
            .map_err(|e| e.to_string())?;
        if affected == 0 {
            return Err(format!("分组不存在: {work_id}"));
        }
        tx.commit().map_err(|e| format!("事务提交失败: {e}"))?;
        Ok(())
    }

    /// Merge `absorb_id` into `keep_id`: combine versions, retarget relations, delete absorb.
    pub fn merge_identities(
        &self,
        package_id: &str,
        keep_id: &str,
        absorb_id: &str,
    ) -> Result<(), String> {
        if keep_id == absorb_id {
            return Err("不能与自身合并".to_string());
        }
        let identities = self.load_identities(package_id)?;
        let keep = identities
            .identities
            .iter()
            .find(|i| i.id == keep_id)
            .ok_or_else(|| format!("身份不存在: {keep_id}"))?
            .clone();
        let absorb = identities
            .identities
            .iter()
            .find(|i| i.id == absorb_id)
            .ok_or_else(|| format!("身份不存在: {absorb_id}"))?
            .clone();

        let mut versions = keep.version_ids.clone();
        for vid in &absorb.version_ids {
            if !versions.contains(vid) {
                versions.push(vid.clone());
            }
        }
        if versions.is_empty() {
            return Err("合并后身份没有任何版本".to_string());
        }
        let head = if versions.contains(&keep.head_version_id) {
            keep.head_version_id.clone()
        } else {
            versions.last().cloned().unwrap_or_default()
        };
        let now = chrono_like_now();

        let tx = self
            .conn
            .unchecked_transaction()
            .map_err(|e| format!("事务开启失败: {e}"))?;

        tx.execute(
            "DELETE FROM identity_versions WHERE package_id = ?1 AND identity_id = ?2",
            params![package_id, keep_id],
        )
        .map_err(|e| e.to_string())?;
        for (order, artifact_id) in versions.iter().enumerate() {
            tx.execute(
                "INSERT INTO identity_versions (package_id, identity_id, artifact_id, order_index)
                 VALUES (?1, ?2, ?3, ?4)",
                params![package_id, keep_id, artifact_id, order as i64],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.execute(
            "UPDATE identities SET head_version_id = ?3, updated_at = ?4
             WHERE package_id = ?1 AND id = ?2",
            params![package_id, keep_id, head, now],
        )
        .map_err(|e| e.to_string())?;

        // Retarget relations that pointed at the absorbed identity.
        tx.execute(
            "UPDATE relations SET from_id = ?3
             WHERE package_id = ?1 AND from_id = ?2",
            params![package_id, absorb_id, keep_id],
        )
        .map_err(|e| e.to_string())?;
        tx.execute(
            "UPDATE relations SET to_id = ?3
             WHERE package_id = ?1 AND to_id = ?2",
            params![package_id, absorb_id, keep_id],
        )
        .map_err(|e| e.to_string())?;

        // Drop duplicate edges created by retargeting.
        tx.execute(
            "DELETE FROM relations WHERE rowid NOT IN (
                SELECT MIN(rowid) FROM relations WHERE package_id = ?1
                GROUP BY from_id, to_id, kind
             ) AND package_id = ?1",
            params![package_id],
        )
        .map_err(|e| e.to_string())?;

        tx.execute(
            "DELETE FROM identity_versions WHERE package_id = ?1 AND identity_id = ?2",
            params![package_id, absorb_id],
        )
        .map_err(|e| e.to_string())?;
        tx.execute(
            "DELETE FROM identities WHERE package_id = ?1 AND id = ?2",
            params![package_id, absorb_id],
        )
        .map_err(|e| e.to_string())?;

        tx.commit().map_err(|e| format!("事务提交失败: {e}"))?;
        Ok(())
    }

    /// Split listed versions out of an identity into a new identity.
    pub fn split_identity(
        &self,
        package_id: &str,
        identity_id: &str,
        artifact_ids: &[String],
        new_identity_id: &str,
        new_display_name: &str,
    ) -> Result<(), String> {
        if artifact_ids.is_empty() {
            return Err("请选择要拆出的版本".to_string());
        }
        let identities = self.load_identities(package_id)?;
        let source = identities
            .identities
            .iter()
            .find(|i| i.id == identity_id)
            .ok_or_else(|| format!("身份不存在: {identity_id}"))?
            .clone();
        if identities.identities.iter().any(|i| i.id == new_identity_id) {
            return Err(format!("身份 id 已存在: {new_identity_id}"));
        }
        for aid in artifact_ids {
            if !source.version_ids.contains(aid) {
                return Err(format!("版本 {aid} 不属于该身份"));
            }
        }
        let remain: Vec<String> = source
            .version_ids
            .iter()
            .filter(|id| !artifact_ids.contains(id))
            .cloned()
            .collect();
        if remain.is_empty() {
            return Err("拆分后原身份至少保留一个版本".to_string());
        }
        let title = new_display_name.trim();
        if title.is_empty() {
            return Err("新身份名称不能为空".to_string());
        }
        let new_head = artifact_ids.last().cloned().unwrap_or_default();
        let remain_head = if remain.contains(&source.head_version_id) {
            source.head_version_id.clone()
        } else {
            remain.last().cloned().unwrap_or_default()
        };
        let now = chrono_like_now();

        let tx = self
            .conn
            .unchecked_transaction()
            .map_err(|e| format!("事务开启失败: {e}"))?;

        tx.execute(
            "DELETE FROM identity_versions WHERE package_id = ?1 AND identity_id = ?2",
            params![package_id, identity_id],
        )
        .map_err(|e| e.to_string())?;
        for (order, artifact_id) in remain.iter().enumerate() {
            tx.execute(
                "INSERT INTO identity_versions (package_id, identity_id, artifact_id, order_index)
                 VALUES (?1, ?2, ?3, ?4)",
                params![package_id, identity_id, artifact_id, order as i64],
            )
            .map_err(|e| e.to_string())?;
        }
        tx.execute(
            "UPDATE identities SET head_version_id = ?3, updated_at = ?4
             WHERE package_id = ?1 AND id = ?2",
            params![package_id, identity_id, remain_head, now],
        )
        .map_err(|e| e.to_string())?;

        tx.execute(
            "INSERT INTO identities
                (package_id, id, display_name, kind, head_version_id, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![
                package_id,
                new_identity_id,
                title,
                source.kind,
                new_head,
                now,
                now
            ],
        )
        .map_err(|e| format!("创建身份失败: {e}"))?;
        for (order, artifact_id) in artifact_ids.iter().enumerate() {
            tx.execute(
                "INSERT INTO identity_versions (package_id, identity_id, artifact_id, order_index)
                 VALUES (?1, ?2, ?3, ?4)",
                params![package_id, new_identity_id, artifact_id, order as i64],
            )
            .map_err(|e| e.to_string())?;
        }

        tx.commit().map_err(|e| format!("事务提交失败: {e}"))?;
        Ok(())
    }

    pub fn set_identity_head(
        &self,
        package_id: &str,
        identity_id: &str,
        head_version_id: &str,
    ) -> Result<(), String> {
        let versions = self.load_identity_versions(package_id, identity_id)?;
        if !versions.iter().any(|v| v == head_version_id) {
            return Err(format!("版本不属于该身份: {head_version_id}"));
        }
        let now = chrono_like_now();
        let affected = self
            .conn
            .execute(
                "UPDATE identities SET head_version_id = ?3, updated_at = ?4
                 WHERE package_id = ?1 AND id = ?2",
                params![package_id, identity_id, head_version_id, now],
            )
            .map_err(|e| format!("设置 head 失败: {e}"))?;
        if affected == 0 {
            return Err(format!("身份不存在: {identity_id}"));
        }
        Ok(())
    }
}

fn chrono_like_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{secs}")
}
