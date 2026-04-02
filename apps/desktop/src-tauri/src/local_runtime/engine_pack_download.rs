use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;

use sha2::{Digest, Sha256};

use super::engine_pack::{
    binary_name, copy_bundle_to_cache, ensure_executable, env_download_url, env_expected_sha256,
    github_user_agent, runtime_root_path, now_nanos, GithubReleaseAsset, GithubReleasePayload,
    GITHUB_RELEASE_API,
};

pub(super) fn build_http_client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(60))
        .build()
        .map_err(|error| {
            format!(
                "LOCAL_AI_ENGINE_PACK_HTTP_CLIENT_FAILED: failed to create HTTP client: {error}"
            )
        })
}

fn match_any(name: &str, candidates: &[&str]) -> bool {
    let normalized = name.to_ascii_lowercase();
    candidates
        .iter()
        .any(|candidate| normalized.contains(candidate))
}

fn os_tokens() -> &'static [&'static str] {
    match std::env::consts::OS {
        "macos" => &["macos", "darwin", "osx", "apple"],
        "windows" => &["windows", "win"],
        "linux" => &["linux", "ubuntu"],
        _ => &[""],
    }
}

fn arch_tokens() -> &'static [&'static str] {
    match std::env::consts::ARCH {
        "aarch64" => &["arm64", "aarch64", "arm"],
        "x86_64" => &["x86_64", "x64", "amd64"],
        _ => &[],
    }
}

pub(super) fn asset_score(name: &str) -> i32 {
    let normalized = name.to_ascii_lowercase();
    let mut score = 0;

    if normalized.contains("llama-server") {
        score += 150;
    }
    if normalized.contains("llama") {
        score += 30;
    }

    if match_any(&normalized, os_tokens()) {
        score += 20;
    }
    let arch_match = if arch_tokens().is_empty() {
        normalized.contains(std::env::consts::ARCH)
    } else {
        match_any(&normalized, arch_tokens())
    };
    if arch_match {
        score += 20;
    }

    if normalized.ends_with(".zip")
        || normalized.ends_with(".tar.gz")
        || normalized.ends_with(".tgz")
    {
        score += 5;
    }

    if normalized.contains("debug") {
        score -= 20;
    }

    if normalized.contains("metal") && std::env::consts::OS != "macos" {
        score -= 40;
    }
    if normalized.contains("cuda") && std::env::consts::OS == "macos" {
        score -= 40;
    }

    score
}

pub(super) fn resolve_latest_release_asset() -> Result<(String, String), String> {
    let client = build_http_client()?;
    let response = client
        .get(GITHUB_RELEASE_API)
        .header(reqwest::header::USER_AGENT, github_user_agent())
        .send()
        .map_err(|error| {
            format!(
                "LOCAL_AI_ENGINE_PACK_RELEASE_QUERY_FAILED: failed to query latest llama.cpp release: {error}"
            )
        })?;

    if !response.status().is_success() {
        return Err(format!(
            "LOCAL_AI_ENGINE_PACK_RELEASE_QUERY_FAILED: release query status={} ",
            response.status().as_u16()
        ));
    }

    let body = response.text().map_err(|error| {
        format!(
            "LOCAL_AI_ENGINE_PACK_RELEASE_QUERY_FAILED: failed to read release payload: {error}"
        )
    })?;
    let payload = serde_json::from_str::<GithubReleasePayload>(body.as_str()).map_err(|error| {
        format!("LOCAL_AI_ENGINE_PACK_RELEASE_QUERY_FAILED: invalid release payload: {error}")
    })?;

    let platform_id = super::engine_pack::platform_id();
    let mut scored_assets = payload
        .assets
        .into_iter()
        .filter(|asset| {
            let name = asset.name.to_ascii_lowercase();
            !name.is_empty() && !asset.browser_download_url.trim().is_empty()
        })
        .map(|asset| {
            let score = asset_score(asset.name.as_str());
            (score, asset.name, asset.browser_download_url)
        })
        .collect::<Vec<_>>();

    scored_assets.sort_by(|left, right| right.0.cmp(&left.0));
    let best = scored_assets
        .into_iter()
        .find(|candidate| candidate.0 > 0)
        .ok_or_else(|| {
            format!(
                "LOCAL_AI_ENGINE_PACK_ASSET_NOT_FOUND: no matching llama.cpp release asset for {}",
                platform_id
            )
        })?;

    Ok((best.1, best.2))
}

pub(super) fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

pub(super) fn download_to_file(url: &str, destination: &Path) -> Result<(), String> {
    let client = build_http_client()?;
    let mut response = client
        .get(url)
        .header(reqwest::header::USER_AGENT, github_user_agent())
        .send()
        .map_err(|error| {
            format!("LOCAL_AI_ENGINE_PACK_DOWNLOAD_FAILED: failed to download engine pack: {error}")
        })?;

    if !response.status().is_success() {
        return Err(format!(
            "LOCAL_AI_ENGINE_PACK_DOWNLOAD_FAILED: engine pack download status={} url={url}",
            response.status().as_u16()
        ));
    }

    let mut file = fs::File::create(destination).map_err(|error| {
        format!(
            "LOCAL_AI_ENGINE_PACK_DOWNLOAD_FAILED: failed to create download file ({}): {error}",
            destination.display()
        )
    })?;

    let mut buffer = [0_u8; 16 * 1024];
    loop {
        let read_bytes = response.read(&mut buffer).map_err(|error| {
            format!("LOCAL_AI_ENGINE_PACK_DOWNLOAD_FAILED: failed to read download stream: {error}")
        })?;
        if read_bytes == 0 {
            break;
        }
        file.write_all(&buffer[..read_bytes]).map_err(|error| {
            format!(
                "LOCAL_AI_ENGINE_PACK_DOWNLOAD_FAILED: failed to write download file ({}): {error}",
                destination.display()
            )
        })?;
    }
    file.flush().map_err(|error| {
        format!(
            "LOCAL_AI_ENGINE_PACK_DOWNLOAD_FAILED: failed to flush download file ({}): {error}",
            destination.display()
        )
    })
}

pub(super) fn verify_download_hash(path: &Path) -> Result<(), String> {
    let Some(expected_hash) = env_expected_sha256() else {
        return Ok(());
    };

    let bytes = fs::read(path).map_err(|error| {
        format!(
            "LOCAL_AI_ENGINE_PACK_HASH_CHECK_FAILED: failed to read downloaded file ({}): {error}",
            path.display()
        )
    })?;
    let actual_hash = sha256_hex(&bytes);

    if actual_hash != expected_hash {
        return Err(format!(
            "LOCAL_AI_ENGINE_PACK_HASH_MISMATCH: expected={expected_hash}, actual={actual_hash}"
        ));
    }

    Ok(())
}

fn run_command(binary: &str, args: &[String]) -> Result<(), String> {
    let status = Command::new(binary).args(args).status().map_err(|error| {
        format!("LOCAL_AI_ENGINE_PACK_EXTRACT_FAILED: failed to execute {binary}: {error}")
    })?;
    if status.success() {
        return Ok(());
    }
    Err(format!(
        "LOCAL_AI_ENGINE_PACK_EXTRACT_FAILED: command {} returned non-zero status",
        binary
    ))
}

pub(super) fn extract_archive_with_system_tool(
    archive_path: &Path,
    output_dir: &Path,
) -> Result<(), String> {
    let archive_name = archive_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();

    if archive_name.ends_with(".zip") {
        #[cfg(target_os = "windows")]
        {
            return run_command(
                "powershell",
                &[
                    "-NoProfile".to_string(),
                    "-Command".to_string(),
                    format!(
                        "Expand-Archive -Path '{}' -DestinationPath '{}' -Force",
                        archive_path.display(),
                        output_dir.display()
                    ),
                ],
            );
        }
        #[cfg(not(target_os = "windows"))]
        {
            return run_command(
                "unzip",
                &[
                    "-oq".to_string(),
                    archive_path.display().to_string(),
                    "-d".to_string(),
                    output_dir.display().to_string(),
                ],
            );
        }
    }

    if archive_name.ends_with(".tar.gz") || archive_name.ends_with(".tgz") {
        return run_command(
            "tar",
            &[
                "-xzf".to_string(),
                archive_path.display().to_string(),
                "-C".to_string(),
                output_dir.display().to_string(),
            ],
        );
    }

    Err(format!(
        "LOCAL_AI_ENGINE_PACK_EXTRACT_FAILED: unsupported archive format: {}",
        archive_path.display()
    ))
}

pub(super) fn find_binary_recursive(root: &Path, name: &str) -> Option<PathBuf> {
    let entries = fs::read_dir(root).ok()?;
    for entry in entries {
        let entry = entry.ok()?;
        let path = entry.path();
        if path.is_dir() {
            if let Some(found) = find_binary_recursive(path.as_path(), name) {
                return Some(found);
            }
            continue;
        }

        let file_name = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default();
        if file_name.eq_ignore_ascii_case(name) {
            return Some(path);
        }
    }
    None
}

pub(super) fn resolve_bootstrap_source() -> Result<(String, String), String> {
    if let Some(url) = env_download_url() {
        let guessed_name = url
            .split('/')
            .next_back()
            .map(|value| value.to_string())
            .unwrap_or_else(|| binary_name().to_string());
        return Ok((guessed_name, url));
    }

    resolve_latest_release_asset()
}

pub(super) fn download_and_prepare_bundle(
    cache_dir: &Path,
) -> Result<(PathBuf, String), String> {
    let (asset_name, asset_url) = resolve_bootstrap_source()?;

    let temp_root = runtime_root_path()?.join(format!("engine-pack-tmp-{}", now_nanos()));
    let temp_download = temp_root.join(asset_name.as_str());
    let temp_extract = temp_root.join("extract");
    fs::create_dir_all(&temp_extract).map_err(|error| {
        format!(
            "LOCAL_AI_ENGINE_PACK_TMP_DIR_FAILED: failed to create temp extraction directory ({}): {error}",
            temp_extract.display()
        )
    })?;

    if let Err(error) = download_to_file(asset_url.as_str(), temp_download.as_path()) {
        let _ = fs::remove_dir_all(&temp_root);
        return Err(error);
    }

    if let Err(error) = verify_download_hash(temp_download.as_path()) {
        let _ = fs::remove_dir_all(&temp_root);
        return Err(error);
    }

    let asset_lower = asset_name.to_ascii_lowercase();
    let downloaded_binary = if asset_lower.ends_with(".zip")
        || asset_lower.ends_with(".tar.gz")
        || asset_lower.ends_with(".tgz")
    {
        if let Err(error) =
            extract_archive_with_system_tool(temp_download.as_path(), temp_extract.as_path())
        {
            let _ = fs::remove_dir_all(&temp_root);
            return Err(error);
        }

        find_binary_recursive(temp_extract.as_path(), binary_name()).ok_or_else(|| {
            format!(
                "LOCAL_AI_ENGINE_PACK_BINARY_NOT_FOUND: {} was not found in extracted archive",
                binary_name()
            )
        })?
    } else {
        temp_download.clone()
    };

    let bundle_source_dir = downloaded_binary.parent().ok_or_else(|| {
        format!(
            "LOCAL_AI_ENGINE_PACK_BINARY_NOT_FOUND: failed to resolve extracted bundle directory for {}",
            downloaded_binary.display()
        )
    })?;

    if let Err(error) = copy_bundle_to_cache(bundle_source_dir, cache_dir) {
        let _ = fs::remove_dir_all(&temp_root);
        return Err(error);
    }

    let _ = fs::remove_dir_all(&temp_root);
    Ok((cache_dir.join(binary_name()), asset_url))
}
