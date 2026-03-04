pub fn list_local_mod_manifests(
    app: &AppHandle,
) -> Result<Vec<RuntimeLocalManifestSummary>, String> {
    let mods_dir = local_mods_dir(app)?;
    fs::create_dir_all(&mods_dir)
        .map_err(|error| format!("创建 mods 目录失败 ({}): {error}", mods_dir.display()))?;
    if let Err(error) = sync_default_mods_from_resources(app, &mods_dir) {
        eprintln!(
            "[runtime_mod] sync_default_mods_from_resources failed ({}): {}",
            mods_dir.display(),
            error
        );
    }
    if !mods_dir.exists() {
        return Ok(Vec::new());
    }

    let mut manifests = Vec::new();
    let entries = fs::read_dir(&mods_dir)
        .map_err(|error| format!("读取 mods 目录失败 ({}): {error}", mods_dir.display()))?;

    for entry in entries {
        let entry = entry.map_err(|error| format!("读取 mods 子目录失败: {error}"))?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let candidates = [
            path.join("mod.manifest.yaml"),
            path.join("mod.manifest.yml"),
            path.join("mod.manifest.json"),
        ];
        let matched_path = candidates.into_iter().find(|candidate| candidate.exists());
        let Some(manifest_path) = matched_path else {
            continue;
        };

        if let Some(summary) = parse_manifest_file(&manifest_path) {
            manifests.push(summary);
        }
    }

    manifests.sort_by(|a, b| a.id.cmp(&b.id));
    Ok(manifests)
}

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
    let mods_dir = local_mods_dir(app)?;
    fs::create_dir_all(&mods_dir)
        .map_err(|error| format!("创建 mods 目录失败 ({}): {error}", mods_dir.display()))?;
    normalize_local_mod_entry_path_from_base(&mods_dir, target)
}

pub fn read_local_mod_entry(app: &AppHandle, path: &str) -> Result<String, String> {
    let normalized = normalize_local_mod_entry_path(app, path)?;
    fs::read_to_string(&normalized)
        .map_err(|error| format!("读取 mod entry 失败 ({}): {error}", normalized.display()))
}

#[cfg(test)]
mod tests {
    use super::{ensure_runtime_matches_mods_root, normalize_local_mod_entry_path_from_base};
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
    fn ensure_runtime_matches_mods_root_accepts_same_path() {
        let root = make_temp_root("runtime-root-same");
        let mods_root = root.join("nimi-mods");
        fs::create_dir_all(&mods_root).expect("create mods root");

        ensure_runtime_matches_mods_root(&mods_root, &mods_root)
            .expect("same path should pass contract");

        fs::remove_dir_all(&root).expect("cleanup temp root");
    }

    #[test]
    fn ensure_runtime_matches_mods_root_rejects_mismatch_path() {
        let root = make_temp_root("runtime-root-mismatch");
        let mods_root = root.join("nimi-mods");
        let runtime_mods_dir = root.join("runtime-mods");
        fs::create_dir_all(&mods_root).expect("create mods root");
        fs::create_dir_all(&runtime_mods_dir).expect("create runtime mods dir");

        let error = ensure_runtime_matches_mods_root(&runtime_mods_dir, &mods_root)
            .expect_err("mismatched directories should fail contract");
        assert!(error.contains("NIMI_RUNTIME_MODS_DIR"));
        assert!(error.contains("NIMI_MODS_ROOT"));

        fs::remove_dir_all(&root).expect("cleanup temp root");
    }
}

