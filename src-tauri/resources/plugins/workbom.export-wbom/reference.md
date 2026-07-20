# .wbom 创建项目参考（schema 2.0）

## 与创建项目的关系

**创建项目** ≠ 工作区扫描。

| | 创建项目 | 工作区扫描（已废弃） |
|--|---------|-------------------|
| 范围 | 当前 transcript 内的 Write/StrReplace 等 | 整个目录 find |
| 会话文本 | `session-transcript.md` | 无 |
| provenance | 自动填 session id | 手工 |

## 目录结构

```text
<项目根>/
├── .ai-sessions/<session-id>/
│   └── session-transcript.md
└── <slug>-session.wbom/
    ├── manifest.json
    ├── relations.json
    ├── works.json
    └── identities.json          # 可选
```

## session-transcript artifact

| 字段 | 值 |
|------|-----|
| `id` | `session-transcript` |
| `role` | `session-log` |
| `kind` | `markdown` |
| `status` | `final` |
| `fileRef.path` | `.ai-sessions/<id>/session-transcript.md` |

## manifest.json

同 WorkBOM 数据模型 v0.2（`schemaVersion: "2.0"`）。创建项目额外约定：

- `domain`: `"AI 协作会话"`
- `summary`: 含产出文件数
- 每个 artifact 必须有 `provenance.note`: `"cursor:<uuid>"` 或 `"codex:<uuid>"`
- `workId` = session uuid
- **默认只收录磁盘上存在的文件**（准确性）

## relations.json

```json
{
  "from": "session-transcript",
  "to": "<产出 artifact id>",
  "kind": "references",
  "label": "会话产出"
}
```

`kind` 只能是 `references` / `derived_from` / `uses` / `pairs_with` / `part_of`（无 `replaces`）。

## identities.json

按「文件名去掉末尾版本号后相同」启发式分组。默认不生成 `part_of`。

## transcript 路径

**Cursor:** `~/.cursor/projects/{slug}/agent-transcripts/{uuid}/{uuid}.jsonl`  
**Codex:** `~/.codex/sessions/**/rollout-*.jsonl`

## 导入行为（WorkBOM）

- 断链文件可导入，UI 标红
- 同 `manifest.id` 重复导入覆盖
- wikilink 自动补关系
