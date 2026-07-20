use tauri::{AppHandle, Manager};

use crate::library::LibraryService;
use crate::models::{
    ArtifactKey, FinalItem, InspirationBoard, InspirationBoardSummary, LibraryState,
    PackageDetail, PackageSummary, TrashItem, TrashQuery,
};
use crate::plugins::{PluginCatalogState, PluginInfo, PluginService};

pub fn library_for(app: &AppHandle) -> Result<LibraryService, String> {
    let vault_path = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取应用数据目录: {e}"))?;
    let resource_dir = app.path().resource_dir().map_err(|e| format!("无法获取应用资源目录: {e}"))?;
    let model_dir = resource_dir.join("resources/models/bge-small-zh-v1.5-int8");
    let service = LibraryService::new_with_model_dir(vault_path, model_dir)?;
    service.ensure_vault()?;
    Ok(service)
}

pub fn plugins_for(app: &AppHandle) -> Result<PluginService, String> {
    let vault_path = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取应用数据目录: {e}"))?;
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("无法获取应用资源目录: {e}"))?;
    let service = PluginService::new(vault_path, resource_dir);
    service.ensure()?;
    Ok(service)
}

#[tauri::command]
pub fn get_library(app: AppHandle) -> Result<LibraryState, String> {
    library_for(&app)?.get_library_state()
}

#[tauri::command]
pub fn import_package(app: AppHandle, source_path: String) -> Result<PackageSummary, String> {
    library_for(&app)?.import_package(&source_path)
}

#[tauri::command]
pub fn get_package_detail(app: AppHandle, package_id: String) -> Result<PackageDetail, String> {
    library_for(&app)?.load_package_detail(&package_id)
}

#[tauri::command]
pub fn get_package_metrics(
    app: AppHandle,
    package_id: String,
) -> Result<crate::metrics::Metrics, String> {
    library_for(&app)?.get_package_metrics(&package_id)
}

#[tauri::command]
pub fn read_artifact_text(
    app: AppHandle,
    package_id: String,
    artifact_id: String,
) -> Result<String, String> {
    library_for(&app)?.read_artifact_text(&package_id, &artifact_id)
}

#[tauri::command]
pub fn write_artifact_text(
    app: AppHandle,
    package_id: String,
    artifact_id: String,
    contents: String,
) -> Result<crate::models::PackageDetail, String> {
    library_for(&app)?.write_artifact_text(&package_id, &artifact_id, &contents)
}

#[tauri::command]
pub fn list_finals(app: AppHandle) -> Result<Vec<FinalItem>, String> {
    let service = library_for(&app)?;
    let state = service.get_library_state()?;
    let mut finals = Vec::new();

    for pkg in state.packages {
        let detail = service.load_package_detail(&pkg.id)?;
        for artifact in detail.artifacts {
            if artifact.artifact.status == "final" {
                finals.push(FinalItem {
                    package_id: pkg.id.clone(),
                    package_title: pkg.title.clone(),
                    artifact: artifact.artifact,
                    absolute_path: artifact.absolute_path,
                    reachable: artifact.reachable,
                });
            }
        }
    }

    finals.sort_by(|a, b| a.artifact.display_name.cmp(&b.artifact.display_name));
    Ok(finals)
}

#[tauri::command]
pub fn relocate_artifact_file(
    app: AppHandle,
    package_id: String,
    artifact_id: String,
    new_absolute_path: String,
) -> Result<PackageDetail, String> {
    library_for(&app)?.relocate_artifact_file(&package_id, &artifact_id, &new_absolute_path)
}

#[tauri::command]
pub fn search_artifacts(
    app: AppHandle,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<crate::search_index::SearchHit>, String> {
    library_for(&app)?.search_artifacts(&query, limit.unwrap_or(40))
}

#[tauri::command]
pub async fn search_assets(
    app: AppHandle,
    request: crate::search_index::SearchRequest,
) -> Result<crate::search_index::SearchResponse, String> {
    let vault_path = app.path().app_data_dir().map_err(|e| format!("无法获取应用数据目录: {e}"))?;
    let resource_dir = app.path().resource_dir().map_err(|e| format!("无法获取应用资源目录: {e}"))?;
    let model_dir = resource_dir.join("resources/models/bge-small-zh-v1.5-int8");
    tauri::async_runtime::spawn_blocking(move || {
        let service = LibraryService::new_with_model_dir(vault_path, model_dir)?;
        service.ensure_vault()?;
        service.search_assets(&request)
    }).await.map_err(|e| format!("语义检索任务失败: {e}"))?
}

#[tauri::command]
pub fn list_inspiration_boards(
    app: AppHandle,
    package_id: Option<String>,
) -> Result<Vec<InspirationBoardSummary>, String> {
    library_for(&app)?.list_inspiration_boards(package_id.as_deref())
}

#[tauri::command]
pub fn create_inspiration_board(
    app: AppHandle,
    package_id: Option<String>,
    title: String,
) -> Result<InspirationBoard, String> {
    library_for(&app)?.create_inspiration_board(package_id.as_deref(), &title)
}

#[tauri::command]
pub fn get_inspiration_board(app: AppHandle, board_id: String) -> Result<InspirationBoard, String> {
    library_for(&app)?.get_inspiration_board(&board_id)
}

#[tauri::command]
pub fn save_inspiration_board(
    app: AppHandle,
    board: InspirationBoard,
    expected_version: i64,
) -> Result<InspirationBoard, String> {
    library_for(&app)?.save_inspiration_board(&board, expected_version)
}

#[tauri::command]
pub fn delete_inspiration_board(app: AppHandle, board_id: String) -> Result<(), String> {
    library_for(&app)?.delete_inspiration_board(&board_id)
}

#[tauri::command]
pub fn list_trash(app: AppHandle, query: TrashQuery) -> Result<Vec<TrashItem>, String> {
    library_for(&app)?.list_trash(&query)
}

#[tauri::command]
pub fn move_artifacts_to_trash(
    app: AppHandle,
    package_id: String,
    artifact_ids: Vec<String>,
    deleted_by: Option<String>,
) -> Result<usize, String> {
    library_for(&app)?.move_artifacts_to_trash(
        &package_id,
        &artifact_ids,
        deleted_by.as_deref(),
    )
}

#[tauri::command]
pub fn restore_trash_items(app: AppHandle, items: Vec<ArtifactKey>) -> Result<usize, String> {
    library_for(&app)?.restore_trash_items(&items)
}

#[tauri::command]
pub fn permanently_delete_trash_items(
    app: AppHandle,
    items: Vec<ArtifactKey>,
) -> Result<usize, String> {
    library_for(&app)?.permanently_delete_trash_items(&items)
}

#[tauri::command]
pub fn empty_trash(app: AppHandle) -> Result<usize, String> {
    library_for(&app)?.empty_trash()
}

#[tauri::command]
pub fn get_graph_layout(
    app: AppHandle,
    package_id: String,
    mode: String,
    fingerprint: String,
) -> Result<Option<crate::graph_layout::GraphLayoutDocument>, String> {
    Ok(library_for(&app)?.get_graph_layout(&package_id, &mode, &fingerprint))
}

#[tauri::command]
pub fn save_graph_layout(
    app: AppHandle,
    package_id: String,
    layout: crate::graph_layout::GraphLayoutDocument,
) -> Result<(), String> {
    library_for(&app)?.save_graph_layout(&package_id, layout)
}

#[tauri::command]
pub fn reset_graph_layout(app: AppHandle, package_id: String) -> Result<(), String> {
    library_for(&app)?.reset_graph_layout(&package_id)
}

#[tauri::command]
pub fn update_artifact_status(
    app: AppHandle,
    package_id: String,
    artifact_id: String,
    status: String,
) -> Result<PackageDetail, String> {
    library_for(&app)?.update_artifact_status(&package_id, &artifact_id, &status)
}

#[tauri::command]
pub fn update_artifact_meta(
    app: AppHandle,
    package_id: String,
    artifact_id: String,
    role: Option<String>,
    summary: Option<String>,
    tags: Vec<String>,
) -> Result<PackageDetail, String> {
    library_for(&app)?.update_artifact_meta(
        &package_id,
        &artifact_id,
        role.as_deref(),
        summary.as_deref(),
        tags,
    )
}

#[tauri::command]
pub fn batch_update_artifact_status(
    app: AppHandle,
    package_id: String,
    artifact_ids: Vec<String>,
    status: String,
) -> Result<PackageDetail, String> {
    library_for(&app)?.batch_update_artifact_status(&package_id, artifact_ids, &status)
}

#[tauri::command]
pub fn add_relation(
    app: AppHandle,
    package_id: String,
    from: String,
    to: String,
    kind: String,
    label: Option<String>,
) -> Result<PackageDetail, String> {
    library_for(&app)?.add_relation(&package_id, &from, &to, &kind, label.as_deref())
}

#[tauri::command]
pub fn remove_relation(
    app: AppHandle,
    package_id: String,
    relation_id: String,
) -> Result<PackageDetail, String> {
    library_for(&app)?.remove_relation(&package_id, &relation_id)
}

#[tauri::command]
pub fn update_relation_kind(
    app: AppHandle,
    package_id: String,
    relation_id: String,
    kind: String,
    label: Option<String>,
) -> Result<PackageDetail, String> {
    library_for(&app)?.update_relation_kind(
        &package_id,
        &relation_id,
        &kind,
        label.as_deref(),
    )
}

#[tauri::command]
pub fn set_work_membership(
    app: AppHandle,
    package_id: String,
    work_id: String,
    artifact_id: String,
    include: bool,
) -> Result<PackageDetail, String> {
    library_for(&app)?.set_work_membership(&package_id, &work_id, &artifact_id, include)
}

#[tauri::command]
pub fn update_package_meta(
    app: AppHandle,
    package_id: String,
    title: String,
    summary: Option<String>,
) -> Result<PackageDetail, String> {
    library_for(&app)?.update_package_meta(&package_id, &title, summary.as_deref())
}

#[tauri::command]
pub fn remove_package(app: AppHandle, package_id: String) -> Result<(), String> {
    library_for(&app)?.remove_package(&package_id)
}

#[tauri::command]
pub fn reindex_package(app: AppHandle, package_id: String) -> Result<(), String> {
    library_for(&app)?.reindex_package(&package_id)
}

#[tauri::command]
pub fn sync_library_watchers(app: AppHandle) -> Result<usize, String> {
    crate::file_watch::sync_watchers(&app)
}

#[tauri::command]
pub fn purge_expired_trash(app: AppHandle) -> Result<usize, String> {
    library_for(&app)?.purge_expired_trash()
}

#[tauri::command]
pub fn export_package(
    app: AppHandle,
    package_id: String,
    target_dir: String,
) -> Result<String, String> {
    library_for(&app)?.export_package(&package_id, &target_dir)
}

#[tauri::command]
pub fn write_text_file(app: AppHandle, path: String, contents: String) -> Result<(), String> {
    let _ = app;
    std::fs::create_dir_all(
        std::path::Path::new(&path)
            .parent()
            .unwrap_or_else(|| std::path::Path::new(".")),
    )
    .map_err(|e| format!("无法创建目录: {e}"))?;
    std::fs::write(&path, contents).map_err(|e| format!("无法写入文件: {e}"))
}

#[tauri::command]
pub fn write_bytes_file(app: AppHandle, path: String, bytes: Vec<u8>) -> Result<(), String> {
    let _ = app;
    std::fs::create_dir_all(
        std::path::Path::new(&path)
            .parent()
            .unwrap_or_else(|| std::path::Path::new(".")),
    )
    .map_err(|e| format!("无法创建目录: {e}"))?;
    std::fs::write(&path, bytes).map_err(|e| format!("无法写入文件: {e}"))
}

#[tauri::command]
pub fn rename_artifact(
    app: AppHandle,
    package_id: String,
    artifact_id: String,
    display_name: String,
) -> Result<PackageDetail, String> {
    library_for(&app)?.rename_artifact(&package_id, &artifact_id, &display_name)
}

#[tauri::command]
pub fn import_artifact_file(
    app: AppHandle,
    package_id: String,
    absolute_path: String,
    display_name: Option<String>,
) -> Result<PackageDetail, String> {
    library_for(&app)?.import_artifact_file(
        &package_id,
        &absolute_path,
        display_name.as_deref(),
    )
}

#[tauri::command]
pub fn create_work(
    app: AppHandle,
    package_id: String,
    title: String,
    summary: Option<String>,
) -> Result<PackageDetail, String> {
    library_for(&app)?.create_work(&package_id, &title, summary.as_deref())
}

#[tauri::command]
pub fn rename_work(
    app: AppHandle,
    package_id: String,
    work_id: String,
    title: String,
    summary: Option<String>,
) -> Result<PackageDetail, String> {
    library_for(&app)?.rename_work(&package_id, &work_id, &title, summary.as_deref())
}

#[tauri::command]
pub fn delete_work(
    app: AppHandle,
    package_id: String,
    work_id: String,
) -> Result<PackageDetail, String> {
    library_for(&app)?.delete_work(&package_id, &work_id)
}

#[tauri::command]
pub fn merge_identities(
    app: AppHandle,
    package_id: String,
    keep_id: String,
    absorb_id: String,
) -> Result<PackageDetail, String> {
    library_for(&app)?.merge_identities(&package_id, &keep_id, &absorb_id)
}

#[tauri::command]
pub fn split_identity(
    app: AppHandle,
    package_id: String,
    identity_id: String,
    artifact_ids: Vec<String>,
    new_display_name: String,
) -> Result<PackageDetail, String> {
    library_for(&app)?.split_identity(
        &package_id,
        &identity_id,
        artifact_ids,
        &new_display_name,
    )
}

#[tauri::command]
pub fn set_identity_head(
    app: AppHandle,
    package_id: String,
    identity_id: String,
    head_version_id: String,
) -> Result<PackageDetail, String> {
    library_for(&app)?.set_identity_head(&package_id, &identity_id, &head_version_id)
}

#[tauri::command]
pub fn accept_suggested_relation(
    app: AppHandle,
    package_id: String,
    from: String,
    to: String,
    kind: String,
    label: Option<String>,
) -> Result<PackageDetail, String> {
    library_for(&app)?.accept_suggested_relation(
        &package_id,
        &from,
        &to,
        &kind,
        label.as_deref(),
    )
}

#[tauri::command]
pub fn reject_suggested_relation(
    app: AppHandle,
    package_id: String,
    from: String,
    to: String,
) -> Result<PackageDetail, String> {
    library_for(&app)?.reject_suggested_relation(&package_id, &from, &to)
}

#[tauri::command]
pub fn get_plugin_catalog(app: AppHandle) -> Result<PluginCatalogState, String> {
    plugins_for(&app)?.get_catalog()
}

#[tauri::command]
pub fn import_plugin(
    app: AppHandle,
    source_path: String,
    overwrite: bool,
) -> Result<PluginInfo, String> {
    plugins_for(&app)?.import_plugin(&source_path, overwrite)
}

#[tauri::command]
pub fn export_plugin(
    app: AppHandle,
    plugin_id: String,
    dest_dir: String,
) -> Result<String, String> {
    plugins_for(&app)?.export_plugin(&plugin_id, &dest_dir)
}

#[tauri::command]
pub fn uninstall_plugin(app: AppHandle, plugin_id: String) -> Result<(), String> {
    plugins_for(&app)?.uninstall_plugin(&plugin_id)
}

#[tauri::command]
pub fn set_plugin_enabled(
    app: AppHandle,
    plugin_id: String,
    enabled: bool,
) -> Result<PluginInfo, String> {
    plugins_for(&app)?.set_plugin_enabled(&plugin_id, enabled)
}

#[tauri::command]
pub fn install_bundled_plugin(app: AppHandle, plugin_id: String) -> Result<PluginInfo, String> {
    plugins_for(&app)?.install_bundled(&plugin_id)
}
