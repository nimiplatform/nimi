use super::*;
use std::io::Read;

fn live2d_reference_path(
    entry_file: &str,
    reference: &str,
    label: &str,
    path_label: &str,
    errors: &mut Vec<AgentCenterValidationIssue>,
) -> Option<String> {
    let reference = reference.trim();
    if reference.is_empty()
        || reference.starts_with('/')
        || reference.starts_with('\\')
        || reference.contains("://")
    {
        errors.push(error(
            "path_rejected",
            &format!("Live2D {label} reference must be package-relative."),
            Some(path_label.to_string()),
        ));
        return None;
    }
    let mut parts = entry_file
        .split('/')
        .map(str::to_string)
        .collect::<Vec<_>>();
    if parts.pop().is_none() || parts.first().map(String::as_str) != Some("files") {
        errors.push(error(
            "avatar_asset_manifest_invalid",
            "Live2D entry_file must be rooted under files/.",
            Some("entry_file".to_string()),
        ));
        return None;
    }
    for segment in reference.split(['/', '\\']) {
        if segment.is_empty() || segment == "." {
            continue;
        }
        if segment == ".." {
            if parts.len() <= 1 {
                errors.push(error(
                    "path_rejected",
                    &format!("Live2D {label} reference escapes files/."),
                    Some(path_label.to_string()),
                ));
                return None;
            }
            parts.pop();
            continue;
        }
        parts.push(segment.to_string());
    }
    let path = parts.join("/");
    if !path.starts_with("files/") || !is_safe_relative_path(&path) {
        errors.push(error(
            "path_rejected",
            &format!("Live2D {label} reference was rejected."),
            Some(path_label.to_string()),
        ));
        return None;
    }
    Some(path)
}

fn validate_live2d_moc_header(
    asset_root: &Path,
    package_path: &str,
    errors: &mut Vec<AgentCenterValidationIssue>,
    warnings: &mut Vec<AgentCenterValidationIssue>,
) {
    let path = match resolve_under_root(asset_root, package_path) {
        Ok(path) => path,
        Err(issue) => {
            errors.push(issue);
            return;
        }
    };
    let metadata = match fs::metadata(&path) {
        Ok(metadata) => metadata,
        Err(source) => {
            errors.push(error(
                "permission_denied",
                &format!("Live2D MOC file metadata cannot be read: {source}"),
                Some(package_path.to_string()),
            ));
            return;
        }
    };
    let mut file = match fs::File::open(&path) {
        Ok(file) => file,
        Err(source) => {
            errors.push(error(
                "permission_denied",
                &format!("Live2D MOC file cannot be opened: {source}"),
                Some(package_path.to_string()),
            ));
            return;
        }
    };
    let mut header = [0_u8; 5];
    if let Err(source) = file.read_exact(&mut header) {
        errors.push(error(
            "live2d_moc_header_invalid",
            &format!("Live2D MOC file is too small or unreadable: {source}"),
            Some(package_path.to_string()),
        ));
        return;
    }
    if &header[..4] != b"MOC3" {
        errors.push(error(
            "live2d_moc_header_invalid",
            "Live2D MOC file must start with the MOC3 header.",
            Some(package_path.to_string()),
        ));
    }
    let size_mb = metadata.len() as f64 / 1024.0 / 1024.0;
    if size_mb > 30.0 {
        warnings.push(issue(
            "live2d_moc_large",
            &format!(
                "Live2D MOC file is large ({size_mb:.2} MB) and may affect startup performance."
            ),
            Some(package_path.to_string()),
            AgentCenterValidationIssueSeverity::Warning,
        ));
    }
}

fn validate_live2d_file_reference(
    asset_root: &Path,
    manifest_files: &std::collections::HashSet<String>,
    entry_file: &str,
    reference: &str,
    label: &str,
    path_label: &str,
    errors: &mut Vec<AgentCenterValidationIssue>,
    warnings: &mut Vec<AgentCenterValidationIssue>,
) -> Option<String> {
    let package_path = live2d_reference_path(entry_file, reference, label, path_label, errors)?;
    if manifest_files.contains(&package_path) {
        if label == "MOC" {
            validate_live2d_moc_header(asset_root, &package_path, errors, warnings);
        }
        return Some(package_path);
    }
    if let Some(actual_path) = manifest_files
        .iter()
        .find(|candidate| candidate.eq_ignore_ascii_case(&package_path))
    {
        errors.push(error(
            "missing_required_file",
            &format!(
                "Live2D {label} reference differs by case: expected {package_path}, found {actual_path}."
            ),
            Some(path_label.to_string()),
        ));
        return None;
    }
    errors.push(error(
        "missing_required_file",
        &format!("Live2D {label} reference is missing: {package_path}."),
        Some(path_label.to_string()),
    ));
    None
}

fn validate_live2d_manifest_warnings(
    manifest: &AvatarAssetManifest,
    warnings: &mut Vec<AgentCenterValidationIssue>,
) {
    let mut basenames = std::collections::BTreeMap::<String, Vec<String>>::new();
    for file in &manifest.files {
        if !file.path.is_ascii() {
            warnings.push(issue(
                "live2d_non_ascii_path",
                "Live2D package file path contains non-ASCII characters; import remains local but cross-platform portability may be reduced.",
                Some(file.path.clone()),
                AgentCenterValidationIssueSeverity::Warning,
            ));
        }
        if let Some(base) = file.path.rsplit('/').next().filter(|base| !base.is_empty()) {
            basenames
                .entry(base.to_ascii_lowercase())
                .or_default()
                .push(file.path.clone());
        }
    }
    for (base, paths) in basenames {
        if paths.len() > 1 {
            warnings.push(issue(
                "live2d_basename_collision",
                &format!(
                    "Live2D package has duplicate basename {base}; path-aware loading is required for {} files.",
                    paths.len()
                ),
                Some(paths.join(", ")),
                AgentCenterValidationIssueSeverity::Warning,
            ));
        }
    }
}

pub(super) fn validate_live2d_model3_structure(
    asset_root: &Path,
    manifest: &AvatarAssetManifest,
    errors: &mut Vec<AgentCenterValidationIssue>,
    warnings: &mut Vec<AgentCenterValidationIssue>,
) {
    validate_live2d_manifest_warnings(manifest, warnings);
    let manifest_files = manifest
        .files
        .iter()
        .map(|file| file.path.clone())
        .collect::<std::collections::HashSet<_>>();
    let entry_path = match resolve_under_root(asset_root, &manifest.entry_file) {
        Ok(path) => path,
        Err(issue) => {
            errors.push(issue);
            return;
        }
    };
    let raw = match fs::read_to_string(&entry_path) {
        Ok(raw) => raw,
        Err(source) => {
            errors.push(error(
                "permission_denied",
                &format!("Live2D model3.json cannot be read: {source}"),
                Some(manifest.entry_file.clone()),
            ));
            return;
        }
    };
    let root = match serde_json::from_str::<serde_json::Value>(&raw) {
        Ok(value) => value,
        Err(source) => {
            errors.push(error(
                "avatar_asset_manifest_invalid",
                &format!("Live2D model3.json is malformed: {source}"),
                Some(manifest.entry_file.clone()),
            ));
            return;
        }
    };
    let Some(references) = root
        .get("FileReferences")
        .and_then(serde_json::Value::as_object)
    else {
        errors.push(error(
            "avatar_asset_manifest_invalid",
            "Live2D model3.json must contain FileReferences.",
            Some("FileReferences".to_string()),
        ));
        return;
    };

    match references.get("Moc").and_then(serde_json::Value::as_str) {
        Some(moc) => {
            validate_live2d_file_reference(
                asset_root,
                &manifest_files,
                &manifest.entry_file,
                moc,
                "MOC",
                "FileReferences.Moc",
                errors,
                warnings,
            );
        }
        None => errors.push(error(
            "missing_required_file",
            "Live2D model3.json must reference FileReferences.Moc.",
            Some("FileReferences.Moc".to_string()),
        )),
    }

    match references
        .get("Textures")
        .and_then(serde_json::Value::as_array)
    {
        Some(textures) if !textures.is_empty() => {
            for (index, texture) in textures.iter().enumerate() {
                if let Some(texture_ref) = texture.as_str() {
                    validate_live2d_file_reference(
                        asset_root,
                        &manifest_files,
                        &manifest.entry_file,
                        texture_ref,
                        "Texture",
                        &format!("FileReferences.Textures.{index}"),
                        errors,
                        warnings,
                    );
                } else {
                    errors.push(error(
                        "avatar_asset_manifest_invalid",
                        "Live2D texture references must be strings.",
                        Some(format!("FileReferences.Textures.{index}")),
                    ));
                }
            }
        }
        _ => errors.push(error(
            "missing_required_file",
            "Live2D model3.json must reference at least one texture.",
            Some("FileReferences.Textures".to_string()),
        )),
    }

    for (key, label) in [
        ("Physics", "Physics"),
        ("Pose", "Pose"),
        ("DisplayInfo", "DisplayInfo"),
    ] {
        if let Some(reference) = references.get(key) {
            if let Some(reference) = reference.as_str() {
                validate_live2d_file_reference(
                    asset_root,
                    &manifest_files,
                    &manifest.entry_file,
                    reference,
                    label,
                    &format!("FileReferences.{key}"),
                    errors,
                    warnings,
                );
            } else {
                errors.push(error(
                    "avatar_asset_manifest_invalid",
                    &format!("Live2D FileReferences.{key} must be a string when present."),
                    Some(format!("FileReferences.{key}")),
                ));
            }
        }
    }

    if let Some(expressions) = references
        .get("Expressions")
        .and_then(serde_json::Value::as_array)
    {
        for (index, expression) in expressions.iter().enumerate() {
            let expression_ref = expression.as_str().or_else(|| {
                expression
                    .as_object()
                    .and_then(|object| object.get("File"))
                    .and_then(serde_json::Value::as_str)
            });
            if let Some(expression_ref) = expression_ref {
                validate_live2d_file_reference(
                    asset_root,
                    &manifest_files,
                    &manifest.entry_file,
                    expression_ref,
                    "Expression",
                    &format!("FileReferences.Expressions.{index}.File"),
                    errors,
                    warnings,
                );
            } else {
                errors.push(error(
                    "avatar_asset_manifest_invalid",
                    "Live2D expression entries must be strings or objects with File.",
                    Some(format!("FileReferences.Expressions.{index}")),
                ));
            }
        }
    }

    if let Some(motions) = references
        .get("Motions")
        .and_then(serde_json::Value::as_object)
    {
        for (group, entries) in motions {
            let Some(entries) = entries.as_array() else {
                errors.push(error(
                    "avatar_asset_manifest_invalid",
                    "Live2D motion groups must be arrays.",
                    Some(format!("FileReferences.Motions.{group}")),
                ));
                continue;
            };
            for (index, motion) in entries.iter().enumerate() {
                if let Some(motion_ref) = motion
                    .as_object()
                    .and_then(|object| object.get("File"))
                    .and_then(serde_json::Value::as_str)
                {
                    validate_live2d_file_reference(
                        asset_root,
                        &manifest_files,
                        &manifest.entry_file,
                        motion_ref,
                        "Motion",
                        &format!("FileReferences.Motions.{group}.{index}.File"),
                        errors,
                        warnings,
                    );
                } else {
                    errors.push(error(
                        "avatar_asset_manifest_invalid",
                        "Live2D motion entries must be objects with File.",
                        Some(format!("FileReferences.Motions.{group}.{index}")),
                    ));
                }
            }
        }
    } else if references.get("Motions").is_some() {
        errors.push(error(
            "avatar_asset_manifest_invalid",
            "Live2D FileReferences.Motions must be an object when present.",
            Some("FileReferences.Motions".to_string()),
        ));
    }
}
