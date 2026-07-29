use super::{
    BuiltInChatScopeRef, BUILT_IN_AI_CONFIG_SCOPE_KIND, BUILT_IN_AI_CONFIG_SCOPE_OWNER_ID,
    BUILT_IN_CHAT_SURFACE_IDS,
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

pub(super) fn now_iso_timestamp() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

pub(super) fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut out = String::with_capacity(digest.len() * 2);
    for byte in digest {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

pub(super) fn stable_json_hash<T: Serialize>(value: &T, label: &str) -> Result<String, String> {
    let raw =
        serde_json::to_vec(value).map_err(|error| format!("serialize {label} failed: {error}"))?;
    Ok(format!("sha256:{}", sha256_hex(&raw)))
}

/// Canonical `data-root:sha256:*` ref for the selected absolute data root.
pub fn data_root_ref(data_root: &Path) -> Result<String, String> {
    if !data_root.is_absolute() {
        return Err("selected dataRootRef requires an absolute data root path".to_string());
    }
    let normalized = data_root.to_string_lossy().trim().to_string();
    if normalized.is_empty() {
        return Err("selected dataRootRef requires a non-empty data root path".to_string());
    }
    Ok(format!(
        "data-root:sha256:{}",
        sha256_hex(normalized.as_bytes())
    ))
}

pub(super) fn validate_account_id(account_id: &str) -> Result<String, String> {
    let normalized = account_id.trim();
    if normalized.is_empty() {
        return Err("authenticated Runtime account_id is required".to_string());
    }
    if normalized.contains('\0') {
        return Err("authenticated Runtime account_id contains an invalid byte".to_string());
    }
    Ok(normalized.to_string())
}

pub(super) fn account_path_segment(account_id: &str) -> String {
    let mut out = String::new();
    for byte in account_id.as_bytes() {
        match *byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' => {
                out.push(*byte as char);
            }
            other => out.push_str(&format!("%{other:02X}")),
        }
    }
    out
}

/// Reject any non-canonical surface id. Generic / merged / omitted scopes fail.
pub(super) fn validate_built_in_chat_surface_id(surface_id: &str) -> Result<String, String> {
    let normalized = surface_id.trim();
    if !BUILT_IN_CHAT_SURFACE_IDS.contains(&normalized) {
        return Err(format!(
            "built-in chat surfaceId must be one of {:?}, got: {}",
            BUILT_IN_CHAT_SURFACE_IDS, normalized
        ));
    }
    Ok(normalized.to_string())
}

/// Canonical built-in chat scope (`P-AISC-006` `feature` shape).
pub(super) fn built_in_chat_scope_ref(surface_id: &str) -> Result<BuiltInChatScopeRef, String> {
    Ok(BuiltInChatScopeRef {
        kind: BUILT_IN_AI_CONFIG_SCOPE_KIND.to_string(),
        owner_id: BUILT_IN_AI_CONFIG_SCOPE_OWNER_ID.to_string(),
        surface_id: validate_built_in_chat_surface_id(surface_id)?,
    })
}

/// Reject the generic / retired / merged / string-only scope shapes.
pub(super) fn verify_built_in_chat_scope_ref(
    scope_ref: &BuiltInChatScopeRef,
) -> Result<(), String> {
    if scope_ref.kind.trim() != BUILT_IN_AI_CONFIG_SCOPE_KIND {
        return Err(
            "built-in AIConfig scopeRef.kind must be the feature shape, not a generic app scope"
                .to_string(),
        );
    }
    if scope_ref.owner_id.trim() != BUILT_IN_AI_CONFIG_SCOPE_OWNER_ID {
        return Err(
            "built-in AIConfig scopeRef.ownerId must be the canonical desktop.chat feature owner"
                .to_string(),
        );
    }
    validate_built_in_chat_surface_id(&scope_ref.surface_id)?;
    Ok(())
}

pub(super) fn scope_path_segment(surface_id: &str) -> String {
    format!("desktop.chat.{surface_id}")
}

/// On-disk path of one scope's committed built-in `AIConfig` record.
pub fn built_in_ai_config_path(
    data_root: &Path,
    account_id: &str,
    surface_id: &str,
) -> Result<PathBuf, String> {
    let normalized_account = validate_account_id(account_id)?;
    let normalized_surface = validate_built_in_chat_surface_id(surface_id)?;
    if !data_root.is_absolute() {
        return Err("built-in AIConfig data root must be absolute".to_string());
    }
    Ok(data_root
        .join("accounts")
        .join(account_path_segment(&normalized_account))
        .join("ai-config")
        .join("built-in")
        .join(format!("{}.json", scope_path_segment(&normalized_surface))))
}
