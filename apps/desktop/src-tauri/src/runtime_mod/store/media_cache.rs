use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine as _;
use sha2::{Digest, Sha256};
use std::time::{Duration, SystemTime};
use url::Url;

const MEDIA_CACHE_ROOT_DIR: &str = ".nimi/cache/media";
const MEDIA_CACHE_DEFAULT_TTL_SECS: u64 = 14 * 24 * 60 * 60;

fn resolve_media_cache_dir() -> Result<PathBuf, String> {
    let home_dir = dirs::home_dir()
        .ok_or_else(|| "cannot resolve home directory for media cache".to_string())?;
    let cache_dir = home_dir.join(MEDIA_CACHE_ROOT_DIR);
    fs::create_dir_all(&cache_dir).map_err(|error| {
        format!(
            "create media cache directory failed ({}): {}",
            cache_dir.display(),
            error
        )
    })?;
    Ok(cache_dir)
}

fn normalize_extension(extension_hint: Option<&str>, mime_type: &str) -> String {
    let from_hint = extension_hint
        .map(|value| value.trim().trim_start_matches('.').to_ascii_lowercase())
        .filter(|value| {
            !value.is_empty()
                && value.len() <= 12
                && value
                    .chars()
                    .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit())
        });
    if let Some(value) = from_hint {
        return value;
    }
    let normalized_mime = mime_type.trim().to_ascii_lowercase();
    match normalized_mime.as_str() {
        "image/png" => "png".to_string(),
        "image/jpeg" => "jpg".to_string(),
        "image/webp" => "webp".to_string(),
        "image/gif" => "gif".to_string(),
        "image/bmp" => "bmp".to_string(),
        "image/tiff" => "tiff".to_string(),
        "video/mp4" => "mp4".to_string(),
        "video/webm" => "webm".to_string(),
        "video/quicktime" => "mov".to_string(),
        "video/x-msvideo" => "avi".to_string(),
        "video/mpeg" => "mpeg".to_string(),
        _ => "bin".to_string(),
    }
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    let digest = hasher.finalize();
    let mut out = String::with_capacity(digest.len() * 2);
    for byte in digest {
        out.push_str(format!("{:02x}", byte).as_str());
    }
    out
}

fn to_file_uri(path: &Path) -> String {
    if let Ok(url) = Url::from_file_path(path) {
        return url.to_string();
    }
    let normalized = path.to_string_lossy().replace('\\', "/");
    if normalized.starts_with('/') {
        return format!("file://{}", normalized);
    }
    format!("file:///{}", normalized)
}

pub fn put_media_cache(
    media_base64: &str,
    mime_type: Option<&str>,
    extension_hint: Option<&str>,
) -> Result<RuntimeMediaCachePutResultPayload, String> {
    let normalized_payload = media_base64.trim();
    if normalized_payload.is_empty() {
        return Err("media cache put failed: base64 payload is empty".to_string());
    }

    let bytes = BASE64_STANDARD
        .decode(normalized_payload)
        .map_err(|error| format!("media cache put failed: base64 decode error: {}", error))?;
    if bytes.is_empty() {
        return Err("media cache put failed: decoded payload is empty".to_string());
    }

    let normalized_mime = mime_type
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .unwrap_or("application/octet-stream");
    let extension = normalize_extension(extension_hint, normalized_mime);
    let cache_key = sha256_hex(&bytes);
    let cache_dir = resolve_media_cache_dir()?;
    let file_name = format!("{}.{}", cache_key, extension);
    let file_path = cache_dir.join(file_name);
    let existed = file_path.exists();
    if !existed {
        fs::write(&file_path, &bytes).map_err(|error| {
            format!(
                "media cache write failed ({}): {}",
                file_path.display(),
                error
            )
        })?;
    }

    Ok(RuntimeMediaCachePutResultPayload {
        cache_key,
        file_path: file_path.to_string_lossy().to_string(),
        uri: to_file_uri(&file_path),
        mime_type: normalized_mime.to_string(),
        size_bytes: bytes.len() as u64,
        existed,
    })
}

pub fn gc_media_cache(max_age_seconds: Option<u64>) -> Result<RuntimeMediaCacheGcResultPayload, String> {
    let ttl_secs = max_age_seconds.unwrap_or(MEDIA_CACHE_DEFAULT_TTL_SECS);
    let cache_dir = resolve_media_cache_dir()?;
    let now = SystemTime::now();
    let mut scanned_count: usize = 0;
    let mut removed_count: usize = 0;
    let mut removed_bytes: u64 = 0;

    let entries = fs::read_dir(&cache_dir).map_err(|error| {
        format!(
            "media cache gc read_dir failed ({}): {}",
            cache_dir.display(),
            error
        )
    })?;
    for entry_result in entries {
        let entry = match entry_result {
            Ok(value) => value,
            Err(_) => continue,
        };
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        scanned_count += 1;
        let metadata = match entry.metadata() {
            Ok(value) => value,
            Err(_) => continue,
        };
        let modified = match metadata.modified() {
            Ok(value) => value,
            Err(_) => continue,
        };
        let age = match now.duration_since(modified) {
            Ok(value) => value,
            Err(_) => Duration::from_secs(0),
        };
        if age.as_secs() < ttl_secs {
            continue;
        }
        let file_size = metadata.len();
        if fs::remove_file(&path).is_ok() {
            removed_count += 1;
            removed_bytes = removed_bytes.saturating_add(file_size);
        }
    }

    Ok(RuntimeMediaCacheGcResultPayload {
        scanned_count,
        removed_count,
        removed_bytes,
        retained_count: scanned_count.saturating_sub(removed_count),
    })
}
