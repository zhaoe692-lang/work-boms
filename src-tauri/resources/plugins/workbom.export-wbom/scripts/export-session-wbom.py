#!/usr/bin/env python3
"""Export a single AI session (Cursor/Codex transcript) to a WorkBOM .wbom package.

Accuracy defaults:
  - Only files that exist on disk are included as artifacts
  - Export always runs validate-wbom (strict by default)
  - Writes are atomic (temp dir → rename)
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
import tempfile
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from pathlib import Path

SCHEMA_VERSION = "2.0"
WRITE_TOOLS = {"Write", "StrReplace", "EditNotebook", "ApplyPatch", "apply_patch"}
IMAGE_TOOLS = {"GenerateImage"}

# Import sibling validator
_SCRIPTS = Path(__file__).resolve().parent
if str(_SCRIPTS) not in sys.path:
    sys.path.insert(0, str(_SCRIPTS))
from validate_wbom import validate_package  # noqa: E402


@dataclass
class TimelineEvent:
    timestamp: str
    label: str
    path: str | None = None


@dataclass
class ParsedSession:
    session_id: str
    title: str
    tool: str
    workspace_path: str
    started_at: str
    updated_at: str
    artifact_paths: list[str] = field(default_factory=list)
    timeline: list[TimelineEvent] = field(default_factory=list)
    user_messages: list[str] = field(default_factory=list)
    assistant_messages: list[str] = field(default_factory=list)
    transcript_files: list[Path] = field(default_factory=list)


@dataclass
class ExportReport:
    ok: bool
    package: str | None
    session_id: str
    title: str
    tool: str
    included: list[str] = field(default_factory=list)
    skipped_missing: list[str] = field(default_factory=list)
    skipped_duplicate: list[str] = field(default_factory=list)
    validation_errors: list[str] = field(default_factory=list)
    validation_warnings: list[str] = field(default_factory=list)
    message: str = ""


def iso_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def decode_project_slug(slug: str) -> str:
    return "/" + slug.replace("-", "/")


def cursor_project_slug(workspace: Path) -> str:
    return re.sub(r"[/\\\s]+", "-", str(workspace.resolve()).strip("/\\"))


def extract_user_title(text: str) -> str | None:
    body = extract_user_body(text)
    for line in body.splitlines():
        line = line.strip()
        if not line or line.startswith("<") or line.startswith("file://"):
            continue
        return line[:120]
    return None


def extract_user_body(text: str) -> str:
    match = re.search(r"<user_query>\s*(.*?)\s*</user_query>", text, re.DOTALL)
    if match:
        return match.group(1).strip()
    return text.strip()


def extract_patch_paths(patch: str) -> list[str]:
    paths: list[str] = []
    for line in patch.splitlines():
        trimmed = line.strip()
        for prefix in ("*** Add File: ", "*** Update File: "):
            if trimmed.startswith(prefix):
                paths.append(trimmed[len(prefix) :].strip())
    return paths


def kind_for_path(path: str) -> str:
    ext = Path(path).suffix.lower()
    if ext in {".md", ".markdown"}:
        return "markdown"
    if ext in {".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".icns"}:
        return "image"
    if ext in {".mp4", ".mov", ".webm"}:
        return "video"
    if ext in {".mp3", ".wav", ".m4a"}:
        return "audio"
    if ext in {".html", ".htm"}:
        return "html"
    return "other"


def status_for_path(path: str) -> str:
    name = Path(path).name.lower()
    if any(k in name for k in ("final", "定稿")):
        return "final"
    if any(k in name for k in ("draft", "草稿", "wip")):
        return "draft"
    return "candidate"


def artifact_id_for_path(path: str, used: set[str]) -> str:
    stem = Path(path).stem
    base = re.sub(r"[^a-zA-Z0-9]+", "-", stem).strip("-").lower() or "artifact"
    candidate = base
    n = 2
    while candidate in used:
        candidate = f"{base}-{n}"
        n += 1
    used.add(candidate)
    return candidate


def resolve_path(path: str, workspace: str) -> Path:
    p = Path(path).expanduser()
    if p.is_absolute():
        return p.resolve()
    return (Path(workspace) / p).resolve()


def normalize_path_key(path: str, workspace: str) -> str:
    try:
        return str(resolve_path(path, workspace))
    except OSError:
        return path


def parse_cursor_transcript(path: Path, project_slug: str) -> ParsedSession | None:
    if not path.is_file():
        return None
    session_id = path.stem
    workspace = decode_project_slug(project_slug)
    try:
        content = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None

    title: str | None = None
    seen_paths: set[str] = set()
    artifact_paths: list[str] = []
    timeline: list[TimelineEvent] = []
    user_messages: list[str] = []
    assistant_messages: list[str] = []
    mtime = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).strftime(
        "%Y-%m-%dT%H:%M:%SZ"
    )

    for line in content.splitlines():
        if not line.strip():
            continue
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(value, dict):
            continue

        role = value.get("role", "")
        message = value.get("message") or {}
        if not isinstance(message, dict):
            continue
        parts = message.get("content") or []
        if not isinstance(parts, list):
            continue

        if role == "user":
            for part in parts:
                if not isinstance(part, dict):
                    continue
                if part.get("type") == "text":
                    text = part.get("text", "")
                    if text:
                        user_messages.append(extract_user_body(text))
                        if title is None:
                            title = extract_user_title(text)
            continue

        if role != "assistant":
            continue

        for part in parts:
            if not isinstance(part, dict):
                continue
            ptype = part.get("type", "")
            if ptype == "text":
                text = (part.get("text") or "").strip()
                if text and text != "[REDACTED]":
                    assistant_messages.append(text)
            elif ptype == "tool_use":
                tool = part.get("name", "")
                inp = part.get("input") or {}
                if not isinstance(inp, dict):
                    continue
                paths: list[str] = []
                if tool in {"Write", "StrReplace"}:
                    if p := inp.get("path"):
                        paths.append(str(p))
                elif tool == "EditNotebook":
                    if p := inp.get("target_notebook"):
                        paths.append(str(p))
                elif tool in WRITE_TOOLS:
                    patch = inp.get("patch") or inp.get("input") or ""
                    if isinstance(patch, str):
                        paths.extend(extract_patch_paths(patch))
                elif tool in IMAGE_TOOLS:
                    if p := inp.get("filename"):
                        paths.append(str(p))

                for file_path in paths:
                    key = file_path
                    if key in seen_paths:
                        continue
                    seen_paths.add(key)
                    artifact_paths.append(file_path)
                    timeline.append(
                        TimelineEvent(mtime, f"写入 {Path(file_path).name}", file_path)
                    )

    if not title:
        title = "Cursor 协作"

    return ParsedSession(
        session_id=session_id,
        title=title,
        tool="Cursor",
        workspace_path=workspace,
        started_at=mtime,
        updated_at=mtime,
        artifact_paths=artifact_paths,
        timeline=timeline,
        user_messages=user_messages,
        assistant_messages=assistant_messages,
        transcript_files=[path],
    )


def parse_codex_rollout(path: Path, fallback_title: str = "") -> ParsedSession | None:
    if not path.is_file():
        return None
    try:
        content = path.read_text(encoding="utf-8", errors="replace")
    except OSError:
        return None

    session_id = ""
    title = fallback_title or "Codex 协作"
    workspace = ""
    started_at = ""
    updated_at = ""
    seen_paths: set[str] = set()
    artifact_paths: list[str] = []
    timeline: list[TimelineEvent] = []
    user_messages: list[str] = []
    assistant_messages: list[str] = []

    for line in content.splitlines():
        if not line.strip():
            continue
        try:
            value = json.loads(line)
        except json.JSONDecodeError:
            continue
        if not isinstance(value, dict):
            continue

        record_type = value.get("type", "")
        timestamp = value.get("timestamp", "") or updated_at
        payload = value.get("payload") or {}
        if not isinstance(payload, dict):
            payload = {}

        if record_type == "session_meta":
            session_id = str(payload.get("session_id") or payload.get("id") or session_id)
            workspace = str(payload.get("cwd") or workspace)
            started_at = str(payload.get("timestamp") or started_at or timestamp)
            continue

        if record_type == "response_item":
            item_type = payload.get("type", "")
            if item_type == "message":
                role = payload.get("role", "")
                content_parts = payload.get("content") or []
                if isinstance(content_parts, list):
                    for part in content_parts:
                        if isinstance(part, dict) and part.get("type") == "text":
                            text = (part.get("text") or "").strip()
                            if not text:
                                continue
                            if role == "user":
                                user_messages.append(text)
                                if not fallback_title:
                                    title = text.splitlines()[0][:120] or title
                            elif role == "assistant" and text != "[REDACTED]":
                                assistant_messages.append(text)
            elif item_type == "custom_tool_call" and payload.get("name") == "apply_patch":
                patch = payload.get("input") or ""
                if isinstance(patch, str):
                    for file_path in extract_patch_paths(patch):
                        if file_path in seen_paths:
                            continue
                        seen_paths.add(file_path)
                        artifact_paths.append(file_path)
                        timeline.append(
                            TimelineEvent(
                                timestamp, f"写入 {Path(file_path).name}", file_path
                            )
                        )
            continue

        if record_type == "turn_context" and not workspace:
            workspace = str(payload.get("cwd") or workspace)

        updated_at = timestamp or updated_at

    if not session_id:
        stem = path.stem
        session_id = stem.rsplit("-", 1)[-1].removesuffix(".jsonl") or stem
    if not session_id:
        return None

    mtime = datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc).strftime(
        "%Y-%m-%dT%H:%M:%SZ"
    )
    if not started_at:
        started_at = mtime
    if not updated_at:
        updated_at = mtime

    return ParsedSession(
        session_id=session_id,
        title=title,
        tool="Codex",
        workspace_path=workspace,
        started_at=started_at,
        updated_at=updated_at,
        artifact_paths=artifact_paths,
        timeline=timeline,
        user_messages=user_messages,
        assistant_messages=assistant_messages,
        transcript_files=[path],
    )


def find_latest_cursor_transcript(workspace: Path) -> tuple[Path, str] | None:
    root = Path.home() / ".cursor" / "projects"
    if not root.is_dir():
        return None
    expected_slug = cursor_project_slug(workspace)
    best: tuple[Path, str, float] | None = None

    for project_dir in root.iterdir():
        if not project_dir.is_dir() or project_dir.name != expected_slug:
            continue
        transcripts = project_dir / "agent-transcripts"
        if not transcripts.is_dir():
            continue
        for folder in transcripts.iterdir():
            if not folder.is_dir():
                continue
            main = folder / f"{folder.name}.jsonl"
            if main.is_file():
                mtime = main.stat().st_mtime
                if best is None or mtime > best[2]:
                    best = (main, project_dir.name, mtime)
    if best:
        return best[0], best[1]
    return None


def merge_sessions(sessions: list[ParsedSession]) -> ParsedSession:
    if len(sessions) == 1:
        return sessions[0]
    base = sessions[0]
    seen: set[str] = set(base.artifact_paths)
    for s in sessions[1:]:
        base.transcript_files.extend(s.transcript_files)
        base.user_messages.extend(s.user_messages)
        base.assistant_messages.extend(s.assistant_messages)
        base.timeline.extend(s.timeline)
        for p in s.artifact_paths:
            if p not in seen:
                seen.add(p)
                base.artifact_paths.append(p)
    base.updated_at = max(s.updated_at for s in sessions)
    return base


def load_session(
    transcript: Path | None, workspace: Path | None, tool: str
) -> ParsedSession:
    if transcript:
        transcript = transcript.expanduser().resolve()
        if not transcript.is_file():
            raise SystemExit(f"transcript 不存在: {transcript}")
        if tool == "codex":
            parsed = parse_codex_rollout(transcript)
            if not parsed:
                raise SystemExit(f"无法解析 Codex transcript: {transcript}")
            if workspace:
                parsed.workspace_path = str(workspace.resolve())
            return parsed

        folder = transcript.parent
        slug = (
            folder.parent.parent.name
            if folder.parent.name == "agent-transcripts"
            else ""
        )
        sessions: list[ParsedSession] = []
        if (p := parse_cursor_transcript(transcript, slug)) is not None:
            sessions.append(p)
        subagents = folder / "subagents"
        if subagents.is_dir():
            for sub in sorted(subagents.glob("*.jsonl")):
                if (p := parse_cursor_transcript(sub, slug)) is not None:
                    sessions.append(p)
        if not sessions:
            raise SystemExit(f"无法解析 Cursor transcript: {transcript}")
        merged = merge_sessions(sessions)
        if workspace:
            merged.workspace_path = str(workspace.resolve())
        return merged

    if workspace:
        if tool == "codex":
            raise SystemExit("Codex 模式请用 --transcript 指定 rollout 文件")
        found = find_latest_cursor_transcript(workspace)
        if not found:
            raise SystemExit(f"未找到工作区 {workspace} 的 Cursor 会话 transcript")
        path, slug = found
        folder = path.parent
        sessions = []
        if (p := parse_cursor_transcript(path, slug)) is not None:
            sessions.append(p)
        subagents = folder / "subagents"
        if subagents.is_dir():
            for sub in sorted(subagents.glob("*.jsonl")):
                if (p := parse_cursor_transcript(sub, slug)) is not None:
                    sessions.append(p)
        merged = merge_sessions(sessions)
        merged.workspace_path = str(workspace.resolve())
        return merged

    raise SystemExit("请指定 --transcript 或 --workspace")


def write_session_transcript(session: ParsedSession, project_root: Path) -> Path:
    out_dir = project_root / ".ai-sessions" / session.session_id
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "session-transcript.md"

    lines = [
        f"# 会话记录：{session.title}",
        "",
        f"- **工具**: {session.tool}",
        f"- **会话 ID**: `{session.session_id}`",
        f"- **工作区**: `{session.workspace_path}`",
        f"- **导出时间**: {iso_now()}",
        "",
        "---",
        "",
    ]

    max_turns = max(len(session.user_messages), len(session.assistant_messages))
    for i in range(max_turns):
        if i < len(session.user_messages):
            lines.extend(["## 用户", "", session.user_messages[i], ""])
        if i < len(session.assistant_messages):
            lines.extend(["## 助手", "", session.assistant_messages[i], ""])

    if session.timeline:
        lines.extend(["---", "", "## 产出时间线", ""])
        for ev in session.timeline:
            detail = f" → `{ev.path}`" if ev.path else ""
            lines.append(f"- {ev.label}{detail}")

    if session.artifact_paths:
        lines.extend(["", "## 产出文件", ""])
        for p in session.artifact_paths:
            lines.append(f"- `{p}`")

    out_path.write_text("\n".join(lines).strip() + "\n", encoding="utf-8")
    return out_path


def infer_version_identities(path_to_id: dict[str, str], now: str) -> list[dict]:
    id_to_path = {aid: path for path, aid in path_to_id.items()}
    groups: dict[str, list[str]] = {}
    for path, aid in path_to_id.items():
        stem = Path(path).stem
        base = re.sub(r"[-_]?v?\d+$", "", stem, flags=re.IGNORECASE)
        groups.setdefault(base.lower(), []).append(aid)

    identities: list[dict] = []
    for base, aids in groups.items():
        if len(aids) < 2:
            continue
        ordered = sorted(aids)
        identity_id = re.sub(r"[^a-z0-9]+", "-", base).strip("-") or "artifact"
        identities.append(
            {
                "id": identity_id,
                "displayName": base,
                "kind": kind_for_path(id_to_path[ordered[-1]]),
                "headVersionId": ordered[-1],
                "versionIds": ordered,
                "createdAt": now,
                "updatedAt": now,
            }
        )
    return identities


def write_json_atomic(path: Path, data: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(data, ensure_ascii=False, indent=2) + "\n"
    fd, tmp_name = tempfile.mkstemp(prefix=path.name + ".", dir=str(path.parent))
    tmp_path = Path(tmp_name)
    try:
        with open(fd, "w", encoding="utf-8") as fh:
            fh.write(text)
        tmp_path.replace(path)
    except Exception:
        if tmp_path.exists():
            tmp_path.unlink(missing_ok=True)
        raise


def build_package(
    session: ParsedSession,
    project_root: Path,
    output_dir: Path,
    *,
    include_missing: bool = False,
) -> tuple[Path, ExportReport]:
    project_root = project_root.resolve()
    output_dir = output_dir.resolve()

    report = ExportReport(
        ok=False,
        package=None,
        session_id=session.session_id,
        title=session.title,
        tool=session.tool,
    )

    transcript_path = write_session_transcript(session, project_root)
    now = iso_now()
    slug = (
        re.sub(r"[^a-z0-9]+", "-", session.title.lower()).strip("-")[:40] or "session"
    )
    package_id = f"{slug}-{session.session_id[:8]}"

    used_ids: set[str] = set()
    artifacts: list[dict] = []
    path_to_id: dict[str, str] = {}
    seen_resolved: set[str] = set()

    rel_transcript = transcript_path.relative_to(project_root).as_posix()
    tid = "session-transcript"
    used_ids.add(tid)
    path_to_id[str(transcript_path)] = tid
    artifacts.append(
        {
            "id": tid,
            "fileRef": {
                "path": rel_transcript,
                "pathKind": "relative",
                "fileName": transcript_path.name,
            },
            "displayName": f"会话记录：{session.title}",
            "kind": "markdown",
            "status": "final",
            "role": "session-log",
            "summary": f"{session.tool} 会话完整记录（用户提问 + 助手回复 + 产出时间线）",
            "workId": session.session_id,
            "provenance": {
                "tool": session.tool,
                "sessionLabel": session.title,
                "exportedAt": now,
                "note": f"{session.tool.lower()}:{session.session_id}",
            },
            "createdAt": session.started_at if "T" in session.started_at else now,
            "updatedAt": now,
        }
    )
    report.included.append(rel_transcript)

    for file_path in session.artifact_paths:
        resolved = resolve_path(file_path, str(project_root))
        resolved_key = str(resolved)
        if resolved_key in seen_resolved:
            report.skipped_duplicate.append(file_path)
            continue
        if not resolved.is_file():
            report.skipped_missing.append(file_path)
            if not include_missing:
                continue
        seen_resolved.add(resolved_key)

        try:
            rel = resolved.relative_to(project_root).as_posix()
            path_kind = "relative"
            ref_path = rel
        except ValueError:
            ref_path = resolved_key
            path_kind = "absolute"

        aid = artifact_id_for_path(file_path, used_ids)
        path_to_id[file_path] = aid
        artifacts.append(
            {
                "id": aid,
                "fileRef": {
                    "path": ref_path,
                    "pathKind": path_kind,
                    "fileName": Path(file_path).name,
                },
                "displayName": Path(file_path).stem,
                "kind": kind_for_path(file_path),
                "status": status_for_path(file_path),
                "workId": session.session_id,
                "provenance": {
                    "tool": session.tool,
                    "sessionLabel": session.title,
                    "exportedAt": now,
                    "note": f"{session.tool.lower()}:{session.session_id}",
                },
                "createdAt": session.started_at if "T" in session.started_at else now,
                "updatedAt": now,
            }
        )
        report.included.append(ref_path)

    included_outputs = max(0, len(artifacts) - 1)
    manifest = {
        "schemaVersion": SCHEMA_VERSION,
        "id": package_id,
        "title": session.title,
        "slug": slug,
        "domain": "AI 协作会话",
        "summary": f"{session.tool} 创建项目：{included_outputs} 个产出文件 + 协作记录",
        "projectRoot": str(project_root),
        "createdAt": session.started_at if "T" in session.started_at else now,
        "artifacts": artifacts,
    }

    relations: list[dict] = []
    rid = 1
    for _file_path, aid in path_to_id.items():
        if aid == "session-transcript":
            continue
        relations.append(
            {
                "id": f"r{rid}",
                "from": "session-transcript",
                "to": aid,
                "kind": "references",
                "label": "会话产出",
            }
        )
        rid += 1

    # Identities only among included session artifacts (exclude transcript path key)
    identity_path_map = {
        p: aid for p, aid in path_to_id.items() if aid != "session-transcript"
    }
    identities = infer_version_identities(identity_path_map, now)
    for identity in identities:
        base = identity["id"]
        candidate = f"{base}-identity" if base in used_ids else base
        n = 2
        while candidate in used_ids:
            candidate = f"{base}-identity-{n}"
            n += 1
        used_ids.add(candidate)
        identity["id"] = candidate

    works = {
        "schemaVersion": SCHEMA_VERSION,
        "works": [
            {
                "id": session.session_id,
                "title": session.title,
                "summary": f"{session.tool} 会话",
                "order": 1,
                "artifactIds": [a["id"] for a in artifacts],
            }
        ],
    }

    # Atomic publish: write into temp dir then replace destination
    output_dir.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="wbom-export-", dir=str(output_dir.parent)) as tmp:
        tmp_dir = Path(tmp) / output_dir.name
        tmp_dir.mkdir(parents=True, exist_ok=True)
        write_json_atomic(tmp_dir / "manifest.json", manifest)
        write_json_atomic(
            tmp_dir / "relations.json",
            {"schemaVersion": SCHEMA_VERSION, "relations": relations},
        )
        write_json_atomic(tmp_dir / "works.json", works)
        if identities:
            write_json_atomic(
                tmp_dir / "identities.json",
                {"schemaVersion": SCHEMA_VERSION, "identities": identities},
            )

        if output_dir.exists():
            if output_dir.is_dir():
                shutil.rmtree(output_dir)
            else:
                output_dir.unlink()
        shutil.copytree(tmp_dir, output_dir)

    report.package = str(output_dir)
    report.ok = True
    report.message = "export built"
    return output_dir, report


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Export one AI session to WorkBOM .wbom package"
    )
    parser.add_argument("--transcript", type=Path, help="Cursor/Codex transcript .jsonl")
    parser.add_argument(
        "--workspace",
        type=Path,
        help="Project root; with --latest finds newest Cursor session",
    )
    parser.add_argument(
        "--latest", action="store_true", help="Use latest Cursor transcript for workspace"
    )
    parser.add_argument("--tool", choices=["cursor", "codex"], default="cursor")
    parser.add_argument("--output", type=Path, help="Output .wbom directory")
    parser.add_argument("--project-root", type=Path, help="Override projectRoot")
    parser.add_argument(
        "--include-missing",
        action="store_true",
        help="Include transcript paths even if the file is missing (not recommended)",
    )
    parser.add_argument(
        "--no-strict",
        action="store_true",
        help="Allow validation warnings (default is strict)",
    )
    parser.add_argument("--report", type=Path, help="Write JSON export report")
    parser.add_argument("--json", action="store_true", help="Print JSON report to stdout")
    args = parser.parse_args()

    if not args.transcript and not (args.workspace and args.latest):
        parser.error("需要 --transcript <path> 或 --workspace <path> --latest")

    session = load_session(
        args.transcript, args.workspace if args.latest or args.workspace else None, args.tool
    )
    project_root = (args.project_root or Path(session.workspace_path)).expanduser()
    try:
        project_root = project_root.resolve()
    except OSError:
        project_root = Path.cwd().resolve()
    if not project_root.is_dir():
        project_root = Path.cwd().resolve()

    slug = (
        re.sub(r"[^a-z0-9]+", "-", session.title.lower()).strip("-")[:30] or "session"
    )
    default_out = project_root / f"{slug}-session.wbom"
    output_dir = (args.output or default_out).expanduser().resolve()

    pkg, report = build_package(
        session,
        project_root,
        output_dir,
        include_missing=args.include_missing,
    )

    strict = not args.no_strict
    validation = validate_package(pkg, strict=strict)
    report.validation_errors = list(validation.errors)
    report.validation_warnings = list(validation.warnings)
    if not validation.ok:
        report.ok = False
        report.message = "export built but validation failed"
    else:
        report.message = "export ok"

    if args.report:
        write_json_atomic(args.report.expanduser().resolve(), asdict(report))

    if args.json:
        print(json.dumps(asdict(report), ensure_ascii=False, indent=2))
    else:
        print(f"Session: {session.title}")
        print(f"Tool: {session.tool}")
        print(f"Included: {len(report.included)} paths")
        if report.skipped_missing:
            print(f"Skipped missing: {len(report.skipped_missing)}")
            for p in report.skipped_missing[:10]:
                print(f"  - {p}")
        if report.skipped_duplicate:
            print(f"Skipped duplicate: {len(report.skipped_duplicate)}")
        print(f"Package: {pkg}")
        if report.validation_errors:
            print("Validation ERRORS:")
            for e in report.validation_errors:
                print(f"  - {e}")
        if report.validation_warnings:
            print("Validation WARNINGS:")
            for w in report.validation_warnings:
                print(f"  - {w}")
        print("OK" if report.ok else "FAIL")

    return 0 if report.ok else 1


if __name__ == "__main__":
    sys.exit(main())
