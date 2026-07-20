# 安装「创建项目」到各 AI 代理

本插件是 **Agent Skill**：把本目录（或 WorkBOM 导出的插件包）放到对应工具的 skills 目录即可。

## 从 WorkBOM 导出

1. 打开 WorkBOM → **插件市场**
2. 找到 **创建项目** → **导出插件**
3. 选择目标目录，得到 `workbom.export-wbom/`（含 `plugin.json` + `SKILL.md` + `scripts/`）

## Cursor

复制到项目或用户 skills：

```bash
# 项目级（推荐随仓库）
cp -R workbom.export-wbom/. "<repo>/.agents/skills/export-wbom/"

# 或用户级（若你的 Cursor 版本支持 ~/.agents/skills）
cp -R workbom.export-wbom "/path/to/skills/export-wbom"
```

对话中说：`用 export-wbom 导出本会话为 .wbom`。

## Codex

```bash
cp -R workbom.export-wbom ~/.codex/skills/export-wbom
```

可选：在 `agents/openai.yaml` 中声明 display_name（若目录内已有则保留）。

## Claude Code

```bash
mkdir -p ~/.claude/skills
cp -R workbom.export-wbom ~/.claude/skills/export-wbom
```

## workBuddy

将插件目录放到 workBuddy 的 skills / plugins 目录（以产品文档为准），确保 `SKILL.md` 可被发现，且 `scripts/*.py` 可执行。

## 校验安装

```bash
python3 scripts/validate_wbom.py --help
python3 scripts/export-session-wbom.py --help
```

两者均可打印帮助即安装成功。
