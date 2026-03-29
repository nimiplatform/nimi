use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use serde::Deserialize;
use sha2::{Digest, Sha256};

const LLAMA_ENGINE_PACK_SUBDIR: &str = "engine-packs/llama-cpp";
const GITHUB_RELEASE_API: &str = "https://api.github.com/repos/ggml-org/llama.cpp/releases/latest";

#[derive(Debug, Clone)]
pub struct EnginePackBootstrapResult {
    pub binary_path: String,
    pub downloaded: bool,
    pub source_url: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GithubReleasePayload {
    #[serde(default)]
    assets: Vec<GithubReleaseAsset>,
}

#[derive(Debug, Deserialize)]
struct GithubReleaseAsset {
    #[serde(default)]
    name: String,
    #[serde(default)]
    browser_download_url: String,
}

fn now_nanos() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos()
}

fn binary_name() -> &'static str {
    #[cfg(target_os = "windows")]
    {
        "llama-server.exe"
    }
    #[cfg(not(target_os = "windows"))]
    {
        "llama-server"
    }
}

fn platform_id() -> String {
    format!("{}-{}", std::env::consts::OS, std::env::consts::ARCH)
}

fn runtime_root_path() -> Result<PathBuf, String> {
    let value = std::env::var("NIMI_LOCAL_AI_RUNTIME_ROOT")
        .ok()
        .map(|item| item.trim().to_string())
        .unwrap_or_default();
    if value.is_empty() {
        return Err(
            "LOCAL_AI_ENGINE_PACK_RUNTIME_ROOT_MISSING: NIMI_LOCAL_AI_RUNTIME_ROOT is not configured"
                .to_string(),
        );
    }
    Ok(PathBuf::from(value))
}

fn cache_binary_path() -> Result<PathBuf, String> {
    let runtime_root = runtime_root_path()?;
    let cache_dir = runtime_root
        .join(LLAMA_ENGINE_PACK_SUBDIR)
        .join(platform_id());
    fs::create_dir_all(&cache_dir).map_err(|error| {
        format!(
            "LOCAL_AI_ENGINE_PACK_CACHE_DIR_FAILED: failed to create cache directory ({}): {error}",
            cache_dir.display()
        )
    })?;
    Ok(cache_dir.join(binary_name()))
}

pub fn resolve_existing_llama_cpp_binary() -> Result<Option<String>, String> {
    if let Some(override_path) = env_override_binary_path() {
        if Path::new(&override_path).exists() {
            return Ok(Some(override_path));
        }
        return Ok(None);
    }

    let cached = cache_binary_path()?;
    if cached.exists() {
        return Ok(Some(cached.to_string_lossy().to_string()));
    }
    Ok(None)
}

fn normalize_non_empty(input: Option<&str>) -> Option<String> {
    let normalized = input.unwrap_or_default().trim();
    if normalized.is_empty() {
        None
    } else {
        Some(normalized.to_string())
    }
}

fn env_override_binary_path() -> Option<String> {
    normalize_non_empty(std::env::var("NIMI_LLAMA_CPP_BIN").ok().as_deref())
}

fn env_download_url() -> Option<String> {
    normalize_non_empty(std::env::var("NIMI_LLAMA_CPP_PACK_URL").ok().as_deref())
}

fn env_expected_sha256() -> Option<String> {
    normalize_non_empty(std::env::var("NIMI_LLAMA_CPP_PACK_SHA256").ok().as_deref()).map(|value| {
        value
            .to_ascii_lowercase()
            .trim_start_matches("sha256:")
            .to_string()
    })
}

fn github_user_agent() -> String {
    std::env::var("NIMI_LOCAL_AI_HF_USER_AGENT")
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "nimi-desktop/0.1 local-ai-runtime".to_string())
}

fn build_http_client() -> Result<reqwest::blocking::Client, String> {
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

fn asset_score(name: &str) -> i32 {
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

fn resolve_latest_release_asset() -> Result<(String, String), String> {
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
                platform_id()
            )
        })?;

    Ok((best.1, best.2))
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    format!("{:x}", hasher.finalize())
}

fn download_to_file(url: &str, destination: &Path) -> Result<(), String> {
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

fn verify_download_hash(path: &Path) -> Result<(), String> {
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

fn extract_archive_with_system_tool(archive_path: &Path, output_dir: &Path) -> Result<(), String> {
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

fn find_binary_recursive(root: &Path, name: &str) -> Option<PathBuf> {
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

#[cfg(unix)]
fn ensure_executable(path: &Path) -> Result<(), String> {
    use std::os::unix::fs::PermissionsExt;
    let metadata = fs::metadata(path).map_err(|error| {
        format!(
            "LOCAL_AI_ENGINE_PACK_CHMOD_FAILED: failed to stat binary ({}): {error}",
            path.display()
        )
    })?;
    let mut permissions = metadata.permissions();
    permissions.set_mode(0o755);
    fs::set_permissions(path, permissions).map_err(|error| {
        format!(
            "LOCAL_AI_ENGINE_PACK_CHMOD_FAILED: failed to chmod binary ({}): {error}",
            path.display()
        )
    })
}

#[cfg(not(unix))]
fn ensure_executable(_path: &Path) -> Result<(), String> {
    Ok(())
}

fn move_binary_to_cache(source: &Path, destination: &Path) -> Result<(), String> {
    if destination.exists() {
        fs::remove_file(destination).map_err(|error| {
            format!(
                "LOCAL_AI_ENGINE_PACK_CACHE_WRITE_FAILED: failed to clear existing binary ({}): {error}",
                destination.display()
            )
        })?;
    }

    fs::copy(source, destination).map_err(|error| {
        format!(
            "LOCAL_AI_ENGINE_PACK_CACHE_WRITE_FAILED: failed to copy binary into cache ({} -> {}): {error}",
            source.display(),
            destination.display()
        )
    })?;

    ensure_executable(destination)?;
    Ok(())
}

fn resolve_bootstrap_source() -> Result<(String, String), String> {
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

fn download_and_prepare_binary(cache_target: &Path) -> Result<(PathBuf, String), String> {
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

    if let Err(error) = move_binary_to_cache(downloaded_binary.as_path(), cache_target) {
        let _ = fs::remove_dir_all(&temp_root);
        return Err(error);
    }

    let _ = fs::remove_dir_all(&temp_root);
    Ok((cache_target.to_path_buf(), asset_url))
}

pub fn ensure_llama_cpp_binary() -> Result<EnginePackBootstrapResult, String> {
    if let Some(override_path) = env_override_binary_path() {
        let path = PathBuf::from(override_path.as_str());
        if !path.exists() {
            return Err(format!(
                "LOCAL_AI_ENGINE_PACK_OVERRIDE_NOT_FOUND: override binary not found: {}",
                path.display()
            ));
        }
        return Ok(EnginePackBootstrapResult {
            binary_path: path.to_string_lossy().to_string(),
            downloaded: false,
            source_url: None,
        });
    }

    let cache_target = cache_binary_path()?;
    if cache_target.exists() {
        return Ok(EnginePackBootstrapResult {
            binary_path: cache_target.to_string_lossy().to_string(),
            downloaded: false,
            source_url: None,
        });
    }

    let (binary_path, source_url) = download_and_prepare_binary(cache_target.as_path())?;
    Ok(EnginePackBootstrapResult {
        binary_path: binary_path.to_string_lossy().to_string(),
        downloaded: true,
        source_url: Some(source_url),
    })
}

#[cfg(test)]
mod tests {
    use super::{asset_score, binary_name};

    #[test]
    fn asset_scoring_prefers_llama_server_name() {
        let binary_asset = format!("llama-server-{}", std::env::consts::OS);
        let archive_asset = format!(
            "llama-{}-{}.zip",
            std::env::consts::OS,
            std::env::consts::ARCH
        );
        assert!(asset_score(binary_asset.as_str()) > asset_score(archive_asset.as_str()));
    }

    #[test]
    fn binary_name_is_not_empty() {
        assert!(!binary_name().trim().is_empty());
    }
}
