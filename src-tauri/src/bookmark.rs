#[cfg(target_os = "macos")]
mod macos {
    use std::path::PathBuf;

    use base64::{engine::general_purpose::STANDARD, Engine as _};
    use objc2::rc::Retained;
    use objc2_foundation::{
        NSData, NSError, NSString, NSURL, NSURLBookmarkCreationOptions, NSURLBookmarkResolutionOptions,
    };

    use crate::bookmarks_store::BookmarkEntry;

    pub struct AccessGuard {
        url: Retained<NSURL>,
        active: bool,
    }

    impl AccessGuard {
        pub fn resolved_path(&self) -> PathBuf {
            self.url
                .path()
                .map(|s| s.to_string())
                .unwrap_or_default()
                .into()
        }
    }

    impl Drop for AccessGuard {
        fn drop(&mut self) {
            if self.active {
                unsafe {
                    self.url.stopAccessingSecurityScopedResource();
                }
            }
        }
    }

    pub fn create_bookmark(path: &str) -> Result<Vec<u8>, String> {
        let path_ns = NSString::from_str(path);
        let url = NSURL::fileURLWithPath(&path_ns);
        let options = NSURLBookmarkCreationOptions::WithSecurityScope;

        let data = url
            .bookmarkDataWithOptions_includingResourceValuesForKeys_relativeToURL_error(
                options,
                None,
                None,
            )
            .map_err(nserror_to_string)?;

        Ok(data.to_vec())
    }

    pub fn access_from_stored(entry: &BookmarkEntry) -> Result<AccessGuard, String> {
        let bytes = STANDARD
            .decode(&entry.bookmark_base64)
            .map_err(|e| format!("书签 base64 解码失败: {e}"))?;
        let data = NSData::with_bytes(&bytes);
        let mut stale = objc2::runtime::Bool::NO;

        let url = unsafe {
            NSURL::URLByResolvingBookmarkData_options_relativeToURL_bookmarkDataIsStale_error(
                &data,
                NSURLBookmarkResolutionOptions::WithSecurityScope,
                None,
                &mut stale,
            )
        }
        .map_err(nserror_to_string)?;

        let active = unsafe { url.startAccessingSecurityScopedResource() };
        Ok(AccessGuard { url, active })
    }

    fn nserror_to_string(error: Retained<NSError>) -> String {
        error.localizedDescription().to_string()
    }
}

#[cfg(not(target_os = "macos"))]
mod macos {
    use crate::bookmarks_store::BookmarkEntry;

    pub struct AccessGuard;

    impl AccessGuard {
        pub fn resolved_path(&self) -> std::path::PathBuf {
            std::path::PathBuf::new()
        }
    }

    pub fn create_bookmark(_path: &str) -> Result<Vec<u8>, String> {
        Ok(Vec::new())
    }

    pub fn access_from_stored(_entry: &BookmarkEntry) -> Result<AccessGuard, String> {
        Ok(AccessGuard)
    }
}

pub use macos::{access_from_stored, create_bookmark, AccessGuard};
