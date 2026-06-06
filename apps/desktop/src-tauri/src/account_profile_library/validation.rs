use super::constants::{
    ACCOUNT_DEFAULT_PROFILE_ID, ACCOUNT_DEFAULT_PROFILE_SOURCE_KIND,
    ACCOUNT_PROFILE_LOCAL_LIBRARY_SOURCE, ACCOUNT_PROFILE_SCHEMA_VERSION,
    PLATFORM_AI_PROFILE_FACTORY_CATALOG_ID, PLATFORM_AI_PROFILE_FACTORY_CATALOG_VERSION,
    PLATFORM_AI_PROFILE_SELECTION_POLICY_REF, PROFILE_REVISION_FACTORY_SEED,
    PROFILE_REVISION_LOCAL_EDIT, PROFILE_REVISION_LOCAL_REPLACEMENT,
};
use super::factory::{factory_provenance_from_row, profile_payload_from_row};
use super::hashing::{compute_record_hash, stable_json_hash};
use super::paths::validate_account_id;
use super::types::{AccountDefaultAIProfilePayload, AccountDefaultProfileRecord};
use nimi_shell_tauri::platform_catalog::ai_profile_factory::{
    verify_first_run_factory_ai_profile, PlatformAIProfileFactoryRow,
};

const FORBIDDEN_AI_PROFILE_FIELD_NAMES: &[&str] = &[
    "RuntimeRouteBinding",
    "selectedBindings",
    "selected_source_records",
    "selectedSourceRecords",
    "install_evidence",
    "installEvidence",
    "materialization_evidence",
    "materializationEvidence",
    "workflow_binding_id",
    "workflowBindingId",
    "prepared_asset_id",
    "preparedAssetId",
    "backend_environment_evidence",
    "backendEnvironmentEvidence",
    "provider_health",
    "providerHealth",
    "scheduler_state",
    "schedulerState",
    "credential_payload",
    "credentialPayload",
    "secret",
    "token",
    "apiKey",
    "api_key",
    "oauth",
    "endpoint",
    "localModelId",
    "goRuntimeLocalModelId",
    "goRuntimeStatus",
    "providerHints",
    "binding",
    "localProfileRef",
    "localProfileRefs",
];

fn is_path_like_string(value: &str) -> bool {
    let trimmed = value.trim();
    trimmed.starts_with('/')
        || trimmed.starts_with('~')
        || trimmed.starts_with("file://")
        || trimmed.contains("\\")
        || trimmed.contains("/Users/")
        || trimmed.contains("/tmp/")
        || trimmed.contains("/var/")
        || (trimmed.len() > 2
            && trimmed.as_bytes()[1] == b':'
            && (trimmed.as_bytes()[2] == b'/' || trimmed.as_bytes()[2] == b'\\'))
}

fn validate_no_forbidden_payload_fields(
    value: &serde_json::Value,
    path: &str,
) -> Result<(), String> {
    match value {
        serde_json::Value::String(text) => {
            if is_path_like_string(text) {
                return Err(format!(
                    "{path} must be a portable non-path logical ref in Account Default Profile AIProfile payload"
                ));
            }
        }
        serde_json::Value::Array(items) => {
            for (index, item) in items.iter().enumerate() {
                validate_no_forbidden_payload_fields(item, &format!("{path}[{index}]"))?;
            }
        }
        serde_json::Value::Object(record) => {
            for (key, child) in record {
                if FORBIDDEN_AI_PROFILE_FIELD_NAMES.contains(&key.as_str()) {
                    return Err(format!(
                        "{path}.{key} is forbidden in Account Default Profile AIProfile payload"
                    ));
                }
                validate_no_forbidden_payload_fields(child, &format!("{path}.{key}"))?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn validate_optional_string_vec(values: &Option<Vec<String>>, label: &str) -> Result<(), String> {
    if let Some(values) = values {
        if values.iter().any(|value| value.trim().is_empty()) {
            return Err(format!("{label} must contain only non-empty strings"));
        }
    }
    Ok(())
}

fn validate_basic_ai_profile_payload_shape(
    payload: &AccountDefaultAIProfilePayload,
) -> Result<(), String> {
    if payload.profile_id != ACCOUNT_DEFAULT_PROFILE_ID {
        return Err(
            "Account Default Profile AIProfile payload profileId must be default".to_string(),
        );
    }
    if payload.title.trim().is_empty() {
        return Err("Account Default Profile AIProfile payload title is required".to_string());
    }
    if payload.tags.iter().any(|tag| tag.trim().is_empty()) {
        return Err(
            "Account Default Profile AIProfile payload tags must be non-empty strings".to_string(),
        );
    }
    if payload.capabilities.is_empty() {
        return Err(
            "Account Default Profile AIProfile payload capabilities are required".to_string(),
        );
    }
    for (capability, value) in &payload.capabilities {
        if capability.trim().is_empty() {
            return Err(
                "Account Default Profile AIProfile payload capability id is required".to_string(),
            );
        }
        if !value.is_object() {
            return Err(
                "Account Default Profile AIProfile payload capability entries must be objects"
                    .to_string(),
            );
        }
    }
    Ok(())
}

fn validate_sdk_ai_profile_payload(payload: &AccountDefaultAIProfilePayload) -> Result<(), String> {
    validate_basic_ai_profile_payload_shape(payload)?;
    let value = serde_json::to_value(payload).map_err(|error| {
        format!("Account Default Profile AIProfile payload cannot serialize: {error}")
    })?;
    validate_no_forbidden_payload_fields(&value, "profile")?;
    for (capability, value) in &payload.capabilities {
        let intent = value.as_object().expect("validated object");
        if let Some(policy) = intent.get("readinessPolicy") {
            if policy.as_str() != Some("required") && policy.as_str() != Some("optional") {
                return Err(format!(
                    "Account Default Profile AIProfile payload capability {capability} readinessPolicy is invalid"
                ));
            }
        }
        if let Some(contract_state) = intent.get("contractState") {
            if contract_state.as_str() != Some("declared")
                && contract_state.as_str() != Some("proposed")
                && contract_state.as_str() != Some("unsupported")
            {
                return Err(format!(
                    "Account Default Profile AIProfile payload capability {capability} contractState is invalid"
                ));
            }
        }
    }
    if let Some(default_params) = &payload.default_params {
        if !default_params.is_object() {
            return Err(
                "Account Default Profile AIProfile payload defaultParams must be an object"
                    .to_string(),
            );
        }
    }
    validate_optional_string_vec(
        &payload.editable_fields,
        "Account Default Profile AIProfile payload editableFields",
    )?;
    validate_optional_string_vec(
        &payload.prepare_requirements,
        "Account Default Profile AIProfile payload prepareRequirements",
    )?;
    validate_optional_string_vec(
        &payload.contract_states,
        "Account Default Profile AIProfile payload contractStates",
    )?;
    validate_optional_string_vec(
        &payload.projection_warnings,
        "Account Default Profile AIProfile payload projectionWarnings",
    )?;
    Ok(())
}

fn verify_profile_revision(
    record: &AccountDefaultProfileRecord,
    factory_seed_payload: &AccountDefaultAIProfilePayload,
) -> Result<(), String> {
    if record.profile_revision.source != ACCOUNT_PROFILE_LOCAL_LIBRARY_SOURCE {
        return Err("Account Default Profile revision provenance source is invalid".to_string());
    }
    if record.profile_revision.changed_at.trim().is_empty()
        || record.profile_revision.changed_at != record.updated_at
    {
        return Err("Account Default Profile revision timestamp is missing or stale".to_string());
    }
    let payload_is_factory_seed = record.profile.payload == *factory_seed_payload;
    match record.profile_revision.revision_kind.as_str() {
        PROFILE_REVISION_FACTORY_SEED => {
            if !payload_is_factory_seed || record.profile.ai_profile_version != 1 {
                return Err(
                    "Account Default Profile factory seed revision cannot carry edited payload"
                        .to_string(),
                );
            }
            if record.profile_revision.previous_content_hash.is_some() {
                return Err(
                    "Account Default Profile factory seed revision cannot carry previous hash"
                        .to_string(),
                );
            }
        }
        PROFILE_REVISION_LOCAL_EDIT | PROFILE_REVISION_LOCAL_REPLACEMENT => {
            if record.profile.ai_profile_version <= 1 || record.updated_at == record.created_at {
                return Err("Account Default Profile local edit/replacement requires advanced version and updated timestamp".to_string());
            }
            let Some(previous_hash) = record.profile_revision.previous_content_hash.as_deref()
            else {
                return Err(
                    "Account Default Profile local edit/replacement requires previous content hash"
                        .to_string(),
                );
            };
            if !previous_hash.starts_with("sha256:") {
                return Err(
                    "Account Default Profile local edit/replacement previous hash must use sha256"
                        .to_string(),
                );
            }
        }
        _ => {
            return Err("Account Default Profile revision kind is invalid".to_string());
        }
    }
    Ok(())
}

fn row_from_record(
    record: &AccountDefaultProfileRecord,
) -> Result<&'static PlatformAIProfileFactoryRow, String> {
    let row = verify_first_run_factory_ai_profile(&record.ai_profile_alias, &record.install_level)?;
    if row.source_rule != record.source.catalog_row_source_rule {
        return Err("Account Default Profile source catalog row source rule mismatch".to_string());
    }
    Ok(row)
}

pub(crate) fn verify_record_fields(
    record: &AccountDefaultProfileRecord,
    authenticated_account_id: &str,
    expected_data_root_ref: &str,
) -> Result<(), String> {
    let account_id = validate_account_id(authenticated_account_id)?;
    if record.schema_version != ACCOUNT_PROFILE_SCHEMA_VERSION {
        return Err("Account Default Profile schemaVersion is unsupported".to_string());
    }
    if record.profile_id != ACCOUNT_DEFAULT_PROFILE_ID {
        return Err("Account Default Profile profileId must be default".to_string());
    }
    if record.display_name.trim().is_empty() {
        return Err("Account Default Profile displayName is required".to_string());
    }
    if !record.editable {
        return Err("Account Default Profile editable must be true".to_string());
    }
    if record.removable {
        return Err("Account Default Profile removable must be false".to_string());
    }
    if record.account_id != account_id {
        return Err(
            "Account Default Profile account_id does not match authenticated Runtime account"
                .to_string(),
        );
    }
    if record.data_root_ref != expected_data_root_ref {
        return Err(
            "Account Default Profile dataRootRef does not match selected data root".to_string(),
        );
    }
    if record.profile.ai_profile_version == 0 {
        return Err("Account Default Profile profile version is required".to_string());
    }
    if record.source.kind != ACCOUNT_DEFAULT_PROFILE_SOURCE_KIND {
        return Err("Account Default Profile source kind must be factory-policy".to_string());
    }
    if record.source.policy_ref != PLATFORM_AI_PROFILE_SELECTION_POLICY_REF {
        return Err(
            "Account Default Profile source policy ref is missing or unresolvable".to_string(),
        );
    }
    if record.source.catalog_id != PLATFORM_AI_PROFILE_FACTORY_CATALOG_ID
        || record.source.catalog_version != PLATFORM_AI_PROFILE_FACTORY_CATALOG_VERSION
    {
        return Err(
            "Account Default Profile source catalog version is missing or unresolvable".to_string(),
        );
    }
    if record.created_at.trim().is_empty() || record.updated_at.trim().is_empty() {
        return Err("Account Default Profile createdAt/updatedAt evidence is required".to_string());
    }
    let row = row_from_record(record)?;
    validate_sdk_ai_profile_payload(&record.profile.payload)?;
    let expected_payload_hash = stable_json_hash(
        &record.profile.payload,
        "Account Default Profile AIProfile payload",
    )?;
    if record.profile.payload_hash != expected_payload_hash {
        return Err(
            "Account Default Profile profile payload hash is missing or mismatched".to_string(),
        );
    }
    let expected_seed_payload = profile_payload_from_row(row);
    if record.factory_seed_profile_payload != expected_seed_payload {
        return Err(
            "Account Default Profile factory seed AIProfile payload is missing or mismatched"
                .to_string(),
        );
    }
    let expected_seed_payload_hash = stable_json_hash(
        &record.factory_seed_profile_payload,
        "Account Default Profile factory seed AIProfile payload",
    )?;
    if record.factory_seed_profile_payload_hash != expected_seed_payload_hash {
        return Err(
            "Account Default Profile factory seed payload hash is missing or mismatched"
                .to_string(),
        );
    }
    verify_profile_revision(record, &expected_seed_payload)?;
    let expected_provenance = factory_provenance_from_row(row);
    if record.factory_provenance != expected_provenance {
        return Err(
            "Account Default Profile factory provenance is missing or mismatched".to_string(),
        );
    }
    let expected_provenance_hash = stable_json_hash(
        &record.factory_provenance,
        "Account Default Profile factory provenance",
    )?;
    if record.factory_provenance_hash != expected_provenance_hash {
        return Err(
            "Account Default Profile factory provenance hash is missing or mismatched".to_string(),
        );
    }
    let expected_hash = compute_record_hash(record)?;
    if record.content_hash != expected_hash {
        return Err("Account Default Profile content hash is missing or mismatched".to_string());
    }
    let row_capabilities = row
        .capability_set
        .iter()
        .map(|value| value.to_string())
        .collect::<Vec<_>>();
    if record.capability_set != row_capabilities {
        return Err("Account Default Profile source catalog capability set mismatch".to_string());
    }
    if record.routing_policy != row.routing_policy {
        return Err("Account Default Profile source catalog routing policy mismatch".to_string());
    }
    Ok(())
}

pub(crate) fn is_reseedable_factory_profile_record(
    record: &AccountDefaultProfileRecord,
    authenticated_account_id: &str,
    expected_data_root_ref: &str,
) -> Result<bool, String> {
    let account_id = validate_account_id(authenticated_account_id)?;
    if record.schema_version != ACCOUNT_PROFILE_SCHEMA_VERSION
        || record.profile_id != ACCOUNT_DEFAULT_PROFILE_ID
        || record.account_id != account_id
        || record.data_root_ref != expected_data_root_ref
        || record.source.kind != ACCOUNT_DEFAULT_PROFILE_SOURCE_KIND
        || record.source.policy_ref != PLATFORM_AI_PROFILE_SELECTION_POLICY_REF
        || record.source.catalog_id != PLATFORM_AI_PROFILE_FACTORY_CATALOG_ID
        || record.source.catalog_version != PLATFORM_AI_PROFILE_FACTORY_CATALOG_VERSION
    {
        return Ok(false);
    }
    let Ok(row) = row_from_record(record) else {
        return Ok(false);
    };
    if row.source_rule != record.source.catalog_row_source_rule {
        return Ok(false);
    }
    if record.profile.ai_profile_version != 1
        || record.profile.payload != record.factory_seed_profile_payload
        || record.profile_revision.revision_kind != PROFILE_REVISION_FACTORY_SEED
        || record.profile_revision.source != ACCOUNT_PROFILE_LOCAL_LIBRARY_SOURCE
        || record.profile_revision.previous_content_hash.is_some()
        || record.profile_revision.changed_at.trim().is_empty()
        || record.profile_revision.changed_at != record.updated_at
    {
        return Ok(false);
    }
    validate_basic_ai_profile_payload_shape(&record.profile.payload)?;
    if record.profile.payload_hash
        != stable_json_hash(
            &record.profile.payload,
            "Account Default Profile AIProfile payload",
        )?
    {
        return Ok(false);
    }
    if record.factory_seed_profile_payload_hash
        != stable_json_hash(
            &record.factory_seed_profile_payload,
            "Account Default Profile factory seed AIProfile payload",
        )?
    {
        return Ok(false);
    }
    if record.factory_provenance_hash
        != stable_json_hash(
            &record.factory_provenance,
            "Account Default Profile factory provenance",
        )?
    {
        return Ok(false);
    }
    if record.content_hash != compute_record_hash(record)? {
        return Ok(false);
    }
    Ok(true)
}

pub(crate) fn is_factory_catalog_drift_error(error: &str) -> bool {
    error.contains("factory seed AIProfile payload")
        || error.contains("factory seed payload hash")
        || error.contains("factory provenance")
        || error.contains("source catalog capability set")
        || error.contains("source catalog routing policy")
        || error.contains("forbidden in Account Default Profile AIProfile payload")
}
