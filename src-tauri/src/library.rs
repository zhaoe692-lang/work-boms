use std::fs;
use std::path::{Path, PathBuf};

use crate::models::{
    Artifact, ArtifactKey, ArtifactView, FileRef, Identity, IdentitiesDocument,
    InspirationBoard, InspirationBoardSummary, LibraryDocument, LibraryState, PackageManifest,
    PackageStats, PackageSummary, Relation, RelationsDocument, TrashItem, TrashQuery,
    WorksDocument, SCHEMA_VERSION,
};
use crate::bookmarks_store::{artifact_key, sync_package_bookmarks, BookmarkStore};
use crate::search_index::{collect_index_contents, SearchIndex};
use crate::store::Store;
use crate::wikilink::infer_relations_from_markdown;

pub struct LibraryService {
    vault_path: PathBuf,
    search: SearchIndex,
    store: Store,
}

impl LibraryService {
    #[allow(dead_code)]
    pub fn new(vault_path: PathBuf) -> Result<Self, String> {
        let model_dir = vault_path.join("models/bge-small-zh-v1.5-int8");
        Self::new_with_model_dir(vault_path, model_dir)
    }

    pub fn new_with_model_dir(vault_path: PathBuf, model_dir: PathBuf) -> Result<Self, String> {
        let search = SearchIndex::open_with_model_dir(&SearchIndex::db_path(&vault_path), model_dir)?;
        let store = Store::open(&vault_path)?;
        let service = Self {
            vault_path,
            search,
            store,
        };
        if service.search.needs_reindex() {
            for package_id in service.store.list_package_ids()? {
                service.sync_and_index_package(&package_id)?;
            }
        }
        Ok(service)
    }

    pub fn ensure_vault(&self) -> Result<(), String> {
        fs::create_dir_all(&self.vault_path)
            .map_err(|e| format!("无法创建库目录: {e}"))?;
        fs::create_dir_all(self.packages_dir())
            .map_err(|e| format!("无法创建 packages 目录: {e}"))?;
        self.migrate_from_json_if_needed()?;
        Ok(())
    }

    pub fn library_file(&self) -> PathBuf {
        self.vault_path.join("library.json")
    }

    pub fn packages_dir(&self) -> PathBuf {
        self.vault_path.join("packages")
    }

    pub fn package_dir(&self, package_id: &str) -> PathBuf {
        self.packages_dir().join(package_id)
    }

    /// One-time migration from the legacy file-based vault (library.json +
    /// packages/<id>/*.json) into the SQLite store. Runs only when the DB is
    /// empty but a legacy library.json exists; leaves the old files untouched.
    fn migrate_from_json_if_needed(&self) -> Result<(), String> {
        if self.store.has_packages()? {
            return Ok(());
        }
        let library_path = self.library_file();
        if !library_path.exists() {
            return Ok(());
        }
        let Ok(library) = read_json::<LibraryDocument>(&library_path) else {
            return Ok(());
        };
        for entry in &library.packages {
            let package_dir = self.package_dir(&entry.package_id);
            let manifest_path = package_dir.join("manifest.json");
            if !manifest_path.exists() {
                continue;
            }
            let Ok(manifest) = read_json::<PackageManifest>(&manifest_path) else {
                continue;
            };
            let relations = read_json(&package_dir.join("relations.json")).unwrap_or_else(|_| {
                RelationsDocument {
                    schema_version: SCHEMA_VERSION.to_string(),
                    relations: vec![],
                }
            });
            let works = read_json(&package_dir.join("works.json")).unwrap_or_else(|_| WorksDocument {
                schema_version: SCHEMA_VERSION.to_string(),
                works: vec![],
            });
            let identities =
                read_json(&package_dir.join("identities.json")).unwrap_or_else(|_| {
                    IdentitiesDocument {
                        schema_version: SCHEMA_VERSION.to_string(),
                        identities: vec![],
                    }
                });
            self.store.upsert_package(
                &manifest,
                &relations,
                &works,
                &identities,
                &entry.imported_at,
                entry.source_path.as_deref(),
            )?;
        }
        Ok(())
    }

    pub fn get_library_state(&self) -> Result<LibraryState, String> {
        let package_ids = self.store.list_package_ids()?;
        crate::bookmark_pool::warmup_vault(&self.vault_path, &package_ids);

        let mut packages = Vec::new();
        for id in &package_ids {
            // Hide empty shells (all assets in trash or gone) from the library rail.
            if self.store.count_active_artifacts(id).unwrap_or(0) == 0 {
                continue;
            }
            if let Ok(summary) = self.load_package_summary(id) {
                packages.push(summary);
            }
        }
        Ok(LibraryState {
            vault_path: self.vault_path.to_string_lossy().to_string(),
            packages,
        })
    }

    pub fn import_package(&self, source_path: &str) -> Result<PackageSummary, String> {
        let source = PathBuf::from(source_path);
        if !source.is_dir() {
            return Err("error.import.not_directory".to_string());
        }

        let manifest_path = source.join("manifest.json");
        // Prefer WorkBOM packages from plugins; otherwise import a local
        // directory (all files → artifacts, grouped by folder).
        if !manifest_path.exists() {
            if crate::obsidian::looks_like_local_directory(&source) {
                return self.import_local_directory(&source);
            }
            return Err("error.import.missing_manifest".to_string());
        }

        let mut manifest: PackageManifest = read_json(&manifest_path)?;
        normalize_project_root(&mut manifest, &source)?;

        let relations: RelationsDocument = read_json(&source.join("relations.json"))
            .unwrap_or(RelationsDocument {
                schema_version: SCHEMA_VERSION.to_string(),
                relations: vec![],
            });

        let works: WorksDocument = read_json(&source.join("works.json")).unwrap_or(WorksDocument {
            schema_version: SCHEMA_VERSION.to_string(),
            works: vec![],
        });

        let identities: IdentitiesDocument = read_json(&source.join("identities.json"))
            .unwrap_or(IdentitiesDocument {
                schema_version: SCHEMA_VERSION.to_string(),
                identities: vec![],
            });

        self.register_package(manifest, relations, works, identities, &source)
    }

    /// Import a local project directory as a link-only WorkBOM package.
    /// Every file becomes an Artifact; folders become Work groups.
    /// Markdown `[[wikilinks]]` become inferred relations on load.
    pub fn import_local_directory(&self, root: &Path) -> Result<PackageSummary, String> {
        let (manifest, relations, works, identities) =
            crate::obsidian::synthesize_from_vault(root)?;
        self.register_package(manifest, relations, works, identities, root)
    }

    fn register_package(
        &self,
        manifest: PackageManifest,
        relations: RelationsDocument,
        works: WorksDocument,
        identities: IdentitiesDocument,
        source: &Path,
    ) -> Result<PackageSummary, String> {
        let artifact_ids: std::collections::HashSet<String> =
            manifest.artifacts.iter().map(|a| a.id.clone()).collect();
        validate_identities(&identities.identities, &artifact_ids)?;
        validate_part_of_acyclic(&relations.relations, &artifact_ids, &identities.identities)?;

        // packages/<id>/ still holds per-package .vault state (bookmarks,
        // graph layout) and is the relative-path base; wipe it on re-import.
        let package_dir = self.package_dir(&manifest.id);
        if package_dir.exists() {
            fs::remove_dir_all(&package_dir)
                .map_err(|e| format!("无法覆盖已有成果包: {e}"))?;
        }
        fs::create_dir_all(&package_dir).map_err(|e| format!("无法创建成果包目录: {e}"))?;

        let imported_at = chrono_now();
        self.store.upsert_package(
            &manifest,
            &relations,
            &works,
            &identities,
            &imported_at,
            source.to_str(),
        )?;

        self.sync_and_index_package(&manifest.id)?;
        crate::bookmark_pool::warmup_package(&self.package_dir(&manifest.id));
        self.compute_and_store_metrics(&manifest.id)?;
        self.load_package_summary(&manifest.id)
    }

    pub fn reindex_package(&self, package_id: &str) -> Result<(), String> {
        self.sync_and_index_package(package_id)?;
        let _ = self.compute_and_store_metrics(package_id);
        Ok(())
    }

    /// Roots to watch for external file changes → reindex.
    pub fn watch_roots(&self) -> Result<Vec<(String, String)>, String> {
        let mut roots = Vec::new();
        for package_id in self.store.list_package_ids()? {
            let Ok(manifest) = self.store.load_manifest(&package_id) else {
                continue;
            };
            if let Some(root) = manifest.project_root.filter(|r| !r.is_empty()) {
                roots.push((package_id, root));
            }
        }
        Ok(roots)
    }

    pub fn sync_and_index_package(&self, package_id: &str) -> Result<(), String> {
        let package_dir = self.package_dir(package_id);
        let manifest = self.store.load_manifest(package_id)?;
        let project_root = manifest.project_root.clone();

        let _session = BookmarkStore::load(&package_dir).activate_all();
        let artifact_paths: Vec<(String, String)> = manifest
            .artifacts
            .iter()
            .map(|artifact| {
                let path = resolve_file_ref(&artifact.file_ref, project_root.as_deref());
                (artifact.id.clone(), path.to_string_lossy().to_string())
            })
            .collect();

        let _ = sync_package_bookmarks(&package_dir, project_root.as_deref(), &artifact_paths);

        let contents = collect_index_contents(&manifest, project_root.as_deref(), &package_dir);
        self.search.index_package(&manifest, &contents)
    }

    pub fn search_artifacts(&self, query: &str, limit: usize) -> Result<Vec<crate::search_index::SearchHit>, String> {
        self.search.search(query, limit)
    }

    pub fn search_assets(
        &self,
        request: &crate::search_index::SearchRequest,
    ) -> Result<crate::search_index::SearchResponse, String> {
        self.search.search_assets(request)
    }

    pub fn load_package_summary(&self, package_id: &str) -> Result<PackageSummary, String> {
        Ok(self.load_package_detail(package_id)?.package)
    }

    pub fn load_package_detail(
        &self,
        package_id: &str,
    ) -> Result<crate::models::PackageDetail, String> {
        if !self.store.package_exists(package_id)? {
            return Err(format!("成果包不存在: {package_id}"));
        }
        let package_dir = self.package_dir(package_id);

        let _session = BookmarkStore::load(&package_dir).activate_all();

        let manifest = self.store.load_manifest(package_id)?;
        let relations = self.store.load_relations(package_id)?;
        let works = self.store.load_works(package_id)?;
        let identities = self.store.load_identities(package_id)?;
        let imported_at = self.store.package_meta(package_id)?.imported_at;

        let project_root = manifest.project_root.clone();
        let manifest_artifacts = manifest.artifacts.clone();
        let mut broken = 0usize;
        let mut final_count = 0usize;
        let artifacts: Vec<ArtifactView> = manifest
            .artifacts
            .iter()
            .map(|artifact| {
                let (absolute_path, reachable) = resolve_artifact_path(
                    artifact,
                    project_root.as_deref(),
                    &package_dir,
                );
                if !reachable {
                    broken += 1;
                }
                if artifact.status == "final" {
                    final_count += 1;
                }
                ArtifactView {
                    artifact: artifact.clone(),
                    absolute_path: absolute_path.to_string_lossy().to_string(),
                    reachable,
                }
            })
            .collect();

        let package = PackageSummary {
            id: manifest.id,
            title: manifest.title,
            slug: manifest.slug,
            domain: manifest.domain,
            summary: manifest.summary,
            project_root: manifest.project_root,
            imported_at,
            stats: PackageStats {
                artifact_count: artifacts.len(),
                final_count,
                broken_link_count: broken,
            },
        };

        let mut relations_merged =
            enrich_relations(&manifest_artifacts, &artifacts, relations.relations);
        let dismissed = crate::dismissed_suggestions::load_dismissed(&package_dir);
        if !dismissed.is_empty() {
            relations_merged.retain(|relation| {
                !relation.inferred.unwrap_or(false)
                    || !dismissed.contains(&crate::dismissed_suggestions::suggestion_key(
                        &relation.from,
                        &relation.to,
                    ))
            });
        }

        Ok(crate::models::PackageDetail {
            package,
            artifacts,
            relations: relations_merged,
            works: works.works,
            identities: identities.identities,
        })
    }

    pub fn relocate_artifact_file(
        &self,
        package_id: &str,
        artifact_id: &str,
        new_absolute_path: &str,
    ) -> Result<crate::models::PackageDetail, String> {
        let path = PathBuf::from(new_absolute_path);
        if !path.is_file() {
            return Err("所选路径不是有效文件".to_string());
        }

        let manifest = self.store.load_manifest(package_id)?;
        let artifact = manifest
            .artifacts
            .iter()
            .find(|a| a.id == artifact_id)
            .ok_or_else(|| format!("成果项不存在: {artifact_id}"))?;

        let file_name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| artifact.file_ref.file_name.clone().unwrap_or_default());

        let file_ref = FileRef {
            path: path.to_string_lossy().to_string(),
            path_kind: "absolute".to_string(),
            file_name: Some(file_name),
        };

        self.store
            .update_artifact_file_ref(package_id, artifact_id, &file_ref, &chrono_now())?;
        self.sync_and_index_package(package_id)?;
        let detail = self.load_package_detail(package_id)?;
        let metrics = crate::metrics::compute_metrics(&detail);
        self.store.save_metrics(package_id, &metrics)?;
        Ok(detail)
    }

    pub fn update_artifact_status(
        &self,
        package_id: &str,
        artifact_id: &str,
        status: &str,
    ) -> Result<crate::models::PackageDetail, String> {
        if !matches!(status, "draft" | "candidate" | "final") {
            return Err("无效状态，应为 draft / candidate / final".to_string());
        }

        self.store
            .update_artifact_status(package_id, artifact_id, status, &chrono_now())?;
        // Status does not change searchable text — patch the index row only.
        let _ = self
            .search
            .update_artifact_status(package_id, artifact_id, status);
        let detail = self.load_package_detail(package_id)?;
        let metrics = crate::metrics::compute_metrics(&detail);
        self.store.save_metrics(package_id, &metrics)?;
        Ok(detail)
    }

    pub fn update_artifact_meta(
        &self,
        package_id: &str,
        artifact_id: &str,
        role: Option<&str>,
        summary: Option<&str>,
        tags: Vec<String>,
    ) -> Result<crate::models::PackageDetail, String> {
        self.store.update_artifact_meta(
            package_id,
            artifact_id,
            role,
            summary,
            &tags,
            &chrono_now(),
        )?;
        self.sync_and_index_package(package_id)?;
        let detail = self.load_package_detail(package_id)?;
        let metrics = crate::metrics::compute_metrics(&detail);
        self.store.save_metrics(package_id, &metrics)?;
        Ok(detail)
    }

    pub fn batch_update_artifact_status(
        &self,
        package_id: &str,
        artifact_ids: Vec<String>,
        status: &str,
    ) -> Result<crate::models::PackageDetail, String> {
        if !matches!(status, "draft" | "candidate" | "final") {
            return Err("无效状态，应为 draft / candidate / final".to_string());
        }
        if artifact_ids.is_empty() {
            return Err("未选择成果项".to_string());
        }
        self.store.batch_update_artifact_status(
            package_id,
            &artifact_ids,
            status,
            &chrono_now(),
        )?;
        let _ = self
            .search
            .update_artifacts_status(package_id, &artifact_ids, status);
        let detail = self.load_package_detail(package_id)?;
        let metrics = crate::metrics::compute_metrics(&detail);
        self.store.save_metrics(package_id, &metrics)?;
        Ok(detail)
    }

    pub fn add_relation(
        &self,
        package_id: &str,
        from: &str,
        to: &str,
        kind: &str,
        label: Option<&str>,
    ) -> Result<crate::models::PackageDetail, String> {
        let valid = [
            "references",
            "derived_from",
            "uses",
            "pairs_with",
            "part_of",
        ];
        if !valid.contains(&kind) {
            return Err(format!("无效关系类型: {kind}"));
        }
        if from == to {
            return Err("不能连接到自身".to_string());
        }
        let relation = crate::models::Relation {
            id: format!("rel-{}", uuid_like()),
            from: from.to_string(),
            to: to.to_string(),
            kind: kind.to_string(),
            label: label.map(|s| s.to_string()),
            inferred: Some(false),
        };
        self.store.add_relation(package_id, &relation)?;
        self.sync_and_index_package(package_id)?;
        let detail = self.load_package_detail(package_id)?;
        let metrics = crate::metrics::compute_metrics(&detail);
        self.store.save_metrics(package_id, &metrics)?;
        Ok(detail)
    }

    pub fn remove_relation(
        &self,
        package_id: &str,
        relation_id: &str,
    ) -> Result<crate::models::PackageDetail, String> {
        self.store.remove_relation(package_id, relation_id)?;
        self.sync_and_index_package(package_id)?;
        let detail = self.load_package_detail(package_id)?;
        let metrics = crate::metrics::compute_metrics(&detail);
        self.store.save_metrics(package_id, &metrics)?;
        Ok(detail)
    }

    pub fn update_relation_kind(
        &self,
        package_id: &str,
        relation_id: &str,
        kind: &str,
        label: Option<&str>,
    ) -> Result<crate::models::PackageDetail, String> {
        let valid = [
            "references",
            "derived_from",
            "uses",
            "pairs_with",
            "part_of",
        ];
        if !valid.contains(&kind) {
            return Err(format!("无效关系类型: {kind}"));
        }
        self.store
            .update_relation_kind(package_id, relation_id, kind, label)?;
        self.sync_and_index_package(package_id)?;
        let detail = self.load_package_detail(package_id)?;
        let metrics = crate::metrics::compute_metrics(&detail);
        self.store.save_metrics(package_id, &metrics)?;
        Ok(detail)
    }

    pub fn set_work_membership(
        &self,
        package_id: &str,
        work_id: &str,
        artifact_id: &str,
        include: bool,
    ) -> Result<crate::models::PackageDetail, String> {
        self.store
            .set_work_membership(package_id, work_id, artifact_id, include)?;
        self.sync_and_index_package(package_id)?;
        self.load_package_detail(package_id)
    }

    pub fn rename_artifact(
        &self,
        package_id: &str,
        artifact_id: &str,
        display_name: &str,
    ) -> Result<crate::models::PackageDetail, String> {
        let name = display_name.trim();
        if name.is_empty() {
            return Err("名称不能为空".to_string());
        }
        if name.contains('/') || name.contains('\\') || name.contains('\0') {
            return Err("名称不能包含路径分隔符".to_string());
        }

        let detail = self.load_package_detail(package_id)?;
        let artifact = detail
            .artifacts
            .iter()
            .find(|a| a.artifact.id == artifact_id)
            .ok_or_else(|| format!("成果项不存在: {artifact_id}"))?
            .clone();

        let now = chrono_now();
        let mut file_ref_update: Option<FileRef> = None;

        // Rename on-disk file first (when reachable) so a failed FS rename
        // does not leave the library pointing at a missing path.
        if artifact.reachable {
            let old_path = PathBuf::from(&artifact.absolute_path);
            if old_path.is_file() {
                let ext = old_path
                    .extension()
                    .and_then(|e| e.to_str())
                    .map(|e| format!(".{e}"))
                    .unwrap_or_default();
                let stem = if !ext.is_empty()
                    && name.to_ascii_lowercase().ends_with(&ext.to_ascii_lowercase())
                {
                    name[..name.len() - ext.len()].trim_end().to_string()
                } else {
                    name.to_string()
                };
                let safe_stem = sanitize_filename_stem(&stem);
                if safe_stem.is_empty() {
                    return Err("文件名无效".to_string());
                }
                let new_file_name = format!("{safe_stem}{ext}");
                let new_path = old_path
                    .parent()
                    .map(|p| p.join(&new_file_name))
                    .unwrap_or_else(|| PathBuf::from(&new_file_name));

                if new_path != old_path {
                    if new_path.exists() {
                        return Err(format!("目标文件已存在: {}", new_path.display()));
                    }
                    fs::rename(&old_path, &new_path)
                        .map_err(|e| format!("重命名磁盘文件失败: {e}"))?;

                    let project_root = detail.package.project_root.as_deref();
                    let (path_kind, ref_path) = match project_root {
                        Some(root) => {
                            let root_path = PathBuf::from(root);
                            match new_path.strip_prefix(&root_path) {
                                Ok(rel) => ("relative".to_string(), rel.to_string_lossy().to_string()),
                                Err(_) => {
                                    ("absolute".to_string(), new_path.to_string_lossy().to_string())
                                }
                            }
                        }
                        None => ("absolute".to_string(), new_path.to_string_lossy().to_string()),
                    };
                    file_ref_update = Some(FileRef {
                        path: ref_path,
                        path_kind,
                        file_name: Some(new_file_name),
                    });

                    let package_dir = self.package_dir(package_id);
                    let mut store = BookmarkStore::load(&package_dir);
                    let key = artifact_key(artifact_id);
                    if store.get(&key).is_some() {
                        let new_path_str = new_path.to_string_lossy().to_string();
                        if let Ok(bookmark) =
                            crate::bookmarks_store::create_bookmark_for_path(&new_path_str)
                        {
                            let _ = store.upsert(&key, &new_path_str, &bookmark);
                        }
                    }
                }
            }
        }

        self.store
            .rename_artifact(package_id, artifact_id, name, &now)?;
        if let Some(file_ref) = file_ref_update {
            self.store
                .update_artifact_file_ref(package_id, artifact_id, &file_ref, &now)?;
        }

        self.sync_and_index_package(package_id)?;
        self.load_package_detail(package_id)
    }

    pub fn import_artifact_file(
        &self,
        package_id: &str,
        absolute_path: &str,
        display_name: Option<&str>,
    ) -> Result<crate::models::PackageDetail, String> {
        let path = PathBuf::from(absolute_path);
        if !path.is_file() {
            return Err("请选择有效的文件".to_string());
        }
        let file_name = path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "asset".to_string());
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        let kind = match ext.as_str() {
            "md" | "markdown" | "txt" => "markdown",
            "html" | "htm" => "html",
            "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "svg" => "image",
            "mp3" | "wav" | "aac" | "m4a" | "flac" | "ogg" => "audio",
            "mp4" | "mov" | "webm" | "mkv" | "m4v" => "video",
            _ => "other",
        };
        let now = chrono_now();
        let id = format!("asset-{}", uuid_like());
        let name = display_name
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or(file_name.as_str())
            .to_string();
        let artifact = Artifact {
            id,
            file_ref: FileRef {
                path: path.to_string_lossy().to_string(),
                path_kind: "absolute".to_string(),
                file_name: Some(file_name),
            },
            display_name: name,
            kind: kind.to_string(),
            status: "draft".to_string(),
            role: None,
            summary: None,
            tags: None,
            work_id: None,
            provenance: None,
            created_at: now.clone(),
            updated_at: now,
        };
        self.store.insert_artifact(package_id, &artifact)?;
        self.sync_and_index_package(package_id)?;
        let _ = self.compute_and_store_metrics(package_id);
        self.load_package_detail(package_id)
    }

    pub fn create_work(
        &self,
        package_id: &str,
        title: &str,
        summary: Option<&str>,
    ) -> Result<crate::models::PackageDetail, String> {
        let works = self.store.load_works(package_id)?;
        let order = works.works.len() as i32;
        let work = crate::models::Work {
            id: format!("work-{}", uuid_like()),
            title: title.to_string(),
            summary: summary.map(|s| s.to_string()),
            order,
            artifact_ids: vec![],
        };
        self.store.create_work(package_id, &work)?;
        self.load_package_detail(package_id)
    }

    pub fn rename_work(
        &self,
        package_id: &str,
        work_id: &str,
        title: &str,
        summary: Option<&str>,
    ) -> Result<crate::models::PackageDetail, String> {
        self.store
            .rename_work(package_id, work_id, title, summary)?;
        self.load_package_detail(package_id)
    }

    pub fn delete_work(
        &self,
        package_id: &str,
        work_id: &str,
    ) -> Result<crate::models::PackageDetail, String> {
        self.store.delete_work(package_id, work_id)?;
        self.load_package_detail(package_id)
    }

    pub fn merge_identities(
        &self,
        package_id: &str,
        keep_id: &str,
        absorb_id: &str,
    ) -> Result<crate::models::PackageDetail, String> {
        self.store
            .merge_identities(package_id, keep_id, absorb_id)?;
        let detail = self.load_package_detail(package_id)?;
        let metrics = crate::metrics::compute_metrics(&detail);
        self.store.save_metrics(package_id, &metrics)?;
        Ok(detail)
    }

    pub fn split_identity(
        &self,
        package_id: &str,
        identity_id: &str,
        artifact_ids: Vec<String>,
        new_display_name: &str,
    ) -> Result<crate::models::PackageDetail, String> {
        let new_id = format!("identity-{}", uuid_like());
        self.store.split_identity(
            package_id,
            identity_id,
            &artifact_ids,
            &new_id,
            new_display_name,
        )?;
        let detail = self.load_package_detail(package_id)?;
        let metrics = crate::metrics::compute_metrics(&detail);
        self.store.save_metrics(package_id, &metrics)?;
        Ok(detail)
    }

    pub fn set_identity_head(
        &self,
        package_id: &str,
        identity_id: &str,
        head_version_id: &str,
    ) -> Result<crate::models::PackageDetail, String> {
        self.store
            .set_identity_head(package_id, identity_id, head_version_id)?;
        self.load_package_detail(package_id)
    }

    /// Promote a wikilink/inferred suggestion into an explicit relation.
    pub fn accept_suggested_relation(
        &self,
        package_id: &str,
        from: &str,
        to: &str,
        kind: &str,
        label: Option<&str>,
    ) -> Result<crate::models::PackageDetail, String> {
        self.add_relation(package_id, from, to, kind, label)
    }

    /// Persistently ignore an inferred suggestion so it no longer appears.
    pub fn reject_suggested_relation(
        &self,
        package_id: &str,
        from: &str,
        to: &str,
    ) -> Result<crate::models::PackageDetail, String> {
        let package_dir = self.package_dir(package_id);
        crate::dismissed_suggestions::dismiss(&package_dir, from, to)?;
        self.load_package_detail(package_id)
    }

    pub fn update_package_meta(
        &self,
        package_id: &str,
        title: &str,
        summary: Option<&str>,
    ) -> Result<crate::models::PackageDetail, String> {
        let title = title.trim();
        if title.is_empty() {
            return Err("标题不能为空".to_string());
        }
        // Keep session "章节" in sync when it still matches the old package title
        // (common for single-session .wbom imports where both start equal).
        let old_title = self
            .store
            .load_manifest(package_id)
            .map(|m| m.title)
            .unwrap_or_default();
        self.store
            .update_package_meta(package_id, title, summary)?;
        if !old_title.is_empty() && old_title != title {
            if let Ok(works) = self.store.load_works(package_id) {
                for work in works.works {
                    if work.title == old_title {
                        let _ = self.store.rename_work(
                            package_id,
                            &work.id,
                            title,
                            work.summary.as_deref(),
                        );
                    }
                }
            }
        }
        self.load_package_detail(package_id)
    }

    pub fn remove_package(&self, package_id: &str) -> Result<(), String> {
        self.store.delete_package(package_id)?;
        let package_dir = self.package_dir(package_id);
        if package_dir.exists() {
            fs::remove_dir_all(&package_dir)
                .map_err(|e| format!("无法删除成果包目录: {e}"))?;
        }
        let _ = self.search.clear_package(package_id);
        Ok(())
    }

    pub fn list_inspiration_boards(
        &self,
        package_id: Option<&str>,
    ) -> Result<Vec<InspirationBoardSummary>, String> {
        self.store.list_inspiration_boards(package_id)
    }

    pub fn create_inspiration_board(
        &self,
        package_id: Option<&str>,
        title: &str,
    ) -> Result<InspirationBoard, String> {
        self.store.create_inspiration_board(
            &format!("board-{}", uuid_like()),
            package_id,
            title,
            epoch_now(),
        )
    }

    pub fn get_inspiration_board(&self, board_id: &str) -> Result<InspirationBoard, String> {
        self.store.load_inspiration_board(board_id)
    }

    pub fn save_inspiration_board(
        &self,
        board: &InspirationBoard,
        expected_version: i64,
    ) -> Result<InspirationBoard, String> {
        self.store
            .save_inspiration_board(board, expected_version, epoch_now())
    }

    pub fn delete_inspiration_board(&self, board_id: &str) -> Result<(), String> {
        self.store.delete_inspiration_board(board_id)
    }

    fn refresh_packages(&self, package_ids: impl IntoIterator<Item = String>) -> Result<(), String> {
        let unique: std::collections::BTreeSet<String> = package_ids.into_iter().collect();
        for package_id in unique {
            if self.store.package_exists(&package_id)? {
                self.sync_and_index_package(&package_id)?;
                self.compute_and_store_metrics(&package_id)?;
            }
        }
        Ok(())
    }

    pub fn list_trash(&self, query: &TrashQuery) -> Result<Vec<TrashItem>, String> {
        let _ = self.purge_expired_trash()?;
        self.store.list_trash(query)
    }

    /// Purge expired trash (30-day TTL). Safe to call on a timer.
    pub fn purge_expired_trash(&self) -> Result<usize, String> {
        let purged = self.store.purge_expired_trash(epoch_now())?;
        let count = purged.len();
        self.refresh_packages(purged.clone())?;
        self.prune_empty_packages(&purged)?;
        Ok(count)
    }

    /// Remove packages that have neither active nor trashed artifacts.
    pub fn prune_empty_packages(&self, candidates: &[String]) -> Result<usize, String> {
        let mut removed = 0usize;
        let mut seen = std::collections::BTreeSet::new();
        for package_id in candidates {
            if !seen.insert(package_id.clone()) {
                continue;
            }
            if !self.store.package_exists(package_id)? {
                continue;
            }
            let active = self.store.count_active_artifacts(package_id)?;
            let trashed = self.store.count_trashed_artifacts(package_id)?;
            if active == 0 && trashed == 0 {
                self.remove_package(package_id)?;
                removed += 1;
            }
        }
        Ok(removed)
    }

    pub fn move_artifacts_to_trash(
        &self,
        package_id: &str,
        artifact_ids: &[String],
        deleted_by: Option<&str>,
    ) -> Result<usize, String> {
        if artifact_ids.is_empty() {
            return Err("未选择资产".to_string());
        }
        let now = epoch_now();
        let affected = self.store.soft_delete_artifacts(
            package_id,
            artifact_ids,
            deleted_by,
            now,
            now + 30 * 24 * 60 * 60,
        )?;
        self.refresh_packages([package_id.to_string()])?;
        Ok(affected)
    }

    pub fn restore_trash_items(&self, items: &[ArtifactKey]) -> Result<usize, String> {
        let keys: Vec<_> = items
            .iter()
            .map(|item| (item.package_id.clone(), item.artifact_id.clone()))
            .collect();
        let affected = self.store.restore_artifacts(&keys)?;
        self.refresh_packages(items.iter().map(|item| item.package_id.clone()))?;
        Ok(affected)
    }

    pub fn permanently_delete_trash_items(&self, items: &[ArtifactKey]) -> Result<usize, String> {
        let keys: Vec<_> = items
            .iter()
            .map(|item| (item.package_id.clone(), item.artifact_id.clone()))
            .collect();
        let (affected, packages) = self.store.permanently_delete_artifacts(&keys)?;
        self.refresh_packages(packages.clone())?;
        self.prune_empty_packages(&packages)?;
        Ok(affected)
    }

    pub fn empty_trash(&self) -> Result<usize, String> {
        let keys = self.store.all_deleted_artifact_keys()?;
        let items: Vec<_> = keys.into_iter().map(|(package_id, artifact_id)| ArtifactKey {
            package_id,
            artifact_id,
        }).collect();
        self.permanently_delete_trash_items(&items)
    }

    /// Export current package state as a `.wbom` directory (manifest + relations + works + identities).
    pub fn export_package(&self, package_id: &str, target_dir: &str) -> Result<String, String> {
        let dest = PathBuf::from(target_dir);
        fs::create_dir_all(&dest).map_err(|e| format!("无法创建导出目录: {e}"))?;

        let manifest = self.store.load_manifest(package_id)?;
        let relations = self.store.load_relations(package_id)?;
        let works = self.store.load_works(package_id)?;
        let identities = self.store.load_identities(package_id)?;

        write_json(&dest.join("manifest.json"), &manifest)?;
        write_json(&dest.join("relations.json"), &relations)?;
        write_json(&dest.join("works.json"), &works)?;
        write_json(&dest.join("identities.json"), &identities)?;
        Ok(dest.to_string_lossy().to_string())
    }

    pub fn get_package_metrics(
        &self,
        package_id: &str,
    ) -> Result<crate::metrics::Metrics, String> {
        // Prefer the stored snapshot. Mutations (status/meta/relations/reindex)
        // already recompute + save; a live disk walk here made every cockpit
        // refresh hitch on large packages.
        if let Some(metrics) = self.store.load_metrics(package_id)? {
            return Ok(metrics);
        }
        self.compute_and_store_metrics(package_id)
    }

    /// Stat-only broken-link count (kept for diagnostics / future freshness probes).
    #[allow(dead_code)]
    fn count_broken(&self, package_id: &str) -> Result<usize, String> {
        let manifest = self.store.load_manifest(package_id)?;
        let package_dir = self.package_dir(package_id);
        let _session = BookmarkStore::load(&package_dir).activate_all();
        let project_root = manifest.project_root.clone();
        let broken = manifest
            .artifacts
            .iter()
            .filter(|artifact| {
                let (_, reachable) =
                    resolve_artifact_path(artifact, project_root.as_deref(), &package_dir);
                !reachable
            })
            .count();
        Ok(broken)
    }

    /// Recompute the health metrics from current data and persist them.
    fn compute_and_store_metrics(
        &self,
        package_id: &str,
    ) -> Result<crate::metrics::Metrics, String> {
        let detail = self.load_package_detail(package_id)?;
        let metrics = crate::metrics::compute_metrics(&detail);
        self.store.save_metrics(package_id, &metrics)?;
        Ok(metrics)
    }

    pub fn read_artifact_text(&self, package_id: &str, artifact_id: &str) -> Result<String, String> {
        let detail = self.load_package_detail(package_id)?;
        let artifact = detail
            .artifacts
            .iter()
            .find(|a| a.artifact.id == artifact_id)
            .ok_or_else(|| format!("成果项不存在: {artifact_id}"))?;

        if !artifact.reachable {
            return Err("文件链接已失效，无法读取".to_string());
        }

        fs::read_to_string(&artifact.absolute_path).map_err(|e| format!("读取文件失败: {e}"))
    }

    pub fn write_artifact_text(
        &self,
        package_id: &str,
        artifact_id: &str,
        contents: &str,
    ) -> Result<crate::models::PackageDetail, String> {
        let detail = self.load_package_detail(package_id)?;
        let artifact = detail
            .artifacts
            .iter()
            .find(|a| a.artifact.id == artifact_id)
            .ok_or_else(|| format!("成果项不存在: {artifact_id}"))?;

        if !artifact.reachable {
            return Err("文件链接已失效，无法保存".to_string());
        }

        let kind = artifact.artifact.kind.as_str();
        if matches!(kind, "image" | "audio" | "video") {
            return Err("非文本资产不支持应用内编辑".to_string());
        }
        if kind == "other" && !is_text_path(&artifact.absolute_path) {
            return Err("此文件类型不支持应用内编辑".to_string());
        }

        fs::write(&artifact.absolute_path, contents)
            .map_err(|e| format!("写入文件失败: {e}"))?;

        let now = chrono_now();
        self.store
            .touch_artifact(package_id, artifact_id, &now)?;
        self.sync_and_index_package(package_id)?;
        self.load_package_detail(package_id)
    }

    pub fn get_graph_layout(
        &self,
        package_id: &str,
        mode: &str,
        fingerprint: &str,
    ) -> Option<crate::graph_layout::GraphLayoutDocument> {
        crate::graph_layout::load_graph_layout(&self.package_dir(package_id), mode, fingerprint)
    }

    pub fn save_graph_layout(
        &self,
        package_id: &str,
        layout: crate::graph_layout::GraphLayoutDocument,
    ) -> Result<(), String> {
        crate::graph_layout::save_graph_layout(&self.package_dir(package_id), &layout)
    }

    pub fn reset_graph_layout(&self, package_id: &str) -> Result<(), String> {
        crate::graph_layout::delete_graph_layout(&self.package_dir(package_id))
    }
}

pub fn resolve_artifact_path(
    artifact: &Artifact,
    project_root: Option<&str>,
    package_dir: &Path,
) -> (PathBuf, bool) {
    let logical = resolve_file_ref(&artifact.file_ref, project_root);
    if logical.is_file() {
        return (logical, true);
    }

    let store = BookmarkStore::load(package_dir);
    if artifact.file_ref.path_kind == "absolute" {
        if let Some(entry) = store.get(&artifact_key(&artifact.id)) {
            if let Ok(guard) = crate::bookmark::access_from_stored(entry) {
                let resolved = guard.resolved_path();
                if resolved.is_file() {
                    return (resolved, true);
                }
            }
        }
    }

    if logical.is_file() {
        (logical, true)
    } else {
        (logical, false)
    }
}

pub fn resolve_file_ref(file_ref: &FileRef, project_root: Option<&str>) -> PathBuf {
    match file_ref.path_kind.as_str() {
        "relative" => {
            if let Some(root) = project_root {
                PathBuf::from(root).join(&file_ref.path)
            } else {
                PathBuf::from(&file_ref.path)
            }
        }
        _ => PathBuf::from(&file_ref.path),
    }
}

fn normalize_project_root(manifest: &mut PackageManifest, source_dir: &Path) -> Result<(), String> {
    let Some(root) = manifest.project_root.clone() else {
        return Ok(());
    };

    let root_path = PathBuf::from(&root);
    if root_path.is_absolute() {
        manifest.project_root = Some(root_path.to_string_lossy().to_string());
        return Ok(());
    }

    let resolved = source_dir.join(&root);
    let canonical = fs::canonicalize(&resolved).unwrap_or(resolved);
    manifest.project_root = Some(canonical.to_string_lossy().to_string());
    Ok(())
}

fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T, String> {
    let content =
        fs::read_to_string(path).map_err(|e| format!("无法读取 {}: {e}", path.display()))?;
    serde_json::from_str(&content).map_err(|e| format!("JSON 解析失败 {}: {e}", path.display()))
}

fn write_json<T: serde::Serialize>(path: &Path, value: &T) -> Result<(), String> {
    let content = serde_json::to_string_pretty(value).map_err(|e| format!("JSON 序列化失败: {e}"))?;
    fs::write(path, content).map_err(|e| format!("无法写入 {}: {e}", path.display()))
}

fn chrono_now() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format_unix_utc_iso(secs)
}

/// Format Unix seconds as `YYYY-MM-DDTHH:MM:SSZ` (UTC), matching .wbom exports.
fn format_unix_utc_iso(secs: u64) -> String {
    // Civil date from days since Unix epoch (Howard Hinnant algorithm).
    let z = (secs / 86_400) as i64 + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = (z - era * 146_097) as u64;
    let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365;
    let y = yoe as i64 + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    let tod = secs % 86_400;
    let hh = tod / 3600;
    let mm = (tod % 3600) / 60;
    let ss = tod % 60;
    format!("{y:04}-{m:02}-{d:02}T{hh:02}:{mm:02}:{ss:02}Z")
}

fn is_text_path(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    const EXTS: &[&str] = &[
        ".md",
        ".markdown",
        ".txt",
        ".text",
        ".json",
        ".csv",
        ".tsv",
        ".log",
        ".yaml",
        ".yml",
        ".toml",
        ".xml",
        ".html",
        ".htm",
        ".css",
        ".js",
        ".ts",
        ".tsx",
        ".jsx",
        ".svg",
        ".rst",
        ".org",
        ".ini",
        ".cfg",
        ".conf",
    ];
    EXTS.iter().any(|ext| lower.ends_with(ext))
}

fn sanitize_filename_stem(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' | '\0' => '-',
            c if c.is_control() => '-',
            c => c,
        })
        .collect();
    cleaned
        .trim()
        .trim_matches('.')
        .chars()
        .take(180)
        .collect::<String>()
        .trim()
        .to_string()
}

fn epoch_now() -> i64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0)
}

fn uuid_like() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    format!("{nanos:x}")
}

/// data-model-v0.2 §5 rule 3-4: every Identity's versionIds must exist as
/// artifacts, and headVersionId must be one of them.
fn validate_identities(
    identities: &[Identity],
    artifact_ids: &std::collections::HashSet<String>,
) -> Result<(), String> {
    for identity in identities {
        if identity.version_ids.is_empty() {
            return Err(format!("身份 {} 没有任何版本(versionIds 为空)", identity.id));
        }
        for version_id in &identity.version_ids {
            if !artifact_ids.contains(version_id) {
                return Err(format!(
                    "身份 {} 引用的版本 {} 不是已存在的成果项",
                    identity.id, version_id
                ));
            }
        }
        if !identity.version_ids.contains(&identity.head_version_id) {
            return Err(format!(
                "身份 {} 的 headVersionId {} 不在 versionIds 列表中",
                identity.id, identity.head_version_id
            ));
        }
    }
    Ok(())
}

#[derive(PartialEq, Clone, Copy)]
enum VisitState {
    Visiting,
    Done,
}

/// data-model-v0.2 §5 rule 1-2: `part_of` edges must resolve to a known
/// artifact or identity id, and the resulting graph must be acyclic.
fn validate_part_of_acyclic(
    relations: &[Relation],
    artifact_ids: &std::collections::HashSet<String>,
    identities: &[Identity],
) -> Result<(), String> {
    let identity_ids: std::collections::HashSet<String> =
        identities.iter().map(|i| i.id.clone()).collect();
    let known = |id: &str| identity_ids.contains(id) || artifact_ids.contains(id);

    let mut adjacency: std::collections::HashMap<String, Vec<String>> =
        std::collections::HashMap::new();
    for rel in relations {
        if rel.kind != "part_of" {
            continue;
        }
        if !known(&rel.from) {
            return Err(format!(
                "part_of 关系中 from={} 不是已知的 artifact 或 identity",
                rel.from
            ));
        }
        if !known(&rel.to) {
            return Err(format!(
                "part_of 关系中 to={} 不是已知的 artifact 或 identity",
                rel.to
            ));
        }
        adjacency
            .entry(rel.from.clone())
            .or_default()
            .push(rel.to.clone());
    }

    fn visit(
        node: &str,
        adjacency: &std::collections::HashMap<String, Vec<String>>,
        state: &mut std::collections::HashMap<String, VisitState>,
    ) -> Result<(), String> {
        match state.get(node) {
            Some(VisitState::Visiting) => {
                return Err(format!("part_of 关系存在环，涉及节点: {node}"));
            }
            Some(VisitState::Done) => return Ok(()),
            None => {}
        }
        state.insert(node.to_string(), VisitState::Visiting);
        if let Some(children) = adjacency.get(node) {
            for child in children {
                visit(child, adjacency, state)?;
            }
        }
        state.insert(node.to_string(), VisitState::Done);
        Ok(())
    }

    let mut state: std::collections::HashMap<String, VisitState> = std::collections::HashMap::new();
    let nodes: Vec<String> = adjacency.keys().cloned().collect();
    for node in nodes {
        visit(&node, &adjacency, &mut state)?;
    }

    Ok(())
}

fn enrich_relations(
    manifest_artifacts: &[Artifact],
    artifacts: &[ArtifactView],
    explicit: Vec<Relation>,
) -> Vec<Relation> {
    let mut merged = explicit;
    let mut existing: std::collections::HashSet<String> = merged
        .iter()
        .map(|r| format!("{}->{}", r.from, r.to))
        .collect();

    let ids: Vec<String> = manifest_artifacts.iter().map(|a| a.id.clone()).collect();
    let file_names: Vec<String> = manifest_artifacts
        .iter()
        .map(|a| {
            a.file_ref
                .file_name
                .clone()
                .unwrap_or_else(|| a.file_ref.path.clone())
        })
        .collect();

    for view in artifacts {
        if view.artifact.kind != "markdown" || !view.reachable {
            continue;
        }
        let Ok(content) = fs::read_to_string(&view.absolute_path) else {
            continue;
        };
        for inferred in infer_relations_from_markdown(
            &view.artifact.id,
            &content,
            &ids,
            &file_names,
        ) {
            let key = format!("{}->{}", inferred.from, inferred.to);
            if existing.insert(key) {
                merged.push(inferred);
            }
        }
    }

    merged
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ids(items: &[&str]) -> std::collections::HashSet<String> {
        items.iter().map(|s| s.to_string()).collect()
    }

    fn identity(id: &str, versions: &[&str], head: &str) -> Identity {
        Identity {
            id: id.to_string(),
            display_name: id.to_string(),
            kind: "markdown".to_string(),
            head_version_id: head.to_string(),
            version_ids: versions.iter().map(|s| s.to_string()).collect(),
            created_at: "0".to_string(),
            updated_at: "0".to_string(),
        }
    }

    fn part_of(from: &str, to: &str) -> Relation {
        Relation {
            id: format!("{from}->{to}"),
            from: from.to_string(),
            to: to.to_string(),
            kind: "part_of".to_string(),
            label: None,
            inferred: None,
        }
    }

    #[test]
    fn validate_identities_accepts_valid_chain() {
        let artifacts = ids(&["heroine-v1", "heroine-v2", "heroine-final"]);
        let identities = vec![identity(
            "heroine",
            &["heroine-v1", "heroine-v2", "heroine-final"],
            "heroine-final",
        )];
        assert!(validate_identities(&identities, &artifacts).is_ok());
    }

    #[test]
    fn validate_identities_rejects_unknown_version() {
        let artifacts = ids(&["heroine-v1"]);
        let identities = vec![identity("heroine", &["heroine-v1", "heroine-ghost"], "heroine-v1")];
        assert!(validate_identities(&identities, &artifacts).is_err());
    }

    #[test]
    fn validate_identities_rejects_head_not_in_versions() {
        let artifacts = ids(&["heroine-v1", "heroine-v2"]);
        let identities = vec![identity("heroine", &["heroine-v1"], "heroine-v2")];
        assert!(validate_identities(&identities, &artifacts).is_err());
    }

    #[test]
    fn part_of_accepts_dag_across_artifacts_and_identities() {
        let artifacts = ids(&["grass", "tree", "episode-script"]);
        let identities = vec![
            identity("tileset-forest", &["grass"], "grass"),
            identity("episode-01", &["episode-script"], "episode-script"),
        ];
        let relations = vec![
            part_of("grass", "tileset-forest"),
            part_of("tree", "tileset-forest"),
            part_of("tileset-forest", "episode-01"),
            part_of("episode-script", "episode-01"),
        ];
        assert!(validate_part_of_acyclic(&relations, &artifacts, &identities).is_ok());
    }

    #[test]
    fn part_of_rejects_cycle() {
        let artifacts = ids(&["a", "b", "c"]);
        let identities: Vec<Identity> = vec![];
        let relations = vec![part_of("a", "b"), part_of("b", "c"), part_of("c", "a")];
        assert!(validate_part_of_acyclic(&relations, &artifacts, &identities).is_err());
    }

    #[test]
    fn part_of_rejects_unknown_node() {
        let artifacts = ids(&["a"]);
        let identities: Vec<Identity> = vec![];
        let relations = vec![part_of("a", "ghost")];
        assert!(validate_part_of_acyclic(&relations, &artifacts, &identities).is_err());
    }

    #[test]
    fn import_example_package_end_to_end() {
        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        let example_path = fs::canonicalize(Path::new(manifest_dir).join("../examples/packages/nightbell.wbom"))
            .expect("example package must exist at examples/packages/nightbell.wbom");

        let vault_dir = std::env::temp_dir().join(format!(
            "workboms-test-{}-{}",
            std::process::id(),
            chrono_now()
        ));
        let _ = fs::remove_dir_all(&vault_dir);

        let service = LibraryService::new(vault_dir.clone()).expect("service init");
        service.ensure_vault().expect("ensure vault");

        let summary = service
            .import_package(example_path.to_str().unwrap())
            .expect("import should succeed with schema v2.0 example package");

        let detail = service
            .load_package_detail(&summary.id)
            .expect("load detail");

        assert_eq!(detail.identities.len(), 2, "expected series-bible + episode-01 identities");
        assert!(
            detail.relations.iter().any(|r| r.kind == "part_of"),
            "expected at least one part_of relation"
        );
        assert!(
            detail
                .identities
                .iter()
                .find(|i| i.id == "series-bible")
                .map(|i| i.version_ids.len() == 2)
                .unwrap_or(false),
            "series-bible identity should have 2 versions (draft + final)"
        );

        let _ = fs::remove_dir_all(&vault_dir);
    }

    #[test]
    fn import_game_demo_package_end_to_end() {
        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        let example_path = fs::canonicalize(Path::new(manifest_dir).join("../examples/packages/game-demo.wbom"))
            .expect("example package must exist at examples/packages/game-demo.wbom");

        let vault_dir = std::env::temp_dir().join(format!(
            "workboms-test-gamedemo-{}-{}",
            std::process::id(),
            chrono_now()
        ));
        let _ = fs::remove_dir_all(&vault_dir);

        let service = LibraryService::new(vault_dir.clone()).expect("service init");
        service.ensure_vault().expect("ensure vault");

        let summary = service
            .import_package(example_path.to_str().unwrap())
            .expect("import should succeed for the game-demo BOM/Identity showcase package");

        let detail = service
            .load_package_detail(&summary.id)
            .expect("load detail");

        assert_eq!(detail.identities.len(), 5, "expected 5 identities (worldbuilding/heroine-rig/mechanics-lv1/level-01/game-project)");
        assert_eq!(detail.artifacts.len(), 24);

        let part_of_count = detail.relations.iter().filter(|r| r.kind == "part_of").count();
        assert_eq!(part_of_count, 19, "expected 19 part_of edges forming the assembly DAG");

        // grass is reused across two tilesets — verifies DAG (not tree) composition.
        let grass_parents: Vec<_> = detail
            .relations
            .iter()
            .filter(|r| r.kind == "part_of" && r.from == "grass")
            .collect();
        assert_eq!(grass_parents.len(), 2, "grass should be part_of both tileset-forest and tileset-swamp");

        let heroine_rig = detail
            .identities
            .iter()
            .find(|i| i.id == "heroine-rig")
            .expect("heroine-rig identity present");
        assert_eq!(heroine_rig.head_version_id, "heroine-rig-v2");
        assert_eq!(heroine_rig.kind, "composite");

        let _ = fs::remove_dir_all(&vault_dir);
    }

    #[test]
    fn import_echo_city_package_end_to_end() {
        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        let example_path = fs::canonicalize(Path::new(manifest_dir).join("../examples/packages/echo-city.wbom"))
            .expect("example package must exist at examples/packages/echo-city.wbom");

        let vault_dir = std::env::temp_dir().join(format!(
            "workboms-test-echocity-{}-{}",
            std::process::id(),
            chrono_now()
        ));
        let _ = fs::remove_dir_all(&vault_dir);

        let service = LibraryService::new(vault_dir.clone()).expect("service init");
        service.ensure_vault().expect("ensure vault");

        let summary = service
            .import_package(example_path.to_str().unwrap())
            .expect("import should succeed for the echo-city mid-size episode showcase package");

        let detail = service
            .load_package_detail(&summary.id)
            .expect("load detail");

        assert_eq!(detail.artifacts.len(), 64);
        assert_eq!(detail.identities.len(), 7);

        let episode = detail
            .identities
            .iter()
            .find(|i| i.id == "echo-city-ep01")
            .expect("episode identity present");
        assert_eq!(episode.head_version_id, "edit-assembly-v2-final");
        assert_eq!(episode.kind, "composite");

        // mira is reused across three separate shots — verifies DAG reuse
        // at scale (not just a toy example).
        let mira_shot_edges = detail
            .relations
            .iter()
            .filter(|r| r.kind == "part_of" && r.from == "char-mira")
            .count();
        assert_eq!(mira_shot_edges, 4, "char-mira should be part_of 4 shots");

        let _ = fs::remove_dir_all(&vault_dir);
    }

    #[test]
    fn import_sonnies_edge_package_end_to_end() {
        let manifest_dir = env!("CARGO_MANIFEST_DIR");
        let example_path =
            fs::canonicalize(Path::new(manifest_dir).join("../examples/packages/sonnies-edge.wbom"))
                .expect("example package must exist at examples/packages/sonnies-edge.wbom");

        let vault_dir = std::env::temp_dir().join(format!(
            "workboms-test-sonniesedge-{}-{}",
            std::process::id(),
            chrono_now()
        ));
        let _ = fs::remove_dir_all(&vault_dir);

        let service = LibraryService::new(vault_dir.clone()).expect("service init");
        service.ensure_vault().expect("ensure vault");

        let summary = service
            .import_package(example_path.to_str().unwrap())
            .expect("import should succeed for the sonnies-edge full-episode showcase package");

        let detail = service
            .load_package_detail(&summary.id)
            .expect("load detail");

        assert_eq!(detail.artifacts.len(), 120);
        assert_eq!(detail.identities.len(), 11);

        let sonnie = detail
            .identities
            .iter()
            .find(|i| i.id == "char-sonnie")
            .expect("sonnie identity present");
        assert_eq!(sonnie.head_version_id, "sonnie-concept-final");

        // Sonnie's concept art is reused across many shots — verifies BOM
        // reuse holds up at 100+ artifact scale, not just toy examples.
        let sonnie_shot_uses = detail
            .relations
            .iter()
            .filter(|r| r.kind == "uses" && r.to == "sonnie-concept-final")
            .count();
        assert!(
            sonnie_shot_uses >= 5,
            "sonnie-concept-final should be used by several shots"
        );

        let _ = fs::remove_dir_all(&vault_dir);
    }

    #[test]
    fn import_obsidian_vault_infers_wikilinks() {
        let obsidian_root = std::env::temp_dir().join(format!(
            "workboms-obsidian-src-{}-{}",
            std::process::id(),
            chrono_now()
        ));
        let vault_dir = std::env::temp_dir().join(format!(
            "workboms-obsidian-lib-{}-{}",
            std::process::id(),
            chrono_now()
        ));
        let _ = fs::remove_dir_all(&obsidian_root);
        let _ = fs::remove_dir_all(&vault_dir);
        // No .obsidian folder — Obsidian vaults are just markdown trees.
        fs::create_dir_all(&obsidian_root).unwrap();
        fs::write(
            obsidian_root.join("Welcome.md"),
            "Hello [[Projects/Alpha]]\n",
        )
        .unwrap();
        fs::create_dir_all(obsidian_root.join("Projects")).unwrap();
        fs::write(
            obsidian_root.join("Projects/Alpha.md"),
            "Back to [[Welcome]]\n",
        )
        .unwrap();

        let service = LibraryService::new(vault_dir.clone()).expect("service init");
        service.ensure_vault().expect("ensure vault");

        let summary = service
            .import_package(obsidian_root.to_str().unwrap())
            .expect("local directory import");
        assert!(summary.id.starts_with("vault-"));

        let detail = service
            .load_package_detail(&summary.id)
            .expect("load detail");
        assert_eq!(detail.artifacts.len(), 2);
        assert!(
            detail.relations.iter().any(|r| {
                r.kind == "references" && r.inferred == Some(true) && r.label.as_deref() == Some("wikilink")
            }),
            "expected inferred wikilink relations, got {:?}",
            detail.relations
        );

        let _ = fs::remove_dir_all(&obsidian_root);
        let _ = fs::remove_dir_all(&vault_dir);
    }
}
