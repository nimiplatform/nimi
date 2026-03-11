use chrono::Utc;
use reqwest::blocking::Client;
use std::collections::HashMap;
use std::fs::File;
use std::io;
use std::sync::{Mutex, OnceLock};
use tauri::Emitter;
use tempfile::tempdir;
use zip::read::ZipArchive;

const RUNTIME_MOD_INSTALL_PROGRESS_EVENT: &str = "runtime-mod://install-progress";

fn install_progress_store() -> &'static Mutex<HashMap<String, RuntimeModInstallProgressPayload>> {
    static STORE: OnceLock<Mutex<HashMap<String, RuntimeModInstallProgressPayload>>> =
        OnceLock::new();
    STORE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn now_rfc3339() -> String {
    Utc::now().to_rfc3339()
}

fn create_install_session_id() -> String {
    format!(
        "runtime-mod-install-{}-{}",
        std::process::id(),
        Utc::now().timestamp_millis()
    )
}

fn emit_install_progress(
    app: &AppHandle,
    payload: RuntimeModInstallProgressPayload,
) -> Result<(), String> {
    let mut store = install_progress_store()
        .lock()
        .map_err(|_| "安装进度状态锁已损坏".to_string())?;
    store.insert(payload.install_session_id.clone(), payload.clone());
    drop(store);
    app.emit(RUNTIME_MOD_INSTALL_PROGRESS_EVENT, &payload)
        .map_err(|error| format!("发送 runtime mod 安装进度事件失败: {error}"))?;
    Ok(())
}

pub fn list_runtime_mod_install_progress(
    install_session_id: Option<&str>,
) -> Result<Vec<RuntimeModInstallProgressPayload>, String> {
    let store = install_progress_store()
        .lock()
        .map_err(|_| "安装进度状态锁已损坏".to_string())?;
    let mut items = store
        .values()
        .filter(|item| {
            install_session_id
                .map(|target| item.install_session_id == target)
                .unwrap_or(true)
        })
        .cloned()
        .collect::<Vec<_>>();
    items.sort_by(|left, right| left.occurred_at.cmp(&right.occurred_at));
    Ok(items)
}

fn normalize_source_kind(source: &str, source_kind: Option<&str>) -> Result<String, String> {
    let explicit = source_kind
        .unwrap_or_default()
        .trim()
        .to_ascii_lowercase();
    if explicit == "directory" || explicit == "archive" || explicit == "url" {
        return Ok(explicit);
    }
    let normalized_source = source.trim();
    if normalized_source.starts_with("http://") || normalized_source.starts_with("https://") {
        return Ok("url".to_string());
    }
    let path = PathBuf::from(normalized_source);
    if path.is_dir() {
        return Ok("directory".to_string());
    }
    if path.is_file() {
        return Ok("archive".to_string());
    }
    Err(format!(
        "无法推断 mod 安装源类型，请显式提供 sourceKind。source={}",
        normalized_source
    ))
}

fn sanitize_mod_dir_name(mod_id: &str) -> String {
    let mut normalized = String::with_capacity(mod_id.len());
    for ch in mod_id.chars() {
        if ch.is_ascii_alphanumeric() || ch == '.' || ch == '_' || ch == '-' {
            normalized.push(ch);
        } else {
            normalized.push('-');
        }
    }
    let trimmed = normalized.trim_matches('-').to_string();
    if trimmed.is_empty() {
        "runtime-mod".to_string()
    } else {
        trimmed
    }
}

fn create_backup_dir_name(mod_id: &str) -> String {
    format!(
        "{}-{}",
        sanitize_mod_dir_name(mod_id),
        Utc::now().timestamp_millis()
    )
}

fn create_update_backup(app: &AppHandle, mod_id: &str, target_dir: &Path) -> Result<Option<PathBuf>, String> {
    if !target_dir.exists() {
        return Ok(None);
    }
    let backups_dir = runtime_mod_backups_dir(app)?;
    let backup_dir = backups_dir.join(create_backup_dir_name(mod_id));
    copy_dir_recursive(target_dir, &backup_dir)?;
    Ok(Some(backup_dir))
}

fn extract_archive_to_dir(archive_path: &Path, output_dir: &Path) -> Result<(), String> {
    let extension = archive_path
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_default();
    if extension != "zip" {
        return Err(format!(
            "仅支持 .zip 预构建 mod 包，当前文件: {}",
            archive_path.display()
        ));
    }

    let file = File::open(archive_path)
        .map_err(|error| format!("打开 mod archive 失败 ({}): {error}", archive_path.display()))?;
    let mut archive = ZipArchive::new(file)
        .map_err(|error| format!("读取 mod archive 失败 ({}): {error}", archive_path.display()))?;

    for index in 0..archive.len() {
        let mut entry = archive
            .by_index(index)
            .map_err(|error| format!("读取 mod archive 条目失败: {error}"))?;
        let Some(relative_path) = entry.enclosed_name().map(|value| value.to_path_buf()) else {
            return Err(format!(
                "mod archive 包含越界路径条目，拒绝解压。archive={} entry={}",
                archive_path.display(),
                entry.name()
            ));
        };
        let target_path = output_dir.join(relative_path);
        if entry.name().ends_with('/') {
            std::fs::create_dir_all(&target_path).map_err(|error| {
                format!("创建 archive 目录失败 ({}): {error}", target_path.display())
            })?;
            continue;
        }
        if let Some(parent) = target_path.parent() {
            std::fs::create_dir_all(parent).map_err(|error| {
                format!("创建 archive 目标目录失败 ({}): {error}", parent.display())
            })?;
        }
        let mut output = File::create(&target_path).map_err(|error| {
            format!("创建 archive 输出文件失败 ({}): {error}", target_path.display())
        })?;
        io::copy(&mut entry, &mut output).map_err(|error| {
            format!("写入 archive 输出文件失败 ({}): {error}", target_path.display())
        })?;
    }

    Ok(())
}

fn restore_backup_into_target(target_dir: &Path, backup_dir: &Path) -> Result<(), String> {
    if target_dir.exists() {
        std::fs::remove_dir_all(target_dir).map_err(|error| {
            format!("删除当前 mod 目录失败 ({}): {error}", target_dir.display())
        })?;
    }
    copy_dir_recursive(backup_dir, target_dir)
}

fn resolve_package_root(root: &Path) -> Result<PathBuf, String> {
    if find_manifest_path(root).is_some() {
        return Ok(root.to_path_buf());
    }
    let entries = std::fs::read_dir(root)
        .map_err(|error| format!("读取 mod 包目录失败 ({}): {error}", root.display()))?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("读取 mod 包目录项失败 ({}): {error}", root.display()))?;
    let directories = entries
        .into_iter()
        .map(|entry| entry.path())
        .filter(|path| path.is_dir())
        .collect::<Vec<_>>();
    if directories.len() == 1 && find_manifest_path(&directories[0]).is_some() {
        return Ok(directories[0].clone());
    }
    Err(format!(
        "mod 包中未找到 manifest。需要在根目录或唯一子目录中包含 mod.manifest.yaml/json。root={}",
        root.display()
    ))
}

fn stage_source_directory(
    source: &str,
    source_kind: &str,
    temp_root: &Path,
    session_id: &str,
    operation: &str,
    app: &AppHandle,
) -> Result<PathBuf, String> {
    let staged_dir = temp_root.join("staged");
    match source_kind {
        "directory" => {
            let source_dir = PathBuf::from(source);
            if !source_dir.exists() || !source_dir.is_dir() {
                return Err(format!("mod 源目录不存在: {}", source_dir.display()));
            }
            copy_dir_recursive(&source_dir, &staged_dir)?;
            Ok(staged_dir)
        }
        "archive" => {
            let archive_path = PathBuf::from(source);
            if !archive_path.exists() || !archive_path.is_file() {
                return Err(format!("mod archive 不存在: {}", archive_path.display()));
            }
            extract_archive_to_dir(&archive_path, &staged_dir)?;
            Ok(staged_dir)
        }
        "url" => {
            emit_install_progress(
                app,
                RuntimeModInstallProgressPayload {
                    install_session_id: session_id.to_string(),
                    operation: operation.to_string(),
                    source_kind: source_kind.to_string(),
                    phase: "download".to_string(),
                    status: "running".to_string(),
                    occurred_at: now_rfc3339(),
                    mod_id: None,
                    manifest_path: None,
                    installed_path: None,
                    progress_percent: Some(25.0),
                    message: Some("downloading mod package".to_string()),
                    error: None,
                },
            )?;
            let client = Client::new();
            let response = client
                .get(source)
                .send()
                .map_err(|error| format!("下载 mod 包失败 ({source}): {error}"))?
                .error_for_status()
                .map_err(|error| format!("下载 mod 包失败 ({source}): {error}"))?;
            let archive_path = temp_root.join("downloaded-mod.zip");
            let mut output = File::create(&archive_path).map_err(|error| {
                format!("创建下载缓存文件失败 ({}): {error}", archive_path.display())
            })?;
            let mut reader = response;
            io::copy(&mut reader, &mut output)
                .map_err(|error| format!("写入下载缓存文件失败: {error}"))?;
            extract_archive_to_dir(&archive_path, &staged_dir)?;
            Ok(staged_dir)
        }
        other => Err(format!("不支持的 mod 安装源类型: {other}")),
    }
}

fn install_from_staged_dir(
    app: &AppHandle,
    staged_dir: &Path,
    replace_existing: bool,
    operation: &str,
    source_kind: &str,
    expected_mod_id: Option<&str>,
    session_id: &str,
) -> Result<RuntimeModInstallResultPayload, String> {
    let package_root = resolve_package_root(staged_dir)?;
    let manifest_path = find_manifest_path(&package_root)
        .ok_or_else(|| format!("mod manifest 不存在: {}", package_root.display()))?;
    let summary = parse_manifest_file(&manifest_path)
        .ok_or_else(|| format!("解析 mod manifest 失败: {}", manifest_path.display()))?;
    if let Some(expected) = expected_mod_id {
        if expected.trim() != summary.id {
            return Err(format!(
                "更新目标 modId 与包内 manifest 不一致。expected={} actual={}",
                expected.trim(),
                summary.id
            ));
        }
    }

    emit_install_progress(
        app,
        RuntimeModInstallProgressPayload {
            install_session_id: session_id.to_string(),
            operation: operation.to_string(),
            source_kind: source_kind.to_string(),
            phase: "validate".to_string(),
            status: "running".to_string(),
            occurred_at: now_rfc3339(),
            mod_id: Some(summary.id.clone()),
            manifest_path: Some(summary.path.clone()),
            installed_path: None,
            progress_percent: Some(55.0),
            message: Some("validated mod package".to_string()),
            error: None,
        },
    )?;

    let mods_dir = local_mods_dir(app)?;
    std::fs::create_dir_all(&mods_dir)
        .map_err(|error| format!("创建 mods 目录失败 ({}): {error}", mods_dir.display()))?;
    let target_dir = mods_dir.join(sanitize_mod_dir_name(&summary.id));
    let rollback_path = if operation == "update" {
        create_update_backup(app, &summary.id, &target_dir)?
    } else {
        None
    };
    if target_dir.exists() {
        if !replace_existing {
            return Err(format!(
                "mod 已存在，请使用 update 或 replaceExisting=true。modId={} path={}",
                summary.id,
                target_dir.display()
            ));
        }
        std::fs::remove_dir_all(&target_dir)
            .map_err(|error| format!("删除旧 mod 目录失败 ({}): {error}", target_dir.display()))?;
    }
    copy_dir_recursive(&package_root, &target_dir)?;
    let installed_manifest_path = find_manifest_path(&target_dir)
        .ok_or_else(|| format!("安装后未找到 manifest: {}", target_dir.display()))?;
    let installed_summary = parse_manifest_file(&installed_manifest_path)
        .ok_or_else(|| format!("安装后解析 manifest 失败: {}", installed_manifest_path.display()))?;

    let result = RuntimeModInstallResultPayload {
        install_session_id: session_id.to_string(),
        operation: operation.to_string(),
        mod_id: installed_summary.id.clone(),
        installed_path: target_dir.display().to_string(),
        manifest: installed_summary.clone(),
        rollback_path: rollback_path.as_ref().map(|value| value.display().to_string()),
    };
    emit_install_progress(
        app,
        RuntimeModInstallProgressPayload {
            install_session_id: session_id.to_string(),
            operation: operation.to_string(),
            source_kind: source_kind.to_string(),
            phase: "complete".to_string(),
            status: "completed".to_string(),
            occurred_at: now_rfc3339(),
            mod_id: Some(installed_summary.id.clone()),
            manifest_path: Some(installed_summary.path.clone()),
            installed_path: Some(result.installed_path.clone()),
            progress_percent: Some(100.0),
            message: Some("mod installed".to_string()),
            error: None,
        },
    )?;

    Ok(result)
}

fn install_runtime_mod_common(
    app: &AppHandle,
    source: &str,
    source_kind: Option<&str>,
    replace_existing: bool,
    operation: &str,
    expected_mod_id: Option<&str>,
) -> Result<RuntimeModInstallResultPayload, String> {
    let normalized_source = String::from(source).trim().to_string();
    if normalized_source.is_empty() {
        return Err("mod 安装源不能为空".to_string());
    }
    let session_id = create_install_session_id();
    let resolved_source_kind = normalize_source_kind(&normalized_source, source_kind)?;
    emit_install_progress(
        app,
        RuntimeModInstallProgressPayload {
            install_session_id: session_id.clone(),
            operation: operation.to_string(),
            source_kind: resolved_source_kind.clone(),
            phase: "prepare".to_string(),
            status: "running".to_string(),
            occurred_at: now_rfc3339(),
            mod_id: expected_mod_id.map(|value| value.trim().to_string()),
            manifest_path: None,
            installed_path: None,
            progress_percent: Some(5.0),
            message: Some("preparing runtime mod install".to_string()),
            error: None,
        },
    )?;

    let temp = tempdir().map_err(|error| format!("创建 mod 安装临时目录失败: {error}"))?;
    let staged_dir = stage_source_directory(
        &normalized_source,
        &resolved_source_kind,
        temp.path(),
        &session_id,
        operation,
        app,
    );
    let result = match staged_dir {
        Ok(path) => install_from_staged_dir(
            app,
            &path,
            replace_existing,
            operation,
            &resolved_source_kind,
            expected_mod_id,
            &session_id,
        ),
        Err(error) => Err(error),
    };

    if let Err(error) = &result {
        let _ = emit_install_progress(
            app,
            RuntimeModInstallProgressPayload {
                install_session_id: session_id,
                operation: operation.to_string(),
                source_kind: resolved_source_kind,
                phase: "complete".to_string(),
                status: "failed".to_string(),
                occurred_at: now_rfc3339(),
                mod_id: expected_mod_id.map(|value| value.trim().to_string()),
                manifest_path: None,
                installed_path: None,
                progress_percent: None,
                message: Some("runtime mod install failed".to_string()),
                error: Some(error.clone()),
            },
        );
    }

    result
}

pub fn install_runtime_mod(
    app: &AppHandle,
    source: &str,
    source_kind: Option<&str>,
    replace_existing: bool,
) -> Result<RuntimeModInstallResultPayload, String> {
    install_runtime_mod_common(app, source, source_kind, replace_existing, "install", None)
}

pub fn update_runtime_mod(
    app: &AppHandle,
    mod_id: &str,
    source: &str,
    source_kind: Option<&str>,
) -> Result<RuntimeModInstallResultPayload, String> {
    let normalized_mod_id = mod_id.trim();
    if normalized_mod_id.is_empty() {
        return Err("modId 不能为空".to_string());
    }
    install_runtime_mod_common(
        app,
        source,
        source_kind,
        true,
        "update",
        Some(normalized_mod_id),
    )
}

pub fn read_installed_runtime_mod_manifest(
    app: &AppHandle,
    mod_id: Option<&str>,
    path: Option<&str>,
) -> Result<RuntimeLocalManifestSummary, String> {
    if let Some(target_path) = path {
        let normalized_path = PathBuf::from(target_path.trim());
        let manifest_path = if normalized_path.is_dir() {
            find_manifest_path(&normalized_path)
                .ok_or_else(|| format!("目录中未找到 mod manifest: {}", normalized_path.display()))?
        } else {
            normalized_path
        };
        return parse_manifest_file(&manifest_path)
            .ok_or_else(|| format!("解析 mod manifest 失败: {}", manifest_path.display()));
    }

    let normalized_mod_id = mod_id.unwrap_or_default().trim();
    if normalized_mod_id.is_empty() {
        return Err("read_manifest 需要 modId 或 path".to_string());
    }
    list_installed_runtime_mods(app)?
        .into_iter()
        .find(|item| item.id == normalized_mod_id)
        .ok_or_else(|| format!("未找到已安装 mod: {normalized_mod_id}"))
}

pub fn uninstall_runtime_mod(app: &AppHandle, mod_id: &str) -> Result<RuntimeLocalManifestSummary, String> {
    let normalized_mod_id = mod_id.trim();
    if normalized_mod_id.is_empty() {
        return Err("modId 不能为空".to_string());
    }

    let summary = list_installed_runtime_mods(app)?
        .into_iter()
        .find(|item| item.id == normalized_mod_id)
        .ok_or_else(|| format!("未找到已安装 mod: {normalized_mod_id}"))?;
    let manifest_path = PathBuf::from(&summary.path);
    let mod_dir = manifest_path
        .parent()
        .ok_or_else(|| format!("无法解析 mod 根目录: {}", summary.path))?;
    std::fs::remove_dir_all(mod_dir)
        .map_err(|error| format!("删除 mod 目录失败 ({}): {error}", mod_dir.display()))?;
    Ok(summary)
}

pub fn restore_runtime_mod_backup(
    app: &AppHandle,
    mod_id: &str,
    backup_path: &str,
) -> Result<RuntimeLocalManifestSummary, String> {
    let normalized_mod_id = mod_id.trim();
    let normalized_backup_path = PathBuf::from(backup_path.trim());
    if normalized_mod_id.is_empty() {
        return Err("modId 不能为空".to_string());
    }
    if backup_path.trim().is_empty() {
        return Err("backupPath 不能为空".to_string());
    }
    if !normalized_backup_path.exists() || !normalized_backup_path.is_dir() {
        return Err(format!(
            "backupPath 不存在或不是目录: {}",
            normalized_backup_path.display()
        ));
    }
    let mods_dir = local_mods_dir(app)?;
    let target_dir = mods_dir.join(sanitize_mod_dir_name(normalized_mod_id));
    restore_backup_into_target(&target_dir, &normalized_backup_path)?;
    let manifest_path = find_manifest_path(&target_dir)
        .ok_or_else(|| format!("恢复后未找到 manifest: {}", target_dir.display()))?;
    parse_manifest_file(&manifest_path)
        .ok_or_else(|| format!("恢复后解析 manifest 失败: {}", manifest_path.display()))
}

#[cfg(test)]
mod runtime_mod_install_store_tests {
    use super::*;
    use std::io::Write;
    use zip::write::SimpleFileOptions;

    #[test]
    fn extract_archive_to_dir_rejects_path_traversal_entries() {
        let temp = tempfile::tempdir().expect("tempdir");
        let archive_path = temp.path().join("bad.zip");
        let file = File::create(&archive_path).expect("zip file");
        let mut writer = zip::ZipWriter::new(file);
        writer
            .start_file("../evil.txt", SimpleFileOptions::default())
            .expect("start file");
        writer.write_all(b"evil").expect("write zip");
        writer.finish().expect("finish zip");

        let output_dir = temp.path().join("out");
        let error = extract_archive_to_dir(&archive_path, &output_dir).expect_err("should reject traversal zip");
        assert!(error.contains("越界路径"));
    }

    #[test]
    fn restore_backup_into_target_replaces_existing_tree() {
        let temp = tempfile::tempdir().expect("tempdir");
        let target_dir = temp.path().join("target");
        let backup_dir = temp.path().join("backup");
        std::fs::create_dir_all(&target_dir).expect("target dir");
        std::fs::create_dir_all(&backup_dir).expect("backup dir");
        std::fs::write(target_dir.join("old.txt"), b"old").expect("old file");
        std::fs::write(backup_dir.join("new.txt"), b"new").expect("new file");

        restore_backup_into_target(&target_dir, &backup_dir).expect("restore backup");

        assert!(!target_dir.join("old.txt").exists());
        assert_eq!(
            std::fs::read_to_string(target_dir.join("new.txt")).expect("restored file"),
            "new"
        );
    }
}
