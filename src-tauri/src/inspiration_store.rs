use std::collections::HashSet;

use rusqlite::{params, OptionalExtension};

use crate::models::{
    InspirationBoard, InspirationBoardItem, InspirationBoardLink, InspirationBoardSummary,
};
use crate::store::Store;

impl Store {
    pub fn list_inspiration_boards(
        &self,
        package_id: Option<&str>,
    ) -> Result<Vec<InspirationBoardSummary>, String> {
        let mut stmt = self
            .conn
            .prepare(
                "SELECT b.id, b.package_id, b.title, COUNT(i.id), b.updated_at, b.version
                 FROM inspiration_boards b
                 LEFT JOIN inspiration_board_items i ON i.board_id = b.id
                 WHERE (?1 IS NULL OR b.package_id = ?1)
                 GROUP BY b.id
                 ORDER BY b.updated_at DESC",
            )
            .map_err(|e| format!("读取灵感板失败: {e}"))?;
        let boards = stmt.query_map(params![package_id], |row| {
            Ok(InspirationBoardSummary {
                id: row.get(0)?,
                package_id: row.get(1)?,
                title: row.get(2)?,
                item_count: row.get::<_, i64>(3)? as usize,
                updated_at: row.get(4)?,
                version: row.get(5)?,
            })
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
        Ok(boards)
    }

    pub fn create_inspiration_board(
        &self,
        id: &str,
        package_id: Option<&str>,
        title: &str,
        now: i64,
    ) -> Result<InspirationBoard, String> {
        let title = validate_title(title)?;
        if let Some(package_id) = package_id {
            if !self.package_exists(package_id)? {
                return Err(format!("成果包不存在: {package_id}"));
            }
        }
        self.conn
            .execute(
                "INSERT INTO inspiration_boards
                    (id, package_id, title, zoom, pan_x, pan_y, version, created_at, updated_at)
                 VALUES (?1, ?2, ?3, 1.0, 0, 0, 1, ?4, ?4)",
                params![id, package_id, title, now],
            )
            .map_err(|e| format!("创建灵感板失败: {e}"))?;
        self.load_inspiration_board(id)
    }

    pub fn load_inspiration_board(&self, board_id: &str) -> Result<InspirationBoard, String> {
        let mut board = self
            .conn
            .query_row(
                "SELECT id, package_id, title, zoom, pan_x, pan_y, version, created_at, updated_at
                 FROM inspiration_boards WHERE id = ?1",
                params![board_id],
                |row| {
                    Ok(InspirationBoard {
                        id: row.get(0)?,
                        package_id: row.get(1)?,
                        title: row.get(2)?,
                        zoom: row.get(3)?,
                        pan_x: row.get(4)?,
                        pan_y: row.get(5)?,
                        version: row.get(6)?,
                        created_at: row.get(7)?,
                        updated_at: row.get(8)?,
                        items: Vec::new(),
                        links: Vec::new(),
                    })
                },
            )
            .optional()
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("灵感板不存在: {board_id}"))?;

        let mut item_stmt = self
            .conn
            .prepare(
                "SELECT id, kind, title, note, artifact_package_id, artifact_id,
                        x, y, width, height, rotation, z_index, color
                 FROM inspiration_board_items WHERE board_id = ?1 ORDER BY z_index, rowid",
            )
            .map_err(|e| e.to_string())?;
        board.items = item_stmt
            .query_map(params![board_id], |row| {
                Ok(InspirationBoardItem {
                    id: row.get(0)?,
                    kind: row.get(1)?,
                    title: row.get(2)?,
                    note: row.get(3)?,
                    artifact_package_id: row.get(4)?,
                    artifact_id: row.get(5)?,
                    x: row.get(6)?,
                    y: row.get(7)?,
                    width: row.get(8)?,
                    height: row.get(9)?,
                    rotation: row.get(10)?,
                    z_index: row.get(11)?,
                    color: row.get(12)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        let mut link_stmt = self
            .conn
            .prepare(
                "SELECT id, from_item_id, to_item_id, kind, label
                 FROM inspiration_board_links WHERE board_id = ?1 ORDER BY rowid",
            )
            .map_err(|e| e.to_string())?;
        board.links = link_stmt
            .query_map(params![board_id], |row| {
                Ok(InspirationBoardLink {
                    id: row.get(0)?,
                    from_item_id: row.get(1)?,
                    to_item_id: row.get(2)?,
                    kind: row.get(3)?,
                    label: row.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(board)
    }

    pub fn save_inspiration_board(
        &self,
        board: &InspirationBoard,
        expected_version: i64,
        now: i64,
    ) -> Result<InspirationBoard, String> {
        validate_board(board)?;
        let tx = self
            .conn
            .unchecked_transaction()
            .map_err(|e| format!("灵感板事务开启失败: {e}"))?;
        let affected = tx
            .execute(
                "UPDATE inspiration_boards
                 SET title = ?2, package_id = ?3, zoom = ?4, pan_x = ?5, pan_y = ?6,
                     version = version + 1, updated_at = ?7
                 WHERE id = ?1 AND version = ?8",
                params![
                    board.id,
                    board.title.trim(),
                    board.package_id,
                    board.zoom,
                    board.pan_x,
                    board.pan_y,
                    now,
                    expected_version,
                ],
            )
            .map_err(|e| format!("保存灵感板失败: {e}"))?;
        if affected == 0 {
            return Err("灵感板已在其他窗口修改，请刷新后重试".to_string());
        }
        tx.execute(
            "DELETE FROM inspiration_board_links WHERE board_id = ?1",
            params![board.id],
        )
        .map_err(|e| e.to_string())?;
        tx.execute(
            "DELETE FROM inspiration_board_items WHERE board_id = ?1",
            params![board.id],
        )
        .map_err(|e| e.to_string())?;
        for item in &board.items {
            tx.execute(
                "INSERT INTO inspiration_board_items
                    (board_id, id, kind, title, note, artifact_package_id, artifact_id,
                     x, y, width, height, rotation, z_index, color)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
                params![
                    board.id,
                    item.id,
                    item.kind,
                    item.title,
                    item.note,
                    item.artifact_package_id,
                    item.artifact_id,
                    item.x,
                    item.y,
                    item.width,
                    item.height,
                    item.rotation,
                    item.z_index,
                    item.color,
                ],
            )
            .map_err(|e| format!("保存灵感卡片失败: {e}"))?;
        }
        for link in &board.links {
            tx.execute(
                "INSERT INTO inspiration_board_links
                    (board_id, id, from_item_id, to_item_id, kind, label)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![
                    board.id,
                    link.id,
                    link.from_item_id,
                    link.to_item_id,
                    link.kind,
                    link.label,
                ],
            )
            .map_err(|e| format!("保存灵感板连线失败: {e}"))?;
        }
        tx.commit().map_err(|e| format!("提交灵感板失败: {e}"))?;
        self.load_inspiration_board(&board.id)
    }

    pub fn delete_inspiration_board(&self, board_id: &str) -> Result<(), String> {
        let affected = self
            .conn
            .execute("DELETE FROM inspiration_boards WHERE id = ?1", params![board_id])
            .map_err(|e| format!("删除灵感板失败: {e}"))?;
        if affected == 0 {
            return Err(format!("灵感板不存在: {board_id}"));
        }
        Ok(())
    }
}

fn validate_title(title: &str) -> Result<&str, String> {
    let title = title.trim();
    if title.is_empty() {
        return Err("灵感板标题不能为空".to_string());
    }
    if title.chars().count() > 200 {
        return Err("灵感板标题不能超过 200 个字符".to_string());
    }
    Ok(title)
}

fn validate_board(board: &InspirationBoard) -> Result<(), String> {
    validate_title(&board.title)?;
    if !(0.25..=4.0).contains(&board.zoom) || !board.pan_x.is_finite() || !board.pan_y.is_finite() {
        return Err("灵感板视图参数无效".to_string());
    }
    if board.items.len() > 2_000 || board.links.len() > 5_000 {
        return Err("灵感板内容超过容量限制".to_string());
    }
    let mut ids = HashSet::new();
    for item in &board.items {
        if !ids.insert(&item.id) {
            return Err(format!("灵感卡片 ID 重复: {}", item.id));
        }
        if item.id.trim().is_empty()
            || item.title.chars().count() > 500
            || !item.x.is_finite()
            || !item.y.is_finite()
            || !item.width.is_finite()
            || !item.height.is_finite()
            || !item.rotation.is_finite()
            || item.width <= 0.0
            || item.height <= 0.0
        {
            return Err(format!("灵感卡片数据无效: {}", item.id));
        }
        if item.artifact_id.is_some() != item.artifact_package_id.is_some() {
            return Err(format!("灵感卡片资产引用不完整: {}", item.id));
        }
    }
    let mut link_ids = HashSet::new();
    for link in &board.links {
        if !link_ids.insert(&link.id)
            || !ids.contains(&link.from_item_id)
            || !ids.contains(&link.to_item_id)
            || link.from_item_id == link.to_item_id
        {
            return Err(format!("灵感板连线无效: {}", link.id));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_dangling_board_links() {
        let board = InspirationBoard {
            id: "b".into(), package_id: None, title: "Board".into(), zoom: 1.0,
            pan_x: 0.0, pan_y: 0.0, version: 1, created_at: 0, updated_at: 0,
            items: vec![],
            links: vec![InspirationBoardLink { id: "l".into(), from_item_id: "a".into(), to_item_id: "b".into(), kind: "line".into(), label: None }],
        };
        assert!(validate_board(&board).is_err());
    }
}
