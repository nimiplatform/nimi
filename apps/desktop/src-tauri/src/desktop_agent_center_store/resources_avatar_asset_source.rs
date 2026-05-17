use super::*;

#[derive(Debug, Clone)]
pub(crate) struct AvatarAssetSourceFile {
    pub(crate) source_path: PathBuf,
    pub(crate) asset_path: String,
    pub(crate) sha256: String,
    pub(crate) bytes: u64,
    pub(crate) mime: String,
}

fn avatar_backend_kind_mime(kind: AgentCenterAvatarBackendKind, relative_path: &str) -> String {
    let extension = extension_for(relative_path);
    match (kind, extension.as_str()) {
        (AgentCenterAvatarBackendKind::Vrm, "vrm") => "model/vrm".to_string(),
        (_, "json") => "application/json".to_string(),
        (_, "png") => "image/png".to_string(),
        (_, "jpg" | "jpeg") => "image/jpeg".to_string(),
        (_, "webp") => "image/webp".to_string(),
        (_, "moc3" | "mtn" | "physics3") => "application/octet-stream".to_string(),
        (_, "vrma") => "model/vrma".to_string(),
        _ => "application/octet-stream".to_string(),
    }
}

fn collect_live2d_source_files(root: &Path) -> Result<(Vec<PathBuf>, PathBuf), String> {
    let mut files = Vec::new();
    let mut model3_files = Vec::new();
    fn visit(
        dir: &Path,
        files: &mut Vec<PathBuf>,
        model3_files: &mut Vec<PathBuf>,
    ) -> Result<(), String> {
        for entry in fs::read_dir(dir).map_err(|error| {
            format!(
                "failed to read Live2D asset directory ({}): {error}",
                dir.display()
            )
        })? {
            let entry =
                entry.map_err(|error| format!("failed to read Live2D asset entry: {error}"))?;
            let path = entry.path();
            let metadata = fs::symlink_metadata(&path).map_err(|error| {
                format!(
                    "failed to inspect Live2D asset entry ({}): {error}",
                    path.display()
                )
            })?;
            if metadata.file_type().is_symlink() {
                return Err(format!(
                    "Live2D asset must not contain symlinks ({})",
                    path.display()
                ));
            }
            if metadata.is_dir() {
                visit(&path, files, model3_files)?;
                continue;
            }
            if !metadata.is_file() {
                continue;
            }
            if path
                .file_name()
                .and_then(|value| value.to_str())
                .map(|value| value.ends_with(".model3.json"))
                .unwrap_or(false)
            {
                model3_files.push(path.clone());
            }
            files.push(path);
        }
        Ok(())
    }
    visit(root, &mut files, &mut model3_files)?;
    match model3_files.len() {
        1 => Ok((files, model3_files.remove(0))),
        0 => Err("Live2D asset must contain exactly one .model3.json file".to_string()),
        _ => Err(
            "Live2D asset contains multiple .model3.json files; select a single model folder"
                .to_string(),
        ),
    }
}

fn collect_vrm_source_files(source: &Path) -> Result<(Vec<PathBuf>, PathBuf), String> {
    if extension_for(&source.to_string_lossy()) != "vrm" {
        return Err("VRM asset source must be a .vrm file".to_string());
    }
    let mut files = vec![source.to_path_buf()];
    if let Some(parent) = source.parent() {
        let presets = parent.join("vrm-motion-presets");
        if presets.is_dir() {
            fn visit(dir: &Path, files: &mut Vec<PathBuf>) -> Result<(), String> {
                for entry in fs::read_dir(dir).map_err(|error| {
                    format!(
                        "failed to read VRM motion preset directory ({}): {error}",
                        dir.display()
                    )
                })? {
                    let entry = entry.map_err(|error| {
                        format!("failed to read VRM motion preset entry: {error}")
                    })?;
                    let path = entry.path();
                    let metadata = fs::symlink_metadata(&path).map_err(|error| {
                        format!(
                            "failed to inspect VRM motion preset entry ({}): {error}",
                            path.display()
                        )
                    })?;
                    if metadata.file_type().is_symlink() {
                        return Err(format!(
                            "VRM motion preset package must not contain symlinks ({})",
                            path.display()
                        ));
                    }
                    if metadata.is_dir() {
                        visit(&path, files)?;
                    } else if metadata.is_file() {
                        files.push(path);
                    }
                }
                Ok(())
            }
            visit(&presets, &mut files)?;
        }
    }
    Ok((files, source.to_path_buf()))
}

fn asset_relative_path(
    kind: AgentCenterAvatarBackendKind,
    root: &Path,
    entry_source: &Path,
    source_path: &Path,
) -> Result<String, String> {
    let relative = match kind {
        AgentCenterAvatarBackendKind::Live2d => source_path
            .strip_prefix(root)
            .map_err(|error| {
                format!(
                    "Live2D asset file is outside selected root ({}): {error}",
                    source_path.display()
                )
            })?
            .to_path_buf(),
        AgentCenterAvatarBackendKind::Vrm => {
            if source_path == entry_source {
                source_path
                    .file_name()
                    .map(PathBuf::from)
                    .ok_or_else(|| "VRM asset source has no file name".to_string())?
            } else {
                let parent = entry_source
                    .parent()
                    .ok_or_else(|| "VRM asset source has no parent directory".to_string())?;
                source_path
                    .strip_prefix(parent)
                    .map_err(|error| {
                        format!(
                            "VRM asset sidecar file is outside selected root ({}): {error}",
                            source_path.display()
                        )
                    })?
                    .to_path_buf()
            }
        }
        AgentCenterAvatarBackendKind::Future => {
            return Err("future avatar backend cannot import a local package".to_string());
        }
    };
    let text = relative
        .to_string_lossy()
        .replace(std::path::MAIN_SEPARATOR, "/");
    if !is_safe_relative_path(&text) {
        return Err(format!("avatar asset file path is not admitted: {text}"));
    }
    Ok(format!("files/{text}"))
}

pub(crate) fn collect_avatar_asset_files(
    kind: AgentCenterAvatarBackendKind,
    source: &Path,
) -> Result<(Vec<AvatarAssetSourceFile>, String, u64), String> {
    let canonical_source = fs::canonicalize(source).map_err(|error| {
        format!(
            "failed to resolve avatar asset source ({}): {error}",
            source.display()
        )
    })?;
    let source_metadata = fs::symlink_metadata(&canonical_source).map_err(|error| {
        format!(
            "failed to read avatar asset source metadata ({}): {error}",
            canonical_source.display()
        )
    })?;
    if source_metadata.file_type().is_symlink() {
        return Err("avatar asset source must not be a symlink".to_string());
    }
    let (raw_files, entry_source) = match kind {
        AgentCenterAvatarBackendKind::Live2d => {
            if !source_metadata.is_dir() {
                return Err("Live2D asset source must be a folder".to_string());
            }
            collect_live2d_source_files(&canonical_source)?
        }
        AgentCenterAvatarBackendKind::Vrm => {
            if !source_metadata.is_file() {
                return Err("VRM asset source must be a file".to_string());
            }
            collect_vrm_source_files(&canonical_source)?
        }
        AgentCenterAvatarBackendKind::Future => {
            return Err("future avatar backend cannot import a local package".to_string());
        }
    };
    if raw_files.is_empty() {
        return Err("avatar asset source contains no files".to_string());
    }
    if raw_files.len() > MAX_AVATAR_ASSET_FILE_COUNT {
        return Err("avatar asset exceeds the fixed file count cap".to_string());
    }
    let mut out = Vec::with_capacity(raw_files.len());
    let mut asset_bytes = 0_u64;
    for file in raw_files {
        let metadata = fs::symlink_metadata(&file).map_err(|error| {
            format!(
                "failed to inspect avatar asset file ({}): {error}",
                file.display()
            )
        })?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err(format!(
                "avatar asset file must be a regular file ({})",
                file.display()
            ));
        }
        let bytes = metadata.len();
        if bytes == 0 || bytes > MAX_AVATAR_ASSET_FILE_BYTES {
            return Err(format!(
                "avatar asset file is outside the fixed byte cap ({})",
                file.display()
            ));
        }
        asset_bytes = asset_bytes
            .checked_add(bytes)
            .ok_or_else(|| "avatar asset byte count overflowed".to_string())?;
        if asset_bytes > MAX_AVATAR_ASSET_BYTES {
            return Err("avatar asset exceeds the fixed asset byte cap".to_string());
        }
        let asset_path = asset_relative_path(kind, &canonical_source, &entry_source, &file)?;
        let (_, sha256) = sha256_file(&file).map_err(|issue| issue.message)?;
        let mime = avatar_backend_kind_mime(kind, &asset_path);
        out.push(AvatarAssetSourceFile {
            source_path: file,
            asset_path,
            sha256,
            bytes,
            mime,
        });
    }
    out.sort_by(|left, right| left.asset_path.cmp(&right.asset_path));
    let entry_file = asset_relative_path(kind, &canonical_source, &entry_source, &entry_source)?;
    Ok((out, entry_file, asset_bytes))
}

pub(crate) fn avatar_asset_content_digest(files: &[AvatarAssetSourceFile]) -> String {
    let mut hasher = Sha256::new();
    for file in files {
        hasher.update(file.asset_path.as_bytes());
        hasher.update([0]);
        hasher.update(file.sha256.as_bytes());
        hasher.update([0]);
        hasher.update(file.bytes.to_string().as_bytes());
        hasher.update([0]);
    }
    format!("{:x}", hasher.finalize())
}

pub(crate) fn avatar_asset_source_fingerprint(source_path: &Path, content_digest: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(source_label_for(source_path).as_bytes());
    hasher.update([0]);
    hasher.update(content_digest.as_bytes());
    format!("{:x}", hasher.finalize())
}
