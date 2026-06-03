use super::constants::{
    ACCOUNT_DEFAULT_PROFILE_DISPLAY_NAME, ACCOUNT_DEFAULT_PROFILE_ID,
    ACCOUNT_DEFAULT_PROFILE_SOURCE_KIND, ACCOUNT_PROFILE_LOCAL_LIBRARY_SOURCE,
    ACCOUNT_PROFILE_SCHEMA_VERSION, PLATFORM_AI_PROFILE_FACTORY_CATALOG_ID,
    PLATFORM_AI_PROFILE_FACTORY_CATALOG_VERSION, PLATFORM_AI_PROFILE_SELECTION_POLICY_REF,
    PROFILE_REVISION_FACTORY_SEED,
};
use super::hashing::{compute_record_hash, stable_json_hash};
use super::paths::validate_account_id;
use super::types::{
    AccountDefaultAIProfilePayload, AccountDefaultFactoryProvenance, AccountDefaultProfileBody,
    AccountDefaultProfileRecord, AccountDefaultProfileRevisionProvenance,
    AccountDefaultProfileSource,
};
use nimi_shell_tauri::platform_catalog::ai_profile_factory::PlatformAIProfileFactoryRow;

fn now_iso_timestamp() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn title_from_alias(alias: &str) -> String {
    alias
        .split('-')
        .filter(|part| !part.is_empty())
        .map(|part| {
            let mut chars = part.chars();
            match chars.next() {
                Some(first) => format!("{}{}", first.to_uppercase(), chars.as_str()),
                None => String::new(),
            }
        })
        .collect::<Vec<_>>()
        .join(" ")
}

pub(crate) fn profile_payload_from_row(
    row: &PlatformAIProfileFactoryRow,
) -> AccountDefaultAIProfilePayload {
    let mut capabilities = serde_json::Map::new();
    for capability in row.capability_set {
        let mut binding = serde_json::Map::new();
        binding.insert("binding".to_string(), serde_json::Value::Null);
        capabilities.insert(
            (*capability).to_string(),
            serde_json::Value::Object(binding),
        );
    }
    AccountDefaultAIProfilePayload {
        profile_id: ACCOUNT_DEFAULT_PROFILE_ID.to_string(),
        title: format!("Default {}", title_from_alias(row.alias)),
        description: format!(
            "Account Default Profile seeded from factory AIProfile: {}",
            row.alias
        ),
        tags: vec![
            "account-default-profile".to_string(),
            "factory-ai-profile".to_string(),
            row.alias.to_string(),
            row.privacy_posture.to_string(),
            row.compute_posture.to_string(),
            row.routing_policy.to_string(),
        ],
        capabilities,
    }
}

pub(crate) fn factory_provenance_from_row(
    row: &PlatformAIProfileFactoryRow,
) -> AccountDefaultFactoryProvenance {
    AccountDefaultFactoryProvenance {
        ai_profile_alias: row.alias.to_string(),
        privacy_posture: row.privacy_posture.to_string(),
        compute_posture: row.compute_posture.to_string(),
        capability_set: row
            .capability_set
            .iter()
            .map(|value| value.to_string())
            .collect(),
        routing_policy: row.routing_policy.to_string(),
        host_capability_profile_refs: row
            .host_capability_profile_refs
            .iter()
            .map(|value| value.to_string())
            .collect(),
        local_compute_pack_refs: row
            .local_compute_pack_refs
            .iter()
            .map(|value| value.to_string())
            .collect(),
        dependency_family_refs: row
            .dependency_family_refs
            .iter()
            .map(|value| value.to_string())
            .collect(),
        materialization_confirmation_required: row.materialization_confirmation_required,
        applicable_scopes: row
            .applicable_scopes
            .iter()
            .map(|value| value.to_string())
            .collect(),
        first_run_install_levels: row
            .first_run_install_levels
            .iter()
            .map(|value| value.to_string())
            .collect(),
        source_rule: row.source_rule.to_string(),
        source_policy_ref: PLATFORM_AI_PROFILE_SELECTION_POLICY_REF.to_string(),
        source_catalog_id: PLATFORM_AI_PROFILE_FACTORY_CATALOG_ID.to_string(),
        source_catalog_version: PLATFORM_AI_PROFILE_FACTORY_CATALOG_VERSION,
    }
}

fn factory_seed_revision(changed_at: &str) -> AccountDefaultProfileRevisionProvenance {
    AccountDefaultProfileRevisionProvenance {
        revision_kind: PROFILE_REVISION_FACTORY_SEED.to_string(),
        source: ACCOUNT_PROFILE_LOCAL_LIBRARY_SOURCE.to_string(),
        previous_content_hash: None,
        changed_at: changed_at.to_string(),
    }
}

pub(crate) fn new_profile_record(
    account_id: &str,
    data_root_ref: &str,
    install_level: &str,
    row: &PlatformAIProfileFactoryRow,
) -> Result<AccountDefaultProfileRecord, String> {
    let now = now_iso_timestamp();
    let profile_payload = profile_payload_from_row(row);
    let profile_payload_hash = stable_json_hash(
        &profile_payload,
        "Account Default Profile AIProfile payload",
    )?;
    let factory_seed_profile_payload = profile_payload.clone();
    let factory_seed_profile_payload_hash = stable_json_hash(
        &factory_seed_profile_payload,
        "Account Default Profile factory seed AIProfile payload",
    )?;
    let factory_provenance = factory_provenance_from_row(row);
    let factory_provenance_hash = stable_json_hash(
        &factory_provenance,
        "Account Default Profile factory provenance",
    )?;
    let mut record = AccountDefaultProfileRecord {
        schema_version: ACCOUNT_PROFILE_SCHEMA_VERSION,
        profile_id: ACCOUNT_DEFAULT_PROFILE_ID.to_string(),
        display_name: ACCOUNT_DEFAULT_PROFILE_DISPLAY_NAME.to_string(),
        source: AccountDefaultProfileSource {
            kind: ACCOUNT_DEFAULT_PROFILE_SOURCE_KIND.to_string(),
            policy_ref: PLATFORM_AI_PROFILE_SELECTION_POLICY_REF.to_string(),
            catalog_version: PLATFORM_AI_PROFILE_FACTORY_CATALOG_VERSION,
            catalog_id: PLATFORM_AI_PROFILE_FACTORY_CATALOG_ID.to_string(),
            catalog_row_source_rule: row.source_rule.to_string(),
        },
        editable: true,
        removable: false,
        profile: AccountDefaultProfileBody {
            ai_profile_version: 1,
            payload: profile_payload,
            payload_hash: profile_payload_hash,
        },
        updated_at: now.clone(),
        account_id: validate_account_id(account_id)?,
        data_root_ref: data_root_ref.to_string(),
        ai_profile_alias: row.alias.to_string(),
        install_level: install_level.trim().to_string(),
        capability_set: row
            .capability_set
            .iter()
            .map(|value| value.to_string())
            .collect(),
        routing_policy: row.routing_policy.to_string(),
        factory_seed_profile_payload,
        factory_seed_profile_payload_hash,
        factory_provenance,
        factory_provenance_hash,
        profile_revision: factory_seed_revision(&now),
        created_at: now,
        content_hash: String::new(),
    };
    record.content_hash = compute_record_hash(&record)?;
    Ok(record)
}
