use serde::{Deserialize, Serialize};

pub const SCHEMA_VERSION: &str = "2.0";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileRef {
    pub path: String,
    pub path_kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub file_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Provenance {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tool: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub exported_at: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub note: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Artifact {
    pub id: String,
    pub file_ref: FileRef,
    pub display_name: String,
    pub kind: String,
    pub status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub role: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub tags: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub work_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provenance: Option<Provenance>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Relation {
    pub id: String,
    pub from: String,
    pub to: String,
    pub kind: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub inferred: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Work {
    pub id: String,
    pub title: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    pub order: i32,
    pub artifact_ids: Vec<String>,
}

/// Version identity (data-model-v0.2): a stable pointer over a family of
/// versioned Artifacts. Holds no file itself — `headVersionId` /
/// `versionIds` always resolve to real Artifact ids with their own fileRef.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Identity {
    pub id: String,
    pub display_name: String,
    /// ArtifactKind string, or "composite" for assembled products
    /// (e.g. a level, a whole project) that are not a single raw file kind.
    pub kind: String,
    pub head_version_id: String,
    pub version_ids: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IdentitiesDocument {
    pub schema_version: String,
    pub identities: Vec<Identity>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageManifest {
    pub schema_version: String,
    pub id: String,
    pub title: String,
    pub slug: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub domain: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_root: Option<String>,
    pub created_at: String,
    pub artifacts: Vec<Artifact>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RelationsDocument {
    pub schema_version: String,
    pub relations: Vec<Relation>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorksDocument {
    pub schema_version: String,
    pub works: Vec<Work>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryEntry {
    pub package_id: String,
    pub title: String,
    pub manifest_path: String,
    pub imported_at: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryDocument {
    pub schema_version: String,
    pub vault_path: String,
    pub packages: Vec<LibraryEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageStats {
    pub artifact_count: usize,
    pub final_count: usize,
    pub broken_link_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageSummary {
    pub id: String,
    pub title: String,
    pub slug: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub domain: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub project_root: Option<String>,
    pub imported_at: String,
    pub stats: PackageStats,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactView {
    #[serde(flatten)]
    pub artifact: Artifact,
    pub absolute_path: String,
    pub reachable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PackageDetail {
    pub package: PackageSummary,
    pub artifacts: Vec<ArtifactView>,
    pub relations: Vec<Relation>,
    pub works: Vec<Work>,
    pub identities: Vec<Identity>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryState {
    pub vault_path: String,
    pub packages: Vec<PackageSummary>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FinalItem {
    pub package_id: String,
    pub package_title: String,
    #[serde(flatten)]
    pub artifact: Artifact,
    pub absolute_path: String,
    pub reachable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InspirationBoardSummary {
    pub id: String,
    pub package_id: Option<String>,
    pub title: String,
    pub item_count: usize,
    pub updated_at: i64,
    pub version: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InspirationBoardItem {
    pub id: String,
    pub kind: String,
    pub title: String,
    pub note: Option<String>,
    pub artifact_package_id: Option<String>,
    pub artifact_id: Option<String>,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
    pub rotation: f64,
    pub z_index: i64,
    pub color: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InspirationBoardLink {
    pub id: String,
    pub from_item_id: String,
    pub to_item_id: String,
    pub kind: String,
    pub label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InspirationBoard {
    pub id: String,
    pub package_id: Option<String>,
    pub title: String,
    pub zoom: f64,
    pub pan_x: f64,
    pub pan_y: f64,
    pub version: i64,
    pub created_at: i64,
    pub updated_at: i64,
    pub items: Vec<InspirationBoardItem>,
    pub links: Vec<InspirationBoardLink>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrashItem {
    pub package_id: String,
    pub package_title: String,
    pub artifact_id: String,
    pub display_name: String,
    pub kind: String,
    pub size_bytes: Option<i64>,
    pub deleted_at: i64,
    pub expires_at: i64,
    pub deleted_by: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TrashQuery {
    pub package_id: Option<String>,
    pub kinds: Option<Vec<String>>,
    pub text: Option<String>,
    pub limit: Option<usize>,
    pub offset: Option<usize>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactKey {
    pub package_id: String,
    pub artifact_id: String,
}
