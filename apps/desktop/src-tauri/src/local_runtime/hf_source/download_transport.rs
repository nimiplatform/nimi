fn download_file_with_resume<F>(
    url: &str,
    destination: &PathBuf,
    on_progress: &mut F,
) -> Result<(), String>
where
    F: FnMut(HfDownloadProgress) -> HfDownloadControl,
{
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(300))
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
                    if status == reqwest::StatusCode::NOT_FOUND
                        || status == reqwest::StatusCode::UNAUTHORIZED
                        || status == reqwest::StatusCode::FORBIDDEN
                    {
                        return Err(last_error.unwrap_or_else(|| {
                            format!(
                                "LOCAL_AI_HF_DOWNLOAD_HTTP_STATUS: status={}, url={url}, attempt={attempt}",
                                status.as_u16()
                            )
                        }));
                    }
                    if attempt < HF_RETRY_BACKOFF_MS.len() {
                        thread::sleep(Duration::from_millis(*backoff_ms));
                    }
                    continue;
                }

                if status == reqwest::StatusCode::RANGE_NOT_SATISFIABLE {
                    // Existing file already contains the full content.
                    if let Some(error) = control_to_error(on_progress(HfDownloadProgress {
                        phase: "download".to_string(),
                        bytes_received: existing_bytes,
                        bytes_total: Some(existing_bytes),
                        speed_bytes_per_sec: None,
                        eta_seconds: Some(0.0),
                        message: Some("download already complete".to_string()),
                    })) {
                        return Err(error);
                    }
                    return Ok(());
                }

                let append = existing_bytes > 0 && status == reqwest::StatusCode::PARTIAL_CONTENT;
                let total_bytes = response
                    .headers()
                    .get(reqwest::header::CONTENT_LENGTH)
                    .and_then(|value| value.to_str().ok())
                    .and_then(|value| value.parse::<u64>().ok())
                    .map(|value| {
                        if append {
                            existing_bytes + value
                        } else {
                            value
                        }
                    });
                let mut file = if append {
                    OpenOptions::new()
                        .create(true)
                        .append(true)
                        .open(destination)
                        .map_err(|error| {
                            if is_disk_full_io_error(&error) {
                                disk_full_error(destination.as_path(), &error)
                            } else {
                                format!(
                                    "LOCAL_AI_HF_DOWNLOAD_FILE_OPEN_FAILED: 打开断点续传文件失败 ({}): {error}",
                                    destination.display()
                                )
                            }
                        })?
                } else {
                    OpenOptions::new()
                        .create(true)
                        .write(true)
                        .truncate(true)
                        .open(destination)
                        .map_err(|error| {
                            if is_disk_full_io_error(&error) {
                                disk_full_error(destination.as_path(), &error)
                            } else {
                                format!(
                                    "LOCAL_AI_HF_DOWNLOAD_FILE_CREATE_FAILED: 创建下载文件失败 ({}): {error}",
                                    destination.display()
                                )
                            }
                        })?
                };

                let mut bytes_received = if append { existing_bytes } else { 0 };
                let started_at = Instant::now();
                if let Some(error) = control_to_error(on_progress(HfDownloadProgress {
                    phase: "download".to_string(),
                    bytes_received,
                    bytes_total: total_bytes,
                    speed_bytes_per_sec: None,
                    eta_seconds: None,
                    message: Some(format!("downloading from Hugging Face (attempt {attempt})")),
                })) {
                    return Err(error);
                }

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
                        if is_disk_full_io_error(&error) {
                            disk_full_error(destination.as_path(), &error)
                        } else {
                            format!(
                                "LOCAL_AI_HF_DOWNLOAD_FILE_WRITE_FAILED: 写入下载文件失败 ({}): {error}",
                                destination.display()
                            )
                        }
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
                    if let Some(error) = control_to_error(on_progress(HfDownloadProgress {
                        phase: "download".to_string(),
                        bytes_received,
                        bytes_total: total_bytes,
                        speed_bytes_per_sec: speed,
                        eta_seconds,
                        message: Some(format!("downloading from Hugging Face (attempt {attempt})")),
                    })) {
                        return Err(error);
                    }
                }
                file.flush().map_err(|error| {
                    if is_disk_full_io_error(&error) {
                        disk_full_error(destination.as_path(), &error)
                    } else {
                        format!(
                            "LOCAL_AI_HF_DOWNLOAD_FILE_FLUSH_FAILED: 刷新下载文件失败 ({}): {error}",
                            destination.display()
                        )
                    }
                })?;
                if let Some(error) = control_to_error(on_progress(HfDownloadProgress {
                    phase: "download".to_string(),
                    bytes_received,
                    bytes_total: total_bytes.or(Some(bytes_received)),
                    speed_bytes_per_sec: None,
                    eta_seconds: Some(0.0),
                    message: Some("download completed".to_string()),
                })) {
                    return Err(error);
                }
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

#[cfg(test)]
fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

/// Streaming SHA256 with optional progress callback.
#[cfg(test)]
fn sha256_hex_streaming(path: &Path) -> Result<String, String> {
    sha256_hex_streaming_with_progress(path, &mut |_bytes_verified, _bytes_total| {})
}

fn sha256_hex_streaming_with_progress<F>(path: &Path, on_progress: &mut F) -> Result<String, String>
where
    F: FnMut(u64, u64),
{
    let file = fs::File::open(path).map_err(|error| {
        format!(
            "SHA256 streaming: failed to open file ({}): {error}",
            path.display()
        )
    })?;
    let total_bytes = file.metadata().map(|meta| meta.len()).unwrap_or(0);
    let mut reader = BufReader::with_capacity(1024 * 1024, file);
    let mut hasher = Sha256::new();
    let mut buf = vec![0u8; 1024 * 1024];
    let mut bytes_verified = 0_u64;
    let mut last_report_at = Instant::now();
    loop {
        let n = reader.read(&mut buf).map_err(|error| {
            format!(
                "SHA256 streaming: failed to read file ({}): {error}",
                path.display()
            )
        })?;
        if n == 0 {
            break;
        }
        hasher.update(&buf[..n]);
        bytes_verified = bytes_verified.saturating_add(n as u64);
        if last_report_at.elapsed() >= Duration::from_millis(250) || bytes_verified >= total_bytes {
            on_progress(bytes_verified, total_bytes);
            last_report_at = Instant::now();
        }
    }
    Ok(format!("{:x}", hasher.finalize()))
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
        engine: normalize_non_empty(request.engine.as_deref().unwrap_or("localai"), "localai"),
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

fn should_cleanup_staging_for_error(error: &str) -> bool {
    let code = error
        .split(':')
        .next()
        .map(|value| value.trim())
        .unwrap_or_default();
    code == LOCAL_AI_HF_DOWNLOAD_CANCELLED || code == LOCAL_AI_HF_DOWNLOAD_HASH_MISMATCH
}
