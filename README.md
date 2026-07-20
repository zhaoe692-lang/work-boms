# WorkBOM

Local-first desktop workspace for organizing, searching, and exploring AI-generated creative assets.

WorkBOM imports `.wbom` packages, keeps links to the original files, and turns scattered outputs into a navigable asset library with project context, relationships, versions, and local search.

> Early Preview · macOS Apple Silicon · MIT License · No telemetry · Source files stay on your machine

## Why WorkBOM?

AI-assisted work spreads across chat transcripts, images, audio, Markdown, scripts, and revisions. File names alone do not explain what belongs together or which result is current.

WorkBOM provides one local workspace to:

- import structured `.wbom` result packages
- browse assets without copying the original project files
- inspect upstream, downstream, reference, assembly, and version relationships
- explore projects through an interactive 3D knowledge graph
- search by file name, metadata, content, media type, and intent
- update asset status, metadata, relations, and version heads
- detect broken file links and reconnect moved files
- recover accidentally removed assets from a local trash

## Early Preview scope

| Area | Included |
| --- | --- |
| Project library | Import and manage `.wbom` packages |
| Asset cockpit | Project metrics, relationship map, metadata and status editing |
| Knowledge graph | Relation filters, neighborhood focus, graph insights |
| Smart search | Full-text and local semantic retrieval |
| Asset operations | Preview, open, reveal in Finder, rename, reconnect and relate |
| Recovery | Soft delete, restore, permanent deletion |
| Official plugin | **Create Project** — generate importable `.wbom` from Cursor / Codex / Claude / workBuddy |

## Download

Prebuilt DMGs are published on the [GitHub Releases](https://github.com/zhaoe692-lang/work-boms/releases) page (when available).

1. Download `WorkBOM_<version>_aarch64.dmg`
2. Open the DMG and drag **WorkBOM** into **Applications**
3. On first launch, macOS may block the unsigned preview — open **System Settings → Privacy & Security** and choose **Open Anyway**
4. Import a `.wbom` package from the project sidebar

Current builds target Apple Silicon. The app is not code-signed or notarized yet.

## Privacy

- No telemetry, analytics, accounts, or cloud sync
- Package metadata, search index, graph layouts, and app state live in the macOS application-data directory
- Imported source files are not uploaded and are not copied into the library
- Semantic search runs locally with a bundled embedding model

## What is a `.wbom` package?

A `.wbom` package is a directory with a manifest and optional relationship / work / identity JSON. Asset entries point to files via relative or absolute paths.

```text
project.wbom/
├── manifest.json
├── relations.json
├── works.json
└── identities.json
```

Use the bundled **Create Project** plugin from the in-app plugin marketplace to generate packages from AI agent sessions.

## Build from source

Requirements:

- macOS with Xcode Command Line Tools
- Node.js 20+
- Rust stable

```bash
npm install
npm test
npm run tauri dev
```

Release build:

```bash
npm run build:app
```

The DMG is written under `releases/` (local only; not committed).

### Embedding model

Local semantic search uses a bundled INT8 ONNX model under `src-tauri/resources/models/bge-small-zh-v1.5-int8/`. License notes are in that folder’s `MODEL_LICENSE.md`. If the weights are missing locally, you can restore them with:

```bash
./scripts/fetch-embedding-model.sh
```

## Known limitations

- Unsigned / not notarized macOS preview
- Inspiration Board may be incomplete or hidden in Early Preview builds
- Please open Issues with version, macOS version, steps, and redacted examples only — **do not** attach private source files, API keys, transcripts, or confidential project data

## License

MIT — see [LICENSE](./LICENSE).

## 中文简介

WorkBOM 是本地优先的 AI 创作资产工作台：导入 `.wbom` 成果包、管理源文件链接、查看关系、探索知识图谱与智能检索。当前为 macOS Apple Silicon Early Preview，无遥测与云同步。欢迎通过 GitHub Issues 反馈，请勿上传含隐私或机密内容的文件。
