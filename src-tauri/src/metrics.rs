//! Backend computation of the fixed "asset health" metrics.
//!
//! The edge-resolution logic here is the Rust twin of `src/shared/graph.ts` +
//! `src/shared/bom.ts`: `part_of` edges are collapsed onto an Identity's head
//! version, and version lineage (`versionIds`) is expressed as synthetic
//! `version` edges. Metrics are then derived from those resolved edges plus the
//! live `reachable` (disk) flags on each artifact.

use std::collections::{HashMap, HashSet};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::models::{ArtifactView, Identity, PackageDetail, Relation};

const DAYS: usize = 14;

pub struct DisplayEdge {
    pub from: String,
    pub to: String,
}

/// Resolve raw relations + identity version chains into edges whose endpoints
/// are always real artifact ids (mirrors `buildDisplayEdges`).
pub fn build_display_edges(
    artifacts: &[ArtifactView],
    relations: &[Relation],
    identities: &[Identity],
) -> Vec<DisplayEdge> {
    let identity_head: HashMap<&str, &str> = identities
        .iter()
        .map(|i| (i.id.as_str(), i.head_version_id.as_str()))
        .collect();
    let artifact_ids: HashSet<&str> = artifacts.iter().map(|a| a.artifact.id.as_str()).collect();
    let resolve = |id: &str| -> String {
        identity_head
            .get(id)
            .map(|head| head.to_string())
            .unwrap_or_else(|| id.to_string())
    };

    let mut edges = Vec::new();
    for rel in relations {
        let from = resolve(&rel.from);
        let to = resolve(&rel.to);
        if from == to {
            continue;
        }
        if !artifact_ids.contains(from.as_str()) || !artifact_ids.contains(to.as_str()) {
            continue;
        }
        edges.push(DisplayEdge { from, to });
    }
    for identity in identities {
        for i in 1..identity.version_ids.len() {
            let from = &identity.version_ids[i - 1];
            let to = &identity.version_ids[i];
            if !artifact_ids.contains(from.as_str()) || !artifact_ids.contains(to.as_str()) {
                continue;
            }
            edges.push(DisplayEdge {
                from: from.clone(),
                to: to.clone(),
            });
        }
    }
    edges
}

fn compute_degree(edges: &[DisplayEdge]) -> HashMap<String, usize> {
    let mut degree: HashMap<String, usize> = HashMap::new();
    for edge in edges {
        *degree.entry(edge.from.clone()).or_insert(0) += 1;
        *degree.entry(edge.to.clone()).or_insert(0) += 1;
    }
    degree
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KindCount {
    pub kind: String,
    pub count: usize,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectedRef {
    pub artifact_id: String,
    pub degree: usize,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PendingBreakdown {
    pub broken: usize,
    pub draft: usize,
    pub candidate: usize,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Hooks {
    pub pending_count: usize,
    pub pending_breakdown: PendingBreakdown,
    pub orphan_count: usize,
    pub orphan_breakdown: Vec<KindCount>,
    pub top_connected: Vec<ConnectedRef>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HookTargets {
    pub pending: Option<String>,
    pub orphan: Option<String>,
    pub connected: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Metrics {
    pub total: usize,
    pub finals: usize,
    pub completion: u32,
    pub broken: usize,
    pub broken_rate: u32,
    pub relations: usize,
    pub avg_degree: f64,
    /// Raw `updatedAt` of the newest artifact — front-end formats it.
    pub last_updated_at: Option<String>,
    pub last_updated_name: Option<String>,
    pub kind_breakdown: Vec<KindCount>,
    /// Cumulative asset count by createdAt across the last DAYS days.
    pub growth: Vec<usize>,
    pub top_connected: Vec<ConnectedRef>,
    pub hooks: Hooks,
    pub hook_targets: HookTargets,
}

pub fn compute_metrics(detail: &PackageDetail) -> Metrics {
    let artifacts = &detail.artifacts;
    let edges = build_display_edges(artifacts, &detail.relations, &detail.identities);
    let degree = compute_degree(&edges);
    let degree_of = |id: &str| -> usize { degree.get(id).copied().unwrap_or(0) };

    let total = artifacts.len();
    let finals = artifacts
        .iter()
        .filter(|a| a.artifact.status == "final")
        .count();
    let broken = artifacts.iter().filter(|a| !a.reachable).count();

    // Newest artifact by updatedAt.
    let mut last_ts: i64 = i64::MIN;
    let mut last_updated_at: Option<String> = None;
    let mut last_updated_name: Option<String> = None;
    for a in artifacts {
        if let Some(ts) = parse_iso_secs(&a.artifact.updated_at) {
            if ts > last_ts {
                last_ts = ts;
                last_updated_at = Some(a.artifact.updated_at.clone());
                last_updated_name = Some(a.artifact.display_name.clone());
            }
        }
    }

    let growth = compute_growth(artifacts);
    let kind_breakdown = breakdown(artifacts.iter().map(|a| a.artifact.kind.as_str()), 4);

    let mut top_all: Vec<ConnectedRef> = artifacts
        .iter()
        .map(|a| ConnectedRef {
            artifact_id: a.artifact.id.clone(),
            degree: degree_of(&a.artifact.id),
        })
        .collect();
    top_all.sort_by(|a, b| b.degree.cmp(&a.degree));
    top_all.truncate(5);

    let relations_count = edges.len();
    let avg_degree = if total > 0 {
        (relations_count as f64 * 2.0) / total as f64
    } else {
        0.0
    };

    Metrics {
        total,
        finals,
        completion: if total > 0 {
            ((finals as f64 / total as f64) * 100.0).round() as u32
        } else {
            0
        },
        broken,
        broken_rate: if total > 0 {
            ((broken as f64 / total as f64) * 100.0).round() as u32
        } else {
            0
        },
        relations: relations_count,
        avg_degree,
        last_updated_at,
        last_updated_name,
        kind_breakdown,
        growth,
        top_connected: top_all,
        hooks: compute_hooks(artifacts, &degree),
        hook_targets: compute_hook_targets(artifacts, &degree),
    }
}

fn compute_hooks(artifacts: &[ArtifactView], degree: &HashMap<String, usize>) -> Hooks {
    let degree_of = |id: &str| -> usize { degree.get(id).copied().unwrap_or(0) };

    let broken = artifacts.iter().filter(|a| !a.reachable).count();
    let candidate = artifacts
        .iter()
        .filter(|a| a.reachable && a.artifact.status == "candidate")
        .count();
    let draft = artifacts
        .iter()
        .filter(|a| a.reachable && a.artifact.status == "draft")
        .count();

    let orphans: Vec<&ArtifactView> = artifacts
        .iter()
        .filter(|a| degree_of(&a.artifact.id) == 0)
        .collect();
    let orphan_breakdown = breakdown(orphans.iter().map(|a| a.artifact.kind.as_str()), 3);

    let mut top: Vec<ConnectedRef> = artifacts
        .iter()
        .map(|a| ConnectedRef {
            artifact_id: a.artifact.id.clone(),
            degree: degree_of(&a.artifact.id),
        })
        .filter(|item| item.degree > 0)
        .collect();
    top.sort_by(|a, b| b.degree.cmp(&a.degree));
    top.truncate(4);

    Hooks {
        pending_count: broken + candidate + draft,
        pending_breakdown: PendingBreakdown {
            broken,
            draft,
            candidate,
        },
        orphan_count: orphans.len(),
        orphan_breakdown,
        top_connected: top,
    }
}

fn compute_hook_targets(
    artifacts: &[ArtifactView],
    degree: &HashMap<String, usize>,
) -> HookTargets {
    let degree_of = |id: &str| -> usize { degree.get(id).copied().unwrap_or(0) };

    let pending = artifacts
        .iter()
        .filter(|a| !a.reachable || a.artifact.status != "final")
        .max_by_key(|a| pending_priority(a, degree_of(&a.artifact.id)))
        .map(|a| a.artifact.id.clone());

    let orphan = artifacts
        .iter()
        .filter(|a| degree_of(&a.artifact.id) == 0)
        .max_by_key(|a| parse_iso_secs(&a.artifact.updated_at).unwrap_or(i64::MIN))
        .map(|a| a.artifact.id.clone());

    let connected = {
        let mut best: Option<(&ArtifactView, usize)> = None;
        for a in artifacts {
            let d = degree_of(&a.artifact.id);
            if d == 0 {
                continue;
            }
            match best {
                Some((_, bd)) if bd >= d => {}
                _ => best = Some((a, d)),
            }
        }
        best.map(|(a, _)| a.artifact.id.clone())
    };

    HookTargets {
        pending,
        orphan,
        connected,
    }
}

fn pending_priority(artifact: &ArtifactView, degree: usize) -> i64 {
    let broken_weight: i64 = if artifact.reachable { 0 } else { 1_000_000_000 };
    let status_weight: i64 = match artifact.artifact.status.as_str() {
        "candidate" => 100_000_000,
        "draft" => 10_000_000,
        _ => 0,
    };
    let updated_ms = parse_iso_secs(&artifact.artifact.updated_at).unwrap_or(0) * 1000;
    broken_weight + status_weight + (degree as i64) * 1000 + updated_ms
}

/// Top-N kinds by count, keeping first-seen order for ties (mirrors the JS
/// Map insertion order + stable sort in `composeBreakdown`).
fn breakdown<'a>(kinds: impl Iterator<Item = &'a str>, top: usize) -> Vec<KindCount> {
    let mut order: Vec<String> = Vec::new();
    let mut counts: HashMap<String, usize> = HashMap::new();
    for kind in kinds {
        let entry = counts.entry(kind.to_string()).or_insert_with(|| {
            order.push(kind.to_string());
            0
        });
        *entry += 1;
    }
    let mut result: Vec<KindCount> = order
        .into_iter()
        .map(|kind| {
            let count = counts[&kind];
            KindCount { kind, count }
        })
        .collect();
    result.sort_by(|a, b| b.count.cmp(&a.count));
    result.truncate(top);
    result
}

fn compute_growth(artifacts: &[ArtifactView]) -> Vec<usize> {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    let start_of_day = now - now.rem_euclid(86_400);

    let mut daily = vec![0usize; DAYS];
    let mut in_window = 0usize;
    for a in artifacts {
        let Some(created) = parse_iso_secs(&a.artifact.created_at) else {
            continue;
        };
        let day_diff = (start_of_day - created).div_euclid(86_400);
        if day_diff >= 0 && (day_diff as usize) < DAYS {
            daily[DAYS - 1 - day_diff as usize] += 1;
            in_window += 1;
        }
    }

    let prior_total = artifacts.len().saturating_sub(in_window);
    let mut run = prior_total;
    daily
        .into_iter()
        .map(|v| {
            run += v;
            run
        })
        .collect()
}

/// Minimal RFC 3339 / ISO-8601 parser → epoch seconds (UTC). Handles the
/// `YYYY-MM-DDTHH:MM:SS[.fff][Z|±HH:MM]` shape emitted by the export tooling;
/// returns None on anything it can't confidently read.
fn parse_iso_secs(s: &str) -> Option<i64> {
    let s = s.trim();
    // Legacy: some mutations wrote Unix seconds / millis as plain digits.
    if s.len() == 10 && s.bytes().all(|b| b.is_ascii_digit()) {
        return s.parse().ok();
    }
    if s.len() == 13 && s.bytes().all(|b| b.is_ascii_digit()) {
        return s.parse::<i64>().ok().map(|ms| ms / 1000);
    }
    if s.len() < 10 {
        return None;
    }
    let year: i64 = s.get(0..4)?.parse().ok()?;
    let month: i64 = s.get(5..7)?.parse().ok()?;
    let day: i64 = s.get(8..10)?.parse().ok()?;

    let (mut hour, mut minute, mut second) = (0i64, 0i64, 0i64);
    let bytes = s.as_bytes();
    if s.len() >= 19 && (bytes[10] == b'T' || bytes[10] == b' ') {
        hour = s.get(11..13)?.parse().ok()?;
        minute = s.get(14..16)?.parse().ok()?;
        second = s.get(17..19)?.parse().ok()?;
    }

    let mut total = days_from_civil(year, month, day) * 86_400 + hour * 3600 + minute * 60 + second;

    // Timezone offset (subtract to normalize to UTC). `Z` / missing => UTC.
    let tail = &s[std::cmp::min(19, s.len())..];
    let tail = tail.trim_start_matches(|c: char| c == '.' || c.is_ascii_digit());
    if let Some(rest) = tail.strip_prefix('+').map(|r| (1i64, r)).or_else(|| {
        tail.strip_prefix('-').map(|r| (-1i64, r))
    }) {
        let (sign, off) = rest;
        if off.len() >= 2 {
            let oh: i64 = off.get(0..2).and_then(|v| v.parse().ok()).unwrap_or(0);
            let om: i64 = if off.len() >= 5 {
                off.get(3..5).and_then(|v| v.parse().ok()).unwrap_or(0)
            } else {
                0
            };
            total -= sign * (oh * 3600 + om * 60);
        }
    }

    Some(total)
}

/// Days since the Unix epoch for a civil date (Howard Hinnant's algorithm).
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{Artifact, FileRef};

    fn view(id: &str, kind: &str, status: &str, reachable: bool, created: &str, updated: &str) -> ArtifactView {
        ArtifactView {
            artifact: Artifact {
                id: id.to_string(),
                file_ref: FileRef {
                    path: format!("{id}.md"),
                    path_kind: "relative".to_string(),
                    file_name: Some(format!("{id}.md")),
                },
                display_name: id.to_string(),
                kind: kind.to_string(),
                status: status.to_string(),
                role: None,
                summary: None,
                tags: None,
                work_id: None,
                provenance: None,
                created_at: created.to_string(),
                updated_at: updated.to_string(),
            },
            absolute_path: format!("/tmp/{id}.md"),
            reachable,
        }
    }

    #[test]
    fn parse_iso_matches_expected_epoch() {
        // 2021-01-01T00:00:00Z == 1609459200
        assert_eq!(parse_iso_secs("2021-01-01T00:00:00Z"), Some(1_609_459_200));
        // date-only
        assert_eq!(parse_iso_secs("1970-01-02"), Some(86_400));
        // offset normalizes to UTC (09:00+08:00 == 01:00Z == epoch + 3600)
        assert_eq!(
            parse_iso_secs("2021-01-01T09:00:00+08:00"),
            Some(1_609_462_800),
        );
        // Legacy plain Unix seconds / millis
        assert_eq!(parse_iso_secs("1609459200"), Some(1_609_459_200));
        assert_eq!(parse_iso_secs("1609459200000"), Some(1_609_459_200));
    }

    #[test]
    fn version_chain_and_part_of_resolve_to_head() {
        let artifacts = vec![
            view("hero-v1", "image", "draft", true, "2026-01-01", "2026-01-01"),
            view("hero-v2", "image", "final", true, "2026-01-02", "2026-01-02"),
            view("scene", "image", "final", true, "2026-01-03", "2026-01-03"),
        ];
        let identities = vec![Identity {
            id: "hero".to_string(),
            display_name: "Hero".to_string(),
            kind: "image".to_string(),
            head_version_id: "hero-v2".to_string(),
            version_ids: vec!["hero-v1".to_string(), "hero-v2".to_string()],
            created_at: "0".to_string(),
            updated_at: "0".to_string(),
        }];
        // part_of points at the identity id "hero" → collapses to head hero-v2.
        let relations = vec![Relation {
            id: "r1".to_string(),
            from: "scene".to_string(),
            to: "hero".to_string(),
            kind: "uses".to_string(),
            label: None,
            inferred: None,
        }];

        let edges = build_display_edges(&artifacts, &relations, &identities);
        // one version edge (v1->v2) + one uses edge (scene->hero-v2)
        assert_eq!(edges.len(), 2);
        let degree = compute_degree(&edges);
        assert_eq!(degree.get("hero-v2").copied().unwrap_or(0), 2);
        assert_eq!(degree.get("hero-v1").copied().unwrap_or(0), 1);
        assert_eq!(degree.get("scene").copied().unwrap_or(0), 1);
    }

    #[test]
    fn metrics_count_broken_and_orphans() {
        let artifacts = vec![
            view("a", "image", "final", true, "2026-01-01", "2026-01-05"),
            view("b", "video", "draft", false, "2026-01-02", "2026-01-02"),
            view("c", "audio", "candidate", true, "2026-01-03", "2026-01-03"),
        ];
        let detail = PackageDetail {
            package: crate::models::PackageSummary {
                id: "p".to_string(),
                title: "P".to_string(),
                slug: "p".to_string(),
                domain: None,
                summary: None,
                project_root: None,
                imported_at: "0".to_string(),
                stats: crate::models::PackageStats {
                    artifact_count: 3,
                    final_count: 1,
                    broken_link_count: 1,
                },
            },
            artifacts,
            relations: vec![],
            identities: vec![],
            works: vec![],
        };
        let m = compute_metrics(&detail);
        assert_eq!(m.total, 3);
        assert_eq!(m.finals, 1);
        assert_eq!(m.broken, 1);
        assert_eq!(m.completion, 33);
        // no edges → everything orphaned
        assert_eq!(m.hooks.orphan_count, 3);
        // pending = broken(1) + reachable-draft(0, b is broken) + reachable-candidate(1) = 2
        assert_eq!(m.hooks.pending_count, 2);
        assert_eq!(m.last_updated_name.as_deref(), Some("a"));
    }
}
