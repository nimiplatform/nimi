//! Support `logs` sub-area log-export command (`rule.nimi.desktop.product-surfaces.r027`).
//!
//! Spec authority: `.nimi/spec/desktop/product-surfaces.authority.yaml`
//! `rule.nimi.desktop.product-surfaces.r027` — the Support `logs` sub-area MUST produce a user-locatable
//! log-export artifact of the `<nimi_data>/logs/` directory
//! (`P-MIG-006` `logs` row, owner `runtime_product_support`,
//! "exportable for support").
//!
//! Artifact shape: a single `nimi-logs-export-<UTC-timestamp>.zip` archive
//! written into the operating-system Downloads directory — an unambiguous,
//! user-locatable location. The whole `<nimi_data>/logs/` tree is bundled into
//! the archive; the artifact is then revealed in the OS file manager so the
//! user can immediately locate it.
//!
//! Fail-closed (`rule.nimi.desktop.product-surfaces.r027`): a missing or unreadable `<nimi_data>/logs/`
//! directory, or an empty one, yields a typed `Err` — never a fabricated empty
//! archive or a pseudo-success artifact. The command does not create the
//! `logs/` directory and never mutates or deletes its contents
//! (`rule.nimi.desktop.product-surfaces.r027` `MUST NOT`).

use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};

use serde::Serialize;
use zip::write::SimpleFileOptions;

const LOGS_DIR_NAME: &str = "logs";
const EXPORT_FILE_PREFIX: &str = "nimi-logs-export-";

/// Typed result of a successful log export. Surfaced to the renderer so the
/// Support `logs` sub-area can show the user where the artifact landed.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LogsExportResult {
    /// Absolute path of the produced `.zip` archive.
    pub artifact_path: String,
    /// Number of log files bundled into the archive.
    pub file_count: usize,
    /// Total uncompressed byte size of the bundled log files.
    pub byte_size: u64,
    /// UTC RFC3339 timestamp the export was produced at.
    pub exported_at: String,
}

/// `rule.nimi.desktop.product-surfaces.r027`: export `<nimi_data>/logs/` to a user-locatable archive.
///
/// Resolves the active `nimi_data` data root via the product-control record,
/// targets `<nimi_data>/logs/`, bundles it into the OS Downloads directory,
/// and reveals the artifact. Fails closed on every typed error path.
#[tauri::command]
pub async fn desktop_logs_export() -> Result<LogsExportResult, String> {
    let data_root = crate::desktop_product_control::runtime_validated_nimi_data_root().await?;
    tauri::async_runtime::spawn_blocking(move || {
        let logs_dir = data_root.join(LOGS_DIR_NAME);
        let downloads_dir = resolve_downloads_dir()?;
        let result = export_logs_archive(&logs_dir, &downloads_dir)?;
        reveal_in_os(Path::new(&result.artifact_path));
        Ok(result)
    })
    .await
    .map_err(|error| format!("LOGS_EXPORT_TASK_JOIN_FAILED: {error}"))?
}

/// Resolve the operating-system Downloads directory. Fails closed when no
/// Downloads directory can be determined — the renderer surfaces the typed
/// reason rather than guessing a path.
pub(crate) fn resolve_downloads_dir() -> Result<PathBuf, String> {
    let dir = dirs::download_dir()
        .or_else(dirs::home_dir)
        .ok_or_else(|| "LOGS_EXPORT_NO_DOWNLOADS_DIR: 无法定位系统下载目录".to_string())?;
    fs::create_dir_all(&dir)
        .map_err(|error| format!("LOGS_EXPORT_DOWNLOADS_DIR_UNWRITABLE: {error}"))?;
    Ok(dir)
}

/// Core export: bundle every file under `logs_dir` into a timestamped `.zip`
/// archive in `output_dir`. Pure over its path inputs so it is directly
/// testable without product-control state.
///
/// Fail-closed contract:
/// - `logs_dir` missing / not a directory / unreadable -> typed `Err`.
/// - `logs_dir` contains zero files -> typed `Err` (no empty artifact).
pub fn export_logs_archive(logs_dir: &Path, output_dir: &Path) -> Result<LogsExportResult, String> {
    if !logs_dir.exists() {
        return Err(format!(
            "LOGS_EXPORT_LOGS_DIR_MISSING: 日志目录不存在: {}",
            logs_dir.display()
        ));
    }
    if !logs_dir.is_dir() {
        return Err(format!(
            "LOGS_EXPORT_LOGS_DIR_NOT_DIRECTORY: 日志路径不是目录: {}",
            logs_dir.display()
        ));
    }

    let mut files = Vec::new();
    collect_log_files(logs_dir, logs_dir, &mut files)?;
    if files.is_empty() {
        return Err(format!(
            "LOGS_EXPORT_LOGS_DIR_EMPTY: 日志目录为空，无可导出内容: {}",
            logs_dir.display()
        ));
    }

    let exported_at = chrono::Utc::now();
    let stamp = exported_at.format("%Y%m%dT%H%M%SZ").to_string();
    let artifact_path = output_dir.join(format!("{EXPORT_FILE_PREFIX}{stamp}.zip"));

    let archive_file = fs::File::create(&artifact_path).map_err(|error| {
        format!(
            "LOGS_EXPORT_ARTIFACT_UNWRITABLE: 无法创建导出文件 {}: {error}",
            artifact_path.display()
        )
    })?;
    let mut writer = zip::ZipWriter::new(archive_file);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    let mut byte_size: u64 = 0;
    for entry in &files {
        let archive_name = entry.archive_name.as_str();
        writer.start_file(archive_name, options).map_err(|error| {
            format!("LOGS_EXPORT_ARCHIVE_ENTRY_FAILED: {archive_name}: {error}")
        })?;
        let mut source = fs::File::open(&entry.absolute_path).map_err(|error| {
            format!(
                "LOGS_EXPORT_LOG_FILE_UNREADABLE: {}: {error}",
                entry.absolute_path.display()
            )
        })?;
        let mut buffer = [0u8; 64 * 1024];
        loop {
            let read = source.read(&mut buffer).map_err(|error| {
                format!(
                    "LOGS_EXPORT_LOG_FILE_READ_FAILED: {}: {error}",
                    entry.absolute_path.display()
                )
            })?;
            if read == 0 {
                break;
            }
            writer
                .write_all(&buffer[..read])
                .map_err(|error| format!("LOGS_EXPORT_ARCHIVE_WRITE_FAILED: {error}"))?;
            byte_size += read as u64;
        }
    }
    writer
        .finish()
        .map_err(|error| format!("LOGS_EXPORT_ARCHIVE_FINALIZE_FAILED: {error}"))?;

    Ok(LogsExportResult {
        artifact_path: artifact_path.display().to_string(),
        file_count: files.len(),
        byte_size,
        exported_at: exported_at.to_rfc3339(),
    })
}

struct LogFileEntry {
    absolute_path: PathBuf,
    /// Forward-slash path relative to the logs root, used as the zip entry name.
    archive_name: String,
}

/// Recursively collect every regular file under `dir`, recording its path
/// relative to `root` as the archive entry name. Symlinks are skipped so the
/// archive never escapes the logs tree.
fn collect_log_files(root: &Path, dir: &Path, out: &mut Vec<LogFileEntry>) -> Result<(), String> {
    let read_dir = fs::read_dir(dir).map_err(|error| {
        format!(
            "LOGS_EXPORT_LOGS_DIR_UNREADABLE: 无法读取日志目录 {}: {error}",
            dir.display()
        )
    })?;
    for entry in read_dir {
        let entry = entry.map_err(|error| format!("LOGS_EXPORT_LOGS_DIR_ENTRY_FAILED: {error}"))?;
        let path = entry.path();
        let file_type = entry
            .file_type()
            .map_err(|error| format!("LOGS_EXPORT_LOGS_DIR_ENTRY_FAILED: {error}"))?;
        if file_type.is_symlink() {
            continue;
        }
        if file_type.is_dir() {
            collect_log_files(root, &path, out)?;
        } else if file_type.is_file() {
            let relative = path
                .strip_prefix(root)
                .map_err(|error| format!("LOGS_EXPORT_RELATIVE_PATH_FAILED: {error}"))?;
            let archive_name = relative
                .components()
                .map(|component| component.as_os_str().to_string_lossy())
                .collect::<Vec<_>>()
                .join("/");
            if archive_name.is_empty() {
                continue;
            }
            out.push(LogFileEntry {
                absolute_path: path,
                archive_name,
            });
        }
    }
    out.sort_by(|a, b| a.archive_name.cmp(&b.archive_name));
    Ok(())
}

/// Reveal the produced artifact in the OS file manager. Best-effort: a failure
/// here does not invalidate the already-produced artifact, so it is not
/// surfaced as a typed export error.
pub(crate) fn reveal_in_os(path: &Path) {
    #[cfg(target_os = "macos")]
    {
        let _ = std::process::Command::new("open")
            .arg("-R")
            .arg(path)
            .spawn();
    }
    #[cfg(target_os = "windows")]
    {
        let _ = std::process::Command::new("explorer")
            .arg("/select,")
            .arg(path)
            .spawn();
    }
    #[cfg(target_os = "linux")]
    {
        let parent = path.parent().unwrap_or(path);
        let _ = std::process::Command::new("xdg-open").arg(parent).spawn();
    }
}

#[cfg(test)]
mod tests {
    use super::{export_logs_archive, EXPORT_FILE_PREFIX};
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};
    use zip::read::ZipArchive;

    fn temp_dir(prefix: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("nimi-logs-export-{prefix}-{unique}"));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn export_bundles_every_log_file_into_a_user_locatable_archive() {
        let base = temp_dir("happy");
        let logs_dir = base.join("logs");
        let output_dir = base.join("downloads");
        fs::create_dir_all(logs_dir.join("net")).expect("create logs subdir");
        fs::create_dir_all(&output_dir).expect("create output dir");
        fs::write(logs_dir.join("runtime.log"), b"runtime line\n").expect("write log");
        fs::write(logs_dir.join("net").join("net.log"), b"net line\n").expect("write nested log");

        let result = export_logs_archive(&logs_dir, &output_dir).expect("export succeeds");

        assert_eq!(result.file_count, 2);
        assert_eq!(
            result.byte_size,
            b"runtime line\n".len() as u64 + b"net line\n".len() as u64
        );
        let artifact = PathBuf::from(&result.artifact_path);
        assert!(
            artifact.exists(),
            "artifact must be written to a locatable path"
        );
        assert!(
            artifact.starts_with(&output_dir),
            "artifact lands in the output dir"
        );
        let file_name = artifact.file_name().unwrap().to_string_lossy().to_string();
        assert!(file_name.starts_with(EXPORT_FILE_PREFIX));
        assert!(file_name.ends_with(".zip"));

        let archive_file = fs::File::open(&artifact).expect("open artifact");
        let mut archive = ZipArchive::new(archive_file).expect("valid zip archive");
        assert_eq!(archive.len(), 2);
        let names: Vec<String> = (0..archive.len())
            .map(|index| archive.by_index(index).unwrap().name().to_string())
            .collect();
        assert!(names.contains(&"runtime.log".to_string()));
        assert!(names.contains(&"net/net.log".to_string()));
    }

    #[test]
    fn export_fails_closed_when_logs_directory_is_missing() {
        let base = temp_dir("missing");
        let logs_dir = base.join("logs");
        let output_dir = base.join("downloads");
        fs::create_dir_all(&output_dir).expect("create output dir");

        let error = export_logs_archive(&logs_dir, &output_dir)
            .expect_err("missing logs directory must fail closed");

        assert!(
            error.starts_with("LOGS_EXPORT_LOGS_DIR_MISSING"),
            "got: {error}"
        );
        // No artifact must be fabricated on the fail-closed path.
        let produced: Vec<_> = fs::read_dir(&output_dir).unwrap().collect();
        assert!(
            produced.is_empty(),
            "fail-closed export must not write an artifact"
        );
    }

    #[test]
    fn export_fails_closed_when_logs_directory_is_empty() {
        let base = temp_dir("empty");
        let logs_dir = base.join("logs");
        let output_dir = base.join("downloads");
        fs::create_dir_all(&logs_dir).expect("create empty logs dir");
        fs::create_dir_all(&output_dir).expect("create output dir");

        let error = export_logs_archive(&logs_dir, &output_dir)
            .expect_err("empty logs directory must fail closed");

        assert!(
            error.starts_with("LOGS_EXPORT_LOGS_DIR_EMPTY"),
            "got: {error}"
        );
        let produced: Vec<_> = fs::read_dir(&output_dir).unwrap().collect();
        assert!(
            produced.is_empty(),
            "empty-logs export must not write an artifact"
        );
    }
}
