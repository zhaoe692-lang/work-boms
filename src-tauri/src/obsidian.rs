//! Synthesize a WorkBOM package from a local project directory (link-only).
//!
//! Two import paths share `import_package`:
//! 1. Plugin / AI package: directory with `manifest.json` (.wbom)
//! 2. Local directory: scan files in place, one Artifact per file, group by folder
//!
//! Files stay on disk under `projectRoot`. Markdown `[[wikilinks]]` become
//! inferred relations on package load.

use crate::models::{
    Artifact, FileRef, IdentitiesDocument, PackageManifest, Provenance, RelationsDocument,
    WorksDocument, Work, SCHEMA_VERSION,
};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const SKIP_DIR_NAMES: &[&str] = &[
    ".obsidian",
    ".trash",
    ".git",
    ".smart-env",
    "node_modules",
    ".wbom",
    "__MACOSX",
];

const SKIP_FILE_NAMES: &[&str] = &[".ds_store", "thumbs.db", "desktop.ini"];

/// True when the folder has at least one importable file (not a .wbom package check).
pub fn looks_like_local_directory(path: &Path) -> bool {
    if !path.is_dir() {
        return false;
    }
    collect_project_files(path)
        .map(|files| !files.is_empty())
        .unwrap_or(false)
}

/// Build an in-memory WorkBOM package from a local directory root.
pub fn synthesize_from_vault(
    vault: &Path,
) -> Result<(PackageManifest, RelationsDocument, WorksDocument, IdentitiesDocument), String> {
    if !vault.is_dir() {
        return Err("error.import.not_directory".to_string());
    }

    let canonical = fs::canonicalize(vault).unwrap_or_else(|_| vault.to_path_buf());
    let files = collect_project_files(&canonical)?;
    if files.is_empty() {
        return Err("error.import.obsidian_empty".to_string());
    }

    let now = iso_now();
    let title = vault_title(&canonical);
    let package_id = format!("vault-{}", short_hash(&canonical.to_string_lossy()));
    let slug = slugify(&title);

    let mut works_by_folder: HashMap<String, Vec<String>> = HashMap::new();
    let mut artifacts = Vec::with_capacity(files.len());
    let mut used_ids = HashSet::new();

    for abs in &files {
        let rel = abs
            .strip_prefix(&canonical)
            .map(|p| p.to_path_buf())
            .unwrap_or_else(|_| abs.clone());
        let rel_str = path_to_unix(&rel);
        let file_name = abs
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "file".to_string());
        let stem = abs
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| file_name.clone());
        let kind = kind_for_path(abs);

        let mut id = format!("file-{}", slugify(&rel_str));
        if id == "file-" || !used_ids.insert(id.clone()) {
            id = format!("file-{}", short_hash(&rel_str));
            used_ids.insert(id.clone());
        }

        // Aggregate by every parent folder segment as Work groups:
        // `Projects/Art/hero.png` → Work "Projects/Art" (full relative parent).
        let work_id = rel.parent().and_then(|parent| {
            if parent.as_os_str().is_empty() || parent == Path::new(".") {
                return None;
            }
            let folder = path_to_unix(parent);
            if folder.is_empty() {
                return None;
            }
            let wid = format!("work-{}", slugify(&folder));
            works_by_folder
                .entry(wid.clone())
                .or_default()
                .push(id.clone());
            Some(wid)
        });

        artifacts.push(Artifact {
            id,
            file_ref: FileRef {
                path: rel_str.clone(),
                path_kind: "relative".to_string(),
                // Relative path so markdown wikilinks like [[folder/note]] resolve.
                file_name: Some(rel_str),
            },
            display_name: stem,
            kind: kind.to_string(),
            status: "candidate".to_string(),
            role: None,
            summary: None,
            tags: None,
            work_id,
            provenance: Some(Provenance {
                tool: Some("local-directory".to_string()),
                session_label: None,
                exported_at: Some(now.clone()),
                note: Some("Imported from local directory".to_string()),
            }),
            created_at: now.clone(),
            updated_at: now.clone(),
        });
    }

    artifacts.sort_by(|a, b| a.file_ref.path.cmp(&b.file_ref.path));

    let mut works: Vec<Work> = works_by_folder
        .into_iter()
        .map(|(id, artifact_ids)| {
            let title = id
                .strip_prefix("work-")
                .unwrap_or(id.as_str())
                .replace('-', "/");
            // slugify turned `/` into `-`; restore readable title from first artifact path.
            let title = artifact_ids
                .first()
                .and_then(|aid| {
                    artifacts
                        .iter()
                        .find(|a| a.id == *aid)
                        .and_then(|a| Path::new(&a.file_ref.path).parent())
                        .map(path_to_unix)
                })
                .filter(|s| !s.is_empty())
                .unwrap_or(title);
            Work {
                id,
                title,
                summary: None,
                order: 0,
                artifact_ids,
            }
        })
        .collect();
    works.sort_by(|a, b| a.title.to_lowercase().cmp(&b.title.to_lowercase()));
    for (i, work) in works.iter_mut().enumerate() {
        work.order = i as i32;
    }

    let manifest = PackageManifest {
        schema_version: SCHEMA_VERSION.to_string(),
        id: package_id,
        title,
        slug,
        domain: None,
        summary: Some(format!("Imported · {} files", artifacts.len())),
        project_root: Some(canonical.to_string_lossy().to_string()),
        created_at: now,
        artifacts,
    };

    Ok((
        manifest,
        RelationsDocument {
            schema_version: SCHEMA_VERSION.to_string(),
            relations: vec![],
        },
        WorksDocument {
            schema_version: SCHEMA_VERSION.to_string(),
            works,
        },
        IdentitiesDocument {
            schema_version: SCHEMA_VERSION.to_string(),
            identities: vec![],
        },
    ))
}

fn kind_for_path(path: &Path) -> &'static str {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    match ext.as_str() {
        "md" | "markdown" | "txt" => "markdown",
        "html" | "htm" => "html",
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "bmp" | "svg" | "ico" | "heic" => "image",
        "mp3" | "wav" | "aac" | "m4a" | "flac" | "ogg" | "aiff" => "audio",
        "mp4" | "mov" | "webm" | "mkv" | "m4v" | "avi" => "video",
        _ => "other",
    }
}

fn collect_project_files(root: &Path) -> Result<Vec<PathBuf>, String> {
    let mut out = Vec::new();
    walk_files(root, &mut out)?;
    out.sort();
    Ok(out)
}

fn walk_files(dir: &Path, out: &mut Vec<PathBuf>) -> Result<(), String> {
    let entries = fs::read_dir(dir).map_err(|e| format!("无法读取目录 {}: {e}", dir.display()))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("无法读取目录项: {e}"))?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if path.is_dir() {
            if name.starts_with('.') || SKIP_DIR_NAMES.iter().any(|s| *s == name.as_str()) {
                continue;
            }
            walk_files(&path, out)?;
            continue;
        }
        if name.starts_with('.') {
            continue;
        }
        if SKIP_FILE_NAMES
            .iter()
            .any(|s| name.eq_ignore_ascii_case(s))
        {
            continue;
        }
        // Skip WorkBOM exchange docs if someone nested a package folder oddly.
        if name.eq_ignore_ascii_case("manifest.json")
            || name.eq_ignore_ascii_case("relations.json")
            || name.eq_ignore_ascii_case("works.json")
            || name.eq_ignore_ascii_case("identities.json")
        {
            continue;
        }
        out.push(path);
    }
    Ok(())
}

fn vault_title(vault: &Path) -> String {
    vault
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| "Local project".to_string())
}

fn path_to_unix(path: &Path) -> String {
    path.components()
        .map(|c| c.as_os_str().to_string_lossy())
        .collect::<Vec<_>>()
        .join("/")
}

fn slugify(input: &str) -> String {
    let mut out = String::new();
    let mut prev_dash = false;
    for ch in input.chars() {
        let lower = ch.to_ascii_lowercase();
        if lower.is_ascii_alphanumeric() {
            out.push(lower);
            prev_dash = false;
        } else if !prev_dash && !out.is_empty() {
            out.push('-');
            prev_dash = true;
        }
    }
    while out.ends_with('-') {
        out.pop();
    }
    if out.is_empty() {
        "vault".to_string()
    } else {
        out.chars().take(80).collect()
    }
}

fn short_hash(seed: &str) -> String {
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    seed.hash(&mut hasher);
    format!("{:x}", hasher.finish())
}

fn iso_now() -> String {
    let secs = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    format!("{secs}")
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn write_file(dir: &Path, rel: &str, body: &[u8]) {
        let path = dir.join(rel);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        let mut f = fs::File::create(&path).unwrap();
        f.write_all(body).unwrap();
    }

    #[test]
    fn imports_all_files_and_groups_by_folder() {
        let root = std::env::temp_dir().join(format!(
            "workbom-dir-test-{}-{}",
            std::process::id(),
            short_hash("synth")
        ));
        let _ = fs::remove_dir_all(&root);
        write_file(&root, "Welcome.md", b"Hello [[Projects/Alpha]]");
        write_file(&root, "Projects/Alpha.md", b"See [[Welcome]]");
        write_file(&root, "Projects/Art/hero.png", b"fakepng");
        write_file(&root, ".DS_Store", b"skip");

        assert!(looks_like_local_directory(&root));
        let (manifest, relations, works, _) = synthesize_from_vault(&root).unwrap();

        assert_eq!(manifest.artifacts.len(), 3);
        assert!(manifest.project_root.is_some());
        assert!(relations.relations.is_empty());
        assert!(manifest
            .artifacts
            .iter()
            .any(|a| a.kind == "image" && a.file_ref.path == "Projects/Art/hero.png"));
        assert!(works
            .works
            .iter()
            .any(|w| w.title == "Projects" || w.title == "Projects/Art"));
        let art_work = works
            .works
            .iter()
            .find(|w| w.title == "Projects/Art")
            .expect("nested folder work");
        assert_eq!(art_work.artifact_ids.len(), 1);

        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn empty_directory_errors() {
        let root = std::env::temp_dir().join(format!(
            "workbom-dir-empty-{}-{}",
            std::process::id(),
            short_hash("empty")
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&root).unwrap();
        assert!(!looks_like_local_directory(&root));
        let err = synthesize_from_vault(&root).unwrap_err();
        assert_eq!(err, "error.import.obsidian_empty");
        let _ = fs::remove_dir_all(&root);
    }
}
