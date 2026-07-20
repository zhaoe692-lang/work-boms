import { invoke } from "@tauri-apps/api/core";
import type {
  ArtifactStatus,
  ArtifactKey,
  FinalItem,
  GraphLayoutDocument,
  LibraryState,
  PackageDetail,
  PackageMetrics,
  PackageSummary,
  RelationKind,
  SearchHit,
  SearchRequest,
  SearchResponse,
  InspirationBoard,
  InspirationBoardSummary,
  TrashItem,
  TrashQuery,
  PluginCatalogState,
  PluginInfo,
} from "./types";

export function getLibrary(): Promise<LibraryState> {
  return invoke("get_library");
}

export function importPackage(sourcePath: string): Promise<PackageSummary> {
  return invoke("import_package", { sourcePath });
}

export function getPackageDetail(packageId: string): Promise<PackageDetail> {
  return invoke("get_package_detail", { packageId });
}

export function getPackageMetrics(packageId: string): Promise<PackageMetrics> {
  return invoke("get_package_metrics", { packageId });
}

export function readArtifactText(
  packageId: string,
  artifactId: string,
): Promise<string> {
  return invoke("read_artifact_text", { packageId, artifactId });
}

export function writeArtifactText(
  packageId: string,
  artifactId: string,
  contents: string,
): Promise<PackageDetail> {
  return invoke("write_artifact_text", { packageId, artifactId, contents });
}

export function listFinals(): Promise<FinalItem[]> {
  return invoke("list_finals");
}

export function relocateArtifactFile(
  packageId: string,
  artifactId: string,
  newAbsolutePath: string,
): Promise<PackageDetail> {
  return invoke("relocate_artifact_file", {
    packageId,
    artifactId,
    newAbsolutePath,
  });
}

export function searchArtifacts(
  query: string,
  limit = 40,
): Promise<SearchHit[]> {
  return invoke("search_artifacts", { query, limit });
}

export function searchAssets(request: SearchRequest): Promise<SearchResponse> {
  return invoke("search_assets", { request });
}

/** Start / refresh FS watchers on all package project roots. */
export function syncLibraryWatchers(): Promise<number> {
  return invoke("sync_library_watchers");
}

export function reindexPackage(packageId: string): Promise<void> {
  return invoke("reindex_package", { packageId });
}

export function listInspirationBoards(packageId?: string): Promise<InspirationBoardSummary[]> {
  return invoke("list_inspiration_boards", { packageId: packageId ?? null });
}

export function createInspirationBoard(
  packageId: string | undefined,
  title: string,
): Promise<InspirationBoard> {
  return invoke("create_inspiration_board", { packageId: packageId ?? null, title });
}

export function getInspirationBoard(boardId: string): Promise<InspirationBoard> {
  return invoke("get_inspiration_board", { boardId });
}

export function saveInspirationBoard(
  board: InspirationBoard,
  expectedVersion: number,
): Promise<InspirationBoard> {
  return invoke("save_inspiration_board", { board, expectedVersion });
}

export function deleteInspirationBoard(boardId: string): Promise<void> {
  return invoke("delete_inspiration_board", { boardId });
}

export function listTrash(query: TrashQuery = {}): Promise<TrashItem[]> {
  return invoke("list_trash", { query });
}

export function moveArtifactsToTrash(
  packageId: string,
  artifactIds: string[],
  deletedBy?: string,
): Promise<number> {
  return invoke("move_artifacts_to_trash", { packageId, artifactIds, deletedBy: deletedBy ?? null });
}

export function restoreTrashItems(items: ArtifactKey[]): Promise<number> {
  return invoke("restore_trash_items", { items });
}

export function permanentlyDeleteTrashItems(items: ArtifactKey[]): Promise<number> {
  return invoke("permanently_delete_trash_items", { items });
}

export function emptyTrash(): Promise<number> {
  return invoke("empty_trash");
}

export function getGraphLayout(
  packageId: string,
  mode: string,
  fingerprint: string,
): Promise<GraphLayoutDocument | null> {
  return invoke("get_graph_layout", { packageId, mode, fingerprint });
}

export function saveGraphLayout(
  packageId: string,
  layout: GraphLayoutDocument,
): Promise<void> {
  return invoke("save_graph_layout", { packageId, layout });
}

export function resetGraphLayout(packageId: string): Promise<void> {
  return invoke("reset_graph_layout", { packageId });
}

export function updateArtifactStatus(
  packageId: string,
  artifactId: string,
  status: ArtifactStatus,
): Promise<PackageDetail> {
  return invoke("update_artifact_status", {
    packageId,
    artifactId,
    status,
  });
}

export function updateArtifactMeta(
  packageId: string,
  artifactId: string,
  meta: { role?: string | null; summary?: string | null; tags: string[] },
): Promise<PackageDetail> {
  return invoke("update_artifact_meta", {
    packageId,
    artifactId,
    role: meta.role ?? null,
    summary: meta.summary ?? null,
    tags: meta.tags,
  });
}

export function batchUpdateArtifactStatus(
  packageId: string,
  artifactIds: string[],
  status: ArtifactStatus,
): Promise<PackageDetail> {
  return invoke("batch_update_artifact_status", {
    packageId,
    artifactIds,
    status,
  });
}

export function addRelation(
  packageId: string,
  from: string,
  to: string,
  kind: RelationKind | string,
  label?: string | null,
): Promise<PackageDetail> {
  return invoke("add_relation", {
    packageId,
    from,
    to,
    kind,
    label: label ?? null,
  });
}

export function removeRelation(
  packageId: string,
  relationId: string,
): Promise<PackageDetail> {
  return invoke("remove_relation", { packageId, relationId });
}

export function updateRelationKind(
  packageId: string,
  relationId: string,
  kind: RelationKind | string,
  label?: string | null,
): Promise<PackageDetail> {
  return invoke("update_relation_kind", {
    packageId,
    relationId,
    kind,
    label: label ?? null,
  });
}

export function setWorkMembership(
  packageId: string,
  workId: string,
  artifactId: string,
  include: boolean,
): Promise<PackageDetail> {
  return invoke("set_work_membership", {
    packageId,
    workId,
    artifactId,
    include,
  });
}

export function updatePackageMeta(
  packageId: string,
  title: string,
  summary?: string | null,
): Promise<PackageDetail> {
  return invoke("update_package_meta", {
    packageId,
    title,
    summary: summary ?? null,
  });
}

export function removePackage(packageId: string): Promise<void> {
  return invoke("remove_package", { packageId });
}

export function purgeExpiredTrash(): Promise<number> {
  return invoke("purge_expired_trash");
}

export function exportPackage(packageId: string, targetDir: string): Promise<string> {
  return invoke("export_package", { packageId, targetDir });
}

export function writeTextFile(path: string, contents: string): Promise<void> {
  return invoke("write_text_file", { path, contents });
}

export function renameArtifact(
  packageId: string,
  artifactId: string,
  displayName: string,
): Promise<PackageDetail> {
  return invoke("rename_artifact", { packageId, artifactId, displayName });
}

export function importArtifactFile(
  packageId: string,
  absolutePath: string,
  displayName?: string | null,
): Promise<PackageDetail> {
  return invoke("import_artifact_file", {
    packageId,
    absolutePath,
    displayName: displayName ?? null,
  });
}

export function createWork(
  packageId: string,
  title: string,
  summary?: string | null,
): Promise<PackageDetail> {
  return invoke("create_work", { packageId, title, summary: summary ?? null });
}

export function renameWork(
  packageId: string,
  workId: string,
  title: string,
  summary?: string | null,
): Promise<PackageDetail> {
  return invoke("rename_work", {
    packageId,
    workId,
    title,
    summary: summary ?? null,
  });
}

export function deleteWork(packageId: string, workId: string): Promise<PackageDetail> {
  return invoke("delete_work", { packageId, workId });
}

export function mergeIdentities(
  packageId: string,
  keepId: string,
  absorbId: string,
): Promise<PackageDetail> {
  return invoke("merge_identities", { packageId, keepId, absorbId });
}

export function splitIdentity(
  packageId: string,
  identityId: string,
  artifactIds: string[],
  newDisplayName: string,
): Promise<PackageDetail> {
  return invoke("split_identity", {
    packageId,
    identityId,
    artifactIds,
    newDisplayName,
  });
}

export function setIdentityHead(
  packageId: string,
  identityId: string,
  headVersionId: string,
): Promise<PackageDetail> {
  return invoke("set_identity_head", {
    packageId,
    identityId,
    headVersionId,
  });
}

export function acceptSuggestedRelation(
  packageId: string,
  from: string,
  to: string,
  kind: RelationKind | string,
  label?: string | null,
): Promise<PackageDetail> {
  return invoke("accept_suggested_relation", {
    packageId,
    from,
    to,
    kind,
    label: label ?? null,
  });
}

export function rejectSuggestedRelation(
  packageId: string,
  from: string,
  to: string,
): Promise<PackageDetail> {
  return invoke("reject_suggested_relation", { packageId, from, to });
}

export function getPluginCatalog(): Promise<PluginCatalogState> {
  return invoke("get_plugin_catalog");
}

export function importPlugin(
  sourcePath: string,
  overwrite = false,
): Promise<PluginInfo> {
  return invoke("import_plugin", { sourcePath, overwrite });
}

export function exportPlugin(
  pluginId: string,
  destDir: string,
): Promise<string> {
  return invoke("export_plugin", { pluginId, destDir });
}

export function uninstallPlugin(pluginId: string): Promise<void> {
  return invoke("uninstall_plugin", { pluginId });
}

export function setPluginEnabled(
  pluginId: string,
  enabled: boolean,
): Promise<PluginInfo> {
  return invoke("set_plugin_enabled", { pluginId, enabled });
}

export function installBundledPlugin(pluginId: string): Promise<PluginInfo> {
  return invoke("install_bundled_plugin", { pluginId });
}
