/**
 * WorkBOM data model v0.2 — link-based, no file copies in package.
 * Adds BOM composition (`part_of`) and version Identity on top of v0.1.
 * See doc/data-model-v0.2.zh-CN.md
 */

export const SCHEMA_VERSION = "2.0" as const;

export type SchemaVersion = typeof SCHEMA_VERSION;

export type PackageStatus = "active" | "archived" | "review";

export type PathKind = "absolute" | "relative";

export type ArtifactKind =
  | "markdown"
  | "image"
  | "audio"
  | "video"
  | "html"
  | "other";

export type ArtifactStatus = "draft" | "candidate" | "final";

export type RelationKind =
  | "references"
  | "derived_from"
  | "uses"
  | "pairs_with"
  | "part_of";

/** Points at a real file on disk — the package does not embed file bytes. */
export interface FileRef {
  path: string;
  pathKind: PathKind;
  fileName?: string;
}

/** Resolved at runtime after import (App layer, not in exported .wbom). */
export interface ResolvedFileRef extends FileRef {
  absolutePath: string;
  reachable: boolean;
  bookmarkId?: string;
}

export interface PackageStats {
  artifactCount: number;
  finalCount: number;
  brokenLinkCount: number;
}

export interface Package {
  id: string;
  schemaVersion: SchemaVersion;
  title: string;
  slug: string;
  domain?: string;
  summary?: string;
  /** Anchor for relative fileRef paths */
  projectRoot?: string;
  createdAt: string;
  importedAt?: string;
  status: PackageStatus;
  stats: PackageStats;
}

export interface Provenance {
  tool?: string;
  sessionLabel?: string;
  exportedAt?: string;
  note?: string;
}

export interface Artifact {
  id: string;
  fileRef: FileRef;
  displayName: string;
  kind: ArtifactKind;
  status: ArtifactStatus;
  role?: string;
  summary?: string;
  tags?: string[];
  workId?: string;
  provenance?: Provenance;
  createdAt: string;
  updatedAt: string;
}

export interface Work {
  id: string;
  title: string;
  summary?: string;
  order: number;
  artifactIds: string[];
}

/**
 * Version identity: a stable pointer over a family of versioned Artifacts.
 * Holds no file itself — `headVersionId` / `versionIds` always resolve to
 * real Artifact ids, each with its own fileRef.
 */
export interface Identity {
  id: string;
  displayName: string;
  /** ArtifactKind for a single-file identity, or "composite" for an
   * assembled product (e.g. a level, a whole project). */
  kind: ArtifactKind | "composite";
  headVersionId: string;
  /** All versions under this identity, oldest → newest. */
  versionIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface Relation {
  id: string;
  from: string;
  to: string;
  kind: RelationKind;
  label?: string;
  /** Parsed from markdown wikilinks at load time */
  inferred?: boolean;
}

export interface PackageManifest {
  schemaVersion: SchemaVersion;
  id: string;
  title: string;
  slug: string;
  domain?: string;
  summary?: string;
  projectRoot?: string;
  createdAt: string;
  artifacts: Artifact[];
}

export interface RelationsDocument {
  schemaVersion: SchemaVersion;
  relations: Relation[];
}

export interface WorksDocument {
  schemaVersion: SchemaVersion;
  works: Work[];
}

export interface IdentitiesDocument {
  schemaVersion: SchemaVersion;
  identities: Identity[];
}

export interface LibraryEntry {
  packageId: string;
  title: string;
  manifestPath: string;
  importedAt: string;
  sourcePath?: string;
}

export interface LibraryDocument {
  schemaVersion: SchemaVersion;
  vaultPath: string;
  packages: LibraryEntry[];
}

export interface PackageSummary {
  id: string;
  title: string;
  slug: string;
  domain?: string;
  summary?: string;
  projectRoot?: string;
  importedAt: string;
  stats: PackageStats;
}

export interface ArtifactView extends Artifact {
  absolutePath: string;
  reachable: boolean;
}

export interface PackageDetail {
  package: PackageSummary;
  artifacts: ArtifactView[];
  relations: Relation[];
  works: Work[];
  identities: Identity[];
}

export interface LibraryState {
  vaultPath: string;
  packages: PackageSummary[];
}

/** A kind (artifact type) with how many artifacts carry it. */
export interface KindCount {
  kind: string;
  count: number;
}

/** An artifact id together with its resolved graph degree. */
export interface ConnectedRef {
  artifactId: string;
  degree: number;
}

export interface PendingBreakdown {
  broken: number;
  draft: number;
  candidate: number;
}

export interface MetricsHooks {
  pendingCount: number;
  pendingBreakdown: PendingBreakdown;
  orphanCount: number;
  orphanBreakdown: KindCount[];
  topConnected: ConnectedRef[];
}

/** Artifact ids the cockpit should focus when a hook card is activated. */
export interface HookTargets {
  pending: string | null;
  orphan: string | null;
  connected: string | null;
}

/**
 * Fixed "asset health" metrics computed by the Rust backend
 * (see src-tauri/src/metrics.rs). The front-end only renders these — it no
 * longer recomputes any of them.
 */
export interface PackageMetrics {
  total: number;
  finals: number;
  completion: number;
  broken: number;
  brokenRate: number;
  relations: number;
  avgDegree: number;
  lastUpdatedAt: string | null;
  lastUpdatedName: string | null;
  kindBreakdown: KindCount[];
  growth: number[];
  topConnected: ConnectedRef[];
  hooks: MetricsHooks;
  hookTargets: HookTargets;
}

export interface FinalItem extends Artifact {
  packageId: string;
  packageTitle: string;
  absolutePath: string;
  reachable: boolean;
}

export type AppView =
  | "home"
  | "artifacts"
  | "assets"
  | "finals"
  | "graph"
  | "trash"
  | "plugins";

export type {
  PluginCatalogState,
  PluginInfo,
  PluginManifest,
  PluginSource,
  PluginTarget,
} from "./pluginTypes";
export { PLUGIN_SCHEMA_VERSION } from "./pluginTypes";
export type GraphMode = "local" | "gravity" | "nebula" | "tree";

export interface SearchHit {
  packageId: string;
  packageTitle: string;
  artifactId: string;
  displayName: string;
  summary?: string;
  snippet?: string;
  rank: number;
  kind: ArtifactKind;
  status: ArtifactStatus;
  updatedAt: string;
}

export interface SearchRequest {
  query: string;
  packageIds?: string[];
  kinds?: string[];
  statuses?: string[];
  sort?: "relevance" | "updated";
  limit?: number;
  offset?: number;
}

export interface SearchResponse {
  items: SearchHit[];
  total: number;
  limit: number;
  offset: number;
  mode: "fulltext" | "hybrid";
  semanticError?: string;
}

export interface InspirationBoardSummary {
  id: string;
  packageId?: string;
  title: string;
  itemCount: number;
  updatedAt: number;
  version: number;
}

export interface InspirationBoardItem {
  id: string;
  kind: string;
  title: string;
  note?: string;
  artifactPackageId?: string;
  artifactId?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  zIndex: number;
  color?: string;
}

export interface InspirationBoardLink {
  id: string;
  fromItemId: string;
  toItemId: string;
  kind: string;
  label?: string;
}

export interface InspirationBoard {
  id: string;
  packageId?: string;
  title: string;
  zoom: number;
  panX: number;
  panY: number;
  version: number;
  createdAt: number;
  updatedAt: number;
  items: InspirationBoardItem[];
  links: InspirationBoardLink[];
}

export interface ArtifactKey {
  packageId: string;
  artifactId: string;
}

export interface TrashItem extends ArtifactKey {
  packageTitle: string;
  displayName: string;
  kind: ArtifactKind;
  sizeBytes?: number;
  deletedAt: number;
  expiresAt: number;
  deletedBy?: string;
}

export interface TrashQuery {
  packageId?: string;
  kinds?: string[];
  text?: string;
  limit?: number;
  offset?: number;
}

export interface GraphNodePosition {
  x: number;
  y: number;
  z?: number;
}

export interface GraphLayoutDocument {
  schemaVersion: string;
  mode: string;
  width: number;
  height: number;
  fingerprint: string;
  positions: Record<string, GraphNodePosition>;
}
