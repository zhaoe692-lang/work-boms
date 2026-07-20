---
name: export-wbom
description: >-
  Create Project：在 AI 代理中创建可导入 WorkBOM 的项目包（.wbom）。
  仅收录本协作真实写入的文件 + 协作记录，创建后强制校验。
---

# Create Project — 创建可导入 WorkBOM 的项目包

在 Cursor / Codex / Claude / workBuddy 中使用；导入 WorkBOM 后成为项目。

## 核心原则（准确性）

| ✅ 做 | ❌ 不做 |
|------|--------|
| 只解析**当前会话** transcript | `find` 扫描整个工作区 |
| 只收录**磁盘上真实存在**的产出文件 | 把缺失路径写进 manifest |
| 导出后 **strict 校验** | 跳过 validate |
| camelCase + schema `2.0` | snake_case / 旧 schema |

`.wbom` = JSON 链接清单；真实文件留在 `projectRoot`。

## 快速执行

脚本相对本插件目录：`scripts/`。

### Cursor — 指定 transcript

```bash
python3 scripts/export-session-wbom.py \
  --transcript "<transcript.jsonl 绝对路径>" \
  --project-root "<工作区绝对路径>" \
  --output "<工作区>/<slug>-session.wbom"
```

### Cursor — 最新会话

```bash
python3 scripts/export-session-wbom.py \
  --workspace "<工作区绝对路径>" \
  --latest \
  --output "<工作区>/<slug>-session.wbom"
```

### Codex

```bash
python3 scripts/export-session-wbom.py \
  --tool codex \
  --transcript "~/.codex/sessions/**/rollout-*.jsonl" \
  --project-root "<cwd>" \
  --output "<cwd>/<slug>-session.wbom"
```

### 校验（单独）

```bash
python3 scripts/validate_wbom.py --strict "<output>.wbom"
# 或 JSON：
python3 scripts/validate_wbom.py --strict --json "<output>.wbom"
```

导出脚本**默认 strict**；仅调试时用 `--no-strict`。

## 产出结构

```text
<项目根>/
├── .ai-sessions/<session-id>/session-transcript.md
└── <slug>-session.wbom/
    ├── manifest.json
    ├── relations.json
    ├── works.json
    └── identities.json   # 可选
```

## 健壮性约定

1. 损坏的 JSONL 行跳过，不中断
2. 缺失文件记入 report `skipped_missing`，默认不进包
3. 原子写入（临时目录 → 替换）
4. 校验失败则进程退出码 ≠ 0
5. 可用 `--report report.json` / `--json` 拿机器可读结果

## 禁止事项

- ❌ 扫描工作区代替会话解析
- ❌ 塞入本会话未写入的文件
- ❌ 复制二进制进 `.wbom`
- ❌ snake_case 字段名

## 安装到各代理

见同目录 `INSTALL.md`（各代理环境的安装说明）。

## 下一步

WorkBOM → 插件市场确认本插件已启用 → 导入生成的 `.wbom` 目录。
