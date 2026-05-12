fn scan_bundle_directory(
    root: &std::path::Path,
    cancel_token: Option<&download_manager::BackgroundImportCancelToken>,
) -> Result<BundleScan, String> {
    fn walk(
        root: &std::path::Path,
        current: &std::path::Path,
        files: &mut Vec<String>,
        cancel_token: Option<&download_manager::BackgroundImportCancelToken>,
    ) -> Result<(), String> {
        if let Some(token) = cancel_token {
            token.throw_if_cancelled()?;
        }
        let entries = std::fs::read_dir(current).map_err(|error| {
            format!(
                "LOCAL_AI_BUNDLE_IMPORT_READ_DIR_FAILED: cannot read bundle directory {}: {error}",
                current.display()
            )
        })?;
        for entry in entries {
            if let Some(token) = cancel_token {
                token.throw_if_cancelled()?;
            }
            let entry = entry.map_err(|error| {
                format!(
                    "LOCAL_AI_BUNDLE_IMPORT_READ_DIR_FAILED: cannot read bundle entry {}: {error}",
                    current.display()
                )
            })?;
            let path = entry.path();
            if is_ignored_local_asset_metadata_path(&path) {
                continue;
            }
            let metadata = std::fs::symlink_metadata(&path).map_err(|error| {
                format!(
                    "LOCAL_AI_BUNDLE_IMPORT_STAT_FAILED: cannot stat bundle entry {}: {error}",
                    path.display()
                )
            })?;
            if metadata.file_type().is_symlink() {
                return Err(symlink_forbidden_error(&path));
            }
            if metadata.is_dir() {
                walk(root, &path, files, cancel_token)?;
                continue;
            }
            if !metadata.is_file() {
                continue;
            }
            let relative = path.strip_prefix(root).map_err(|error| {
                format!(
                    "LOCAL_AI_BUNDLE_IMPORT_RELATIVE_PATH_FAILED: cannot normalize bundle entry {}: {error}",
                    path.display()
                )
            })?;
            let relative_string = relative_path_string(relative);
            if relative_string == ASSET_MANIFEST_FILE_NAME {
                continue;
            }
            files.push(relative_string);
        }
        Ok(())
    }

    let mut files = Vec::<String>::new();
    walk(root, root, &mut files, cancel_token)?;
    files.sort();
    let entry_candidates = files
        .iter()
        .filter(|item| is_model_file_extension(std::path::Path::new(item.as_str())))
        .filter(|item| !is_mmproj_relative_path(item))
        .cloned()
        .collect::<Vec<_>>();
    let mmproj_candidates = files
        .iter()
        .filter(|item| is_mmproj_relative_path(item))
        .cloned()
        .collect::<Vec<_>>();
    Ok(BundleScan {
        files,
        entry_candidates,
        mmproj_candidates,
    })
}

fn ensure_parent_dir(path: &std::path::Path) -> Result<(), String> {
    let Some(parent) = path.parent() else {
        return Ok(());
    };
    std::fs::create_dir_all(parent).map_err(|error| {
        format!(
            "LOCAL_AI_BUNDLE_IMPORT_DIR_FAILED: cannot create directory {}: {error}",
            parent.display()
        )
    })
}

fn copy_bundle_directory(
    source_root: &std::path::Path,
    dest_root: &std::path::Path,
    cancel_token: Option<&download_manager::BackgroundImportCancelToken>,
) -> Result<(), String> {
    fn walk_copy(
        source_root: &std::path::Path,
        current: &std::path::Path,
        dest_root: &std::path::Path,
        cancel_token: Option<&download_manager::BackgroundImportCancelToken>,
    ) -> Result<(), String> {
        if let Some(token) = cancel_token {
            token.throw_if_cancelled()?;
        }
        let entries = std::fs::read_dir(current).map_err(|error| {
            format!(
                "LOCAL_AI_BUNDLE_IMPORT_READ_DIR_FAILED: cannot read bundle directory {}: {error}",
                current.display()
            )
        })?;
        for entry in entries {
            if let Some(token) = cancel_token {
                token.throw_if_cancelled()?;
            }
            let entry = entry.map_err(|error| {
                format!(
                    "LOCAL_AI_BUNDLE_IMPORT_READ_DIR_FAILED: cannot read bundle entry {}: {error}",
                    current.display()
                )
            })?;
            let source_path = entry.path();
            if is_ignored_local_asset_metadata_path(&source_path) {
                continue;
            }
            let metadata = std::fs::symlink_metadata(&source_path).map_err(|error| {
                format!(
                    "LOCAL_AI_BUNDLE_IMPORT_STAT_FAILED: cannot stat bundle entry {}: {error}",
                    source_path.display()
                )
            })?;
            if metadata.file_type().is_symlink() {
                return Err(symlink_forbidden_error(&source_path));
            }
            let relative = source_path.strip_prefix(source_root).map_err(|error| {
                format!(
                    "LOCAL_AI_BUNDLE_IMPORT_RELATIVE_PATH_FAILED: cannot normalize bundle entry {}: {error}",
                    source_path.display()
                )
            })?;
            let dest_path = dest_root.join(relative);
            if metadata.is_dir() {
                std::fs::create_dir_all(&dest_path).map_err(|error| {
                    format!(
                        "LOCAL_AI_BUNDLE_IMPORT_DIR_FAILED: cannot create bundle directory {}: {error}",
                        dest_path.display()
                    )
                })?;
                walk_copy(source_root, &source_path, dest_root, cancel_token)?;
                continue;
            }
            if !metadata.is_file() {
                continue;
            }
            ensure_parent_dir(&dest_path)?;
            if let Some(token) = cancel_token {
                token.throw_if_cancelled()?;
            }
            let source_file = std::fs::File::open(&source_path).map_err(|error| {
                format!(
                    "LOCAL_AI_BUNDLE_IMPORT_COPY_FAILED: cannot open bundle file {}: {error}",
                    source_path.display()
                )
            })?;
            copy_file_with_progress(
                source_file,
                &dest_path,
                |_| {},
                || match cancel_token {
                    Some(token) => token.throw_if_cancelled(),
                    None => Ok(()),
                },
            )
            .map_err(|error| {
                if download_manager::is_background_import_cancelled_error(error.as_str()) {
                    error
                } else {
                    format!(
                        "LOCAL_AI_BUNDLE_IMPORT_COPY_FAILED: cannot copy bundle file {} -> {}: {error}",
                        source_path.display(),
                        dest_path.display()
                    )
                }
            })?;
        }
        Ok(())
    }

    if let Some(token) = cancel_token {
        token.throw_if_cancelled()?;
    }
    std::fs::create_dir_all(dest_root).map_err(|error| {
        format!(
            "LOCAL_AI_BUNDLE_IMPORT_DIR_FAILED: cannot create bundle root {}: {error}",
            dest_root.display()
        )
    })?;
    walk_copy(source_root, source_root, dest_root, cancel_token)
}

fn unique_sibling_path(path: &std::path::Path, label: &str) -> Result<std::path::PathBuf, String> {
    let parent = path.parent().ok_or_else(|| {
        format!(
            "LOCAL_AI_BUNDLE_IMPORT_PATH_FAILED: path has no parent: {}",
            path.display()
        )
    })?;
    let file_name = path.file_name().and_then(|value| value.to_str()).ok_or_else(|| {
        format!(
            "LOCAL_AI_BUNDLE_IMPORT_PATH_FAILED: path has no file name: {}",
            path.display()
        )
    })?;
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_nanos())
        .unwrap_or_default();
    Ok(parent.join(format!(
        ".{file_name}.{label}-{}-{nanos}",
        std::process::id()
    )))
}

fn remove_dir_if_exists(path: &std::path::Path, reason_code: &str) -> Result<(), String> {
    if !path.exists() {
        return Ok(());
    }
    std::fs::remove_dir_all(path)
        .map_err(|error| format!("{reason_code}: cannot remove {}: {error}", path.display()))
}

fn replace_directory_with_rollback(
    staged_dir: &std::path::Path,
    dest_dir: &std::path::Path,
) -> Result<Option<std::path::PathBuf>, String> {
    let backup_dir = unique_sibling_path(dest_dir, "backup")?;
    if dest_dir.exists() {
        std::fs::rename(dest_dir, &backup_dir).map_err(|error| {
            format!(
                "LOCAL_AI_BUNDLE_IMPORT_BACKUP_FAILED: cannot move existing bundle {} -> {}: {error}",
                dest_dir.display(),
                backup_dir.display()
            )
        })?;
    }
    if let Err(error) = std::fs::rename(staged_dir, dest_dir) {
        if backup_dir.exists() {
            let _ = std::fs::rename(&backup_dir, dest_dir);
        }
        return Err(format!(
            "LOCAL_AI_BUNDLE_IMPORT_COMMIT_FAILED: cannot move staged bundle {} -> {}: {error}",
            staged_dir.display(),
            dest_dir.display()
        ));
    }
    Ok(if backup_dir.exists() {
        Some(backup_dir)
    } else {
        None
    })
}

fn rollback_directory_replace(
    dest_dir: &std::path::Path,
    backup_dir: Option<&std::path::Path>,
) -> Result<(), String> {
    remove_dir_if_exists(dest_dir, "LOCAL_AI_BUNDLE_IMPORT_ROLLBACK_FAILED")?;
    if let Some(backup_dir) = backup_dir {
        if backup_dir.exists() {
            std::fs::rename(backup_dir, dest_dir).map_err(|error| {
                format!(
                    "LOCAL_AI_BUNDLE_IMPORT_ROLLBACK_FAILED: cannot restore bundle {} -> {}: {error}",
                    backup_dir.display(),
                    dest_dir.display()
                )
            })?;
        }
    }
    Ok(())
}

fn cleanup_directory_backup(backup_dir: Option<&std::path::Path>) {
    if let Some(backup_dir) = backup_dir {
        let _ = remove_dir_if_exists(backup_dir, "LOCAL_AI_BUNDLE_IMPORT_BACKUP_CLEAN_FAILED");
    }
}
