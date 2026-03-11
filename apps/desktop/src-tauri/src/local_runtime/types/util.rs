use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use chrono::SecondsFormat;
use sha2::Digest;

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
    use super::{generate_ulid_string, now_iso_timestamp, slugify_local_model_id};

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
