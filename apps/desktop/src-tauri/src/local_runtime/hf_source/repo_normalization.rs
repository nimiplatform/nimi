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
    // Also match mirror URLs (e.g. hf-mirror.com).
    let base = hf_download_base_url();
    if let Some(host) = base
        .strip_prefix("https://")
        .or_else(|| base.strip_prefix("http://"))
    {
        if normalized.contains(host) {
            return true;
        }
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
        // Try mirror host extraction.
        let base = hf_download_base_url();
        let mirror_host = base
            .strip_prefix("https://")
            .or_else(|| base.strip_prefix("http://"))
            .unwrap_or("");
        if !mirror_host.is_empty() && mirror_host != "huggingface.co" {
            if let Some((_, suffix)) = normalized.split_once(&format!("{mirror_host}/")) {
                suffix
            } else {
                normalized
            }
        } else {
            normalized
        }
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
    if path.is_absolute() || path.has_root() {
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

fn normalize_install_files(
    request: &LocalAiInstallRequest,
) -> Result<(String, Vec<String>), String> {
    let entry = normalize_relative_file_path(
        normalize_non_empty(request.entry.as_deref().unwrap_or("model.bin"), "model.bin").as_str(),
    )?;

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
    let base = hf_download_base_url();
    let normalized_revision = normalize_non_empty(revision, "main");
    let entry = file_path.trim().replace(' ', "%20");
    format!(
        "{base}/{repo}/resolve/{revision}/{entry}",
        base = base,
        repo = repo_slug.trim(),
        revision = normalized_revision,
        entry = entry
    )
}

const LOCAL_AI_HF_DOWNLOAD_PAUSED: &str = "LOCAL_AI_HF_DOWNLOAD_PAUSED";
const LOCAL_AI_HF_DOWNLOAD_CANCELLED: &str = "LOCAL_AI_HF_DOWNLOAD_CANCELLED";
const LOCAL_AI_HF_DOWNLOAD_DISK_FULL: &str = "LOCAL_AI_HF_DOWNLOAD_DISK_FULL";
const LOCAL_AI_HF_DOWNLOAD_HASH_MISMATCH: &str = "LOCAL_AI_HF_DOWNLOAD_HASH_MISMATCH";
const HF_RETRY_BACKOFF_MS: [u64; 8] = [300, 1_000, 5_000, 15_000, 30_000, 60_000, 120_000, 180_000];

fn control_to_error(control: HfDownloadControl) -> Option<String> {
    match control {
        HfDownloadControl::Continue => None,
        HfDownloadControl::Pause => Some(format!(
            "{LOCAL_AI_HF_DOWNLOAD_PAUSED}: download paused by user"
        )),
        HfDownloadControl::Cancel => Some(format!(
            "{LOCAL_AI_HF_DOWNLOAD_CANCELLED}: download cancelled by user"
        )),
    }
}

fn is_disk_full_io_error(error: &std::io::Error) -> bool {
    if let Some(code) = error.raw_os_error() {
        if code == 28 || code == 112 {
            return true;
        }
    }
    false
}

fn disk_full_error(destination: &Path, error: &std::io::Error) -> String {
    format!(
        "{LOCAL_AI_HF_DOWNLOAD_DISK_FULL}: disk full while writing {}: {error}",
        destination.display()
    )
}

