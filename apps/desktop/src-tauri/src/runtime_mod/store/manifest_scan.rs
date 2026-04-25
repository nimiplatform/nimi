fn extract_manifest_summary(path: &Path, value: &JsonValue) -> Option<RuntimeLocalManifestSummary> {
    let object = value.as_object()?;
    let id = object.get("id")?.as_str()?.trim();
    if id.is_empty() {
        return None;
    }

    let read_opt = |key: &str| -> Option<String> {
        object
            .get(key)
            .and_then(|item| item.as_str())
            .map(|item| item.trim().to_string())
            .filter(|item| !item.is_empty())
    };

    let entry = read_opt("entry");
    let icon_asset = read_opt("iconAsset");
    let styles = object
        .get("styles")
        .and_then(|item| item.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str())
                .map(|item| item.trim().to_string())
                .filter(|item| !item.is_empty())
                .collect::<Vec<_>>()
        })
        .filter(|items| !items.is_empty());
    let entry_path = entry.as_ref().and_then(|entry_value| {
        let parent = path.parent()?;
        Some(parent.join(entry_value).display().to_string())
    });
    let icon_asset_path = icon_asset.as_ref().and_then(|icon_asset_value| {
        let parent = path.parent()?;
        Some(parent.join(icon_asset_value).display().to_string())
    });
    let style_paths = styles.as_ref().and_then(|style_entries| {
        let parent = path.parent()?;
        Some(
            style_entries
                .iter()
                .map(|entry_value| parent.join(entry_value).display().to_string())
                .collect::<Vec<_>>(),
        )
    });

    Some(RuntimeLocalManifestSummary {
        path: path.display().to_string(),
        id: id.to_string(),
        source_id: None,
        source_type: None,
        source_dir: None,
        name: read_opt("name"),
        version: read_opt("version"),
        entry,
        entry_path,
        icon_asset,
        icon_asset_path,
        styles,
        style_paths,
        description: read_opt("description"),
        manifest: Some(value.clone()),
        release_manifest: path.parent().and_then(read_release_manifest_file),
    })
}

fn parse_manifest_file(path: &Path) -> Option<RuntimeLocalManifestSummary> {
    let content = fs::read_to_string(path).ok()?;
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_default();

    let value = if extension == "json" {
        serde_json::from_str::<JsonValue>(&content).ok()?
    } else if extension == "yaml" || extension == "yml" {
        serde_yaml::from_str::<JsonValue>(&content).ok()?
    } else {
        return None;
    };

    extract_manifest_summary(path, &value)
}

fn find_manifest_path(dir: &Path) -> Option<PathBuf> {
    let candidates = [
        dir.join("mod.manifest.yaml"),
        dir.join("mod.manifest.yml"),
        dir.join("mod.manifest.json"),
    ];
    candidates.into_iter().find(|candidate| candidate.exists())
}

fn read_release_manifest_file(dir: &Path) -> Option<JsonValue> {
    let release_path = dir.join("release.manifest.json");
    if !release_path.exists() {
        return None;
    }
    let content = fs::read_to_string(&release_path).ok()?;
    serde_json::from_str::<JsonValue>(&content).ok()
}

fn copy_dir_recursive(source: &Path, target: &Path) -> Result<(), String> {
    fs::create_dir_all(target)
        .map_err(|error| format!("创建目录失败 ({}): {error}", target.display()))?;
    let entries = fs::read_dir(source)
        .map_err(|error| format!("读取目录失败 ({}): {error}", source.display()))?;
    for entry in entries {
        let entry = entry.map_err(|error| format!("读取目录项失败: {error}"))?;
        let source_path = entry.path();
        let target_path = target.join(entry.file_name());
        if source_path.is_dir() {
            copy_dir_recursive(&source_path, &target_path)?;
            continue;
        }
        if source_path.is_file() {
            if let Some(parent) = target_path.parent() {
                fs::create_dir_all(parent).map_err(|error| {
                    format!("创建目标父目录失败 ({}): {error}", parent.display())
                })?;
            }
            fs::copy(&source_path, &target_path).map_err(|error| {
                format!(
                    "复制文件失败 ({} -> {}): {error}",
                    source_path.display(),
                    target_path.display()
                )
            })?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod manifest_scan_tests {
    use super::parse_manifest_file;
    use std::fs;
    use std::path::{Path, PathBuf};
    use tempfile::tempdir;

    fn write_test_manifest(root: &Path) -> PathBuf {
        fs::write(
            root.join("mod.manifest.yaml"),
            "id: world.nimi.test-ai\nname: Test AI\nversion: 1.0.0\nentry: dist/mods/test-ai/index.js\niconAsset: assets/icon.svg\nstyles:\n  - dist/mods/test-ai/index.css\n",
        )
        .expect("write test manifest");
        root.join("mod.manifest.yaml")
    }

    #[test]
    fn parse_manifest_file_extracts_style_paths() {
        let temp = tempdir().expect("create temp dir");
        let mod_dir = temp.path().join("test-ai");
        fs::create_dir_all(mod_dir.join("dist/mods/test-ai")).expect("create test mod dist");
        let manifest_path = write_test_manifest(&mod_dir);

        let summary = parse_manifest_file(&manifest_path).expect("parse manifest");
        assert_eq!(
            summary.styles,
            Some(vec!["dist/mods/test-ai/index.css".to_string()])
        );
        assert_eq!(
            summary.style_paths,
            Some(vec![mod_dir
                .join("dist/mods/test-ai/index.css")
                .display()
                .to_string()])
        );
        assert_eq!(summary.icon_asset.as_deref(), Some("assets/icon.svg"));
        let expected_icon_path = mod_dir.join("assets/icon.svg").display().to_string();
        assert_eq!(
            summary.icon_asset_path.as_deref(),
            Some(expected_icon_path.as_str())
        );
    }
}
