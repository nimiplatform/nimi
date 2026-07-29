use super::hashing::account_default_profile_ref;
use super::types::{AccountDefaultProfileEvidence, AccountDefaultProfileRecord};
use std::fs;
use std::path::Path;

pub(crate) fn evidence_from_record(
    path: &Path,
    record: &AccountDefaultProfileRecord,
) -> Result<AccountDefaultProfileEvidence, String> {
    Ok(AccountDefaultProfileEvidence {
        account_default_profile_ref: account_default_profile_ref(record)?,
        profile_path: path.display().to_string(),
        account_id: record.account_id.clone(),
        data_root_ref: record.data_root_ref.clone(),
        profile_id: record.profile_id.clone(),
        profile_version: record.profile.ai_profile_version,
        content_hash: record.content_hash.clone(),
        source_policy_ref: record.source.policy_ref.clone(),
        source_catalog_id: record.source.catalog_id.clone(),
        source_catalog_version: record.source.catalog_version,
        created_at: record.created_at.clone(),
        updated_at: record.updated_at.clone(),
        ai_profile_alias: record.ai_profile_alias.clone(),
        profile_payload_hash: record.profile.payload_hash.clone(),
        factory_provenance_hash: record.factory_provenance_hash.clone(),
    })
}

pub(crate) fn read_profile_record(path: &Path) -> Result<AccountDefaultProfileRecord, String> {
    let raw = fs::read_to_string(path).map_err(|error| {
        format!(
            "Account Default Profile record is missing or unreadable ({}): {error}",
            path.display()
        )
    })?;
    serde_json::from_str::<AccountDefaultProfileRecord>(&raw).map_err(|error| {
        format!(
            "Account Default Profile record cannot be parsed ({}): {error}",
            path.display()
        )
    })
}

pub(crate) fn write_profile_record(
    path: &Path,
    record: &AccountDefaultProfileRecord,
) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Account Default Profile path has no parent directory".to_string())?;
    fs::create_dir_all(parent).map_err(|error| {
        format!(
            "create Account Default Profile directory failed ({}): {error}",
            parent.display()
        )
    })?;
    let raw = serde_json::to_string_pretty(record)
        .map_err(|error| format!("serialize Account Default Profile failed: {error}"))?;
    let tmp_path = path.with_extension(format!("json.tmp.{}", std::process::id()));
    fs::write(&tmp_path, raw).map_err(|error| {
        format!(
            "write Account Default Profile temporary file failed ({}): {error}",
            tmp_path.display()
        )
    })?;
    fs::rename(&tmp_path, path).map_err(|error| {
        format!(
            "commit Account Default Profile record failed ({}): {error}",
            path.display()
        )
    })
}
