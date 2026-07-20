#!/usr/bin/env python3
"""Accuracy / robustness tests for the official export-wbom plugin."""

from __future__ import annotations

import importlib.util
import json
import sys
import tempfile
import unittest
from pathlib import Path

_HERE = Path(__file__).resolve().parent
_spec = importlib.util.spec_from_file_location(
    "export_session_wbom", _HERE / "export-session-wbom.py"
)
export_mod = importlib.util.module_from_spec(_spec)
assert _spec and _spec.loader
sys.modules["export_session_wbom"] = export_mod
_spec.loader.exec_module(export_mod)

from validate_wbom import validate_package  # noqa: E402


class ExportAccuracyTests(unittest.TestCase):
    def test_extract_patch_paths(self):
        patch = "*** Add File: docs/a.md\n+hello\n*** Update File: src/b.ts\n"
        self.assertEqual(
            export_mod.extract_patch_paths(patch), ["docs/a.md", "src/b.ts"]
        )

    def test_parse_cursor_skips_bad_json_and_reads_write(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            transcript = root / "sess.jsonl"
            lines = [
                "not-json",
                json.dumps(
                    {
                        "role": "user",
                        "message": {
                            "content": [
                                {
                                    "type": "text",
                                    "text": "<user_query>\n写一个大纲\n</user_query>",
                                }
                            ]
                        },
                    }
                ),
                json.dumps(
                    {
                        "role": "assistant",
                        "message": {
                            "content": [
                                {
                                    "type": "tool_use",
                                    "name": "Write",
                                    "input": {
                                        "path": "docs/outline.md",
                                        "contents": "# hi",
                                    },
                                }
                            ]
                        },
                    }
                ),
            ]
            transcript.write_text("\n".join(lines) + "\n", encoding="utf-8")
            parsed = export_mod.parse_cursor_transcript(transcript, "Users-demo-project")
            self.assertIsNotNone(parsed)
            assert parsed is not None
            self.assertEqual(parsed.title, "写一个大纲")
            self.assertEqual(parsed.artifact_paths, ["docs/outline.md"])

    def test_build_skips_missing_and_validates(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            project = root / "proj"
            project.mkdir()
            (project / "docs").mkdir()
            (project / "docs" / "outline.md").write_text("# outline\n", encoding="utf-8")

            session = export_mod.ParsedSession(
                session_id="abcd1234-session",
                title="写一个大纲",
                tool="Cursor",
                workspace_path=str(project),
                started_at="2026-01-01T00:00:00Z",
                updated_at="2026-01-01T00:00:00Z",
                artifact_paths=["docs/outline.md", "docs/missing.md"],
            )
            out = root / "demo-session.wbom"
            pkg, report = export_mod.build_package(
                session, project, out, include_missing=False
            )
            self.assertTrue(report.ok)
            self.assertIn("docs/missing.md", report.skipped_missing)

            manifest = json.loads((pkg / "manifest.json").read_text(encoding="utf-8"))
            ids = {a["id"] for a in manifest["artifacts"]}
            self.assertIn("session-transcript", ids)
            self.assertIn("outline", ids)
            self.assertEqual(len(manifest["artifacts"]), 2)

            result = validate_package(pkg, strict=True)
            self.assertTrue(result.ok, result.errors)


if __name__ == "__main__":
    unittest.main()
