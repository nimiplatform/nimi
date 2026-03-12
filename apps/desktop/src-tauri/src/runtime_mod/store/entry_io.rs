#[cfg(test)]
fn normalize_local_mod_entry_path_from_base(
    base_mods_dir: &Path,
    target: &str,
) -> Result<PathBuf, String> {
    let base = base_mods_dir.canonicalize().map_err(|error| {
        format!(
            "规范化 mods 目录失败 ({}): {error}",
            base_mods_dir.display()
        )
    })?;
    let raw_target = PathBuf::from(target);
    let candidate = if raw_target.is_absolute() {
        raw_target
    } else {
        base.join(raw_target)
    };
    let normalized = candidate
        .canonicalize()
        .map_err(|error| format!("规范化 entry 路径失败 ({}): {error}", candidate.display()))?;

    if !normalized.starts_with(&base) {
        return Err(format!(
            "拒绝访问 mods 目录外的路径: {}",
            normalized.display()
        ));
    }

    Ok(normalized)
}

fn normalize_local_mod_entry_path(app: &AppHandle, target: &str) -> Result<PathBuf, String> {
    let roots = enabled_runtime_mod_source_dirs(app)?;
    normalize_entry_path_within_roots(&roots, target)
}

fn is_declared_runtime_mod_asset(app: &AppHandle, normalized: &Path) -> Result<bool, String> {
    Ok(is_declared_runtime_mod_asset_path(
        normalized,
        &list_local_mod_manifests(app)?,
    ))
}

fn is_declared_runtime_mod_asset_path(
    normalized: &Path,
    manifests: &[RuntimeLocalManifestSummary],
) -> bool {
    manifests
        .iter()
        .filter_map(|summary| summary.icon_asset_path.as_ref())
        .filter_map(|item| PathBuf::from(item).canonicalize().ok())
        .any(|item| item == normalized)
}

pub fn read_local_mod_entry(app: &AppHandle, path: &str) -> Result<String, String> {
    let normalized = normalize_local_mod_entry_path(app, path)?;
    fs::read_to_string(&normalized)
        .map_err(|error| format!("读取 mod entry 失败 ({}): {error}", normalized.display()))
}

pub fn read_local_mod_asset(app: &AppHandle, path: &str) -> Result<RuntimeLocalAssetPayload, String> {
    let normalized = normalize_local_mod_entry_path(app, path)?;
    let extension = normalized
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_default();
    if extension != "svg" {
        return Err(format!(
            "拒绝读取非 SVG mod asset: {}",
            normalized.display()
        ));
    }
    if !is_declared_runtime_mod_asset(app, &normalized)? {
        return Err(format!(
            "拒绝读取未声明的 mod asset: {}",
            normalized.display()
        ));
    }
    let bytes = fs::read(&normalized)
        .map_err(|error| format!("读取 mod asset 失败 ({}): {error}", normalized.display()))?;
    Ok(RuntimeLocalAssetPayload {
        mime_type: "image/svg+xml".to_string(),
        base64: base64::engine::general_purpose::STANDARD.encode(bytes),
    })
}

#[cfg(test)]
mod tests {
    use super::{is_declared_runtime_mod_asset_path, normalize_local_mod_entry_path_from_base};
    use crate::runtime_mod::store::RuntimeLocalManifestSummary;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn make_temp_root(label: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock before unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "nimi-runtime-mod-store-{label}-{}-{nanos}",
            std::process::id()
        ));
        fs::create_dir_all(&root).expect("create temp root");
        root
    }

    #[test]
    fn normalize_local_mod_entry_path_allows_in_root_file() {
        let root = make_temp_root("allow-in-root");
        let mods_dir = root.join("mods");
        let entry = mods_dir
            .join("local-chat")
            .join("dist")
            .join("mods")
            .join("local-chat")
            .join("index.js");
        fs::create_dir_all(entry.parent().expect("entry parent")).expect("create entry parent");
        fs::write(&entry, "export {};\n").expect("write entry");

        let normalized = normalize_local_mod_entry_path_from_base(
            &mods_dir,
            "local-chat/dist/mods/local-chat/index.js",
        )
        .expect("normalize entry path");
        assert_eq!(
            normalized,
            entry.canonicalize().expect("canonical entry path")
        );

        fs::remove_dir_all(&root).expect("cleanup temp root");
    }

    #[test]
    fn normalize_local_mod_entry_path_rejects_relative_escape() {
        let root = make_temp_root("reject-relative-escape");
        let mods_dir = root.join("mods");
        fs::create_dir_all(&mods_dir).expect("create mods dir");
        let outside = root.join("outside.js");
        fs::write(&outside, "export {};\n").expect("write outside file");

        let error = normalize_local_mod_entry_path_from_base(&mods_dir, "../outside.js")
            .expect_err("relative escape should be rejected");
        assert!(error.contains("拒绝访问 mods 目录外的路径"));

        fs::remove_dir_all(&root).expect("cleanup temp root");
    }

    #[test]
    fn normalize_local_mod_entry_path_rejects_absolute_outside_path() {
        let root = make_temp_root("reject-absolute-escape");
        let mods_dir = root.join("mods");
        fs::create_dir_all(&mods_dir).expect("create mods dir");
        let outside = root.join("outside-absolute.js");
        fs::write(&outside, "export {};\n").expect("write outside file");

        let error = normalize_local_mod_entry_path_from_base(
            &mods_dir,
            outside
                .to_str()
                .expect("outside path must be valid utf-8 for test"),
        )
        .expect_err("absolute outside path should be rejected");
        assert!(error.contains("拒绝访问 mods 目录外的路径"));

        fs::remove_dir_all(&root).expect("cleanup temp root");
    }

    #[test]
    fn declared_runtime_mod_asset_path_matches_manifest_icon_asset() {
        let root = make_temp_root("declared-asset");
        let mod_dir = root.join("mods").join("local-chat");
        let icon = mod_dir.join("assets").join("icon.svg");
        fs::create_dir_all(icon.parent().expect("icon parent")).expect("create icon parent");
        fs::write(&icon, "<svg/>").expect("write icon");
        let normalized = icon.canonicalize().expect("canonical icon");
        let manifests = vec![RuntimeLocalManifestSummary {
            path: mod_dir.join("mod.manifest.yaml").display().to_string(),
            id: "world.nimi.local-chat".to_string(),
            source_id: None,
            source_type: None,
            source_dir: None,
            name: Some("Local Chat".to_string()),
            version: Some("1.0.0".to_string()),
            entry: None,
            entry_path: None,
            icon_asset: Some("assets/icon.svg".to_string()),
            icon_asset_path: Some(icon.display().to_string()),
            styles: None,
            style_paths: None,
            description: None,
            manifest: None,
            release_manifest: None,
        }];
        assert!(is_declared_runtime_mod_asset_path(&normalized, &manifests));

        fs::remove_dir_all(&root).expect("cleanup temp root");
    }

    #[test]
    fn declared_runtime_mod_asset_path_rejects_undeclared_or_non_canonical_paths() {
        let root = make_temp_root("undeclared-asset");
        let mod_dir = root.join("mods").join("local-chat");
        let icon = mod_dir.join("assets").join("icon.svg");
        let other = mod_dir.join("assets").join("other.svg");
        fs::create_dir_all(icon.parent().expect("icon parent")).expect("create icon parent");
        fs::write(&icon, "<svg/>").expect("write icon");
        fs::write(&other, "<svg/>").expect("write other icon");
        let normalized_other = other.canonicalize().expect("canonical other icon");
        let manifests = vec![RuntimeLocalManifestSummary {
            path: mod_dir.join("mod.manifest.yaml").display().to_string(),
            id: "world.nimi.local-chat".to_string(),
            source_id: None,
            source_type: None,
            source_dir: None,
            name: Some("Local Chat".to_string()),
            version: Some("1.0.0".to_string()),
            entry: None,
            entry_path: None,
            icon_asset: Some("assets/icon.svg".to_string()),
            icon_asset_path: Some(icon.display().to_string()),
            styles: None,
            style_paths: None,
            description: None,
            manifest: None,
            release_manifest: None,
        }];
        assert!(!is_declared_runtime_mod_asset_path(&normalized_other, &manifests));

        fs::remove_dir_all(&root).expect("cleanup temp root");
    }
}
