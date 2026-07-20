use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use fastembed::{
    InitOptionsUserDefined, Pooling, QuantizationMode, TextEmbedding, TokenizerFiles,
    UserDefinedEmbeddingModel,
};
use rusqlite::{params, Connection};

use crate::models::{Artifact, PackageManifest};

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchHit {
    pub package_id: String,
    pub package_title: String,
    pub artifact_id: String,
    pub display_name: String,
    pub summary: Option<String>,
    pub snippet: Option<String>,
    pub rank: f64,
    pub kind: String,
    pub status: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchRequest {
    pub query: String,
    #[serde(default)]
    pub package_ids: Vec<String>,
    #[serde(default)]
    pub kinds: Vec<String>,
    #[serde(default)]
    pub statuses: Vec<String>,
    pub sort: Option<String>,
    pub limit: Option<usize>,
    pub offset: Option<usize>,
}

#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResponse {
    pub items: Vec<SearchHit>,
    pub total: usize,
    pub limit: usize,
    pub offset: usize,
    pub mode: String,
    pub semantic_error: Option<String>,
}

pub struct SearchIndex {
    conn: Connection,
    needs_reindex: bool,
    model_cache_dir: PathBuf,
}

const EMBEDDING_MODEL_ID: &str = "Xenova/bge-small-zh-v1.5-int8@75c43b0";
static EMBEDDING_MODEL: Mutex<Option<TextEmbedding>> = Mutex::new(None);

impl SearchIndex {
    #[allow(dead_code)]
    pub fn open(db_path: &Path) -> Result<Self, String> {
        let model_dir = db_path.parent().unwrap_or_else(|| Path::new(".")).join("models/bge-small-zh-v1.5-int8");
        Self::open_with_model_dir(db_path, model_dir)
    }

    pub fn open_with_model_dir(db_path: &Path, model_cache_dir: PathBuf) -> Result<Self, String> {
        if let Some(parent) = db_path.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("无法创建索引目录: {e}"))?;
        }
        let conn = Connection::open(db_path).map_err(|e| format!("无法打开搜索索引: {e}"))?;
        let mut index = Self { conn, needs_reindex: false, model_cache_dir };
        index.needs_reindex = index.init_schema()?;
        Ok(index)
    }

    fn init_schema(&self) -> Result<bool, String> {
        self.conn
            .execute_batch(
                "
                CREATE TABLE IF NOT EXISTS artifacts (
                    package_id TEXT NOT NULL,
                    package_title TEXT NOT NULL,
                    artifact_id TEXT NOT NULL,
                    display_name TEXT NOT NULL,
                    summary TEXT,
                    tags TEXT,
                    content TEXT,
                    search_meta TEXT NOT NULL DEFAULT '',
                    kind TEXT NOT NULL DEFAULT 'other',
                    status TEXT NOT NULL DEFAULT 'draft',
                    updated_at TEXT NOT NULL DEFAULT '',
                    embedding BLOB,
                    embedding_model TEXT,
                    embedding_hash TEXT,
                    PRIMARY KEY (package_id, artifact_id)
                );
                CREATE VIRTUAL TABLE IF NOT EXISTS artifacts_fts USING fts5(
                    package_id UNINDEXED,
                    package_title,
                    artifact_id UNINDEXED,
                    display_name,
                    summary,
                    tags,
                    content,
                    search_meta,
                    tokenize = 'unicode61'
                );
                CREATE VIRTUAL TABLE IF NOT EXISTS artifacts_trigram USING fts5(
                    package_id UNINDEXED,
                    package_title,
                    artifact_id UNINDEXED,
                    display_name,
                    summary,
                    tags,
                    content,
                    search_meta,
                    tokenize = 'trigram'
                );
                ",
            )
            .map_err(|e| format!("无法初始化搜索索引: {e}"))?;
        let mut needs_reindex = self.ensure_column("kind", "TEXT NOT NULL DEFAULT 'other'")?
            | self.ensure_column("status", "TEXT NOT NULL DEFAULT 'draft'")?
            | self.ensure_column("updated_at", "TEXT NOT NULL DEFAULT ''")?
            | self.ensure_column("search_meta", "TEXT NOT NULL DEFAULT ''")?;
        self.ensure_column("embedding", "BLOB")?;
        self.ensure_column("embedding_model", "TEXT")?;
        self.ensure_column("embedding_hash", "TEXT")?;
        if !self.fts_has_column("artifacts_fts", "search_meta")?
            || !self.fts_has_column("artifacts_trigram", "search_meta")?
        {
            self.conn.execute_batch(
                "DROP TABLE IF EXISTS artifacts_fts;
                 DROP TABLE IF EXISTS artifacts_trigram;
                 CREATE VIRTUAL TABLE artifacts_fts USING fts5(
                    package_id UNINDEXED, package_title, artifact_id UNINDEXED,
                    display_name, summary, tags, content, search_meta,
                    tokenize = 'unicode61'
                 );
                 CREATE VIRTUAL TABLE artifacts_trigram USING fts5(
                    package_id UNINDEXED, package_title, artifact_id UNINDEXED,
                    display_name, summary, tags, content, search_meta,
                    tokenize = 'trigram'
                 );"
            ).map_err(|e| format!("升级搜索元数据索引失败: {e}"))?;
            needs_reindex = true;
        }
        let trigram_count: i64 = self.conn.query_row(
            "SELECT COUNT(*) FROM artifacts_trigram", [], |row| row.get(0),
        ).unwrap_or(0);
        if trigram_count == 0 {
            self.conn.execute(
                "INSERT INTO artifacts_trigram
                 (package_id, package_title, artifact_id, display_name, summary, tags, content, search_meta)
                 SELECT package_id, package_title, artifact_id, display_name, summary, tags, content, search_meta
                 FROM artifacts",
                [],
            ).map_err(|e| format!("迁移模糊搜索索引失败: {e}"))?;
        }
        Ok(needs_reindex)
    }

    fn ensure_column(&self, column: &str, definition: &str) -> Result<bool, String> {
        let mut stmt = self.conn.prepare("PRAGMA table_info(artifacts)").map_err(|e| e.to_string())?;
        let columns = stmt.query_map([], |row| row.get::<_, String>(1)).map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
        if !columns.iter().any(|name| name == column) {
            self.conn.execute(&format!("ALTER TABLE artifacts ADD COLUMN {column} {definition}"), [])
                .map_err(|e| format!("搜索索引迁移失败: {e}"))?;
            return Ok(true);
        }
        Ok(false)
    }

    fn fts_has_column(&self, table: &str, column: &str) -> Result<bool, String> {
        let mut stmt = self.conn.prepare(&format!("PRAGMA table_info({table})"))
            .map_err(|e| e.to_string())?;
        let columns = stmt.query_map([], |row| row.get::<_, String>(1))
            .map_err(|e| e.to_string())?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;
        Ok(columns.iter().any(|name| name == column))
    }

    pub fn needs_reindex(&self) -> bool { self.needs_reindex }

    pub fn clear_package(&self, package_id: &str) -> Result<(), String> {
        self.conn
            .execute(
                "DELETE FROM artifacts WHERE package_id = ?1",
                params![package_id],
            )
            .map_err(|e| format!("清除索引失败: {e}"))?;
        self.conn
            .execute(
                "DELETE FROM artifacts_fts WHERE package_id = ?1",
                params![package_id],
            )
            .map_err(|e| format!("清除 FTS 失败: {e}"))?;
        self.conn
            .execute("DELETE FROM artifacts_trigram WHERE package_id = ?1", params![package_id])
            .map_err(|e| format!("清除模糊索引失败: {e}"))?;
        Ok(())
    }

    /// Status-only patch — avoids wiping/rebuilding the whole package FTS index.
    pub fn update_artifact_status(
        &self,
        package_id: &str,
        artifact_id: &str,
        status: &str,
    ) -> Result<(), String> {
        let affected = self
            .conn
            .execute(
                "UPDATE artifacts SET status = ?3, embedding_hash = NULL
                 WHERE package_id = ?1 AND artifact_id = ?2",
                params![package_id, artifact_id, status],
            )
            .map_err(|e| format!("更新索引状态失败: {e}"))?;
        if affected == 0 {
            // Index may be cold; caller can fall back to full reindex if needed.
            return Ok(());
        }
        Ok(())
    }

    pub fn update_artifacts_status(
        &self,
        package_id: &str,
        artifact_ids: &[String],
        status: &str,
    ) -> Result<(), String> {
        for artifact_id in artifact_ids {
            self.update_artifact_status(package_id, artifact_id, status)?;
        }
        Ok(())
    }

    pub fn index_package(
        &self,
        manifest: &PackageManifest,
        contents: &[(String, Option<String>)],
    ) -> Result<(), String> {
        self.clear_package(&manifest.id)?;
        let tx = self
            .conn
            .unchecked_transaction()
            .map_err(|e| format!("索引事务失败: {e}"))?;

        for artifact in &manifest.artifacts {
            let content = contents
                .iter()
                .find(|(id, _)| id == &artifact.id)
                .and_then(|(_, body)| body.clone())
                .unwrap_or_default();
            let tags = artifact.tags.as_ref().map(|t| t.join(" ")).unwrap_or_default();
            let summary = artifact.summary.clone().unwrap_or_default();
            let search_meta = artifact_search_metadata(artifact);

            tx.execute(
                "INSERT INTO artifacts (package_id, package_title, artifact_id, display_name, summary, tags, content, search_meta, kind, status, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
                params![
                    manifest.id,
                    manifest.title,
                    artifact.id,
                    artifact.display_name,
                    summary,
                    tags,
                    content,
                    search_meta,
                    artifact.kind,
                    artifact.status,
                    artifact.updated_at,
                ],
            )
            .map_err(|e| format!("写入索引失败: {e}"))?;

            tx.execute(
                "INSERT INTO artifacts_fts (package_id, package_title, artifact_id, display_name, summary, tags, content, search_meta)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![
                    manifest.id,
                    manifest.title,
                    artifact.id,
                    artifact.display_name,
                    summary,
                    tags,
                    content,
                    search_meta,
                ],
            )
            .map_err(|e| format!("写入 FTS 失败: {e}"))?;

            tx.execute(
                "INSERT INTO artifacts_trigram (package_id, package_title, artifact_id, display_name, summary, tags, content, search_meta)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                params![manifest.id, manifest.title, artifact.id, artifact.display_name, summary, tags, content, search_meta],
            )
            .map_err(|e| format!("写入模糊索引失败: {e}"))?;
        }

        tx.commit().map_err(|e| format!("提交索引失败: {e}"))
    }

    pub fn search(&self, query: &str, limit: usize) -> Result<Vec<SearchHit>, String> {
        let trimmed = query.trim();
        if trimmed.is_empty() {
            return Ok(Vec::new());
        }

        let compact_len = trimmed.chars().filter(|c| !c.is_whitespace()).count();
        let contains_cjk = trimmed.chars().any(|c| ('\u{4e00}'..='\u{9fff}').contains(&c));
        if contains_cjk && compact_len < 3 {
            return self.search_substring(trimmed, limit);
        }

        let use_trigram = compact_len >= 3 && contains_cjk;
        let fts_query = if use_trigram { build_trigram_query(trimmed) } else { build_fts_query(trimmed) };
        let table = if use_trigram { "artifacts_trigram" } else { "artifacts_fts" };
        let sql = format!("
            SELECT
                f.package_id,
                f.package_title,
                f.artifact_id,
                f.display_name,
                f.summary,
                snippet({table}, 6, '<b>', '</b>', '…', 24) AS snippet,
                bm25({table}, 6.0, 1.0, 8.0, 4.0, 2.0, 0.5, 0.2, 1.5) AS rank,
                a.kind, a.status, a.updated_at
            FROM {table} f
            JOIN artifacts a ON a.package_id = f.package_id AND a.artifact_id = f.artifact_id
            WHERE {table} MATCH ?1
            ORDER BY rank
            LIMIT ?2
        ");

        let mut stmt = self
            .conn
            .prepare(&sql)
            .map_err(|e| format!("搜索准备失败: {e}"))?;

        let hits = stmt
            .query_map(params![fts_query, limit as i64], |row| {
                Ok(SearchHit {
                    package_id: row.get(0)?,
                    package_title: row.get(1)?,
                    artifact_id: row.get(2)?,
                    display_name: row.get(3)?,
                    summary: row.get(4)?,
                    snippet: row.get(5)?,
                    rank: row.get(6)?,
                    kind: row.get(7)?,
                    status: row.get(8)?,
                    updated_at: row.get(9)?,
                })
            })
            .map_err(|e| format!("搜索失败: {e}"))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| format!("读取搜索结果失败: {e}"))?;

        Ok(hits)
    }

    fn search_substring(&self, query: &str, limit: usize) -> Result<Vec<SearchHit>, String> {
        let escaped = query.replace('\\', "\\\\").replace('%', "\\%").replace('_', "\\_");
        let pattern = format!("%{escaped}%");
        let mut stmt = self.conn.prepare(
            "SELECT package_id, package_title, artifact_id, display_name, summary,
                    CASE
                      WHEN display_name LIKE ?1 ESCAPE '\\' THEN display_name
                      WHEN summary LIKE ?1 ESCAPE '\\' THEN summary
                      WHEN tags LIKE ?1 ESCAPE '\\' THEN tags
                      WHEN search_meta LIKE ?1 ESCAPE '\\' THEN search_meta
                      ELSE substr(content, 1, 160)
                    END AS snippet,
                    CASE
                      WHEN display_name LIKE ?1 ESCAPE '\\' THEN 0.0
                      WHEN tags LIKE ?1 ESCAPE '\\' THEN 1.0
                      WHEN summary LIKE ?1 ESCAPE '\\' THEN 2.0
                      WHEN search_meta LIKE ?1 ESCAPE '\\' THEN 3.0
                      ELSE 4.0
                    END AS rank,
                    kind, status, updated_at
             FROM artifacts
             WHERE package_title LIKE ?1 ESCAPE '\\'
                OR display_name LIKE ?1 ESCAPE '\\'
                OR summary LIKE ?1 ESCAPE '\\'
                OR tags LIKE ?1 ESCAPE '\\'
                OR search_meta LIKE ?1 ESCAPE '\\'
                OR content LIKE ?1 ESCAPE '\\'
             ORDER BY rank, updated_at DESC
             LIMIT ?2"
        ).map_err(|e| format!("短词检索准备失败: {e}"))?;
        let hits = stmt.query_map(params![pattern, limit.clamp(1, 500) as i64], |row| {
            Ok(SearchHit {
                package_id: row.get(0)?, package_title: row.get(1)?, artifact_id: row.get(2)?,
                display_name: row.get(3)?, summary: row.get(4)?, snippet: row.get(5)?, rank: row.get(6)?,
                kind: row.get(7)?, status: row.get(8)?, updated_at: row.get(9)?,
            })
        }).map_err(|e| format!("短词检索失败: {e}"))?
          .collect::<Result<Vec<_>, _>>()
          .map_err(|e| format!("读取短词检索结果失败: {e}"))?;
        Ok(hits)
    }

    pub fn search_assets(&self, request: &SearchRequest) -> Result<SearchResponse, String> {
        let limit = request.limit.unwrap_or(40).clamp(1, 100);
        let offset = request.offset.unwrap_or(0).min(10_000);
        let lexical = self.search(&request.query, 500)?;
        let use_semantic = should_use_semantic_search(&request.query);
        let (semantic, semantic_error) = if use_semantic {
            match self.semantic_search(&request.query, 500) {
                Ok(items) => (items, None),
                Err(error) => (Vec::new(), Some(error)),
            }
        } else {
            (Vec::new(), None)
        };
        let has_semantic = !semantic.is_empty();
        let mut scores: HashMap<(String, String), (SearchHit, f64)> = HashMap::new();
        for (position, hit) in lexical.into_iter().enumerate() {
            let key = (hit.package_id.clone(), hit.artifact_id.clone());
            scores.insert(key, (hit, 0.55 / (60.0 + position as f64)));
        }
        for (position, hit) in semantic.into_iter().enumerate() {
            let key = (hit.package_id.clone(), hit.artifact_id.clone());
            let contribution = 0.45 / (60.0 + position as f64);
            scores.entry(key).and_modify(|(_, score)| *score += contribution).or_insert((hit, contribution));
        }
        let mut items: Vec<SearchHit> = scores.into_values().map(|(mut hit, score)| {
            hit.rank = -score;
            hit
        }).collect();
        items.sort_by(|a, b| a.rank.total_cmp(&b.rank));
        items.retain(|hit| {
            (request.package_ids.is_empty() || request.package_ids.contains(&hit.package_id))
                && (request.kinds.is_empty() || request.kinds.contains(&hit.kind))
                && (request.statuses.is_empty() || request.statuses.contains(&hit.status))
        });
        if request.sort.as_deref() == Some("updated") {
            items.sort_by(|a, b| {
                b.updated_at
                    .cmp(&a.updated_at)
                    .then_with(|| a.rank.total_cmp(&b.rank))
            });
        }
        let total = items.len();
        let items = items.into_iter().skip(offset).take(limit).collect();
        let mode = if use_semantic && semantic_error.is_none() && has_semantic {
            "hybrid"
        } else {
            "fulltext"
        };
        Ok(SearchResponse { items, total, limit, offset, mode: mode.into(), semantic_error })
    }

    fn semantic_search(&self, query: &str, limit: usize) -> Result<Vec<SearchHit>, String> {
        self.ensure_semantic_embeddings()?;
        let query_embedding = self.embed_texts(vec![format!("为这个句子生成表示以用于检索相关文章：{query}")])?
            .into_iter().next().ok_or_else(|| "语义模型未返回查询向量".to_string())?;
        let mut stmt = self.conn.prepare(
            "SELECT package_id, package_title, artifact_id, display_name, summary,
                    kind, status, updated_at, embedding
             FROM artifacts WHERE embedding_model = ?1 AND embedding IS NOT NULL"
        ).map_err(|e| format!("读取语义索引失败: {e}"))?;
        let mut hits: Vec<SearchHit> = stmt.query_map(params![EMBEDDING_MODEL_ID], |row| {
            let bytes: Vec<u8> = row.get(8)?;
            Ok((SearchHit {
                package_id: row.get(0)?, package_title: row.get(1)?, artifact_id: row.get(2)?,
                display_name: row.get(3)?, summary: row.get(4)?, snippet: None, rank: 0.0,
                kind: row.get(5)?, status: row.get(6)?, updated_at: row.get(7)?,
            }, bytes))
        }).map_err(|e| e.to_string())?
          .collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
          .into_iter().filter_map(|(mut hit, bytes)| {
              let vector = decode_vector(&bytes)?;
              hit.rank = -(cosine_similarity(&query_embedding, &vector) as f64);
              Some(hit)
          }).collect();
        hits.sort_by(|a, b| a.rank.total_cmp(&b.rank));
        hits.truncate(limit);
        Ok(hits)
    }

    fn ensure_semantic_embeddings(&self) -> Result<(), String> {
        let mut stmt = self.conn.prepare(
            "SELECT package_id, artifact_id, package_title, display_name, summary, tags, content,
                    search_meta, kind, status, embedding_model, embedding_hash
             FROM artifacts ORDER BY package_id, artifact_id"
        ).map_err(|e| format!("检查语义索引失败: {e}"))?;
        let rows = stmt.query_map([], |row| Ok((
            row.get::<_, String>(0)?, row.get::<_, String>(1)?, row.get::<_, String>(2)?,
            row.get::<_, String>(3)?, row.get::<_, Option<String>>(4)?.unwrap_or_default(),
            row.get::<_, Option<String>>(5)?.unwrap_or_default(), row.get::<_, Option<String>>(6)?.unwrap_or_default(),
            row.get::<_, String>(7)?, row.get::<_, String>(8)?, row.get::<_, String>(9)?,
            row.get::<_, Option<String>>(10)?, row.get::<_, Option<String>>(11)?,
        ))).map_err(|e| e.to_string())?.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?;
        drop(stmt);
        let mut pending = Vec::new();
        for (package_id, artifact_id, package_title, display_name, summary, tags, content, search_meta, kind, status, model, stored_hash) in rows {
            let source = semantic_source(
                &package_title, &display_name, &summary, &tags, &content,
                &search_meta, &kind, &status,
            );
            let hash = text_hash(&source);
            if model.as_deref() != Some(EMBEDDING_MODEL_ID) || stored_hash.as_deref() != Some(&hash) {
                pending.push((package_id, artifact_id, source, hash));
            }
        }
        for batch in pending.chunks(32) {
            let embeddings = self.embed_texts(batch.iter().map(|(_, _, text, _)| text.clone()).collect())?;
            if embeddings.len() != batch.len() { return Err("语义模型返回数量不一致".into()); }
            let tx = self.conn.unchecked_transaction().map_err(|e| format!("开启语义索引事务失败: {e}"))?;
            for ((package_id, artifact_id, _, hash), embedding) in batch.iter().zip(embeddings) {
                tx.execute(
                    "UPDATE artifacts SET embedding = ?3, embedding_model = ?4, embedding_hash = ?5
                     WHERE package_id = ?1 AND artifact_id = ?2",
                    params![package_id, artifact_id, encode_vector(&embedding), EMBEDDING_MODEL_ID, hash],
                ).map_err(|e| format!("保存语义索引失败: {e}"))?;
            }
            tx.commit().map_err(|e| format!("提交语义索引失败: {e}"))?;
        }
        Ok(())
    }

    fn embed_texts(&self, texts: Vec<String>) -> Result<Vec<Vec<f32>>, String> {
        let mut guard = EMBEDDING_MODEL.lock().map_err(|_| "语义模型锁已损坏".to_string())?;
        if guard.is_none() {
            let read = |name: &str| std::fs::read(self.model_cache_dir.join(name))
                .map_err(|e| format!("缺少本地语义模型文件 {name}: {e}"));
            let tokenizer_files = TokenizerFiles {
                tokenizer_file: read("tokenizer.json")?,
                config_file: read("config.json")?,
                special_tokens_map_file: read("special_tokens_map.json")?,
                tokenizer_config_file: read("tokenizer_config.json")?,
            };
            let model = UserDefinedEmbeddingModel::new(read("model_int8.onnx")?, tokenizer_files)
                .with_quantization(QuantizationMode::Dynamic)
                .with_pooling(Pooling::Cls);
            let options = InitOptionsUserDefined::new().with_max_length(512).with_intra_threads(4);
            *guard = Some(TextEmbedding::try_new_from_user_defined(model, options)
                .map_err(|e| format!("本地 INT8 语义模型加载失败: {e}"))?);
        }
        guard.as_mut().unwrap().embed(texts, Some(32)).map_err(|e| format!("生成语义向量失败: {e}"))
    }

    pub fn db_path(vault_path: &Path) -> PathBuf {
        vault_path.join("search.db")
    }
}

fn build_trigram_query(input: &str) -> String {
    let compact: Vec<char> = input.chars().filter(|c| !c.is_whitespace() && !c.is_ascii_punctuation()).collect();
    if compact.len() < 3 {
        return build_fts_query(input);
    }
    compact
        .windows(3)
        .take(24)
        .map(|window| format!("\"{}\"", window.iter().collect::<String>().replace('"', "\"\"")))
        .collect::<Vec<_>>()
        .join(" OR ")
}

fn semantic_source(
    package_title: &str,
    display_name: &str,
    summary: &str,
    tags: &str,
    content: &str,
    search_meta: &str,
    kind: &str,
    status: &str,
) -> String {
    let combined = format!(
        "项目：{package_title}\n资产：{display_name}\n类型：{kind}\n状态：{status}\n元数据：{search_meta}\n摘要：{summary}\n标签：{tags}\n内容：{content}"
    );
    combined.chars().take(6_000).collect()
}

fn should_use_semantic_search(query: &str) -> bool {
    let compact: Vec<char> = query.chars().filter(|character| !character.is_whitespace()).collect();
    let contains_cjk = compact.iter().any(|character| ('\u{4e00}'..='\u{9fff}').contains(character));
    compact.len() >= if contains_cjk { 2 } else { 3 }
}

fn artifact_search_metadata(artifact: &Artifact) -> String {
    let kind_label = match artifact.kind.as_str() {
        "image" => "image 图像",
        "audio" => "audio 音频",
        "video" => "video 视频",
        "markdown" => "markdown document 文档",
        "html" => "html webpage 网页",
        _ => "asset file 资产 文件",
    };
    let file_name = artifact.file_ref.file_name.as_deref().unwrap_or(&artifact.file_ref.path);
    let extension = Path::new(file_name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    format!(
        "type kind {kind_label}\nrole {}\nfile {file_name}\nextension {extension}",
        artifact.role.as_deref().unwrap_or_default(),
    )
}

fn text_hash(text: &str) -> String {
    // Stable FNV-1a hash: unlike DefaultHasher this stays consistent across Rust releases.
    let mut hash = 0xcbf29ce484222325u64;
    for byte in text.as_bytes() {
        hash ^= *byte as u64;
        hash = hash.wrapping_mul(0x100000001b3);
    }
    format!("{hash:016x}")
}

fn encode_vector(vector: &[f32]) -> Vec<u8> {
    vector.iter().flat_map(|value| value.to_le_bytes()).collect()
}

fn decode_vector(bytes: &[u8]) -> Option<Vec<f32>> {
    if bytes.len() % 4 != 0 { return None; }
    Some(bytes.chunks_exact(4).map(|chunk| {
        f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]])
    }).collect())
}

fn cosine_similarity(left: &[f32], right: &[f32]) -> f32 {
    if left.len() != right.len() || left.is_empty() { return -1.0; }
    let mut dot = 0.0;
    let mut left_norm = 0.0;
    let mut right_norm = 0.0;
    for (a, b) in left.iter().zip(right) {
        dot += a * b;
        left_norm += a * a;
        right_norm += b * b;
    }
    let denominator = left_norm.sqrt() * right_norm.sqrt();
    if denominator <= f32::EPSILON { -1.0 } else { dot / denominator }
}

fn build_fts_query(input: &str) -> String {
    input
        .split_whitespace()
        .filter(|t| !t.is_empty())
        .map(|term| {
            let escaped = term.replace('"', "\"\"");
            format!("\"{escaped}\"*")
        })
        .collect::<Vec<_>>()
        .join(" ")
}

pub fn read_text_if_exists(path: &Path) -> Option<String> {
    if path.is_file() {
        std::fs::read_to_string(path).ok()
    } else {
        None
    }
}

pub fn collect_index_contents(
    manifest: &PackageManifest,
    project_root: Option<&str>,
    package_dir: &Path,
) -> Vec<(String, Option<String>)> {
    let _session = crate::bookmarks_store::BookmarkStore::load(package_dir).activate_all();

    manifest
        .artifacts
        .iter()
        .map(|artifact| {
            let path = crate::library::resolve_file_ref(
                &artifact.file_ref,
                project_root,
            );
            let content = collect_artifact_index_text(artifact, &path);
            (artifact.id.clone(), content)
        })
        .collect()
}

/// Build indexable text for an artifact.
/// Markdown → full file body; media → basename + sidecar captions (content-level without OCR/vision).
fn collect_artifact_index_text(
    artifact: &crate::models::Artifact,
    path: &Path,
) -> Option<String> {
    let mut parts: Vec<String> = Vec::new();

    let basename = artifact
        .file_ref
        .file_name
        .clone()
        .or_else(|| {
            path.file_name()
                .map(|n| n.to_string_lossy().to_string())
        })
        .unwrap_or_default();
    if !basename.is_empty() {
        parts.push(format!("文件名：{basename}"));
    }

    if artifact.kind == "markdown" || artifact.kind == "html" {
        if let Some(body) = read_text_if_exists(path) {
            parts.push(body);
        }
    } else {
        // Sidecar captions next to media: foo.jpg.txt / foo.jpg.md / foo.alt.txt
        for candidate in media_sidecar_paths(path) {
            if let Some(text) = read_text_if_exists(&candidate) {
                let trimmed = text.trim();
                if !trimmed.is_empty() {
                    parts.push(trimmed.to_string());
                }
            }
        }
    }

    let joined = parts.join("\n");
    if joined.trim().is_empty() {
        None
    } else {
        Some(joined)
    }
}

fn media_sidecar_paths(path: &Path) -> Vec<PathBuf> {
    let mut out = Vec::new();
    let Some(parent) = path.parent() else {
        return out;
    };
    let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("");
    let name = path.file_name().and_then(|s| s.to_str()).unwrap_or("");
    if !name.is_empty() {
        out.push(parent.join(format!("{name}.txt")));
        out.push(parent.join(format!("{name}.md")));
        out.push(parent.join(format!("{name}.alt.txt")));
    }
    if !stem.is_empty() {
        out.push(parent.join(format!("{stem}.txt")));
        out.push(parent.join(format!("{stem}.md")));
        out.push(parent.join(format!("{stem}.alt.txt")));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{Artifact, FileRef};

    #[test]
    fn chinese_natural_language_uses_trigram_matches() {
        let dir = std::env::temp_dir().join(format!("workboms-search-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let index = SearchIndex::open(&dir.join("search.db")).unwrap();
        let manifest = PackageManifest {
            schema_version: "2.0".into(), id: "p1".into(), title: "回声之城".into(), slug: "echo".into(),
            domain: None, summary: None, project_root: None, created_at: "1".into(),
            artifacts: vec![Artifact { id: "a1".into(), file_ref: FileRef { path: "/missing".into(), path_kind: "absolute".into(), file_name: None },
                display_name: "雨夜站台分镜".into(), kind: "image".into(), status: "final".into(), role: None,
                summary: Some("冷色潮湿的重逢场景".into()), tags: None, work_id: None, provenance: None, created_at: "1".into(), updated_at: "1".into() }],
        };
        index.index_package(&manifest, &[]).unwrap();
        let hits = index.search("寻找雨夜站台的氛围", 10).unwrap();
        assert_eq!(hits.first().map(|hit| hit.artifact_id.as_str()), Some("a1"));
        drop(index);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn two_character_chinese_query_matches_inside_name() {
        let dir = std::env::temp_dir().join(format!("workboms-short-search-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let index = SearchIndex::open(&dir.join("search.db")).unwrap();
        let manifest = PackageManifest {
            schema_version: "2.0".into(), id: "p1".into(), title: "自击者".into(), slug: "sonnie".into(),
            domain: None, summary: None, project_root: None, created_at: "1".into(),
            artifacts: vec![Artifact { id: "music-1".into(), file_ref: FileRef { path: "/missing".into(), path_kind: "absolute".into(), file_name: None },
                display_name: "第1幕配乐".into(), kind: "audio".into(), status: "final".into(), role: None,
                summary: None, tags: None, work_id: None, provenance: None, created_at: "1".into(), updated_at: "1".into() }],
        };
        index.index_package(&manifest, &[]).unwrap();
        let hits = index.search("配乐", 10).unwrap();
        assert_eq!(hits.first().map(|hit| hit.artifact_id.as_str()), Some("music-1"));
        drop(index);
        let _ = std::fs::remove_dir_all(dir);
    }

    #[test]
    fn int8_semantic_search_matches_chinese_synonym_intent() {
        let dir = std::env::temp_dir().join(format!("workboms-semantic-search-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        let model_dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources/models/bge-small-zh-v1.5-int8");
        let index = SearchIndex::open_with_model_dir(&dir.join("search.db"), model_dir).unwrap();
        let artifact = |id: &str, name: &str, kind: &str, summary: &str| Artifact {
            id: id.into(),
            file_ref: FileRef { path: "/missing".into(), path_kind: "absolute".into(), file_name: None },
            display_name: name.into(), kind: kind.into(), status: "final".into(), role: None,
            summary: Some(summary.into()), tags: None, work_id: None, provenance: None,
            created_at: "1".into(), updated_at: "1".into(),
        };
        let manifest = PackageManifest {
            schema_version: "2.0".into(), id: "p1".into(), title: "自击者".into(), slug: "sonnie".into(),
            domain: None, summary: None, project_root: None, created_at: "1".into(),
            artifacts: vec![
                artifact("music-1", "第1幕配乐", "audio", "压迫感节奏，为开场战斗建立气氛"),
                artifact("character-1", "角色设定", "markdown", "主人公的外貌、性格与成长经历"),
                artifact("image-1", "雨夜站台", "image", "冷色潮湿的重逢场景"),
            ],
        };
        index.index_package(&manifest, &[]).unwrap();
        let response = index.search_assets(&SearchRequest {
            query: "开场背景音乐".into(), package_ids: vec![], kinds: vec![], statuses: vec![],
            sort: None, limit: Some(10), offset: None,
        }).unwrap();
        assert_eq!(response.mode, "hybrid");
        assert_eq!(response.items.first().map(|hit| hit.artifact_id.as_str()), Some("music-1"));
        let short_response = index.search_assets(&SearchRequest {
            query: "声音".into(), package_ids: vec![], kinds: vec![], statuses: vec![],
            sort: None, limit: Some(10), offset: None,
        }).unwrap();
        assert_eq!(short_response.mode, "hybrid");
        assert_eq!(short_response.items.first().map(|hit| hit.artifact_id.as_str()), Some("music-1"));
        let image_response = index.search_assets(&SearchRequest {
            query: "image".into(), package_ids: vec![], kinds: vec![], statuses: vec![],
            sort: None, limit: Some(10), offset: None,
        }).unwrap();
        assert_eq!(image_response.items.first().map(|hit| hit.artifact_id.as_str()), Some("image-1"));
        let document_response = index.search_assets(&SearchRequest {
            query: "document".into(), package_ids: vec![], kinds: vec![], statuses: vec![],
            sort: None, limit: Some(10), offset: None,
        }).unwrap();
        assert_eq!(document_response.items.first().map(|hit| hit.artifact_id.as_str()), Some("character-1"));
        drop(index);
        let _ = std::fs::remove_dir_all(dir);
    }
}
