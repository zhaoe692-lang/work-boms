use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use notify::{Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter, Manager};

use crate::library::LibraryService;

fn library_service(app: &AppHandle) -> Result<LibraryService, String> {
    let vault_path = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("无法获取应用数据目录: {e}"))?;
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|e| format!("无法获取应用资源目录: {e}"))?;
    let model_dir = resource_dir.join("resources/models/bge-small-zh-v1.5-int8");
    let service = LibraryService::new_with_model_dir(vault_path, model_dir)?;
    service.ensure_vault()?;
    Ok(service)
}

const DEBOUNCE: Duration = Duration::from_millis(1200);

struct WatchState {
    /// path → package_id
    roots: HashMap<PathBuf, String>,
    pending: HashMap<String, Instant>,
    watcher: Option<RecommendedWatcher>,
}

pub struct LibraryWatcher {
    inner: Arc<Mutex<WatchState>>,
}

impl LibraryWatcher {
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Mutex::new(WatchState {
                roots: HashMap::new(),
                pending: HashMap::new(),
                watcher: None,
            })),
        }
    }

    pub fn sync_roots(&self, app: &AppHandle) -> Result<usize, String> {
        let service = library_service(app)?;
        let roots = service.watch_roots()?;
        let mut state = self
            .inner
            .lock()
            .map_err(|_| "文件监听锁损坏".to_string())?;

        let mut next_map = HashMap::new();
        for (package_id, root) in roots {
            let path = PathBuf::from(&root);
            if path.is_dir() {
                next_map.insert(path, package_id);
            }
        }

        let app_handle = app.clone();
        let pending_state = self.inner.clone();
        let mut watcher = notify::recommended_watcher(move |res: Result<Event, notify::Error>| {
            let Ok(event) = res else { return };
            if !is_relevant(&event.kind) {
                return;
            }
            let Ok(mut guard) = pending_state.lock() else { return };
            for path in event.paths {
                if let Some(package_id) = package_for_path(&guard.roots, &path) {
                    guard.pending.insert(package_id, Instant::now());
                }
            }
            drop(guard);
            schedule_flush(app_handle.clone(), pending_state.clone());
        })
        .map_err(|e| format!("无法启动文件监听: {e}"))?;

        for path in next_map.keys() {
            let _ = watcher.watch(path, RecursiveMode::Recursive);
        }

        state.roots = next_map;
        state.watcher = Some(watcher);
        Ok(state.roots.len())
    }
}

fn is_relevant(kind: &EventKind) -> bool {
    matches!(
        kind,
        EventKind::Create(_) | EventKind::Modify(_) | EventKind::Remove(_)
    )
}

fn package_for_path(roots: &HashMap<PathBuf, String>, path: &Path) -> Option<String> {
    let mut best: Option<(usize, String)> = None;
    for (root, package_id) in roots {
        if path.starts_with(root) {
            let len = root.as_os_str().len();
            if best.as_ref().map(|(l, _)| len > *l).unwrap_or(true) {
                best = Some((len, package_id.clone()));
            }
        }
    }
    best.map(|(_, id)| id)
}

fn schedule_flush(app: AppHandle, state: Arc<Mutex<WatchState>>) {
    std::thread::spawn(move || {
        std::thread::sleep(DEBOUNCE);
        let Ok(mut guard) = state.lock() else { return };
        let now = Instant::now();
        let due: Vec<String> = guard
            .pending
            .iter()
            .filter(|(_, at)| now.duration_since(**at) >= DEBOUNCE)
            .map(|(id, _)| id.clone())
            .collect();
        for id in &due {
            guard.pending.remove(id);
        }
        drop(guard);

        for package_id in due {
            if let Ok(service) = library_service(&app) {
                if service.reindex_package(&package_id).is_ok() {
                    let _ = app.emit(
                        "package-reindexed",
                        serde_json::json!({ "packageId": package_id }),
                    );
                }
            }
        }
    });
}

pub fn init_watcher(app: &AppHandle) -> Result<(), String> {
    let watcher = LibraryWatcher::new();
    let count = watcher.sync_roots(app)?;
    app.manage(watcher);
    let _ = count;
    Ok(())
}

pub fn sync_watchers(app: &AppHandle) -> Result<usize, String> {
    if let Some(watcher) = app.try_state::<LibraryWatcher>() {
        watcher.sync_roots(app)
    } else {
        init_watcher(app)?;
        app.state::<LibraryWatcher>().sync_roots(app)
    }
}
