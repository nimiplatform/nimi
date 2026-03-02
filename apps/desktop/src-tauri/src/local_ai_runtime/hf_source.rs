use std::collections::{HashMap, HashSet};
use std::fs;
use std::fs::OpenOptions;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::thread;
use std::time::{Duration, Instant};

use sha2::{Digest, Sha256};
use tauri::AppHandle;

use super::import_validator::{
    manifest_to_model_record, normalize_and_validate_capabilities, parse_and_validate_manifest,
    validate_loopback_endpoint,
};
use super::store::runtime_models_dir;
use super::types::{
    normalize_non_empty, slugify_local_model_id, ImportedModelManifest, ImportedModelSource,
    LocalAiInstallRequest, DEFAULT_LOCAL_RUNTIME_ENDPOINT,
};

#[derive(Debug, Clone)]
pub struct HfDownloadProgress {
    pub phase: String,
    pub bytes_received: u64,
    pub bytes_total: Option<u64>,
    pub speed_bytes_per_sec: Option<f64>,
    pub eta_seconds: Option<f64>,
    pub message: Option<String>,
}

fn is_hf_repo(repo: &str) -> bool {
    let normalized = repo.trim();
    if normalized.is_empty() {
        return false;
    }
    if normalized.starts_with("hf://") {
        return true;
    }
    if normalized.contains("huggingface.co/") {
        return true;
    }
    // Also allow canonical HF repo slug "org/model-name".
    normalized.split('/').count() == 2 && !normalized.contains("://")
}

fn normalize_hf_repo_slug(repo: &str) -> Option<String> {
    let normalized = repo.trim();
    if normalized.is_empty() {
        return None;
    }

    let candidate = if let Some(stripped) = normalized.strip_prefix("hf://") {
        stripped
    } else if let Some((_, suffix)) = normalized.split_once("huggingface.co/") {
        suffix
    } else {
        normalized
    };

    let candidate = candidate
        .split(['?', '#'])
        .next()
        .unwrap_or(candidate)
        .trim_matches('/');
    if candidate.is_empty() {
        return None;
    }
    if let Some((prefix, _)) = candidate.split_once("/resolve/") {
        return Some(prefix.trim_matches('/').to_string());
    }
    let parts = candidate.split('/').collect::<Vec<_>>();
    if parts.len() < 2 {
        return None;
    }
    Some(format!("{}/{}", parts[0], parts[1]))
}

fn normalize_expected_hash(value: &str) -> String {
    value
        .trim()
        .to_ascii_lowercase()
        .trim_start_matches("sha256:")
        .to_string()
}

fn normalize_relative_file_path(value: &str) -> Result<String, String> {
    let normalized = value.trim().replace('\\', "/");
    if normalized.is_empty() {
        return Err("LOCAL_AI_INSTALL_FILE_PATH_INVALID: empty file path".to_string());
    }
    let path = Path::new(normalized.as_str());
    if path.is_absolute() {
        return Err(format!(
            "LOCAL_AI_INSTALL_FILE_PATH_INVALID: absolute path is not allowed: {normalized}"
        ));
    }
    if normalized.split('/').any(|segment| segment == "..") {
        return Err(format!(
            "LOCAL_AI_INSTALL_FILE_PATH_INVALID: parent traversal segment is not allowed: {normalized}"
        ));
    }
    Ok(normalized)
}

fn normalize_install_files(request: &LocalAiInstallRequest) -> Result<(String, Vec<String>), String> {
    let entry = normalize_relative_file_path(normalize_non_empty(
        request.entry.as_deref().unwrap_or("model.bin"),
        "model.bin",
    )
    .as_str())?;

    let mut files = Vec::<String>::new();
    let mut seen = HashSet::<String>::new();
    if let Some(raw_files) = request.files.as_ref() {
        for item in raw_files {
            let normalized = normalize_relative_file_path(item.as_str())?;
            if seen.insert(normalized.clone()) {
                files.push(normalized);
            }
        }
    }

    if seen.insert(entry.clone()) {
        files.insert(0, entry.clone());
    } else {
        // Keep entry as first for deterministic install ordering.
        files.retain(|item| item != &entry);
        files.insert(0, entry.clone());
    }

    if files.is_empty() {
        files.push(entry.clone());
    }

    Ok((entry, files))
}

fn resolve_expected_file_hash(request: &LocalAiInstallRequest, file_path: &str) -> Option<String> {
    let hashes = request.hashes.as_ref()?;
    let raw = hashes.get(file_path)?;
    let normalized = normalize_expected_hash(raw);
    if normalized.is_empty() {
        return None;
    }
    Some(normalized)
}

fn build_hf_download_url(repo_slug: &str, revision: &str, file_path: &str) -> String {
    let normalized_revision = normalize_non_empty(revision, "main");
    let entry = file_path.trim().replace(' ', "%20");
    format!(
        "https://huggingface.co/{repo}/resolve/{revision}/{entry}",
        repo = repo_slug.trim(),
        revision = normalized_revision,
        entry = entry
    )
}

const HF_RETRY_BACKOFF_MS: [u64; 8] = [300, 1_000, 5_000, 15_000, 30_000, 60_000, 120_000, 180_000];

fn download_file_with_resume<F>(
    url: &str,
    destination: &PathBuf,
    on_progress: &mut F,
) -> Result<(), String>
where
    F: FnMut(HfDownloadProgress),
{
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|error| {
            format!("LOCAL_AI_HF_DOWNLOAD_CLIENT_FAILED: 创建 HF 下载客户端失败: {error}")
        })?;

    let mut last_error: Option<String> = None;
    for (index, backoff_ms) in HF_RETRY_BACKOFF_MS.iter().enumerate() {
        let attempt = index + 1;
        let existing_bytes = fs::metadata(destination)
            .map(|meta| meta.len())
            .unwrap_or(0);
        let mut request = client.get(url);
        if existing_bytes > 0 {
            request = request.header(reqwest::header::RANGE, format!("bytes={existing_bytes}-"));
        }

        match request.send() {
            Ok(mut response) => {
                let status = response.status();
                if !(status.is_success()
                    || status == reqwest::StatusCode::PARTIAL_CONTENT
                    || status == reqwest::StatusCode::RANGE_NOT_SATISFIABLE)
                {
                    last_error = Some(format!(
                        "LOCAL_AI_HF_DOWNLOAD_HTTP_STATUS: status={}, url={url}, attempt={attempt}",
                        status.as_u16()
                    ));
                    if attempt < HF_RETRY_BACKOFF_MS.len() {
                        thread::sleep(Duration::from_millis(*backoff_ms));
                    }
                    continue;
                }

                if status == reqwest::StatusCode::RANGE_NOT_SATISFIABLE {
                    // Existing file already contains the full content.
                    on_progress(HfDownloadProgress {
                        phase: "download".to_string(),
                        bytes_received: existing_bytes,
                        bytes_total: Some(existing_bytes),
                        speed_bytes_per_sec: None,
                        eta_seconds: Some(0.0),
                        message: Some("download already complete".to_string()),
                    });
                    return Ok(());
                }

                let append = existing_bytes > 0 && status == reqwest::StatusCode::PARTIAL_CONTENT;
                let total_bytes = response
                    .headers()
                    .get(reqwest::header::CONTENT_LENGTH)
                    .and_then(|value| value.to_str().ok())
                    .and_then(|value| value.parse::<u64>().ok())
                    .map(|value| if append { existing_bytes + value } else { value });
                let mut file = if append {
                    OpenOptions::new()
                        .create(true)
                        .append(true)
                        .open(destination)
                        .map_err(|error| {
                            format!(
                                "LOCAL_AI_HF_DOWNLOAD_FILE_OPEN_FAILED: 打开断点续传文件失败 ({}): {error}",
                                destination.display()
                            )
                        })?
                } else {
                    OpenOptions::new()
                        .create(true)
                        .write(true)
                        .truncate(true)
                        .open(destination)
                        .map_err(|error| {
                            format!(
                                "LOCAL_AI_HF_DOWNLOAD_FILE_CREATE_FAILED: 创建下载文件失败 ({}): {error}",
                                destination.display()
                            )
                        })?
                };

                let mut bytes_received = if append { existing_bytes } else { 0 };
                let started_at = Instant::now();
                on_progress(HfDownloadProgress {
                    phase: "download".to_string(),
                    bytes_received,
                    bytes_total: total_bytes,
                    speed_bytes_per_sec: None,
                    eta_seconds: None,
                    message: Some(format!("downloading from Hugging Face (attempt {attempt})")),
                });

                let mut chunk = [0u8; 16 * 1024];
                loop {
                    let read_bytes = response.read(&mut chunk).map_err(|error| {
                        format!(
                            "LOCAL_AI_HF_DOWNLOAD_STREAM_READ_FAILED: 读取 HF 下载流失败: {error}"
                        )
                    })?;
                    if read_bytes == 0 {
                        break;
                    }
                    bytes_received = bytes_received.saturating_add(read_bytes as u64);
                    file.write_all(&chunk[..read_bytes]).map_err(|error| {
                        format!(
                            "LOCAL_AI_HF_DOWNLOAD_FILE_WRITE_FAILED: 写入下载文件失败 ({}): {error}",
                            destination.display()
                        )
                    })?;
                    let elapsed_secs = started_at.elapsed().as_secs_f64();
                    let speed = if elapsed_secs > 0.0 {
                        Some(bytes_received as f64 / elapsed_secs)
                    } else {
                        None
                    };
                    let eta_seconds = match (total_bytes, speed) {
                        (Some(total), Some(value)) if value > 0.0 && total >= bytes_received => {
                            Some((total.saturating_sub(bytes_received)) as f64 / value)
                        }
                        _ => None,
                    };
                    on_progress(HfDownloadProgress {
                        phase: "download".to_string(),
                        bytes_received,
                        bytes_total: total_bytes,
                        speed_bytes_per_sec: speed,
                        eta_seconds,
                        message: Some(format!("downloading from Hugging Face (attempt {attempt})")),
                    });
                }
                file.flush().map_err(|error| {
                    format!(
                        "LOCAL_AI_HF_DOWNLOAD_FILE_FLUSH_FAILED: 刷新下载文件失败 ({}): {error}",
                        destination.display()
                    )
                })?;
                on_progress(HfDownloadProgress {
                    phase: "download".to_string(),
                    bytes_received,
                    bytes_total: total_bytes.or(Some(bytes_received)),
                    speed_bytes_per_sec: None,
                    eta_seconds: Some(0.0),
                    message: Some("download completed".to_string()),
                });
                return Ok(());
            }
            Err(error) => {
                last_error = Some(format!(
                    "LOCAL_AI_HF_DOWNLOAD_REQUEST_FAILED: attempt={attempt}, error={error}"
                ));
                if attempt < HF_RETRY_BACKOFF_MS.len() {
                    thread::sleep(Duration::from_millis(*backoff_ms));
                }
            }
        }
    }

    Err(last_error
        .unwrap_or_else(|| "LOCAL_AI_HF_DOWNLOAD_FAILED: HF 下载失败: 未知错误".to_string()))
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

fn build_manifest_from_install_request(
    request: &LocalAiInstallRequest,
    entry_file: &str,
    files: &[String],
    computed_hashes: &HashMap<String, String>,
) -> Result<ImportedModelManifest, String> {
    let capabilities_input = request
        .capabilities
        .clone()
        .unwrap_or_else(|| vec!["chat".to_string()]);
    let capabilities = normalize_and_validate_capabilities(&capabilities_input)?;

    let hashes = if !computed_hashes.is_empty() {
        computed_hashes.clone()
    } else {
        request.hashes.clone().unwrap_or_default()
    };

    Ok(ImportedModelManifest {
        schema_version: "1.0.0".to_string(),
        model_id: request.model_id.trim().to_string(),
        capabilities,
        engine: normalize_non_empty(
            request.engine.as_deref().unwrap_or("localai"),
            "localai",
        ),
        entry: entry_file.to_string(),
        files: files.to_vec(),
        license: normalize_non_empty(request.license.as_deref().unwrap_or("unknown"), "unknown"),
        source: ImportedModelSource {
            repo: request.repo.trim().to_string(),
            revision: normalize_non_empty(request.revision.as_deref().unwrap_or("main"), "main"),
        },
        hashes,
    })
}

fn rollback_staging(staging_dir: &Path, backup_dir: &Path, model_dir: &Path) {
    if staging_dir.exists() {
        let _ = fs::remove_dir_all(staging_dir);
    }
    if backup_dir.exists() && !model_dir.exists() {
        let _ = fs::rename(backup_dir, model_dir);
    }
}

fn aggregate_progress(
    completed_before_file: u64,
    known_total: Option<u64>,
    file_progress: &HfDownloadProgress,
) -> (u64, Option<u64>) {
    let bytes_received = completed_before_file.saturating_add(file_progress.bytes_received);
    let bytes_total = match known_total {
        Some(total) => Some(total),
        None => file_progress
            .bytes_total
            .map(|file_total| completed_before_file.saturating_add(file_total)),
    };
    (bytes_received, bytes_total)
}

pub fn install_from_hf(
    app: &AppHandle,
    request: &LocalAiInstallRequest,
    on_progress: &mut impl FnMut(HfDownloadProgress),
) -> Result<super::types::LocalAiModelRecord, String> {
    if request.model_id.trim().is_empty() {
        return Err("LOCAL_AI_INSTALL_MODEL_ID_EMPTY: 安装失败: modelId 不能为空".to_string());
    }
    if !is_hf_repo(&request.repo) {
        return Err(
            "LOCAL_AI_INSTALL_SOURCE_NOT_HF: 安装失败: 仅允许 Hugging Face 仓库来源".to_string(),
        );
    }
    let repo_slug = normalize_hf_repo_slug(&request.repo).ok_or_else(|| {
        "LOCAL_AI_INSTALL_HF_REPO_INVALID: 安装失败: 无法解析 Hugging Face repo slug".to_string()
    })?;
    let validated_endpoint = validate_loopback_endpoint(
        request
            .endpoint
            .as_deref()
            .unwrap_or(DEFAULT_LOCAL_RUNTIME_ENDPOINT),
    )?;

    let (entry_file, install_files) = normalize_install_files(request)?;

    let slug = slugify_local_model_id(&request.model_id);
    let models_dir = runtime_models_dir(app)?;
    let model_dir = models_dir.join(&slug);
    let staging_dir = models_dir.join(format!("{slug}-staging"));
    let backup_dir = models_dir.join(format!("{slug}-backup"));

    if staging_dir.exists() {
        fs::remove_dir_all(&staging_dir).map_err(|error| {
            format!("清理 staging 目录失败 ({}): {error}", staging_dir.display())
        })?;
    }
    if backup_dir.exists() {
        fs::remove_dir_all(&backup_dir)
            .map_err(|error| format!("清理 backup 目录失败 ({}): {error}", backup_dir.display()))?;
    }

    fs::create_dir_all(&staging_dir)
        .map_err(|error| format!("创建 staging 目录失败 ({}): {error}", staging_dir.display()))?;

    let head_client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| {
            format!("LOCAL_AI_HF_DOWNLOAD_CLIENT_FAILED: 创建 HF metadata 客户端失败: {error}")
        })?;

    let mut per_file_sizes = HashMap::<String, Option<u64>>::new();
    for file_path in &install_files {
        let download_url = build_hf_download_url(
            &repo_slug,
            request.revision.as_deref().unwrap_or("main"),
            file_path,
        );
        let size = head_client
            .head(download_url)
            .send()
            .ok()
            .and_then(|response| {
                if !response.status().is_success() {
                    return None;
                }
                response
                    .headers()
                    .get(reqwest::header::CONTENT_LENGTH)
                    .and_then(|value| value.to_str().ok())
                    .and_then(|value| value.parse::<u64>().ok())
            });
        per_file_sizes.insert(file_path.clone(), size);
    }
    let total_bytes_known = if per_file_sizes.values().all(|value| value.is_some()) {
        Some(
            per_file_sizes
                .values()
                .map(|value| value.unwrap_or(0))
                .sum::<u64>(),
        )
    } else {
        None
    };

    let mut total_verified_bytes = 0_u64;
    let mut computed_hashes = HashMap::<String, String>::new();
    let file_count = install_files.len();

    for (file_index, file_path) in install_files.iter().enumerate() {
        let staged_file_path = staging_dir.join(file_path);
        if let Some(parent) = staged_file_path.parent() {
            fs::create_dir_all(parent)
                .map_err(|error| format!("创建文件目录失败 ({}): {error}", parent.display()))?;
        }

        let download_url = build_hf_download_url(
            &repo_slug,
            request.revision.as_deref().unwrap_or("main"),
            file_path,
        );

        let completed_before_file = total_verified_bytes;
        let file_label = file_path.clone();
        let mut on_file_progress = |progress: HfDownloadProgress| {
            let (bytes_received, bytes_total) =
                aggregate_progress(completed_before_file, total_bytes_known, &progress);
            let message = progress.message.as_ref().map(|detail| {
                format!(
                    "[{}/{}] {}: {}",
                    file_index + 1,
                    file_count,
                    file_label,
                    detail
                )
            });
            on_progress(HfDownloadProgress {
                phase: progress.phase,
                bytes_received,
                bytes_total,
                speed_bytes_per_sec: progress.speed_bytes_per_sec,
                eta_seconds: progress.eta_seconds,
                message,
            });
        };

        if let Err(error) =
            download_file_with_resume(&download_url, &staged_file_path, &mut on_file_progress)
        {
            rollback_staging(staging_dir.as_path(), backup_dir.as_path(), model_dir.as_path());
            return Err(error);
        }

        on_progress(HfDownloadProgress {
            phase: "verify".to_string(),
            bytes_received: total_verified_bytes,
            bytes_total: total_bytes_known,
            speed_bytes_per_sec: None,
            eta_seconds: None,
            message: Some(format!(
                "[{}/{}] {}: verifying downloaded file",
                file_index + 1,
                file_count,
                file_path
            )),
        });

        let file_bytes = fs::read(&staged_file_path).map_err(|error| {
            rollback_staging(staging_dir.as_path(), backup_dir.as_path(), model_dir.as_path());
            format!(
                "读取 HF 下载文件失败 ({}): {error}",
                staged_file_path.display()
            )
        })?;
        let file_hash = sha256_hex(&file_bytes);

        if let Some(expected_hash) = resolve_expected_file_hash(request, file_path) {
            if expected_hash != file_hash {
                rollback_staging(staging_dir.as_path(), backup_dir.as_path(), model_dir.as_path());
                return Err(format!(
                    "HF 下载 hash 校验失败: file={}, expected={}, actual={}",
                    file_path, expected_hash, file_hash
                ));
            }
        }

        total_verified_bytes = total_verified_bytes.saturating_add(file_bytes.len() as u64);
        computed_hashes.insert(file_path.to_string(), format!("sha256:{file_hash}"));

        on_progress(HfDownloadProgress {
            phase: "verify".to_string(),
            bytes_received: total_verified_bytes,
            bytes_total: total_bytes_known.or(Some(total_verified_bytes)),
            speed_bytes_per_sec: None,
            eta_seconds: Some(0.0),
            message: Some(format!(
                "[{}/{}] {}: hash verification passed",
                file_index + 1,
                file_count,
                file_path
            )),
        });
    }

    let manifest = match build_manifest_from_install_request(
        request,
        &entry_file,
        &install_files,
        &computed_hashes,
    ) {
        Ok(value) => value,
        Err(error) => {
            rollback_staging(staging_dir.as_path(), backup_dir.as_path(), model_dir.as_path());
            return Err(error);
        }
    };
    let manifest_path: PathBuf = staging_dir.join("model.manifest.json");
    let manifest_json = serde_json::to_string_pretty(&manifest)
        .map_err(|error| format!("序列化 HF manifest 失败: {error}"))?;
    fs::write(&manifest_path, manifest_json).map_err(|error| {
        rollback_staging(staging_dir.as_path(), backup_dir.as_path(), model_dir.as_path());
        format!(
            "写入 HF manifest 失败 ({}): {error}",
            manifest_path.display()
        )
    })?;

    let validated = match parse_and_validate_manifest(&manifest_path) {
        Ok(value) => value,
        Err(error) => {
            rollback_staging(staging_dir.as_path(), backup_dir.as_path(), model_dir.as_path());
            return Err(error);
        }
    };

    if model_dir.exists() {
        fs::rename(&model_dir, &backup_dir).map_err(|error| {
            format!(
                "切换模型目录失败 ({} -> {}): {error}",
                model_dir.display(),
                backup_dir.display()
            )
        })?;
    }
    if let Err(error) = fs::rename(&staging_dir, &model_dir) {
        // Rollback best-effort.
        if backup_dir.exists() {
            let _ = fs::rename(&backup_dir, &model_dir);
        }
        return Err(format!(
            "提交 HF 模型目录失败 ({} -> {}): {error}",
            staging_dir.display(),
            model_dir.display()
        ));
    }
    if backup_dir.exists() {
        let _ = fs::remove_dir_all(&backup_dir);
    }

    on_progress(HfDownloadProgress {
        phase: "verify".to_string(),
        bytes_received: total_verified_bytes,
        bytes_total: total_bytes_known.or(Some(total_verified_bytes)),
        speed_bytes_per_sec: None,
        eta_seconds: Some(0.0),
        message: Some("manifest validated".to_string()),
    });

    manifest_to_model_record(&validated, Some(validated_endpoint.as_str()))
}

#[cfg(test)]
mod tests {
    use super::{
        aggregate_progress, build_hf_download_url, build_manifest_from_install_request, is_hf_repo,
        normalize_expected_hash, normalize_hf_repo_slug, normalize_install_files,
        normalize_relative_file_path, resolve_expected_file_hash,
    };
    use crate::local_ai_runtime::types::LocalAiInstallRequest;

    #[test]
    fn hf_repo_detection_accepts_hf_protocol_and_urls() {
        assert!(is_hf_repo("hf://meta-llama/Llama-3.1-8B-Instruct"));
        assert!(is_hf_repo(
            "https://huggingface.co/meta-llama/Llama-3.1-8B-Instruct"
        ));
        assert!(is_hf_repo("meta-llama/Llama-3.1-8B-Instruct"));
        assert!(!is_hf_repo("https://example.com/model.bin"));
        assert!(!is_hf_repo(""));
    }

    #[test]
    fn normalize_hf_repo_slug_extracts_org_and_model() {
        assert_eq!(
            normalize_hf_repo_slug("hf://meta-llama/Llama-3.1-8B-Instruct"),
            Some("meta-llama/Llama-3.1-8B-Instruct".to_string())
        );
        assert_eq!(
            normalize_hf_repo_slug(
                "https://huggingface.co/meta-llama/Llama-3.1-8B-Instruct/resolve/main/model.gguf"
            ),
            Some("meta-llama/Llama-3.1-8B-Instruct".to_string())
        );
        assert_eq!(normalize_hf_repo_slug(""), None);
    }

    #[test]
    fn hf_download_url_uses_revision_and_entry_path() {
        let url = build_hf_download_url("meta-llama/Llama-3.1-8B-Instruct", "main", "model.gguf");
        assert_eq!(
            url,
            "https://huggingface.co/meta-llama/Llama-3.1-8B-Instruct/resolve/main/model.gguf"
        );
    }

    #[test]
    fn normalize_install_files_uses_multifile_and_keeps_entry_first() {
        let request = LocalAiInstallRequest {
            model_id: "m".to_string(),
            repo: "hf://org/model".to_string(),
            revision: None,
            capabilities: None,
            engine: None,
            entry: Some("weights/model.safetensors".to_string()),
            files: Some(vec![
                "config.json".to_string(),
                "weights/model.safetensors".to_string(),
                "tokenizer.json".to_string(),
                "config.json".to_string(),
            ]),
            license: None,
            hashes: None,
            endpoint: None,
            provider_hints: None,
        };

        let (entry, files) = normalize_install_files(&request).expect("normalized files");
        assert_eq!(entry, "weights/model.safetensors");
        assert_eq!(files[0], "weights/model.safetensors");
        assert_eq!(files.len(), 3);
    }

    #[test]
    fn resolve_expected_file_hash_reads_exact_key() {
        let mut hashes = std::collections::HashMap::new();
        hashes.insert("a.bin".to_string(), "sha256:abc123".to_string());
        let request = LocalAiInstallRequest {
            model_id: "m".to_string(),
            repo: "hf://org/model".to_string(),
            revision: None,
            capabilities: None,
            engine: None,
            entry: Some("a.bin".to_string()),
            files: Some(vec!["a.bin".to_string()]),
            license: None,
            hashes: Some(hashes),
            endpoint: None,
            provider_hints: None,
        };
        assert_eq!(
            resolve_expected_file_hash(&request, "a.bin"),
            Some("abc123".to_string())
        );
    }

    #[test]
    fn build_manifest_from_install_request_writes_multifile_hashes() {
        let request = LocalAiInstallRequest {
            model_id: "hf:test/model".to_string(),
            repo: "hf://test/model".to_string(),
            revision: Some("main".to_string()),
            capabilities: Some(vec!["tts".to_string()]),
            engine: Some("localai".to_string()),
            entry: Some("model.safetensors".to_string()),
            files: Some(vec!["model.safetensors".to_string(), "config.json".to_string()]),
            license: Some("apache-2.0".to_string()),
            hashes: None,
            endpoint: None,
            provider_hints: None,
        };
        let hashes = std::collections::HashMap::from([
            (
                "model.safetensors".to_string(),
                "sha256:111".to_string(),
            ),
            ("config.json".to_string(), "sha256:222".to_string()),
        ]);
        let manifest = build_manifest_from_install_request(
            &request,
            "model.safetensors",
            &vec!["model.safetensors".to_string(), "config.json".to_string()],
            &hashes,
        )
        .expect("manifest");

        assert_eq!(manifest.entry, "model.safetensors");
        assert_eq!(manifest.files.len(), 2);
        assert_eq!(manifest.hashes.get("config.json"), Some(&"sha256:222".to_string()));
    }

    #[test]
    fn aggregate_progress_merges_file_progress_into_session_totals() {
        let progress = super::HfDownloadProgress {
            phase: "download".to_string(),
            bytes_received: 200,
            bytes_total: Some(500),
            speed_bytes_per_sec: None,
            eta_seconds: None,
            message: None,
        };
        let (bytes_received, bytes_total) = aggregate_progress(100, Some(1000), &progress);
        assert_eq!(bytes_received, 300);
        assert_eq!(bytes_total, Some(1000));

        let (dynamic_received, dynamic_total) = aggregate_progress(100, None, &progress);
        assert_eq!(dynamic_received, 300);
        assert_eq!(dynamic_total, Some(600));
    }

    // --- K-LOCAL-026 normalize_relative_file_path ---

    #[test]
    fn normalize_relative_file_path_rejects_absolute_path() {
        let result = normalize_relative_file_path("/etc/passwd");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("absolute path"));
    }

    #[test]
    fn normalize_relative_file_path_rejects_parent_traversal() {
        let result = normalize_relative_file_path("../../../etc");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("parent traversal"));
    }

    #[test]
    fn normalize_relative_file_path_converts_backslash() {
        assert_eq!(
            normalize_relative_file_path("subdir\\model.bin"),
            Ok("subdir/model.bin".to_string())
        );
    }

    #[test]
    fn normalize_relative_file_path_rejects_empty() {
        let result = normalize_relative_file_path("");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("empty"));
    }

    #[test]
    fn normalize_relative_file_path_accepts_nested() {
        assert_eq!(
            normalize_relative_file_path("speech_tokenizer/model.safetensors"),
            Ok("speech_tokenizer/model.safetensors".to_string())
        );
    }

    // --- K-LOCAL-024 normalize_expected_hash ---

    #[test]
    fn normalize_expected_hash_strips_sha256_prefix() {
        assert_eq!(normalize_expected_hash("sha256:ABC123"), "abc123");
    }

    #[test]
    fn normalize_expected_hash_handles_plain_hex() {
        assert_eq!(normalize_expected_hash("  abc123  "), "abc123");
    }

    // --- download URL ---

    #[test]
    fn build_hf_download_url_encodes_spaces() {
        let url = build_hf_download_url("org/model", "main", "my model.gguf");
        assert!(url.contains("my%20model.gguf"));
    }
}
