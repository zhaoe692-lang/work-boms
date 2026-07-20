#!/usr/bin/env python3
"""Validate a WorkBOM .wbom package directory.

Exit codes:
  0 — passed (warnings allowed unless --strict)
  1 — validation errors (or warnings in --strict)
  2 — usage / I/O failure
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import asdict, dataclass, field
from pathlib import Path

SCHEMA_VERSION = "2.0"
KINDS = {"markdown", "image", "audio", "video", "html", "other"}
IDENTITY_KINDS = KINDS | {"composite"}
STATUSES = {"draft", "candidate", "final"}
PATH_KINDS = {"relative", "absolute"}
RELATION_KINDS = {"references", "derived_from", "uses", "pairs_with", "part_of"}

MANIFEST_REQUIRED = {"schemaVersion", "id", "title", "slug", "createdAt", "artifacts"}
ARTIFACT_REQUIRED = {
    "id",
    "fileRef",
    "displayName",
    "kind",
    "status",
    "createdAt",
    "updatedAt",
}
FILEREF_REQUIRED = {"path", "pathKind"}
IDENTITY_REQUIRED = {
    "id",
    "displayName",
    "kind",
    "headVersionId",
    "versionIds",
    "createdAt",
    "updatedAt",
}


@dataclass
class ValidationResult:
    package: str
    ok: bool
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)
    artifact_count: int = 0
    final_count: int = 0
    broken_links: int = 0

    def exit_code(self, strict: bool = False) -> int:
        if self.errors:
            return 1
        if strict and self.warnings:
            return 1
        return 0


def load_json(path: Path) -> tuple[dict | list | None, str | None]:
    try:
        return json.loads(path.read_text(encoding="utf-8")), None
    except FileNotFoundError:
        return None, f"missing {path.name}"
    except json.JSONDecodeError as e:
        return None, f"{path.name}: invalid JSON — {e}"
    except OSError as e:
        return None, f"{path.name}: read failed — {e}"


def resolve_path(project_root: Path | None, file_ref: dict) -> Path:
    path = file_ref.get("path", "")
    kind = file_ref.get("pathKind", "absolute")
    if kind == "relative" and project_root:
        return (project_root / path).resolve()
    return Path(str(path)).expanduser().resolve()


def validate_package(package_dir: Path, *, strict: bool = False) -> ValidationResult:
    result = ValidationResult(package=str(package_dir), ok=False)

    if not package_dir.is_dir():
        result.errors.append(f"not a directory: {package_dir}")
        return result

    if (package_dir / "artifacts").exists():
        result.errors.append("artifacts/ folder must not exist — link-only package")

    manifest_path = package_dir / "manifest.json"
    if not manifest_path.exists():
        result.errors.append("missing manifest.json")
        return result

    manifest, err = load_json(manifest_path)
    if err:
        result.errors.append(err)
        return result
    if not isinstance(manifest, dict):
        result.errors.append("manifest.json must be an object")
        return result

    missing = MANIFEST_REQUIRED - manifest.keys()
    if missing:
        result.errors.append(f"manifest missing fields: {sorted(missing)}")

    schema = manifest.get("schemaVersion")
    if schema != SCHEMA_VERSION:
        msg = f"schemaVersion is {schema!r}, expected {SCHEMA_VERSION!r}"
        if strict:
            result.errors.append(msg)
        else:
            result.warnings.append(msg)

    for key in manifest:
        if isinstance(key, str) and "_" in key:
            result.errors.append(f"manifest uses snake_case key {key!r} — use camelCase")

    artifacts = manifest.get("artifacts")
    if not isinstance(artifacts, list):
        result.errors.append("manifest.artifacts must be an array")
        return result

    result.artifact_count = len(artifacts)

    project_root_raw = manifest.get("projectRoot")
    project_root: Path | None = None
    if project_root_raw:
        pr = Path(str(project_root_raw))
        project_root = pr.resolve() if pr.is_absolute() else (package_dir / pr).resolve()
        if not project_root.is_dir():
            result.warnings.append(f"projectRoot does not exist: {project_root}")

    ids: set[str] = set()

    for i, art in enumerate(artifacts):
        if not isinstance(art, dict):
            result.errors.append(f"artifacts[{i}] must be an object")
            continue

        amiss = ARTIFACT_REQUIRED - art.keys()
        if amiss:
            result.errors.append(f"artifact {art.get('id', i)!r} missing: {sorted(amiss)}")

        aid = art.get("id")
        if not isinstance(aid, str) or not aid.strip():
            result.errors.append(f"artifacts[{i}]: invalid id")
            continue
        if aid in ids:
            result.errors.append(f"duplicate artifact id: {aid}")
        ids.add(aid)

        kind = art.get("kind")
        if kind not in KINDS:
            result.errors.append(f"artifact {aid}: invalid kind {kind!r}")

        status = art.get("status")
        if status not in STATUSES:
            result.errors.append(f"artifact {aid}: invalid status {status!r}")
        elif status == "final":
            result.final_count += 1

        file_ref = art.get("fileRef")
        if not isinstance(file_ref, dict):
            result.errors.append(f"artifact {aid}: fileRef must be an object")
            continue

        fmiss = FILEREF_REQUIRED - file_ref.keys()
        if fmiss:
            result.errors.append(f"artifact {aid}: fileRef missing {sorted(fmiss)}")

        pk = file_ref.get("pathKind")
        if pk not in PATH_KINDS:
            result.errors.append(f"artifact {aid}: invalid pathKind {pk!r}")

        resolved = resolve_path(project_root, file_ref)
        if not resolved.is_file():
            result.broken_links += 1
            msg = f"artifact {aid}: file not found — {resolved}"
            if strict:
                result.errors.append(msg)
            else:
                result.warnings.append(msg)

        for nested_key in ("fileRef", "provenance"):
            nested = art.get(nested_key)
            if isinstance(nested, dict):
                for nk in nested:
                    if isinstance(nk, str) and "_" in nk:
                        result.errors.append(
                            f"artifact {aid}.{nested_key} uses snake_case key {nk!r}"
                        )

    identity_ids: set[str] = set()
    identities_path = package_dir / "identities.json"
    if identities_path.exists():
        identities_doc, ierr = load_json(identities_path)
        if ierr:
            result.errors.append(ierr)
        elif not isinstance(identities_doc, dict):
            result.errors.append("identities.json must be an object")
        else:
            identities = identities_doc.get("identities", [])
            if not isinstance(identities, list):
                result.errors.append("identities must be an array")
            else:
                for k, identity in enumerate(identities):
                    if not isinstance(identity, dict):
                        result.errors.append(f"identities[{k}] must be an object")
                        continue
                    imiss = IDENTITY_REQUIRED - identity.keys()
                    if imiss:
                        result.errors.append(
                            f"identity {identity.get('id', k)!r} missing: {sorted(imiss)}"
                        )
                    iid = identity.get("id")
                    if not isinstance(iid, str) or not iid.strip():
                        result.errors.append(f"identities[{k}]: invalid id")
                        continue
                    if iid in identity_ids:
                        result.errors.append(f"duplicate identity id: {iid}")
                    identity_ids.add(iid)
                    if identity.get("kind") not in IDENTITY_KINDS:
                        result.errors.append(
                            f"identity {iid}: invalid kind {identity.get('kind')!r}"
                        )
                    version_ids = identity.get("versionIds")
                    if not isinstance(version_ids, list) or not version_ids:
                        result.errors.append(
                            f"identity {iid}: versionIds must be a non-empty array"
                        )
                        version_ids = []
                    else:
                        for vid in version_ids:
                            if vid not in ids:
                                result.errors.append(
                                    f"identity {iid}: versionIds contains unknown artifact {vid!r}"
                                )
                    head = identity.get("headVersionId")
                    if head not in version_ids:
                        result.errors.append(
                            f"identity {iid}: headVersionId {head!r} not in versionIds"
                        )

    part_of_edges: list[tuple[str, str]] = []
    relations_path = package_dir / "relations.json"
    if relations_path.exists():
        relations_doc, rerr = load_json(relations_path)
        if rerr:
            result.errors.append(rerr)
        elif not isinstance(relations_doc, dict):
            result.errors.append("relations.json must be an object")
        else:
            rels = relations_doc.get("relations", [])
            if not isinstance(rels, list):
                result.errors.append("relations must be an array")
            else:
                valid_nodes = ids | identity_ids
                for j, rel in enumerate(rels):
                    if not isinstance(rel, dict):
                        result.errors.append(f"relations[{j}] must be an object")
                        continue
                    rk = rel.get("kind")
                    if rk not in RELATION_KINDS:
                        result.errors.append(
                            f"relation {rel.get('id', j)}: invalid kind {rk!r}"
                        )
                    allowed = valid_nodes if rk == "part_of" else ids
                    for end in ("from", "to"):
                        ref = rel.get(end)
                        if ref not in allowed:
                            result.errors.append(
                                f"relation {rel.get('id', j)}: {end}={ref!r} not in artifacts/identities"
                            )
                    if rk == "part_of":
                        frm, to = rel.get("from"), rel.get("to")
                        if frm in valid_nodes and to in valid_nodes:
                            part_of_edges.append((frm, to))

    if part_of_edges:
        children_of: dict[str, list[str]] = {}
        for frm, to in part_of_edges:
            children_of.setdefault(to, []).append(frm)
        WHITE, GRAY, BLACK = 0, 1, 2
        color: dict[str, int] = {n: WHITE for edge in part_of_edges for n in edge}
        found_cycle = False
        for start in list(color):
            if found_cycle or color[start] != WHITE:
                continue
            stack: list[tuple[str, list[str], int]] = [
                (start, children_of.get(start, []), 0)
            ]
            color[start] = GRAY
            while stack:
                node, children, idx = stack[-1]
                if idx >= len(children):
                    color[node] = BLACK
                    stack.pop()
                    continue
                stack[-1] = (node, children, idx + 1)
                child = children[idx]
                state = color.get(child, WHITE)
                if state == GRAY:
                    found_cycle = True
                    break
                if state == WHITE:
                    color[child] = GRAY
                    stack.append((child, children_of.get(child, []), 0))
        if found_cycle:
            result.errors.append("part_of relations contain a cycle")

    works_path = package_dir / "works.json"
    if works_path.exists():
        works_doc, werr = load_json(works_path)
        if werr:
            result.errors.append(werr)
        elif isinstance(works_doc, dict):
            works = works_doc.get("works", [])
            if isinstance(works, list):
                for w in works:
                    if not isinstance(w, dict):
                        continue
                    for aid in w.get("artifactIds", []) or []:
                        if aid not in ids:
                            result.errors.append(
                                f"work {w.get('id')}: artifactIds contains unknown {aid!r}"
                            )

    result.ok = not result.errors and (not strict or not result.warnings)
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate a WorkBOM .wbom package")
    parser.add_argument("package", type=Path, help="Path to .wbom directory")
    parser.add_argument(
        "--strict",
        action="store_true",
        help="Treat warnings (schema drift, broken links) as errors",
    )
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON")
    args = parser.parse_args()

    package = args.package.expanduser().resolve()
    result = validate_package(package, strict=args.strict)

    if args.json:
        print(json.dumps(asdict(result), ensure_ascii=False, indent=2))
    else:
        for msg in result.errors:
            print(f"ERROR: {msg}")
        for msg in result.warnings:
            print(f"WARN: {msg}")
        print()
        print(f"Package: {result.package}")
        print(
            f"Artifacts: {result.artifact_count} | Finals: {result.final_count} | Broken links: {result.broken_links}"
        )
        print(f"Errors: {len(result.errors)} | Warnings: {len(result.warnings)}")
        if result.ok:
            print("OK: validation passed")
        else:
            print("FAIL: validation failed")

    return result.exit_code(strict=args.strict)


if __name__ == "__main__":
    sys.exit(main())
