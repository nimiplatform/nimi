use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use chrono::SecondsFormat;
use sha2::Digest;

use super::constants::DEFAULT_LOCAL_ENDPOINT;

pub fn now_iso_timestamp() -> String {
    chrono::Utc::now().to_rfc3339_opts(SecondsFormat::Millis, true)
}

pub fn normalize_non_empty(value: &str, fallback: &str) -> String {
    let normalized = value.trim();
    if normalized.is_empty() {
        fallback.to_string()
    } else {
        normalized.to_string()
    }
}

fn capability_matches(value: &str, candidates: &[&str]) -> bool {
    let normalized = value.trim().to_ascii_lowercase();
    candidates.iter().any(|candidate| normalized == *candidate)
}

fn capability_is_image(value: &str) -> bool {
    capability_matches(value, &["image", "image.generate", "image.edit"])
}

fn capability_is_video(value: &str) -> bool {
    capability_matches(value, &["video", "video.generate", "i2v"])
}

fn capability_is_transcribe(value: &str) -> bool {
    capability_matches(value, &["stt", "audio.transcribe"])
}

fn capability_is_synthesize(value: &str) -> bool {
    capability_matches(value, &["tts", "audio.synthesize"])
}

fn capability_is_voice_workflow(value: &str) -> bool {
    capability_matches(value, &["voice_workflow.tts_v2v", "voice_workflow.tts_t2v"])
}

pub fn default_preferred_engine_for_capabilities(capabilities: &[String]) -> String {
    if capabilities
        .iter()
        .any(|item| capability_is_image(item) || capability_is_video(item))
    {
        return "media".to_string();
    }
    if capabilities.iter().any(|item| {
        capability_is_transcribe(item)
            || capability_is_synthesize(item)
            || capability_is_voice_workflow(item)
    }) {
        return "speech".to_string();
    }
    if capabilities
        .iter()
        .any(|item| capability_matches(item, &["music", "music.generate"]))
    {
        return "sidecar".to_string();
    }
    "llama".to_string()
}

pub fn normalize_local_engine(value: &str, capabilities: &[String]) -> String {
    let normalized = value.trim().to_ascii_lowercase();
    match normalized.as_str() {
        "" => default_preferred_engine_for_capabilities(capabilities),
        "llama" | "media" | "speech" | "sidecar" => normalized,
        _ => normalized,
    }
}

pub fn default_logical_model_id(model_id: &str) -> String {
    let trimmed = model_id.trim();
    if trimmed.is_empty() {
        return "nimi/local-model".to_string();
    }
    let lower = trimmed.to_ascii_lowercase();
    for prefix in ["local/", "llama/", "media/", "speech/", "sidecar/"] {
        if lower.starts_with(prefix) {
            return format!("nimi/{}", slugify_local_model_id(&trimmed[prefix.len()..]));
        }
    }
    format!("nimi/{}", slugify_local_model_id(trimmed))
}

pub fn resolved_model_relative_dir(logical_model_id: &str) -> PathBuf {
    let mut path = PathBuf::from("resolved");
    let mut pushed_any = false;
    for segment in logical_model_id
        .split('/')
        .map(str::trim)
        .filter(|segment| !segment.is_empty() && *segment != "." && *segment != "..")
    {
        path.push(segment);
        pushed_any = true;
    }
    if !pushed_any {
        path.push("nimi");
        path.push("local-model");
    }
    path
}

pub fn resolved_model_dir(models_root: &Path, logical_model_id: &str) -> PathBuf {
    models_root.join(resolved_model_relative_dir(logical_model_id))
}

pub fn resolved_model_manifest_path(models_root: &Path, logical_model_id: &str) -> PathBuf {
    resolved_model_dir(models_root, logical_model_id).join("manifest.json")
}

pub fn artifact_relative_dir(artifact_id: &str) -> PathBuf {
    let mut path = PathBuf::from("artifacts");
    path.push(slugify_local_model_id(artifact_id));
    path
}

pub fn artifact_dir(models_root: &Path, artifact_id: &str) -> PathBuf {
    models_root.join(artifact_relative_dir(artifact_id))
}

fn push_unique(values: &mut Vec<String>, value: &str) {
    if values.iter().any(|item| item == value) {
        return;
    }
    values.push(value.to_string());
}

pub fn default_artifact_roles_for_capabilities(capabilities: &[String]) -> Vec<String> {
    let mut roles = Vec::<String>::new();
    for capability in capabilities {
        if capability_is_image(capability) {
            push_unique(&mut roles, "diffusion_transformer");
            continue;
        }
        if capability_is_video(capability) {
            push_unique(&mut roles, "video_model");
            continue;
        }
        if capability_is_transcribe(capability) {
            push_unique(&mut roles, "stt_model");
            continue;
        }
        if capability_is_synthesize(capability) {
            push_unique(&mut roles, "tts_model");
            push_unique(&mut roles, "tokenizer");
            continue;
        }
        if capability_is_voice_workflow(capability) {
            push_unique(&mut roles, "voice_workflow_model");
            push_unique(&mut roles, "speech_tokenizer");
            push_unique(&mut roles, "tokenizer");
            continue;
        }
        push_unique(&mut roles, "llm");
        push_unique(&mut roles, "tokenizer");
    }
    roles
}

pub fn default_fallback_engines_for_engine(engine: &str, capabilities: &[String]) -> Vec<String> {
    let normalized = engine.trim().to_ascii_lowercase();
    if normalized == "media"
        && capabilities
            .iter()
            .any(|item| capability_is_image(item) || capability_is_video(item))
    {
        return Vec::new();
    }
    Vec::new()
}

pub fn default_endpoint_for_engine(engine: &str) -> String {
    match engine.trim().to_ascii_lowercase().as_str() {
        "media" => "http://127.0.0.1:8321".to_string(),
        "speech" => "http://127.0.0.1:8330".to_string(),
        "sidecar" => "http://127.0.0.1:8340".to_string(),
        _ => DEFAULT_LOCAL_ENDPOINT.to_string(),
    }
}

pub fn normalize_local_inventory_id(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    let lower = trimmed.to_ascii_lowercase();
    for prefix in ["local/", "llama/", "media/", "speech/", "sidecar/"] {
        if lower.starts_with(prefix) {
            let suffix = trimmed[prefix.len()..].trim();
            return if suffix.is_empty() {
                String::new()
            } else {
                format!("local/{suffix}")
            };
        }
    }
    format!("local/{trimmed}")
}

const CROCKFORD_BASE32: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // pragma: allowlist secret
static ULID_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Generates a ULID-compatible 26-character string using existing deps (sha2 + chrono).
/// Timestamp portion (10 chars) encodes milliseconds since Unix epoch.
/// Randomness portion (16 chars) is derived from sha256(timestamp + counter + pid + thread_id).
pub fn generate_ulid_string() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64;

    let mut ts_chars = [0u8; 10];
    let mut ts = millis & 0xFFFF_FFFF_FFFF;
    for i in (0..10).rev() {
        ts_chars[i] = CROCKFORD_BASE32[(ts & 0x1F) as usize];
        ts >>= 5;
    }

    let counter = ULID_COUNTER.fetch_add(1, Ordering::Relaxed);
    let pid = std::process::id();
    let thread_id = format!("{:?}", std::thread::current().id());

    let mut hasher = sha2::Sha256::new();
    hasher.update(millis.to_le_bytes());
    hasher.update(counter.to_le_bytes());
    hasher.update(pid.to_le_bytes());
    hasher.update(thread_id.as_bytes());
    let hash = hasher.finalize();

    let mut bits: u128 = 0;
    for &b in &hash[..10] {
        bits = (bits << 8) | b as u128;
    }
    let mut rand_chars = [0u8; 16];
    for i in (0..16).rev() {
        rand_chars[i] = CROCKFORD_BASE32[(bits & 0x1F) as usize];
        bits >>= 5;
    }

    let mut result = String::with_capacity(26);
    for &c in &ts_chars {
        result.push(c as char);
    }
    for &c in &rand_chars {
        result.push(c as char);
    }
    result
}

pub fn slugify_local_model_id(input: &str) -> String {
    let mut output = String::with_capacity(input.len());
    for ch in input.chars() {
        if ch.is_ascii_alphanumeric() {
            output.push(ch.to_ascii_lowercase());
            continue;
        }
        if ch == '-' || ch == '_' {
            output.push('-');
            continue;
        }
        if ch == '/' || ch == ':' || ch == '.' || ch.is_whitespace() {
            output.push('-');
        }
    }
    let compact = output
        .split('-')
        .filter(|part| !part.trim().is_empty())
        .collect::<Vec<_>>()
        .join("-");
    if compact.is_empty() {
        "local-model".to_string()
    } else {
        compact
    }
}

#[cfg(test)]
mod tests {
    use super::{
        default_artifact_roles_for_capabilities, default_endpoint_for_engine,
        default_fallback_engines_for_engine, default_logical_model_id,
        default_preferred_engine_for_capabilities, generate_ulid_string, normalize_local_engine,
        normalize_local_inventory_id, now_iso_timestamp, resolved_model_relative_dir,
        slugify_local_model_id,
    };
    use std::path::PathBuf;

    #[test]
    fn now_iso_timestamp_returns_rfc3339_millis_utc() {
        let ts = now_iso_timestamp();
        assert!(ts.ends_with('Z'));
        assert!(ts.contains('T'));
        assert!(ts.contains('.'));
    }

    #[test]
    fn slugify_local_model_id_colon_to_dash() {
        assert_eq!(
            slugify_local_model_id("hf:org/model-name"),
            "hf-org-model-name"
        );
    }

    #[test]
    fn slugify_local_model_id_slash_to_dash() {
        assert_eq!(slugify_local_model_id("org/model"), "org-model");
    }

    #[test]
    fn slugify_local_model_id_empty_returns_fallback() {
        assert_eq!(slugify_local_model_id(""), "local-model");
    }

    #[test]
    fn slugify_local_model_id_consecutive_separators_collapsed() {
        assert_eq!(slugify_local_model_id("hf:::org///model"), "hf-org-model");
    }

    #[test]
    fn slugify_local_model_id_preserves_alphanumeric_lowercase() {
        assert_eq!(slugify_local_model_id("MyModel-V2.1"), "mymodel-v2-1");
    }

    #[test]
    fn normalize_local_inventory_id_adds_local_prefix() {
        assert_eq!(
            normalize_local_inventory_id("z_image_turbo"),
            "local/z_image_turbo"
        );
    }

    #[test]
    fn normalize_local_inventory_id_preserves_runtime_native_prefixes() {
        assert_eq!(
            normalize_local_inventory_id("llama/z_image_ae"),
            "local/z_image_ae"
        );
        assert_eq!(
            normalize_local_inventory_id("speech/qwen3_4b_companion"),
            "local/qwen3_4b_companion"
        );
    }

    #[test]
    fn normalize_local_engine_accepts_only_runtime_native_provider_names() {
        assert_eq!(normalize_local_engine("llama", &[]), "llama");
        assert_eq!(normalize_local_engine("media", &[]), "media");
        assert_eq!(
            normalize_local_engine("speech", &["audio.transcribe".to_string()]),
            "speech"
        );
    }

    #[test]
    fn default_preferred_engine_routes_speech_to_speech_engine() {
        assert_eq!(
            default_preferred_engine_for_capabilities(&["audio.synthesize".to_string()]),
            "speech"
        );
        assert_eq!(
            default_preferred_engine_for_capabilities(&["image.generate".to_string()]),
            "media"
        );
    }

    #[test]
    fn default_logical_model_id_uses_runtime_native_prefix() {
        assert_eq!(
            default_logical_model_id("local/z_image_turbo"),
            "nimi/z-image-turbo"
        );
    }

    #[test]
    fn resolved_model_relative_dir_uses_resolved_namespace_layout() {
        assert_eq!(
            resolved_model_relative_dir("nimi/test-model"),
            PathBuf::from("resolved").join("nimi").join("test-model")
        );
    }

    #[test]
    fn default_artifact_roles_include_voice_workflow_roles() {
        assert_eq!(
            default_artifact_roles_for_capabilities(&["voice_workflow.tts_v2v".to_string()]),
            vec![
                "voice_workflow_model".to_string(),
                "speech_tokenizer".to_string(),
                "tokenizer".to_string()
            ]
        );
    }

    #[test]
    fn default_fallback_engines_do_not_expose_internal_media_driver() {
        assert_eq!(
            default_fallback_engines_for_engine("media", &["video.generate".to_string()]),
            Vec::<String>::new()
        );
        assert!(default_fallback_engines_for_engine("speech", &["tts".to_string()]).is_empty());
    }

    #[test]
    fn default_endpoint_for_engine_uses_canonical_ports() {
        assert_eq!(
            default_endpoint_for_engine("speech"),
            "http://127.0.0.1:8330"
        );
        assert_eq!(
            default_endpoint_for_engine("media"),
            "http://127.0.0.1:8321"
        );
    }

    #[test]
    fn generate_ulid_string_returns_26_char_crockford() {
        let ulid = generate_ulid_string();
        assert_eq!(ulid.len(), 26);
        let crockford_chars = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"; // pragma: allowlist secret
        for ch in ulid.chars() {
            assert!(crockford_chars.contains(ch), "invalid crockford char: {ch}");
        }
    }

    #[test]
    fn generate_ulid_string_successive_calls_unique() {
        let a = generate_ulid_string();
        let b = generate_ulid_string();
        assert_ne!(a, b);
    }
}
