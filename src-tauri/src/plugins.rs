//! WorkBOM plugin marketplace: install, preinstall bundled, import / export.

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

pub const PLUGIN_SCHEMA_VERSION: &str = "1.0";
pub const OFFICIAL_EXPORT_PLUGIN_ID: &str = "workbom.export-wbom";
/// Legacy id from the `.aiwork` era; removed on ensure so the official plugin is unique.
const LEGACY_EXPORT_PLUGIN_ID: &str = "workbom.export-aiwork";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginEntry {
    pub skill: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub validate_script: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub export_script: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginManifest {
    pub schema_version: String,
    pub id: String,
    pub name: String,
    pub display_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name_i18n: Option<std::collections::HashMap<String, String>>,
    pub version: String,
    pub description: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description_i18n: Option<std::collections::HashMap<String, String>>,
    pub author: String,
    #[serde(default)]
    pub official: bool,
    pub kind: String,
    #[serde(default)]
    pub targets: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub homepage: Option<String>,
    #[serde(default)]
    pub capabilities: Vec<String>,
    pub entry: PluginEntry,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_app_version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub license: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegistryPlugin {
    pub id: String,
    pub version: String,
    pub installed_at: String,
    pub source: String,
    pub enabled: bool,
    pub install_path: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginRegistry {
    pub schema_version: String,
    pub plugins: Vec<RegistryPlugin>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginInfo {
    pub id: String,
    pub name: String,
    pub display_name: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display_name_i18n: Option<std::collections::HashMap<String, String>>,
    pub version: String,
    pub description: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub description_i18n: Option<std::collections::HashMap<String, String>>,
    pub author: String,
    pub official: bool,
    pub kind: String,
    pub targets: Vec<String>,
    pub capabilities: Vec<String>,
    pub source: String,
    pub enabled: bool,
    pub installed: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub installed_at: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub install_path: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub homepage: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub min_app_version: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub license: Option<String>,
    pub issues: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginCatalogState {
    pub installed: Vec<PluginInfo>,
    pub available: Vec<PluginInfo>,
}

pub struct PluginService {
    vault_path: PathBuf,
    resource_dir: PathBuf,
}

impl PluginService {
    pub fn new(vault_path: PathBuf, resource_dir: PathBuf) -> Self {
        Self {
            vault_path,
            resource_dir,
        }
    }

    pub fn plugins_dir(&self) -> PathBuf {
        self.vault_path.join("plugins")
    }

    pub fn registry_path(&self) -> PathBuf {
        self.plugins_dir().join("registry.json")
    }

    pub fn bundled_plugins_dir(&self) -> PathBuf {
        self.resource_dir.join("resources/plugins")
    }

    pub fn ensure(&self) -> Result<(), String> {
        fs::create_dir_all(self.plugins_dir())
            .map_err(|e| format!("无法创建 plugins 目录: {e}"))?;
        if !self.registry_path().exists() {
            self.write_registry(&PluginRegistry {
                schema_version: PLUGIN_SCHEMA_VERSION.to_string(),
                plugins: vec![],
            })?;
        }
        self.ensure_preinstalled()?;
        Ok(())
    }

    fn iso_now() -> String {
        let secs = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_secs())
            .unwrap_or(0);
        // Keep it simple / stable for local storage; UI formats as needed.
        format!("{secs}")
    }

    fn read_registry(&self) -> Result<PluginRegistry, String> {
        let path = self.registry_path();
        if !path.exists() {
            return Ok(PluginRegistry {
                schema_version: PLUGIN_SCHEMA_VERSION.to_string(),
                plugins: vec![],
            });
        }
        let text = fs::read_to_string(&path).map_err(|e| format!("读取 registry 失败: {e}"))?;
        serde_json::from_str(&text).map_err(|e| format!("解析 registry 失败: {e}"))
    }

    fn write_registry(&self, registry: &PluginRegistry) -> Result<(), String> {
        let path = self.registry_path();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).map_err(|e| format!("创建 registry 目录失败: {e}"))?;
        }
        let text = serde_json::to_string_pretty(registry)
            .map_err(|e| format!("序列化 registry 失败: {e}"))?;
        atomic_write(&path, text.as_bytes())
    }

    pub fn validate_plugin_dir(dir: &Path) -> Result<(PluginManifest, Vec<String>), String> {
        let mut issues = Vec::new();
        if !dir.is_dir() {
            return Err(format!("不是插件目录: {}", dir.display()));
        }
        let manifest_path = dir.join("plugin.json");
        if !manifest_path.is_file() {
            return Err("缺少 plugin.json".into());
        }
        let text = fs::read_to_string(&manifest_path)
            .map_err(|e| format!("读取 plugin.json 失败: {e}"))?;

        // Reject snake_case top-level keys before serde (serde would just miss fields).
        if let Ok(raw) = serde_json::from_str::<serde_json::Value>(&text) {
            if let Some(obj) = raw.as_object() {
                for key in obj.keys() {
                    if key.contains('_') {
                        return Err(format!(
                            "plugin.json 使用了 snake_case 字段 {key:?}，请使用 camelCase"
                        ));
                    }
                }
            }
        }

        let manifest: PluginManifest = serde_json::from_str(&text)
            .map_err(|e| format!("plugin.json 无效: {e}"))?;

        if manifest.schema_version != PLUGIN_SCHEMA_VERSION {
            issues.push(format!(
                "schemaVersion 为 {:?}，期望 {:?}",
                manifest.schema_version, PLUGIN_SCHEMA_VERSION
            ));
        }
        if manifest.id.trim().is_empty() {
            return Err("plugin.json id 不能为空".into());
        }
        if !manifest.id.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-' || c == '_')
        {
            return Err("plugin.json id 仅允许字母数字、点、横线、下划线".into());
        }
        if manifest.name.trim().is_empty() || manifest.display_name.trim().is_empty() {
            return Err("plugin.json name / displayName 不能为空".into());
        }
        if manifest.version.trim().is_empty() {
            return Err("plugin.json version 不能为空".into());
        }
        if manifest.kind.trim().is_empty() {
            return Err("plugin.json kind 不能为空".into());
        }
        if manifest.entry.skill.trim().is_empty() {
            return Err("plugin.json entry.skill 不能为空".into());
        }

        let skill_path = dir.join(&manifest.entry.skill);
        if !skill_path.is_file() {
            return Err(format!("缺少 skill 文件: {}", manifest.entry.skill));
        }

        if let Some(script) = &manifest.entry.validate_script {
            if !dir.join(script).is_file() {
                issues.push(format!("缺少 validateScript: {script}"));
            }
        }
        if let Some(script) = &manifest.entry.export_script {
            if !dir.join(script).is_file() {
                issues.push(format!("缺少 exportScript: {script}"));
            }
        }

        Ok((manifest, issues))
    }

    fn copy_dir_recursive(src: &Path, dst: &Path) -> Result<(), String> {
        if dst.exists() {
            fs::remove_dir_all(dst).map_err(|e| format!("清理目标目录失败: {e}"))?;
        }
        fs::create_dir_all(dst).map_err(|e| format!("创建目标目录失败: {e}"))?;
        for entry in fs::read_dir(src).map_err(|e| format!("读取源目录失败: {e}"))? {
            let entry = entry.map_err(|e| format!("读取目录项失败: {e}"))?;
            let ty = entry
                .file_type()
                .map_err(|e| format!("读取文件类型失败: {e}"))?;
            let from = entry.path();
            let to = dst.join(entry.file_name());
            if ty.is_dir() {
                Self::copy_dir_recursive(&from, &to)?;
            } else if ty.is_file() {
                if let Some(parent) = to.parent() {
                    fs::create_dir_all(parent).map_err(|e| format!("创建文件目录失败: {e}"))?;
                }
                fs::copy(&from, &to).map_err(|e| format!("复制文件失败 {}: {e}", from.display()))?;
            }
        }
        Ok(())
    }

    fn install_from_dir(
        &self,
        source_dir: &Path,
        source_label: &str,
        overwrite: bool,
    ) -> Result<PluginInfo, String> {
        let (manifest, issues) = Self::validate_plugin_dir(source_dir)?;
        if !issues.is_empty() && source_label == "imported" {
            // Hard-fail import when required scripts missing.
            let hard: Vec<_> = issues
                .iter()
                .filter(|i| i.starts_with("缺少"))
                .cloned()
                .collect();
            if !hard.is_empty() {
                return Err(hard.join("; "));
            }
        }

        let mut registry = self.read_registry()?;
        if let Some(existing) = registry.plugins.iter().find(|p| p.id == manifest.id) {
            if !overwrite {
                return Err(format!(
                    "插件 {} 已安装 (v{})。请先卸载或选择覆盖导入。",
                    manifest.id, existing.version
                ));
            }
        }

        let install_rel = format!("plugins/{}", manifest.id);
        let install_abs = self.vault_path.join(&install_rel);
        Self::copy_dir_recursive(source_dir, &install_abs)?;

        // Re-validate installed copy
        let (installed_manifest, installed_issues) = Self::validate_plugin_dir(&install_abs)?;
        if installed_manifest.id != manifest.id {
            return Err("安装后 plugin id 不一致".into());
        }

        registry.plugins.retain(|p| p.id != manifest.id);
        registry.plugins.push(RegistryPlugin {
            id: manifest.id.clone(),
            version: manifest.version.clone(),
            installed_at: Self::iso_now(),
            source: source_label.to_string(),
            enabled: true,
            install_path: install_rel.clone(),
        });
        self.write_registry(&registry)?;

        Ok(self.info_from_parts(
            &installed_manifest,
            source_label,
            true,
            true,
            Some(Self::iso_now()),
            Some(install_abs.display().to_string()),
            installed_issues,
        ))
    }

    fn migrate_legacy_official_plugin(&self) -> Result<(), String> {
        let mut registry = self.read_registry()?;
        let Some(legacy) = registry
            .plugins
            .iter()
            .find(|p| p.id == LEGACY_EXPORT_PLUGIN_ID)
            .cloned()
        else {
            return Ok(());
        };
        let dir = self.vault_path.join(&legacy.install_path);
        if dir.exists() {
            let _ = fs::remove_dir_all(&dir);
        }
        registry
            .plugins
            .retain(|p| p.id != LEGACY_EXPORT_PLUGIN_ID);
        self.write_registry(&registry)?;
        Ok(())
    }

    fn ensure_preinstalled(&self) -> Result<(), String> {
        self.migrate_legacy_official_plugin()?;
        let registry = self.read_registry()?;
        if registry
            .plugins
            .iter()
            .any(|p| p.id == OFFICIAL_EXPORT_PLUGIN_ID)
        {
            // Keep bundled official plugin in sync when newer bundled version exists.
            let bundled = self
                .bundled_plugins_dir()
                .join(OFFICIAL_EXPORT_PLUGIN_ID);
            if bundled.is_dir() {
                if let (Ok((bundled_m, _)), Ok((installed_m, _))) = (
                    Self::validate_plugin_dir(&bundled),
                    Self::validate_plugin_dir(
                        &self.vault_path.join(format!("plugins/{OFFICIAL_EXPORT_PLUGIN_ID}")),
                    ),
                ) {
                    if bundled_m.version != installed_m.version {
                        let _ = self.install_from_dir(&bundled, "bundled", true);
                    }
                }
            }
            return Ok(());
        }

        let bundled = self
            .bundled_plugins_dir()
            .join(OFFICIAL_EXPORT_PLUGIN_ID);
        if !bundled.is_dir() {
            // Dev without resources: try repo-relative fallback is not available at runtime.
            return Ok(());
        }
        self.install_from_dir(&bundled, "bundled", true)?;
        Ok(())
    }

    fn info_from_parts(
        &self,
        manifest: &PluginManifest,
        source: &str,
        enabled: bool,
        installed: bool,
        installed_at: Option<String>,
        install_path: Option<String>,
        issues: Vec<String>,
    ) -> PluginInfo {
        PluginInfo {
            id: manifest.id.clone(),
            name: manifest.name.clone(),
            display_name: manifest.display_name.clone(),
            display_name_i18n: manifest.display_name_i18n.clone(),
            version: manifest.version.clone(),
            description: manifest.description.clone(),
            description_i18n: manifest.description_i18n.clone(),
            author: manifest.author.clone(),
            official: manifest.official,
            kind: manifest.kind.clone(),
            targets: manifest.targets.clone(),
            capabilities: manifest.capabilities.clone(),
            source: source.to_string(),
            enabled,
            installed,
            installed_at,
            install_path,
            homepage: manifest.homepage.clone(),
            min_app_version: manifest.min_app_version.clone(),
            license: manifest.license.clone(),
            issues,
        }
    }

    pub fn get_catalog(&self) -> Result<PluginCatalogState, String> {
        self.ensure()?;
        let registry = self.read_registry()?;
        let mut installed = Vec::new();
        for entry in &registry.plugins {
            let dir = self.vault_path.join(&entry.install_path);
            match Self::validate_plugin_dir(&dir) {
                Ok((manifest, issues)) => {
                    installed.push(self.info_from_parts(
                        &manifest,
                        &entry.source,
                        entry.enabled,
                        true,
                        Some(entry.installed_at.clone()),
                        Some(dir.display().to_string()),
                        issues,
                    ));
                }
                Err(err) => {
                    installed.push(PluginInfo {
                        id: entry.id.clone(),
                        name: entry.id.clone(),
                        display_name: entry.id.clone(),
                        display_name_i18n: None,
                        version: entry.version.clone(),
                        description: String::new(),
                        description_i18n: None,
                        author: String::new(),
                        official: entry.id == OFFICIAL_EXPORT_PLUGIN_ID,
                        kind: "unknown".into(),
                        targets: vec![],
                        capabilities: vec![],
                        source: entry.source.clone(),
                        enabled: entry.enabled,
                        installed: true,
                        installed_at: Some(entry.installed_at.clone()),
                        install_path: Some(dir.display().to_string()),
                        homepage: None,
                        min_app_version: None,
                        license: None,
                        issues: vec![err],
                    });
                }
            }
        }

        let installed_ids: std::collections::HashSet<_> =
            installed.iter().map(|p| p.id.clone()).collect();
        let mut available = Vec::new();
        let bundled_root = self.bundled_plugins_dir();
        if bundled_root.is_dir() {
            for entry in fs::read_dir(&bundled_root)
                .map_err(|e| format!("读取内置插件目录失败: {e}"))?
            {
                let entry = entry.map_err(|e| format!("读取内置插件失败: {e}"))?;
                if !entry.file_type().map(|t| t.is_dir()).unwrap_or(false) {
                    continue;
                }
                let dir = entry.path();
                if let Ok((manifest, issues)) = Self::validate_plugin_dir(&dir) {
                    if installed_ids.contains(&manifest.id) {
                        continue;
                    }
                    available.push(self.info_from_parts(
                        &manifest,
                        "catalog",
                        true,
                        false,
                        None,
                        Some(dir.display().to_string()),
                        issues,
                    ));
                }
            }
        }

        installed.sort_by(|a, b| a.display_name.cmp(&b.display_name));
        available.sort_by(|a, b| a.display_name.cmp(&b.display_name));
        Ok(PluginCatalogState {
            installed,
            available,
        })
    }

    pub fn import_plugin(&self, source_path: &str, overwrite: bool) -> Result<PluginInfo, String> {
        self.ensure()?;
        let source = PathBuf::from(source_path);
        let dir = if source.is_file() && source.file_name().and_then(|n| n.to_str()) == Some("plugin.json")
        {
            source
                .parent()
                .ok_or_else(|| "无效的 plugin.json 路径".to_string())?
                .to_path_buf()
        } else {
            source
        };
        self.install_from_dir(&dir, "imported", overwrite)
    }

    pub fn export_plugin(&self, plugin_id: &str, dest_dir: &str) -> Result<String, String> {
        self.ensure()?;
        let registry = self.read_registry()?;
        let entry = registry
            .plugins
            .iter()
            .find(|p| p.id == plugin_id)
            .ok_or_else(|| format!("未安装插件: {plugin_id}"))?;
        let src = self.vault_path.join(&entry.install_path);
        let (manifest, issues) = Self::validate_plugin_dir(&src)?;
        if !issues.is_empty() {
            // Still allow export, but surface hard errors
            let hard: Vec<_> = issues
                .iter()
                .filter(|i| i.contains("缺少 skill") || i.contains("plugin.json"))
                .cloned()
                .collect();
            if !hard.is_empty() {
                return Err(hard.join("; "));
            }
        }

        let dest_root = PathBuf::from(dest_dir);
        fs::create_dir_all(&dest_root).map_err(|e| format!("无法创建导出目录: {e}"))?;
        let dest = dest_root.join(&manifest.id);
        Self::copy_dir_recursive(&src, &dest)?;
        // Final check
        Self::validate_plugin_dir(&dest)?;
        Ok(dest.display().to_string())
    }

    pub fn uninstall_plugin(&self, plugin_id: &str) -> Result<(), String> {
        self.ensure()?;
        let mut registry = self.read_registry()?;
        let Some(entry) = registry.plugins.iter().find(|p| p.id == plugin_id).cloned() else {
            return Err(format!("未安装插件: {plugin_id}"));
        };
        let dir = self.vault_path.join(&entry.install_path);
        if dir.exists() {
            fs::remove_dir_all(&dir).map_err(|e| format!("删除插件目录失败: {e}"))?;
        }
        registry.plugins.retain(|p| p.id != plugin_id);
        self.write_registry(&registry)?;
        Ok(())
    }

    pub fn set_plugin_enabled(&self, plugin_id: &str, enabled: bool) -> Result<PluginInfo, String> {
        self.ensure()?;
        let mut registry = self.read_registry()?;
        let entry = registry
            .plugins
            .iter_mut()
            .find(|p| p.id == plugin_id)
            .ok_or_else(|| format!("未安装插件: {plugin_id}"))?;
        entry.enabled = enabled;
        let install_path = entry.install_path.clone();
        let source = entry.source.clone();
        let installed_at = entry.installed_at.clone();
        self.write_registry(&registry)?;

        let dir = self.vault_path.join(&install_path);
        let (manifest, issues) = Self::validate_plugin_dir(&dir)?;
        Ok(self.info_from_parts(
            &manifest,
            &source,
            enabled,
            true,
            Some(installed_at),
            Some(dir.display().to_string()),
            issues,
        ))
    }

    pub fn install_bundled(&self, plugin_id: &str) -> Result<PluginInfo, String> {
        self.ensure()?;
        let bundled = self.bundled_plugins_dir().join(plugin_id);
        if !bundled.is_dir() {
            return Err(format!("内置目录中没有插件: {plugin_id}"));
        }
        self.install_from_dir(&bundled, "bundled", true)
    }
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "无效路径".to_string())?;
    fs::create_dir_all(parent).map_err(|e| format!("创建目录失败: {e}"))?;
    let tmp = parent.join(format!(
        ".{}.tmp",
        path.file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("plugin")
    ));
    fs::write(&tmp, bytes).map_err(|e| format!("写入临时文件失败: {e}"))?;
    fs::rename(&tmp, path).or_else(|e| {
        // Windows may need remove-then-rename; macOS usually fine.
        if path.exists() {
            let _ = fs::remove_file(path);
        }
        fs::rename(&tmp, path).map_err(|e2| format!("原子替换失败: {e} / {e2}"))
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;

    fn write_minimal_plugin(dir: &Path, id: &str, version: &str) {
        fs::create_dir_all(dir.join("scripts")).unwrap();
        let manifest = format!(
            r#"{{
  "schemaVersion": "1.0",
  "id": "{id}",
  "name": "demo",
  "displayName": "Demo Plugin",
  "version": "{version}",
  "description": "test",
  "author": "WorkBOM",
  "official": false,
  "kind": "agent-skill",
  "targets": ["cursor"],
  "capabilities": [],
  "entry": {{
    "skill": "SKILL.md",
    "validateScript": "scripts/validate_wbom.py",
    "exportScript": "scripts/export-session-wbom.py"
  }}
}}"#
        );
        fs::write(dir.join("plugin.json"), manifest).unwrap();
        fs::write(dir.join("SKILL.md"), "# demo\n").unwrap();
        fs::write(dir.join("scripts/validate_wbom.py"), "print('ok')\n").unwrap();
        fs::write(dir.join("scripts/export-session-wbom.py"), "print('ok')\n").unwrap();
    }

    #[test]
    fn validate_rejects_snake_case() {
        let tmp = tempfile_dir("snake");
        write_minimal_plugin(&tmp, "demo.plugin", "1.0.0");
        let mut text = fs::read_to_string(tmp.join("plugin.json")).unwrap();
        text = text.replace("\"schemaVersion\"", "\"schema_version\"");
        fs::write(tmp.join("plugin.json"), text).unwrap();
        let err = PluginService::validate_plugin_dir(&tmp).unwrap_err();
        assert!(err.contains("snake_case") || err.contains("plugin.json 无效"));
    }

    #[test]
    fn import_export_roundtrip() {
        let vault = tempfile_dir("vault");
        let resources = tempfile_dir("res");
        let bundled = resources.join("resources/plugins/workbom.export-wbom");
        write_minimal_plugin(&bundled, OFFICIAL_EXPORT_PLUGIN_ID, "1.0.0");

        let service = PluginService::new(vault.clone(), resources);
        service.ensure().unwrap();
        let catalog = service.get_catalog().unwrap();
        assert!(catalog
            .installed
            .iter()
            .any(|p| p.id == OFFICIAL_EXPORT_PLUGIN_ID));

        let export_root = tempfile_dir("export");
        let exported = service
            .export_plugin(OFFICIAL_EXPORT_PLUGIN_ID, export_root.to_str().unwrap())
            .unwrap();
        assert!(Path::new(&exported).join("plugin.json").is_file());

        // Import as third-party id
        let third = tempfile_dir("third");
        write_minimal_plugin(&third, "community.sample", "0.1.0");
        let info = service
            .import_plugin(third.to_str().unwrap(), false)
            .unwrap();
        assert_eq!(info.id, "community.sample");
        assert_eq!(info.source, "imported");
    }

    #[test]
    fn bundled_official_plugin_e2e() {
        let real = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("resources/plugins/workbom.export-wbom");
        assert!(
            real.join("plugin.json").is_file(),
            "bundled official plugin missing at {}",
            real.display()
        );

        let (manifest, issues) = PluginService::validate_plugin_dir(&real).unwrap();
        assert_eq!(manifest.id, OFFICIAL_EXPORT_PLUGIN_ID);
        assert!(!manifest.description.trim().is_empty());
        assert!(!manifest.display_name.trim().is_empty());
        assert!(manifest.official);
        assert!(manifest.targets.iter().any(|t| t == "cursor"));
        assert!(issues.is_empty(), "bundled plugin issues: {issues:?}");
        assert!(real.join(&manifest.entry.skill).is_file());
        assert!(real
            .join(manifest.entry.validate_script.as_deref().unwrap())
            .is_file());
        assert!(real
            .join(manifest.entry.export_script.as_deref().unwrap())
            .is_file());

        let vault = tempfile_dir("vault-real");
        let resources = tempfile_dir("res-real");
        let bundled_dst = resources
            .join("resources/plugins")
            .join(OFFICIAL_EXPORT_PLUGIN_ID);
        PluginService::copy_dir_recursive(&real, &bundled_dst).unwrap();

        let service = PluginService::new(vault, resources);
        service.ensure().unwrap();
        let catalog = service.get_catalog().unwrap();
        let installed = catalog
            .installed
            .iter()
            .find(|p| p.id == OFFICIAL_EXPORT_PLUGIN_ID)
            .expect("official plugin should be preinstalled");
        assert!(installed.enabled);
        assert_eq!(installed.source, "bundled");
        assert!(
            !installed.description.is_empty(),
            "marketplace description must surface"
        );
        assert!(installed.display_name.contains(".wbom"));

        let export_root = tempfile_dir("export-real");
        let exported = service
            .export_plugin(OFFICIAL_EXPORT_PLUGIN_ID, export_root.to_str().unwrap())
            .unwrap();
        let (exported_m, _) = PluginService::validate_plugin_dir(Path::new(&exported)).unwrap();
        assert_eq!(exported_m.id, OFFICIAL_EXPORT_PLUGIN_ID);

        // Re-import exported package (overwrite)
        let again = service.import_plugin(&exported, true).unwrap();
        assert_eq!(again.id, OFFICIAL_EXPORT_PLUGIN_ID);
        assert_eq!(again.source, "imported");

        service.set_plugin_enabled(OFFICIAL_EXPORT_PLUGIN_ID, false).unwrap();
        let catalog2 = service.get_catalog().unwrap();
        let disabled = catalog2
            .installed
            .iter()
            .find(|p| p.id == OFFICIAL_EXPORT_PLUGIN_ID)
            .unwrap();
        assert!(!disabled.enabled);
    }

    fn tempfile_dir(label: &str) -> PathBuf {
        let mut dir = std::env::temp_dir();
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        dir.push(format!("workbom-plugin-{label}-{nanos}"));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[allow(dead_code)]
    fn touch(path: &Path) {
        let mut f = fs::File::create(path).unwrap();
        writeln!(f, "x").unwrap();
    }
}
