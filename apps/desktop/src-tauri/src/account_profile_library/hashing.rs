use super::constants::ACCOUNT_DEFAULT_PROFILE_REF_PREFIX;
use super::types::{
    AccountDefaultAIProfilePayload, AccountDefaultFactoryProvenance, AccountDefaultProfileBody,
    AccountDefaultProfileRecord, AccountDefaultProfileRevisionProvenance,
    AccountDefaultProfileSource,
};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::path::Path;

fn sha256_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let mut out = String::with_capacity(digest.len() * 2);
    for byte in digest {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

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

fn record_hash_payload(record: &AccountDefaultProfileRecord) -> Result<Vec<u8>, String> {
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct HashPayload<'a> {
        schema_version: u32,
        profile_id: &'a str,
        display_name: &'a str,
        source: &'a AccountDefaultProfileSource,
        editable: bool,
        removable: bool,
        profile: &'a AccountDefaultProfileBody,
        updated_at: &'a str,
        account_id: &'a str,
        data_root_ref: &'a str,
        ai_profile_alias: &'a str,
        install_level: &'a str,
        capability_set: &'a [String],
        routing_policy: &'a str,
        factory_seed_profile_payload: &'a AccountDefaultAIProfilePayload,
        factory_seed_profile_payload_hash: &'a str,
        factory_provenance: &'a AccountDefaultFactoryProvenance,
        factory_provenance_hash: &'a str,
        profile_revision: &'a AccountDefaultProfileRevisionProvenance,
        created_at: &'a str,
    }

    let payload = HashPayload {
        schema_version: record.schema_version,
        profile_id: &record.profile_id,
        display_name: &record.display_name,
        source: &record.source,
        editable: record.editable,
        removable: record.removable,
        profile: &record.profile,
        updated_at: &record.updated_at,
        account_id: &record.account_id,
        data_root_ref: &record.data_root_ref,
        ai_profile_alias: &record.ai_profile_alias,
        install_level: &record.install_level,
        capability_set: &record.capability_set,
        routing_policy: &record.routing_policy,
        factory_seed_profile_payload: &record.factory_seed_profile_payload,
        factory_seed_profile_payload_hash: &record.factory_seed_profile_payload_hash,
        factory_provenance: &record.factory_provenance,
        factory_provenance_hash: &record.factory_provenance_hash,
        profile_revision: &record.profile_revision,
        created_at: &record.created_at,
    };
    serde_json::to_vec(&payload)
        .map_err(|error| format!("serialize profile hash payload failed: {error}"))
}

pub(crate) fn compute_record_hash(record: &AccountDefaultProfileRecord) -> Result<String, String> {
    Ok(format!(
        "sha256:{}",
        sha256_hex(&record_hash_payload(record)?)
    ))
}

pub(crate) fn stable_json_hash<T: Serialize>(value: &T, label: &str) -> Result<String, String> {
    let raw =
        serde_json::to_vec(value).map_err(|error| format!("serialize {label} failed: {error}"))?;
    Ok(format!("sha256:{}", sha256_hex(&raw)))
}

pub(crate) fn account_default_profile_ref(
    record: &AccountDefaultProfileRecord,
) -> Result<String, String> {
    let account_hash = sha256_hex(record.account_id.as_bytes());
    let content_hash = record
        .content_hash
        .strip_prefix("sha256:")
        .ok_or_else(|| "Account Default Profile contentHash must use sha256".to_string())?;
    Ok(format!(
        "{ACCOUNT_DEFAULT_PROFILE_REF_PREFIX}:{account_hash}:{}:{content_hash}",
        record.profile_id
    ))
}
