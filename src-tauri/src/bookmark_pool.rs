use std::path::Path;
use std::sync::Mutex;

use crate::bookmark::AccessGuard;
use crate::bookmarks_store::BookmarkStore;

static BOOKMARK_POOL: Mutex<Vec<AccessGuard>> = Mutex::new(Vec::new());

pub fn extend_pool(guards: Vec<AccessGuard>) {
    if let Ok(mut pool) = BOOKMARK_POOL.lock() {
        pool.extend(guards);
    }
}

pub fn warmup_package(package_dir: &Path) {
    let store = BookmarkStore::load(package_dir);
    let session = store.activate_all();
    session.retain_in_pool();
}

pub fn warmup_vault(vault_path: &Path, package_ids: &[String]) {
    for package_id in package_ids {
        let package_dir = vault_path.join("packages").join(package_id);
        if package_dir.exists() {
            warmup_package(&package_dir);
        }
    }
}
