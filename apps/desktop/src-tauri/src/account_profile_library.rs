use nimi_shell_tauri::capabilities::ai_profile::verify_first_run_factory_ai_profile;
use std::path::Path;

mod constants;
mod factory;
mod hashing;
mod paths;
mod record_io;
mod types;
mod validation;

use factory::new_profile_record;
pub use hashing::data_root_ref;
#[cfg(test)]
use hashing::{compute_record_hash, stable_json_hash};
pub use paths::account_default_profile_path;
use record_io::{evidence_from_record, read_profile_record, write_profile_record};
pub use types::*;
use validation::{
    is_factory_catalog_drift_error, is_reseedable_factory_profile_record, verify_record_fields,
};

#[cfg(test)]
use constants::{
    ACCOUNT_PROFILE_LOCAL_LIBRARY_SOURCE, PLATFORM_AI_PROFILE_FACTORY_CATALOG_ID,
    PLATFORM_AI_PROFILE_FACTORY_CATALOG_VERSION, PLATFORM_AI_PROFILE_SELECTION_POLICY_REF,
    PROFILE_REVISION_LOCAL_EDIT, PROFILE_REVISION_LOCAL_REPLACEMENT,
};

/// Read + verify the durable Account Default Profile record and project its
/// AIProfile payload for the AIConfig scope-init rule (P-AIPS-013 / product
/// manual "Profile And AIConfig Model").
///
/// The record's structural / hash / provenance fields are fully verified
/// against the authenticated account and selected data root before the payload
/// is returned, so a missing / tampered / wrong-account record fails closed.
pub fn read_account_default_profile_ai_profile(
    data_root: &Path,
    authenticated_account_id: &str,
) -> Result<AccountDefaultProfileAIProfile, String> {
    let path = account_default_profile_path(authenticated_account_id)?;
    let expected_data_root_ref = data_root_ref(data_root)?;
    let record = read_profile_record(&path)?;
    verify_record_fields(&record, authenticated_account_id, &expected_data_root_ref)?;
    Ok(AccountDefaultProfileAIProfile {
        profile_id: record.profile.payload.profile_id.clone(),
        version: record.profile.payload.version.clone(),
        revision: record.profile.payload.revision.clone(),
        title: record.profile.payload.title.clone(),
        description: record.profile.payload.description.clone(),
        tags: record.profile.payload.tags.clone(),
        capabilities: record.profile.payload.capabilities.clone(),
        asset_bindings: record.profile.payload.asset_bindings.clone(),
        default_params: record.profile.payload.default_params.clone(),
        editable_fields: record.profile.payload.editable_fields.clone(),
        prepare_requirements: record.profile.payload.prepare_requirements.clone(),
        contract_states: record.profile.payload.contract_states.clone(),
        projection_warnings: record.profile.payload.projection_warnings.clone(),
    })
}

pub fn verify_account_default_profile_ref(
    data_root: &Path,
    authenticated_account_id: &str,
    account_default_profile_ref: &str,
) -> Result<AccountDefaultProfileEvidence, String> {
    let path = account_default_profile_path(authenticated_account_id)?;
    let expected_data_root_ref = data_root_ref(data_root)?;
    let record = read_profile_record(&path)?;
    verify_record_fields(&record, authenticated_account_id, &expected_data_root_ref)?;
    let evidence = evidence_from_record(&path, &record)?;
    if evidence.account_default_profile_ref != account_default_profile_ref.trim() {
        return Err(
            "Account Default Profile ref is caller-provided, stale, or string-only".to_string(),
        );
    }
    Ok(evidence)
}

pub fn ensure_account_default_profile(
    data_root: &Path,
    authenticated_account_id: &str,
    selected_ai_profile_alias: &str,
    install_level: &str,
) -> Result<AccountDefaultProfileEvidence, String> {
    let path = account_default_profile_path(authenticated_account_id)?;
    let expected_data_root_ref = data_root_ref(data_root)?;
    let selected_row =
        verify_first_run_factory_ai_profile(selected_ai_profile_alias, install_level)?;
    if path.exists() {
        let record = read_profile_record(&path)?;
        if let Err(error) =
            verify_record_fields(&record, authenticated_account_id, &expected_data_root_ref)
        {
            if is_factory_catalog_drift_error(&error)
                && is_reseedable_factory_profile_record(
                    &record,
                    authenticated_account_id,
                    &expected_data_root_ref,
                )?
            {
                let next_record = new_profile_record(
                    authenticated_account_id,
                    &expected_data_root_ref,
                    install_level,
                    selected_row,
                )?;
                write_profile_record(&path, &next_record)?;
                let evidence = evidence_from_record(&path, &next_record)?;
                return verify_account_default_profile_ref(
                    data_root,
                    authenticated_account_id,
                    &evidence.account_default_profile_ref,
                );
            }
            return Err(error);
        }
        let evidence = evidence_from_record(&path, &record)?;
        return verify_account_default_profile_ref(
            data_root,
            authenticated_account_id,
            &evidence.account_default_profile_ref,
        );
    }

    let record = new_profile_record(
        authenticated_account_id,
        &expected_data_root_ref,
        install_level,
        selected_row,
    )?;
    write_profile_record(&path, &record)?;
    let evidence = evidence_from_record(&path, &record)?;
    verify_account_default_profile_ref(
        data_root,
        authenticated_account_id,
        &evidence.account_default_profile_ref,
    )
}

#[cfg(test)]
mod tests;
