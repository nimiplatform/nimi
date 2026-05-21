//! Product-control mutating operations: data-root selection, first-run install
//! level / setup state, the account-default-profile and built-in-AIConfig
//! ensure paths, and the authenticated Runtime account resolution they share.

use base64::Engine;
use prost::Message;
use std::path::{Path, PathBuf};

use crate::desktop_paths::normalize_desktop_absolute_path;

use super::paths::{now_iso_timestamp, now_unix_ms, product_control_record_path};
use super::pointers::resolve_product_pointers;
use super::projection::read_product_control_projection;
use super::record::{
    ProductControlRecordProjection, ProductControlState, ProductDataRootRecord,
    ProductDataRootStatus, ProductFirstRunSetupStatePayload, ProductRepairRecord,
};
use super::record_store::{
    empty_record, ensure_data_root_layout, read_existing_record, selected_data_root_path,
    write_record,
};

pub fn select_product_data_root(path: &str) -> Result<ProductControlRecordProjection, String> {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return Err("nimi_data path is required".to_string());
    }
    let candidate = PathBuf::from(trimmed);
    if !candidate.is_absolute() {
        return Err(format!("nimi_data path must be absolute, got: {trimmed}"));
    }
    let normalized = normalize_desktop_absolute_path(&candidate);
    ensure_data_root_layout(&normalized)?;
    let control_path = product_control_record_path()?;
    let mut record = read_existing_record(&control_path)?
        .unwrap_or(empty_record(ProductControlState::DataRootMissing)?);
    let now = now_unix_ms();
    record.state = ProductControlState::DataRootSelected;
    record.data_root = Some(ProductDataRootRecord {
        path: normalized.display().to_string(),
        status: ProductDataRootStatus::Selected,
        selected_at: now_iso_timestamp(),
        verified_at: now_iso_timestamp(),
        selected_at_unix_ms: now,
        verified_at_unix_ms: now,
    });
    record.pointers = resolve_product_pointers()?;
    record.repair = ProductRepairRecord::default();
    write_record(&control_path, &record)?;
    read_product_control_projection()
}

/// Commit a `nimi_data` data-root pointer cutover for the `P-MIG-007`
/// migration flow.
///
/// Unlike [`select_product_data_root`], this is NOT a first-run selection: it
/// is the last atomic step of a completed-and-verified data-root migration. It
/// rewrites only the `dataRoot.path` (and the discovery `pointers`) on the
/// existing record and preserves every `firstRun` evidence field, the product
/// `state`, and the `installId` — moving the data root must not reset
/// first-run progress.
///
/// `P-MIG-007` "pointer commit last": the caller (the migration flow) only
/// invokes this after the data has been copied to `new_data_root` and the
/// integrity check passed. It requires an existing record that already has a
/// selected data root — a migration has no meaning before first-run data-root
/// selection. The new path must be absolute and must already exist on disk
/// (the migration created it); a non-existent target fails closed so the
/// pointer can never advertise a directory that is not there.
pub fn migrate_product_data_root_pointer(
    new_data_root: &str,
) -> Result<ProductControlRecordProjection, String> {
    let trimmed = new_data_root.trim();
    if trimmed.is_empty() {
        return Err("nimi_data migration target path is required".to_string());
    }
    let candidate = PathBuf::from(trimmed);
    if !candidate.is_absolute() {
        return Err(format!(
            "nimi_data migration target path must be absolute, got: {trimmed}"
        ));
    }
    let normalized = normalize_desktop_absolute_path(&candidate);
    if !normalized.is_dir() {
        return Err(format!(
            "nimi_data migration target does not exist on disk: {}",
            normalized.display()
        ));
    }
    let control_path = product_control_record_path()?;
    let mut record = read_existing_record(&control_path)?.ok_or_else(|| {
        "~/.nimi/nimi.json is missing; a data-root migration requires an existing record"
            .to_string()
    })?;
    let data_root = record.data_root.as_mut().ok_or_else(|| {
        "~/.nimi/nimi.json has no selected data root; nothing to migrate".to_string()
    })?;
    let now = now_unix_ms();
    data_root.path = normalized.display().to_string();
    // The data root is freshly verified by the migration integrity check.
    data_root.verified_at = now_iso_timestamp();
    data_root.verified_at_unix_ms = now;
    record.pointers = resolve_product_pointers()?;
    write_record(&control_path, &record)?;
    read_product_control_projection()
}

pub fn set_first_run_install_level(
    install_level: &str,
    ai_profile_alias: Option<String>,
) -> Result<ProductControlRecordProjection, String> {
    let normalized = install_level.trim().to_lowercase();
    if normalized != "minimal" && normalized != "recommended" {
        return Err("first-run install level must be minimal or recommended".to_string());
    }
    let control_path = product_control_record_path()?;
    let mut record = read_existing_record(&control_path)?.ok_or_else(|| {
        "~/.nimi/nimi.json is missing; select nimi_data before install level".to_string()
    })?;
    if selected_data_root_path(&record).is_none() {
        return Err("selected nimi_data is required before install level".to_string());
    }
    let normalized_alias = ai_profile_alias
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let alias = normalized_alias
        .as_deref()
        .ok_or_else(|| "first-run aiProfileAlias is required".to_string())?;
    crate::platform_ai_profile_factory_catalog::verify_first_run_factory_ai_profile(
        alias,
        &normalized,
    )?;
    record.first_run.install_level = Some(normalized);
    record.first_run.ai_profile_alias = Some(alias.to_string());
    record.first_run.completed = false;
    record.first_run.completed_at = None;
    record.first_run.initialization_plan_id = None;
    record.first_run.baseline_profile_ref = None;
    record.first_run.baseline_commit_id = None;
    record.first_run.account_default_profile_ref = None;
    record.first_run.built_in_ai_config_refs = Vec::new();
    record.first_run.runtime_baseline_ref = None;
    record.first_run.execution_evidence_ref = None;
    if matches!(record.state, ProductControlState::DataRootSelected) {
        record.state = ProductControlState::AiEnvironmentUnconfigured;
    }
    write_record(&control_path, &record)?;
    read_product_control_projection()
}

pub(crate) async fn authenticated_runtime_account_id() -> Result<String, String> {
    let request = crate::runtime_bridge::generated::GetAccountSessionStatusRequest { caller: None };
    let payload = crate::runtime_bridge::RuntimeBridgeUnaryPayload {
        method_id: "/nimi.runtime.v1.RuntimeAccountService/GetAccountSessionStatus".to_string(),
        request_bytes_base64: base64::engine::general_purpose::STANDARD
            .encode(request.encode_to_vec()),
        metadata: None,
        authorization: None,
        protected_access_token: None,
        app_session: None,
        timeout_ms: Some(10_000),
    };
    let result = crate::runtime_bridge::runtime_bridge_unary(payload).await?;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(result.response_bytes_base64.trim())
        .map_err(|_| "RuntimeAccountService response could not be decoded".to_string())?;
    let response =
        crate::runtime_bridge::generated::GetAccountSessionStatusResponse::decode(bytes.as_slice())
            .map_err(|error| format!("RuntimeAccountService response was invalid: {error}"))?;
    if response.state != crate::runtime_bridge::generated::AccountSessionState::Authenticated as i32
    {
        return Err("authenticated Runtime account session is required".to_string());
    }
    let account_id = response
        .account_projection
        .as_ref()
        .map(|projection| projection.account_id.trim().to_string())
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            "authenticated Runtime account session did not include account_id".to_string()
        })?;
    Ok(account_id)
}

pub async fn ensure_account_default_profile_for_product_control(
) -> Result<ProductControlRecordProjection, String> {
    let control_path = product_control_record_path()?;
    let mut record = read_existing_record(&control_path)?.ok_or_else(|| {
        "~/.nimi/nimi.json is missing; select nimi_data before Account Default Profile".to_string()
    })?;
    let data_root = selected_data_root_path(&record).ok_or_else(|| {
        "selected nimi_data is required before Account Default Profile".to_string()
    })?;
    let install_level = record
        .first_run
        .install_level
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            "first-run install level is required before Account Default Profile".to_string()
        })?
        .to_string();
    let ai_profile_alias = record
        .first_run
        .ai_profile_alias
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            "first-run aiProfileAlias is required before Account Default Profile".to_string()
        })?
        .to_string();
    crate::platform_ai_profile_factory_catalog::verify_first_run_factory_ai_profile(
        &ai_profile_alias,
        &install_level,
    )?;
    let account_id = authenticated_runtime_account_id().await?;
    let evidence = crate::account_profile_library::ensure_account_default_profile(
        &data_root,
        &account_id,
        &ai_profile_alias,
        &install_level,
    )?;
    record.first_run.account_default_profile_ref =
        Some(evidence.account_default_profile_ref.clone());
    write_record(&control_path, &record)?;
    read_product_control_projection()
}

/// Read + verify the Account Default Profile and project it as a portable
/// AIProfile payload for the Desktop host AIConfig scope-init rule
/// (product manual "Profile And AIConfig Model").
///
/// A new AIConfig scope initializes its config from the Account Default
/// Profile ONLY when no prior AIConfig exists for that scope; the renderer
/// reads this projection for that one-time initialization. It is the verified
/// content of the durable `default.json` record — never realm session or
/// app-local state.
pub async fn read_account_default_profile_for_scope_init(
) -> Result<crate::account_profile_library::AccountDefaultProfileAIProfile, String> {
    let control_path = product_control_record_path()?;
    let record = read_existing_record(&control_path)?.ok_or_else(|| {
        "~/.nimi/nimi.json is missing; select nimi_data before Account Default Profile".to_string()
    })?;
    let data_root = selected_data_root_path(&record).ok_or_else(|| {
        "selected nimi_data is required before Account Default Profile".to_string()
    })?;
    let account_id = authenticated_runtime_account_id().await?;
    crate::account_profile_library::read_account_default_profile_ai_profile(
        &data_root,
        &account_id,
    )
}

pub async fn ensure_built_in_ai_config_for_product_control(
) -> Result<ProductControlRecordProjection, String> {
    let control_path = product_control_record_path()?;
    let mut record = read_existing_record(&control_path)?.ok_or_else(|| {
        "~/.nimi/nimi.json is missing; select nimi_data before built-in AIConfig".to_string()
    })?;
    let data_root = selected_data_root_path(&record)
        .ok_or_else(|| "selected nimi_data is required before built-in AIConfig".to_string())?;
    let install_level = record
        .first_run
        .install_level
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            "first-run install level is required before built-in AIConfig".to_string()
        })?
        .to_string();
    let ai_profile_alias = record
        .first_run
        .ai_profile_alias
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            "first-run aiProfileAlias is required before built-in AIConfig".to_string()
        })?
        .to_string();
    crate::platform_ai_profile_factory_catalog::verify_first_run_factory_ai_profile(
        &ai_profile_alias,
        &install_level,
    )?;
    let account_id = authenticated_runtime_account_id().await?;
    let evidence_set = crate::desktop_ai_config_library::ensure_built_in_ai_config_evidence_set(
        &data_root,
        &account_id,
        &ai_profile_alias,
        &install_level,
    )?;
    record.first_run.built_in_ai_config_refs = evidence_set.refs();
    write_record(&control_path, &record)?;
    read_product_control_projection()
}

/// Resolve + verify the recorded `builtInAiConfigRefs` through the Desktop host
/// AIConfig service for the backend `AdmitProductReadyForUse` operation.
///
/// This is the seam admission step 6 calls. It does NOT write `ready_for_use`.
/// Fails closed when either canonical built-in chat scope cannot be resolved,
/// when the recorded set is partial, or when a string-only ref is supplied.
///
/// `data_root` and `authenticated_account_id` are the inputs the caller has
/// already resolved through their owners earlier in the `P-COLD-016`
/// composition (selected `nimi_data` and the authenticated Runtime account
/// session). They are passed in so this seam does not re-resolve the account
/// binding — admission owns a single authenticated account resolution.
pub fn resolve_built_in_ai_config_refs_for_admission(
    data_root: &Path,
    authenticated_account_id: &str,
    built_in_ai_config_refs: &[String],
) -> Result<crate::desktop_ai_config_library::BuiltInAiConfigEvidenceSet, String> {
    crate::desktop_ai_config_library::verify_built_in_ai_config_evidence_set(
        data_root,
        authenticated_account_id,
        built_in_ai_config_refs,
    )
}

fn parse_first_run_setup_state(value: &str) -> Result<ProductControlState, String> {
    let quoted = serde_json::to_string(value.trim())
        .map_err(|error| format!("failed to parse first-run setup state: {error}"))?;
    let parsed = serde_json::from_str::<ProductControlState>(&quoted).map_err(|_| {
        "first-run setup state must be a non-ready local setup, repair, or blocked state"
            .to_string()
    })?;
    match parsed {
        ProductControlState::LocalAiProfileSelectedAssetsMissing
        | ProductControlState::LocalAiProfileSelectedEnvironmentNotReady
        | ProductControlState::LocalAiAssetsDownloadedEnvironmentNotReady
        | ProductControlState::RepairRequired
        | ProductControlState::Blocked => Ok(parsed),
        ProductControlState::LocalAiReady => {
            Err(
                "first-run setup state cannot mark local AI ready without Runtime admission verification"
                    .to_string(),
            )
        }
        ProductControlState::ReadyForUse => {
            Err("first-run setup state cannot mark ready_for_use".to_string())
        }
        _ => Err(
            "first-run setup state must be a non-ready local setup, repair, or blocked state"
                .to_string(),
        ),
    }
}

pub fn set_first_run_setup_state(
    payload: ProductFirstRunSetupStatePayload,
) -> Result<ProductControlRecordProjection, String> {
    let setup_state = parse_first_run_setup_state(&payload.state)?;
    let control_path = product_control_record_path()?;
    let mut record = read_existing_record(&control_path)?.ok_or_else(|| {
        "~/.nimi/nimi.json is missing; select nimi_data before Runtime setup state".to_string()
    })?;
    if selected_data_root_path(&record).is_none() {
        return Err("selected nimi_data is required before Runtime setup state".to_string());
    }
    if record.first_run.install_level.as_deref().is_none() {
        return Err("first-run install level is required before Runtime setup state".to_string());
    }
    record.state = setup_state.clone();
    let reason = payload
        .reason
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if matches!(
        setup_state,
        ProductControlState::RepairRequired | ProductControlState::Blocked
    ) {
        record.repair = ProductRepairRecord {
            required: true,
            reason,
        };
        if let Some(data_root) = record.data_root.as_mut() {
            data_root.status = ProductDataRootStatus::RepairRequired;
        }
    } else {
        record.repair = ProductRepairRecord::default();
    }
    write_record(&control_path, &record)?;
    read_product_control_projection()
}
