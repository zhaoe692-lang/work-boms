use std::collections::BTreeSet;
use std::path::PathBuf;

use rusqlite::{params, params_from_iter, types::Value};

use crate::models::{TrashItem, TrashQuery};
use crate::store::Store;

impl Store {
    pub fn soft_delete_artifacts(
        &self,
        package_id: &str,
        artifact_ids: &[String],
        deleted_by: Option<&str>,
        now: i64,
        expires_at: i64,
    ) -> Result<usize, String> {
        if artifact_ids.is_empty() {
            return Ok(0);
        }
        let tx = self.conn.unchecked_transaction().map_err(|e| e.to_string())?;
        let mut affected = 0;
        for artifact_id in artifact_ids {
            affected += tx
                .execute(
                    "UPDATE artifacts
                     SET deleted_at = ?3, delete_expires_at = ?4, deleted_by = ?5
                     WHERE package_id = ?1 AND id = ?2 AND deleted_at IS NULL",
                    params![package_id, artifact_id, now, expires_at, deleted_by],
                )
                .map_err(|e| format!("移入回收站失败: {e}"))?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(affected)
    }

    pub fn restore_artifacts(&self, keys: &[(String, String)]) -> Result<usize, String> {
        let tx = self.conn.unchecked_transaction().map_err(|e| e.to_string())?;
        let mut affected = 0;
        for (package_id, artifact_id) in keys {
            affected += tx
                .execute(
                    "UPDATE artifacts
                     SET deleted_at = NULL, delete_expires_at = NULL, deleted_by = NULL
                     WHERE package_id = ?1 AND id = ?2 AND deleted_at IS NOT NULL",
                    params![package_id, artifact_id],
                )
                .map_err(|e| format!("恢复资产失败: {e}"))?;
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok(affected)
    }

    pub fn list_trash(&self, query: &TrashQuery) -> Result<Vec<TrashItem>, String> {
        let mut sql = String::from(
            "SELECT a.package_id, p.title, a.id, a.display_name, a.kind,
                    a.file_path, a.file_path_kind, p.project_root,
                    a.deleted_at, a.delete_expires_at, a.deleted_by
             FROM artifacts a JOIN packages p ON p.id = a.package_id
             WHERE a.deleted_at IS NOT NULL",
        );
        let mut values: Vec<Value> = Vec::new();
        if let Some(package_id) = query.package_id.as_deref() {
            sql.push_str(" AND a.package_id = ?");
            values.push(Value::Text(package_id.to_string()));
        }
        if let Some(kinds) = query.kinds.as_ref().filter(|items| !items.is_empty()) {
            sql.push_str(&format!(" AND a.kind IN ({})", vec!["?"; kinds.len()].join(",")));
            values.extend(kinds.iter().cloned().map(Value::Text));
        }
        if let Some(text) = query.text.as_deref().map(str::trim).filter(|text| !text.is_empty()) {
            sql.push_str(" AND (a.display_name LIKE ? ESCAPE '\\' OR p.title LIKE ? ESCAPE '\\')");
            let pattern = format!("%{}%", text.replace('%', "\\%").replace('_', "\\_"));
            values.push(Value::Text(pattern.clone()));
            values.push(Value::Text(pattern));
        }
        sql.push_str(" ORDER BY a.deleted_at DESC LIMIT ? OFFSET ?");
        values.push(Value::Integer(query.limit.unwrap_or(200).min(500) as i64));
        values.push(Value::Integer(query.offset.unwrap_or(0) as i64));

        let mut stmt = self.conn.prepare(&sql).map_err(|e| e.to_string())?;
        let items = stmt.query_map(params_from_iter(values), |row| {
            let file_path: String = row.get(5)?;
            let path_kind: String = row.get(6)?;
            let project_root: Option<String> = row.get(7)?;
            let absolute = if path_kind == "relative" {
                project_root.map(PathBuf::from).unwrap_or_default().join(file_path)
            } else {
                PathBuf::from(file_path)
            };
            Ok(TrashItem {
                package_id: row.get(0)?,
                package_title: row.get(1)?,
                artifact_id: row.get(2)?,
                display_name: row.get(3)?,
                kind: row.get(4)?,
                size_bytes: std::fs::metadata(absolute).ok().map(|metadata| metadata.len() as i64),
                deleted_at: row.get(8)?,
                expires_at: row.get(9)?,
                deleted_by: row.get(10)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
        Ok(items)
    }

    pub fn permanently_delete_artifacts(
        &self,
        keys: &[(String, String)],
    ) -> Result<(usize, Vec<String>), String> {
        let tx = self.conn.unchecked_transaction().map_err(|e| e.to_string())?;
        let mut packages = BTreeSet::new();
        let mut affected = 0;
        for (package_id, artifact_id) in keys {
            let deleted: i64 = tx
                .query_row(
                    "SELECT COUNT(*) FROM artifacts
                     WHERE package_id = ?1 AND id = ?2 AND deleted_at IS NOT NULL",
                    params![package_id, artifact_id],
                    |row| row.get(0),
                )
                .map_err(|e| e.to_string())?;
            if deleted == 0 {
                continue;
            }
            packages.insert(package_id.clone());
            tx.execute("DELETE FROM artifact_tags WHERE package_id = ?1 AND artifact_id = ?2", params![package_id, artifact_id]).map_err(|e| e.to_string())?;
            tx.execute("DELETE FROM work_artifacts WHERE package_id = ?1 AND artifact_id = ?2", params![package_id, artifact_id]).map_err(|e| e.to_string())?;
            tx.execute("DELETE FROM identity_versions WHERE package_id = ?1 AND artifact_id = ?2", params![package_id, artifact_id]).map_err(|e| e.to_string())?;
            tx.execute("DELETE FROM relations WHERE package_id = ?1 AND (from_id = ?2 OR to_id = ?2)", params![package_id, artifact_id]).map_err(|e| e.to_string())?;
            affected += tx.execute("DELETE FROM artifacts WHERE package_id = ?1 AND id = ?2", params![package_id, artifact_id]).map_err(|e| e.to_string())?;
        }
        for package_id in &packages {
            tx.execute(
                "DELETE FROM identities WHERE package_id = ?1 AND NOT EXISTS (
                    SELECT 1 FROM identity_versions v
                    WHERE v.package_id = identities.package_id AND v.identity_id = identities.id
                 )",
                params![package_id],
            )
            .map_err(|e| e.to_string())?;
            let identities: Vec<(String, String)> = {
                let mut stmt = tx
                    .prepare("SELECT id, head_version_id FROM identities WHERE package_id = ?1")
                    .map_err(|e| e.to_string())?;
                let rows = stmt.query_map(params![package_id], |row| Ok((row.get(0)?, row.get(1)?)))
                    .map_err(|e| e.to_string())?
                    .collect::<Result<Vec<_>, _>>()
                    .map_err(|e| e.to_string())?;
                rows
            };
            for (identity_id, head_id) in identities {
                let head_exists: i64 = tx
                    .query_row(
                        "SELECT COUNT(*) FROM identity_versions
                         WHERE package_id = ?1 AND identity_id = ?2 AND artifact_id = ?3",
                        params![package_id, identity_id, head_id],
                        |row| row.get(0),
                    )
                    .unwrap_or(0);
                if head_exists == 0 {
                    let replacement: Option<String> = tx
                        .query_row(
                            "SELECT artifact_id FROM identity_versions
                             WHERE package_id = ?1 AND identity_id = ?2
                             ORDER BY order_index DESC LIMIT 1",
                            params![package_id, identity_id],
                            |row| row.get(0),
                        )
                        .ok();
                    if let Some(replacement) = replacement {
                        tx.execute(
                            "UPDATE identities SET head_version_id = ?3 WHERE package_id = ?1 AND id = ?2",
                            params![package_id, identity_id, replacement],
                        )
                        .map_err(|e| e.to_string())?;
                    }
                }
            }
        }
        tx.commit().map_err(|e| e.to_string())?;
        Ok((affected, packages.into_iter().collect()))
    }

    pub fn purge_expired_trash(&self, now: i64) -> Result<Vec<String>, String> {
        let keys: Vec<(String, String)> = {
            let mut stmt = self
                .conn
                .prepare(
                    "SELECT package_id, id FROM artifacts
                     WHERE deleted_at IS NOT NULL AND delete_expires_at <= ?1",
                )
                .map_err(|e| e.to_string())?;
            let rows = stmt.query_map(params![now], |row| Ok((row.get(0)?, row.get(1)?)))
                .map_err(|e| e.to_string())?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?;
            rows
        };
        self.permanently_delete_artifacts(&keys).map(|(_, packages)| packages)
    }

    pub fn all_deleted_artifact_keys(&self) -> Result<Vec<(String, String)>, String> {
        let mut stmt = self.conn.prepare(
            "SELECT package_id, id FROM artifacts WHERE deleted_at IS NOT NULL",
        ).map_err(|e| e.to_string())?;
        let keys = stmt.query_map([], |row| Ok((row.get(0)?, row.get(1)?)))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(keys)
    }

    pub fn count_active_artifacts(&self, package_id: &str) -> Result<usize, String> {
        self.conn
            .query_row(
                "SELECT COUNT(*) FROM artifacts
                 WHERE package_id = ?1 AND deleted_at IS NULL",
                params![package_id],
                |row| row.get::<_, i64>(0),
            )
            .map(|n| n as usize)
            .map_err(|e| e.to_string())
    }

    pub fn count_trashed_artifacts(&self, package_id: &str) -> Result<usize, String> {
        self.conn
            .query_row(
                "SELECT COUNT(*) FROM artifacts
                 WHERE package_id = ?1 AND deleted_at IS NOT NULL",
                params![package_id],
                |row| row.get::<_, i64>(0),
            )
            .map(|n| n as usize)
            .map_err(|e| e.to_string())
    }

}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_store() -> (Store, PathBuf) {
        let dir = std::env::temp_dir().join(format!(
            "workboms-trash-{}",
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()
        ));
        let store = Store::open(&dir).unwrap();
        store.conn.execute(
            "INSERT INTO packages (id, schema_version, title, slug, created_at, imported_at)
             VALUES ('p1', '2.0', '测试项目', 'test', '1', '1')", [],
        ).unwrap();
        store.conn.execute(
            "INSERT INTO artifacts
             (package_id, id, order_index, display_name, kind, status, file_path,
              file_path_kind, created_at, updated_at)
             VALUES ('p1', 'a1', 0, '雨夜站台', 'markdown', 'draft', '/missing',
                     'absolute', '1', '1')", [],
        ).unwrap();
        (store, dir)
    }

    #[test]
    fn soft_delete_restore_and_permanent_delete_are_consistent() {
        let (store, dir) = test_store();
        assert_eq!(store.soft_delete_artifacts("p1", &["a1".into()], Some("tester"), 10, 20).unwrap(), 1);
        assert!(store.load_manifest("p1").unwrap().artifacts.is_empty());
        assert_eq!(store.list_trash(&TrashQuery::default()).unwrap().len(), 1);
        assert_eq!(store.restore_artifacts(&[("p1".into(), "a1".into())]).unwrap(), 1);
        assert_eq!(store.load_manifest("p1").unwrap().artifacts.len(), 1);
        store.soft_delete_artifacts("p1", &["a1".into()], None, 10, 20).unwrap();
        let (affected, _) = store.permanently_delete_artifacts(&[("p1".into(), "a1".into())]).unwrap();
        assert_eq!(affected, 1);
        assert!(store.list_trash(&TrashQuery::default()).unwrap().is_empty());
        drop(store);
        let _ = std::fs::remove_dir_all(dir);
    }
}
