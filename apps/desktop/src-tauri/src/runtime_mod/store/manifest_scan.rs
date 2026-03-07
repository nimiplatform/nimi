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
    let entry_path = entry.as_ref().and_then(|entry_value| {
        let parent = path.parent()?;
        let candidate = parent.join(entry_value);
        Some(candidate.display().to_string())
    });

    Some(RuntimeLocalManifestSummary {
        path: path.display().to_string(),
        id: id.to_string(),
        name: read_opt("name"),
        version: read_opt("version"),
        entry,
        entry_path,
        description: read_opt("description"),
        manifest: Some(value.clone()),
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

fn parse_semver_parts(input: &str) -> Vec<u64> {
    input
        .split(['-', '+'])
        .next()
        .unwrap_or_default()
        .split('.')
        .map(|part| part.trim().parse::<u64>().unwrap_or(0))
        .collect()
}

fn compare_versions(left: Option<&str>, right: Option<&str>) -> Ordering {
    let left_parts = parse_semver_parts(left.unwrap_or_default());
    let right_parts = parse_semver_parts(right.unwrap_or_default());
    let max_len = left_parts.len().max(right_parts.len());
    for index in 0..max_len {
        let left_value = *left_parts.get(index).unwrap_or(&0);
        let right_value = *right_parts.get(index).unwrap_or(&0);
        if left_value < right_value {
            return Ordering::Less;
        }
        if left_value > right_value {
            return Ordering::Greater;
        }
    }
    Ordering::Equal
}

fn find_manifest_path(dir: &Path) -> Option<PathBuf> {
    let candidates = [
        dir.join("mod.manifest.yaml"),
        dir.join("mod.manifest.yml"),
        dir.join("mod.manifest.json"),
    ];
    candidates.into_iter().find(|candidate| candidate.exists())
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

fn hash_file_bytes(path: &Path) -> Result<Vec<u8>, String> {
    fs::read(path).map_err(|error| format!("读取文件失败 ({}): {error}", path.display()))
}

fn hash_directory_recursive(path: &Path) -> Result<String, String> {
    fn walk(path: &Path, base: &Path, hasher: &mut sha2::Sha256) -> Result<(), String> {
        let mut entries = fs::read_dir(path)
            .map_err(|error| format!("读取目录失败 ({}): {error}", path.display()))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| format!("读取目录项失败 ({}): {error}", path.display()))?;
        entries.sort_by_key(|entry| entry.file_name());

        for entry in entries {
            let current_path = entry.path();
            let relative = current_path
                .strip_prefix(base)
                .map_err(|error| format!("计算相对路径失败 ({}): {error}", current_path.display()))?;
            if relative == Path::new(DEFAULT_MOD_MARKER_FILE) {
                continue;
            }
            let relative_text = relative.to_string_lossy().replace('\\', "/");
            hasher.update(relative_text.as_bytes());
            if current_path.is_dir() {
                hasher.update(b"dir");
                walk(&current_path, base, hasher)?;
                continue;
            }
            if current_path.is_file() {
                hasher.update(b"file");
                hasher.update(&hash_file_bytes(&current_path)?);
            }
        }
        Ok(())
    }

    let mut hasher = sha2::Sha256::new();
    walk(path, path, &mut hasher)?;
    let digest = sha2::Digest::finalize(hasher);
    let mut out = String::with_capacity(digest.len() * 2);
    for byte in digest {
        out.push_str(format!("{:02x}", byte).as_str());
    }
    Ok(out)
}

fn should_refresh_managed_default_mod(
    source_mod_dir: &Path,
    target_mod_dir: &Path,
    source_version: Option<&str>,
    target_version: Option<&str>,
    _marker: &ManagedDefaultModMarker,
) -> Result<bool, String> {
    match compare_versions(source_version, target_version) {
        Ordering::Greater => return Ok(true),
        Ordering::Less => return Ok(false),
        Ordering::Equal => {}
    }

    let source_hash = hash_directory_recursive(source_mod_dir)?;
    let target_hash = hash_directory_recursive(target_mod_dir)?;
    Ok(source_hash != target_hash)
}

fn marker_path(mod_dir: &Path) -> PathBuf {
    mod_dir.join(DEFAULT_MOD_MARKER_FILE)
}

fn read_default_mod_marker(mod_dir: &Path) -> Option<ManagedDefaultModMarker> {
    let path = marker_path(mod_dir);
    let content = fs::read_to_string(path).ok()?;
    serde_json::from_str::<ManagedDefaultModMarker>(&content).ok()
}

fn write_default_mod_marker(
    mod_dir: &Path,
    mod_id: &str,
    version: Option<&str>,
    content_hash: Option<&str>,
) -> Result<(), String> {
    let marker = ManagedDefaultModMarker {
        managed: true,
        mod_id: mod_id.to_string(),
        version: version
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
        content_hash: content_hash
            .map(|value| value.trim().to_string())
            .filter(|value| !value.is_empty()),
    };
    let marker_content = serde_json::to_string_pretty(&marker)
        .map_err(|error| format!("序列化默认 mod 标记失败: {error}"))?;
    fs::write(marker_path(mod_dir), marker_content)
        .map_err(|error| format!("写入默认 mod 标记失败: {error}"))
}

fn has_custom_mods_dir_override() -> bool {
    std::env::var("NIMI_RUNTIME_MODS_DIR")
        .ok()
        .map(|value| value.trim().to_string())
        .map(|value| !value.is_empty())
        .unwrap_or(false)
}

fn bundled_default_mods_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|error| format!("无法获取 resource_dir: {error}"))?;
    Ok(resource_dir.join("default-mods"))
}

fn sync_default_mods_from_resources(app: &AppHandle, mods_dir: &Path) -> Result<(), String> {
    if cfg!(debug_assertions) || has_custom_mods_dir_override() {
        return Ok(());
    }

    let source_root = bundled_default_mods_dir(app)?;
    if !source_root.exists() {
        return Ok(());
    }

    let entries = fs::read_dir(&source_root).map_err(|error| {
        format!(
            "读取 default-mods 资源目录失败 ({}): {error}",
            source_root.display()
        )
    })?;

    for entry in entries {
        let entry = entry.map_err(|error| format!("读取 default-mods 子项失败: {error}"))?;
        let source_mod_dir = entry.path();
        if !source_mod_dir.is_dir() {
            continue;
        }

        let source_manifest_path = match find_manifest_path(&source_mod_dir) {
            Some(path) => path,
            None => continue,
        };
        let source_summary = match parse_manifest_file(&source_manifest_path) {
            Some(summary) => summary,
            None => continue,
        };

        let target_mod_dir = mods_dir.join(entry.file_name());
        let source_version = source_summary.version.as_deref();
        let source_content_hash = hash_directory_recursive(&source_mod_dir)?;

        if !target_mod_dir.exists() {
            copy_dir_recursive(&source_mod_dir, &target_mod_dir)?;
            write_default_mod_marker(
                &target_mod_dir,
                &source_summary.id,
                source_version,
                Some(&source_content_hash),
            )?;
            continue;
        }

        let marker = match read_default_mod_marker(&target_mod_dir) {
            Some(value) => value,
            None => continue,
        };
        if !marker.managed || marker.mod_id != source_summary.id {
            continue;
        }

        let target_manifest_path = match find_manifest_path(&target_mod_dir) {
            Some(path) => path,
            None => continue,
        };
        let target_summary = parse_manifest_file(&target_manifest_path);
        let target_version = target_summary
            .as_ref()
            .and_then(|summary| summary.version.as_deref());
        if !should_refresh_managed_default_mod(
            &source_mod_dir,
            &target_mod_dir,
            source_version,
            target_version,
            &marker,
        )? {
            continue;
        }

        fs::remove_dir_all(&target_mod_dir).map_err(|error| {
            format!(
                "删除旧默认 mod 目录失败 ({}): {error}",
                target_mod_dir.display()
            )
        })?;
        copy_dir_recursive(&source_mod_dir, &target_mod_dir)?;
        write_default_mod_marker(
            &target_mod_dir,
            &source_summary.id,
            source_version,
            Some(&source_content_hash),
        )?;
    }

    Ok(())
}

#[cfg(test)]
mod manifest_scan_tests {
    use super::{
        hash_directory_recursive, should_refresh_managed_default_mod, ManagedDefaultModMarker,
        DEFAULT_MOD_MARKER_FILE,
    };
    use std::fs;
    use std::path::Path;
    use tempfile::tempdir;

    fn write_test_mod(root: &Path, version: &str, body: &str) {
        fs::create_dir_all(root.join("dist/mods/local-chat")).expect("create test mod dist");
        fs::write(
            root.join("mod.manifest.yaml"),
            format!(
                "id: world.nimi.local-chat\nname: Local Chat\nversion: {version}\nentry: dist/mods/local-chat/index.js\n"
            ),
        )
        .expect("write test manifest");
        fs::write(root.join("dist/mods/local-chat/index.js"), body).expect("write test entry");
    }

    fn managed_marker(content_hash: Option<String>) -> ManagedDefaultModMarker {
        ManagedDefaultModMarker {
            managed: true,
            mod_id: "world.nimi.local-chat".to_string(),
            version: Some("1.0.0".to_string()),
            content_hash,
        }
    }

    #[test]
    fn hash_directory_recursive_ignores_default_mod_marker() {
        let temp = tempdir().expect("create temp dir");
        let mod_dir = temp.path().join("local-chat");
        write_test_mod(&mod_dir, "1.0.0", "export const version = 'a';\n");
        let before = hash_directory_recursive(&mod_dir).expect("hash before marker");
        fs::write(
            mod_dir.join(DEFAULT_MOD_MARKER_FILE),
            r#"{"managed":true,"modId":"world.nimi.local-chat","version":"1.0.0","contentHash":"ignored"}"#,
        )
        .expect("write marker");
        let after = hash_directory_recursive(&mod_dir).expect("hash after marker");
        assert_eq!(before, after);
    }

    #[test]
    fn same_version_same_content_does_not_refresh() {
        let temp = tempdir().expect("create temp dir");
        let source_dir = temp.path().join("source");
        let target_dir = temp.path().join("target");
        write_test_mod(&source_dir, "1.0.0", "export const version = 'same';\n");
        write_test_mod(&target_dir, "1.0.0", "export const version = 'same';\n");
        let source_hash = hash_directory_recursive(&source_dir).expect("hash source");

        let refresh = should_refresh_managed_default_mod(
            &source_dir,
            &target_dir,
            Some("1.0.0"),
            Some("1.0.0"),
            &managed_marker(Some(source_hash)),
        )
        .expect("evaluate refresh");

        assert!(!refresh);
    }

    #[test]
    fn same_version_content_change_refreshes_even_with_stale_marker() {
        let temp = tempdir().expect("create temp dir");
        let source_dir = temp.path().join("source");
        let target_dir = temp.path().join("target");
        write_test_mod(&source_dir, "1.0.0", "export const version = 'new';\n");
        write_test_mod(&target_dir, "1.0.0", "export const version = 'old';\n");
        let target_hash = hash_directory_recursive(&target_dir).expect("hash target");

        let refresh = should_refresh_managed_default_mod(
            &source_dir,
            &target_dir,
            Some("1.0.0"),
            Some("1.0.0"),
            &managed_marker(Some(target_hash)),
        )
        .expect("evaluate refresh");

        assert!(refresh);
    }
}
