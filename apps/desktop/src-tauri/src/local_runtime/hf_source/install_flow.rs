const DOWNLOAD_SPEED_WINDOW_MIN: Duration = Duration::from_secs(1);
const DOWNLOAD_SPEED_WINDOW_MAX: Duration = Duration::from_secs(3);
const DOWNLOAD_ETA_SMOOTHING_ALPHA: f64 = 0.2;

#[derive(Debug, Clone, Copy)]
struct DownloadProgressSample {
    captured_at: Instant,
    bytes_received: u64,
}

#[derive(Debug, Default)]
struct SessionProgressEstimator {
    samples: VecDeque<DownloadProgressSample>,
    smoothed_eta_seconds: Option<f64>,
}

impl SessionProgressEstimator {
    fn observe_at(
        &mut self,
        captured_at: Instant,
        bytes_received: u64,
        bytes_total: Option<u64>,
    ) -> (Option<f64>, Option<f64>) {
        if self
            .samples
            .back()
            .map(|sample| bytes_received < sample.bytes_received)
            .unwrap_or(false)
        {
            self.samples.clear();
            self.smoothed_eta_seconds = None;
        }

        self.samples.push_back(DownloadProgressSample {
            captured_at,
            bytes_received,
        });

        while self.samples.len() > 1 {
            let Some(oldest) = self.samples.front().copied() else {
                break;
            };
            if captured_at.saturating_duration_since(oldest.captured_at)
                <= DOWNLOAD_SPEED_WINDOW_MAX
            {
                break;
            }
            self.samples.pop_front();
        }

        let Some(anchor) = self.samples.front().copied() else {
            return (None, None);
        };

        let elapsed_secs = captured_at
            .saturating_duration_since(anchor.captured_at)
            .as_secs_f64();
        if elapsed_secs < DOWNLOAD_SPEED_WINDOW_MIN.as_secs_f64()
            || bytes_received <= anchor.bytes_received
        {
            return (None, None);
        }

        let delta_bytes = bytes_received.saturating_sub(anchor.bytes_received);
        let speed_bytes_per_sec = Some(delta_bytes as f64 / elapsed_secs);
        let raw_eta_seconds = match (bytes_total, speed_bytes_per_sec) {
            (Some(total), Some(speed)) if speed > 0.0 && total >= bytes_received => {
                Some((total.saturating_sub(bytes_received)) as f64 / speed)
            }
            _ => None,
        };
        let eta_seconds = match raw_eta_seconds {
            Some(raw_eta) if raw_eta <= 0.0 => {
                self.smoothed_eta_seconds = Some(0.0);
                Some(0.0)
            }
            Some(raw_eta) => {
                let next_eta = match self.smoothed_eta_seconds {
                    Some(previous_eta) if previous_eta.is_finite() => {
                        previous_eta
                            + ((raw_eta - previous_eta) * DOWNLOAD_ETA_SMOOTHING_ALPHA)
                    }
                    _ => raw_eta,
                };
                self.smoothed_eta_seconds = Some(next_eta);
                Some(next_eta)
            }
            None => {
                self.smoothed_eta_seconds = None;
                None
            }
        };

        (speed_bytes_per_sec, eta_seconds)
    }
}

pub fn install_from_hf(
    app: &AppHandle,
    request: &LocalAiInstallRequest,
    on_progress: &mut impl FnMut(HfDownloadProgress),
) -> Result<super::types::LocalAiModelRecord, String> {
    let mut wrapped_progress = |progress: HfDownloadProgress| -> HfDownloadControl {
        on_progress(progress);
        HfDownloadControl::Continue
    };
    install_from_hf_with_control(app, request, &mut wrapped_progress)
}

pub fn install_from_hf_with_control(
    app: &AppHandle,
    request: &LocalAiInstallRequest,
    on_progress: &mut impl FnMut(HfDownloadProgress) -> HfDownloadControl,
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
            .unwrap_or(DEFAULT_LOCAL_ENDPOINT),
    )?;

    let (entry_file, install_files) = normalize_install_files(request)?;

    let slug = slugify_local_model_id(&request.model_id);
    let models_dir = runtime_models_dir(app)?;
    let model_dir = models_dir.join(&slug);
    let staging_dir = models_dir.join(format!("{slug}-staging"));
    let backup_dir = models_dir.join(format!("{slug}-backup"));

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
    let mut session_progress_estimator = SessionProgressEstimator::default();

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
        let mut on_file_progress = |progress: HfDownloadProgress| -> HfDownloadControl {
            let (bytes_received, bytes_total) =
                aggregate_progress(completed_before_file, total_bytes_known, &progress);
            let (speed_bytes_per_sec, eta_seconds) = session_progress_estimator.observe_at(
                Instant::now(),
                bytes_received,
                bytes_total,
            );
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
                speed_bytes_per_sec,
                eta_seconds,
                message,
            })
        };

        if let Err(error) =
            download_file_with_resume(&download_url, &staged_file_path, &mut on_file_progress)
        {
            if should_cleanup_staging_for_error(error.as_str()) {
                rollback_staging(
                    staging_dir.as_path(),
                    backup_dir.as_path(),
                    model_dir.as_path(),
                );
            }
            return Err(error);
        }

        let file_size = fs::metadata(&staged_file_path)
            .map(|meta| meta.len())
            .unwrap_or(0);
        let downloaded_bytes_after_file = completed_before_file.saturating_add(file_size);

        if let Some(error) = control_to_error(on_progress(HfDownloadProgress {
            phase: "verify".to_string(),
            bytes_received: downloaded_bytes_after_file,
            bytes_total: total_bytes_known.or(Some(downloaded_bytes_after_file)),
            speed_bytes_per_sec: None,
            eta_seconds: None,
            message: Some(format!(
                "[{}/{}] {}: verifying downloaded file",
                file_index + 1,
                file_count,
                file_path
            )),
        })) {
            return Err(error);
        }

        let mut verify_progress_estimator = SessionProgressEstimator::default();
        let file_hash = sha256_hex_streaming_with_progress(
            &staged_file_path,
            &mut |verified_bytes, verified_total| {
                let (verify_speed_bytes_per_sec, verify_eta_seconds) =
                    verify_progress_estimator.observe_at(
                        Instant::now(),
                        verified_bytes,
                        Some(verified_total),
                    );
                let verify_percent = if verified_total > 0 {
                    ((verified_bytes as f64 / verified_total as f64) * 100.0).round() as u64
                } else {
                    0
                };
                control_to_error(on_progress(HfDownloadProgress {
                    phase: "verify".to_string(),
                    bytes_received: downloaded_bytes_after_file,
                    bytes_total: total_bytes_known.or(Some(downloaded_bytes_after_file)),
                    speed_bytes_per_sec: verify_speed_bytes_per_sec,
                    eta_seconds: verify_eta_seconds,
                    message: Some(format!(
                        "[{}/{}] {}: verifying integrity ({}%)",
                        file_index + 1,
                        file_count,
                        file_path,
                        verify_percent.min(100)
                    )),
                }))
                .is_none()
            },
        )
        .map_err(|error| {
            rollback_staging(
                staging_dir.as_path(),
                backup_dir.as_path(),
                model_dir.as_path(),
            );
            error
        })?;

        if let Some(expected_hash) = resolve_expected_file_hash(request, file_path) {
            if expected_hash != file_hash {
                rollback_staging(
                    staging_dir.as_path(),
                    backup_dir.as_path(),
                    model_dir.as_path(),
                );
                return Err(format!(
                    "{LOCAL_AI_HF_DOWNLOAD_HASH_MISMATCH}: file={}, expected={}, actual={}",
                    file_path, expected_hash, file_hash
                ));
            }
        }

        total_verified_bytes = downloaded_bytes_after_file;
        computed_hashes.insert(file_path.to_string(), format!("sha256:{file_hash}"));

        if let Some(error) = control_to_error(on_progress(HfDownloadProgress {
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
        })) {
            return Err(error);
        }
    }

    let manifest = match build_manifest_from_install_request(
        request,
        &entry_file,
        &install_files,
        &computed_hashes,
    ) {
        Ok(value) => value,
        Err(error) => {
            rollback_staging(
                staging_dir.as_path(),
                backup_dir.as_path(),
                model_dir.as_path(),
            );
            return Err(error);
        }
    };
    let manifest_path: PathBuf = staging_dir.join("model.manifest.json");
    let manifest_json = serde_json::to_string_pretty(&manifest)
        .map_err(|error| format!("序列化 HF manifest 失败: {error}"))?;
    fs::write(&manifest_path, manifest_json).map_err(|error| {
        rollback_staging(
            staging_dir.as_path(),
            backup_dir.as_path(),
            model_dir.as_path(),
        );
        format!(
            "写入 HF manifest 失败 ({}): {error}",
            manifest_path.display()
        )
    })?;

    let validated = match parse_and_validate_manifest(&manifest_path) {
        Ok(value) => value,
        Err(error) => {
            rollback_staging(
                staging_dir.as_path(),
                backup_dir.as_path(),
                model_dir.as_path(),
            );
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

    if let Some(error) = control_to_error(on_progress(HfDownloadProgress {
        phase: "verify".to_string(),
        bytes_received: total_verified_bytes,
        bytes_total: total_bytes_known.or(Some(total_verified_bytes)),
        speed_bytes_per_sec: None,
        eta_seconds: Some(0.0),
        message: Some("manifest validated".to_string()),
    })) {
        return Err(error);
    }

    manifest_to_model_record(
        &validated,
        Some(validated_endpoint.as_str()),
        Some(model_dir.as_path()),
    )
}
