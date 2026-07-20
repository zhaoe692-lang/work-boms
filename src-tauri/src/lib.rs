mod bookmark;
mod bookmark_pool;
mod bookmarks_store;
mod commands;
mod dismissed_suggestions;
mod file_watch;
mod graph_layout;
mod inspiration_store;
mod library;
mod metrics;
mod models;
mod obsidian;
mod plugins;
mod search_index;
mod store;
mod trash_store;
mod wikilink;

use commands::{
    accept_suggested_relation, add_relation, batch_update_artifact_status,
    create_inspiration_board, create_work, delete_inspiration_board, delete_work, empty_trash,
    export_package, export_plugin, get_graph_layout, get_inspiration_board, get_library,
    get_package_detail, get_package_metrics, get_plugin_catalog, import_artifact_file,
    import_package, import_plugin, install_bundled_plugin, list_finals, list_inspiration_boards,
    list_trash, merge_identities, move_artifacts_to_trash, permanently_delete_trash_items,
    purge_expired_trash, read_artifact_text, reindex_package, reject_suggested_relation,
    write_artifact_text,
    relocate_artifact_file, remove_package, remove_relation, rename_artifact, rename_work,
    reset_graph_layout, restore_trash_items, save_graph_layout, save_inspiration_board,
    search_artifacts, search_assets, set_identity_head, set_plugin_enabled, set_work_membership,
    split_identity, sync_library_watchers, uninstall_plugin, update_artifact_meta,
    update_artifact_status, update_package_meta, update_relation_kind, write_bytes_file,
    write_text_file,
};
use tauri::Manager;

fn focus_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        if window.is_minimized().unwrap_or(false) {
            let _ = window.unminimize();
        }
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_library,
            import_package,
            get_package_detail,
            get_package_metrics,
            read_artifact_text,
            write_artifact_text,
            list_finals,
            relocate_artifact_file,
            search_artifacts,
            search_assets,
            list_inspiration_boards,
            create_inspiration_board,
            get_inspiration_board,
            save_inspiration_board,
            delete_inspiration_board,
            list_trash,
            move_artifacts_to_trash,
            restore_trash_items,
            permanently_delete_trash_items,
            empty_trash,
            get_graph_layout,
            save_graph_layout,
            reset_graph_layout,
            update_artifact_status,
            update_artifact_meta,
            batch_update_artifact_status,
            add_relation,
            remove_relation,
            update_relation_kind,
            set_work_membership,
            update_package_meta,
            remove_package,
            reindex_package,
            sync_library_watchers,
            purge_expired_trash,
            export_package,
            write_text_file,
            write_bytes_file,
            rename_artifact,
            import_artifact_file,
            create_work,
            rename_work,
            delete_work,
            merge_identities,
            split_identity,
            set_identity_head,
            accept_suggested_relation,
            reject_suggested_relation,
            get_plugin_catalog,
            import_plugin,
            export_plugin,
            uninstall_plugin,
            set_plugin_enabled,
            install_bundled_plugin,
        ])
        .setup(|app| {
            focus_main_window(app.handle());
            let _ = file_watch::init_watcher(app.handle());
            // Preinstall official plugins (export-wbom) on first launch / upgrade.
            if let Ok(plugins) = commands::plugins_for(app.handle()) {
                let _ = plugins.get_catalog();
            }
            // Background TTL purge: once at launch, then hourly.
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                loop {
                    if let Ok(service) = commands::library_for(&handle) {
                        let _ = service.purge_expired_trash();
                    }
                    std::thread::sleep(std::time::Duration::from_secs(60 * 60));
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            // macOS: red traffic-light / Cmd+W hides instead of quitting.
            // Dock click / Reopen brings the window back (see run() below).
            #[cfg(target_os = "macos")]
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
            #[cfg(not(target_os = "macos"))]
            {
                let _ = (window, &event);
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            // On macOS, clicking the Dock icon (or re-opening the app) fires
            // Reopen. Bring the existing window back to the front and focus it
            // instead of leaving focus on whatever app was in front.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                focus_main_window(app_handle);
            }
            #[cfg(not(target_os = "macos"))]
            {
                let _ = (app_handle, &event);
            }
        });
}
