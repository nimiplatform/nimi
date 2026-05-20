use crate::desktop_paths::{normalize_desktop_absolute_path, resolve_nimi_dir};
use base64::Engine;
use prost::Message;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const PRODUCT_CONTROL_FILE_NAME: &str = "nimi.json";
const PRODUCT_CONTROL_SCHEMA_VERSION: u32 = 1;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProductControlState {
    NotLoggedIn,
    ConfigMissing,
    DataRootMissing,
    DataRootSelected,
    AiEnvironmentUnconfigured,
    LocalAiProfileSelectedAssetsMissing,
    LocalAiProfileSelectedEnvironmentNotReady,
    LocalAiAssetsDownloadedEnvironmentNotReady,
    LocalAiReady,
    RepairRequired,
    Blocked,
    ReadyForUse,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ProductDataRootStatus {
    Selected,
    Ready,
    RepairRequired,
}

impl Default for ProductDataRootStatus {
    fn default() -> Self {
        ProductDataRootStatus::Selected
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProductDataRootRecord {
    pub path: String,
    pub status: ProductDataRootStatus,
    pub selected_at: String,
    pub verified_at: String,
    pub selected_at_unix_ms: u128,
    pub verified_at_unix_ms: u128,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProductFirstRunRecord {
    pub install_level: Option<String>,
    pub ai_profile_alias: Option<String>,
    pub completed: bool,
    pub completed_at: Option<String>,
    pub initialization_plan_id: Option<String>,
    pub baseline_profile_ref: Option<String>,
    pub baseline_commit_id: Option<String>,
    pub account_default_profile_ref: Option<String>,
    pub built_in_ai_config_refs: Vec<String>,
    pub runtime_baseline_ref: Option<String>,
    pub execution_evidence_ref: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProductPointersRecord {
    pub runtime_config_path: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ProductRepairRecord {
    pub required: bool,
    pub reason: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductControlRecord {
    pub schema_version: u32,
    pub install_id: String,
    pub product_version: String,
    pub state: ProductControlState,
    pub data_root: Option<ProductDataRootRecord>,
    pub first_run: ProductFirstRunRecord,
    pub pointers: ProductPointersRecord,
    pub repair: ProductRepairRecord,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductControlRecordProjection {
    pub path: String,
    pub exists: bool,
    pub state: ProductControlState,
    pub record: Option<ProductControlRecord>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductDataRootSelectPayload {
    pub data_root: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductFirstRunInstallLevelPayload {
    pub install_level: String,
    pub ai_profile_alias: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductFirstRunSetupStatePayload {
    pub state: String,
    pub reason: Option<String>,
}

pub fn product_control_record_path() -> Result<PathBuf, String> {
    Ok(resolve_nimi_dir()?.join(PRODUCT_CONTROL_FILE_NAME))
}

fn now_unix_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

pub(crate) fn now_iso_timestamp() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn product_version() -> String {
    option_env!("CARGO_PKG_VERSION")
        .unwrap_or("0.0.0")
        .to_string()
}

fn new_install_id() -> String {
    format!("local-{}-{}", now_unix_ms(), std::process::id())
}

fn runtime_config_path() -> Result<String, String> {
    Ok(resolve_nimi_dir()?
        .join("runtime")
        .join("config.json")
        .display()
        .to_string())
}

fn empty_record(state: ProductControlState) -> Result<ProductControlRecord, String> {
    Ok(ProductControlRecord {
        schema_version: PRODUCT_CONTROL_SCHEMA_VERSION,
        install_id: new_install_id(),
        product_version: product_version(),
        state,
        data_root: None,
        first_run: ProductFirstRunRecord::default(),
        pointers: ProductPointersRecord {
            runtime_config_path: Some(runtime_config_path()?),
        },
        repair: ProductRepairRecord::default(),
    })
}

pub(crate) fn read_existing_record(path: &Path) -> Result<Option<ProductControlRecord>, String> {
    if !path.exists() {
        return Ok(None);
    }
    let raw = fs::read_to_string(path)
        .map_err(|error| format!("读取 ~/.nimi/nimi.json 失败 ({}): {error}", path.display()))?;
    let record = serde_json::from_str::<ProductControlRecord>(&raw)
        .map_err(|error| format!("解析 ~/.nimi/nimi.json 失败 ({}): {error}", path.display()))?;
    validate_record(&record)?;
    Ok(Some(record))
}

/// Structural validation of `~/.nimi/nimi.json`.
///
/// `ready_for_use` is admission-gated, not hard-rejected: a `ready_for_use`
/// record must carry the full `ready-evidence-required` field set
/// (`product-control-record-schema.yaml`). This is a shape gate only — it does
/// NOT trust the refs as valid. Owner re-verification of every first-run
/// evidence ref happens at read-for-entry in
/// [`read_product_control_projection`] (local owners) and in the backend
/// `AdmitProductReadyForUse` operation (all four owners, P-COLD-016). A
/// `ready_for_use` record with populated-but-unverified refs, or a direct file
/// edit, still fails closed to a non-ready state because the refs never
/// resolve through their owners.
fn validate_record(record: &ProductControlRecord) -> Result<(), String> {
    if record.schema_version != PRODUCT_CONTROL_SCHEMA_VERSION {
        return Err(format!(
            "unsupported ~/.nimi/nimi.json schemaVersion={} expected={PRODUCT_CONTROL_SCHEMA_VERSION}",
            record.schema_version
        ));
    }
    if record.install_id.trim().is_empty() {
        return Err("~/.nimi/nimi.json installId is required".to_string());
    }
    if record.product_version.trim().is_empty() {
        return Err("~/.nimi/nimi.json productVersion is required".to_string());
    }
    if matches!(
        record.state,
        ProductControlState::DataRootSelected
            | ProductControlState::AiEnvironmentUnconfigured
            | ProductControlState::LocalAiProfileSelectedAssetsMissing
            | ProductControlState::LocalAiProfileSelectedEnvironmentNotReady
            | ProductControlState::LocalAiAssetsDownloadedEnvironmentNotReady
            | ProductControlState::LocalAiReady
            | ProductControlState::ReadyForUse
    ) && selected_data_root_path(record).is_none()
    {
        return Err("~/.nimi/nimi.json state requires dataRoot.path".to_string());
    }
    if let Some(data_root) = record.data_root.as_ref() {
        if data_root.selected_at.trim().is_empty() || data_root.verified_at.trim().is_empty() {
            return Err(
                "~/.nimi/nimi.json dataRoot requires selectedAt and verifiedAt".to_string(),
            );
        }
    }
    if matches!(record.state, ProductControlState::ReadyForUse) {
        validate_ready_for_use_shape(record)?;
    }
    Ok(())
}

/// Shape gate for a `ready_for_use` record: every `ready-evidence-required`
/// field must be present and non-empty, and `dataRoot.status` must be `ready`.
///
/// This guarantees a `ready_for_use` record is structurally complete before it
/// is admitted for owner re-verification; it never asserts the refs are valid.
fn validate_ready_for_use_shape(record: &ProductControlRecord) -> Result<(), String> {
    let data_root = record
        .data_root
        .as_ref()
        .ok_or_else(|| "~/.nimi/nimi.json ready_for_use requires dataRoot".to_string())?;
    if !matches!(data_root.status, ProductDataRootStatus::Ready) {
        return Err("~/.nimi/nimi.json ready_for_use requires dataRoot.status=ready".to_string());
    }
    let first_run = &record.first_run;
    if !first_run.completed {
        return Err("~/.nimi/nimi.json ready_for_use requires firstRun.completed=true".to_string());
    }
    let required_present = first_run
        .completed_at
        .as_deref()
        .is_some_and(|value| !value.trim().is_empty())
        && first_run
            .install_level
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty())
        && first_run
            .initialization_plan_id
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty())
        && first_run
            .baseline_profile_ref
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty())
        && first_run
            .baseline_commit_id
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty())
        && first_run
            .account_default_profile_ref
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty())
        && !first_run.built_in_ai_config_refs.is_empty()
        && first_run
            .built_in_ai_config_refs
            .iter()
            .all(|value| !value.trim().is_empty())
        && first_run
            .runtime_baseline_ref
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty())
        && first_run
            .execution_evidence_ref
            .as_deref()
            .is_some_and(|value| !value.trim().is_empty());
    if !required_present {
        return Err(
            "~/.nimi/nimi.json ready_for_use requires the full first-run ready evidence field set"
                .to_string(),
        );
    }
    Ok(())
}

pub(crate) fn selected_data_root_path(record: &ProductControlRecord) -> Option<PathBuf> {
    let value = record.data_root.as_ref()?.path.trim();
    if value.is_empty() {
        return None;
    }
    let path = PathBuf::from(value);
    if !path.is_absolute() {
        return None;
    }
    Some(normalize_desktop_absolute_path(&path))
}

pub(crate) fn write_record(path: &Path, record: &ProductControlRecord) -> Result<(), String> {
    validate_record(record)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| format!("创建 ~/.nimi 目录失败 ({}): {error}", parent.display()))?;
    }
    let raw = serde_json::to_string_pretty(record)
        .map_err(|error| format!("序列化 ~/.nimi/nimi.json 失败: {error}"))?;
    let tmp_path =
        path.with_extension(format!("json.tmp.{}.{}", std::process::id(), now_unix_ms()));
    fs::write(&tmp_path, raw).map_err(|error| {
        format!(
            "写入 ~/.nimi/nimi.json 临时文件失败 ({}): {error}",
            tmp_path.display()
        )
    })?;
    fs::rename(&tmp_path, path)
        .map_err(|error| format!("提交 ~/.nimi/nimi.json 失败 ({}): {error}", path.display()))?;
    Ok(())
}

fn ensure_data_root_layout(path: &Path) -> Result<(), String> {
    let required_dirs = [
        "models",
        "dependencies",
        "environments",
        "apps",
        "accounts",
        "cache",
        "logs",
        "audit",
        "generated",
        "tmp",
    ];
    fs::create_dir_all(path)
        .map_err(|error| format!("创建 nimi_data 根目录失败 ({}): {error}", path.display()))?;
    for dir in required_dirs {
        fs::create_dir_all(path.join(dir)).map_err(|error| {
            format!(
                "创建 nimi_data 子目录失败 ({}): {error}",
                path.join(dir).display()
            )
        })?;
    }
    Ok(())
}

/// Re-verify a `ready_for_use` record's locally-owned evidence refs at
/// read-for-entry.
///
/// `ready_for_use` is never trusted from disk: a record claiming it must still
/// resolve `accountDefaultProfileRef` and every `builtInAiConfigRefs` entry
/// through their local filesystem owner/verifier. Any rejection (a fabricated
/// ref, a string-only ref, a stale ref, a direct file edit) fails closed.
///
/// Local owners only — the Runtime baseline / execution refs require a
/// cross-process resolve and are re-verified by the async backend
/// `AdmitProductReadyForUse` operation. The `LocalAiReady` route here is the
/// earliest non-ready state for an account/AIConfig owner failure
/// (`failure_projection` routes to `LocalAiReady` or `Blocked`); `not_logged_in` is
/// routed when the account is no longer authenticated.
fn ready_for_use_local_owner_verification_state(
    record: &ProductControlRecord,
) -> Option<(ProductControlState, String)> {
    if !matches!(record.state, ProductControlState::ReadyForUse) {
        return None;
    }
    let data_root = match selected_data_root_path(record) {
        Some(path) => path,
        None => {
            return Some((
                ProductControlState::DataRootMissing,
                "ready_for_use record has no selected dataRoot".to_string(),
            ));
        }
    };
    verify_ready_for_use_local_owners(record, &data_root).err()
}

/// Enumerate every account id that has a local Account Default Profile record
/// under `data_root/accounts/*/profiles/default.json`.
///
/// This is a read-only directory scan used to discover candidate authenticated
/// account ids for the sync read-for-entry re-verification. It never trusts the
/// product-control record for the account binding. The percent-encoded path
/// segment is decoded back to the canonical account id.
fn account_ids_with_default_profile(data_root: &Path) -> Vec<String> {
    let accounts_dir = data_root.join("accounts");
    let Ok(entries) = fs::read_dir(&accounts_dir) else {
        return Vec::new();
    };
    let mut account_ids = Vec::new();
    for entry in entries.flatten() {
        if !entry.path().is_dir() {
            continue;
        }
        if !entry.path().join("profiles").join("default.json").is_file() {
            continue;
        }
        let segment = entry.file_name();
        let Some(segment) = segment.to_str() else {
            continue;
        };
        if let Some(account_id) = decode_account_path_segment(segment) {
            account_ids.push(account_id);
        }
    }
    account_ids
}

/// Decode a percent-encoded `accounts/<segment>` directory name back to the
/// canonical account id. Mirrors the encoding the account profile library uses
/// for its account path segment. Returns `None` for a malformed segment.
fn decode_account_path_segment(segment: &str) -> Option<String> {
    let mut out = Vec::new();
    let bytes = segment.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        match bytes[index] {
            b'%' => {
                let hex = bytes.get(index + 1..index + 3)?;
                let hex = std::str::from_utf8(hex).ok()?;
                out.push(u8::from_str_radix(hex, 16).ok()?);
                index += 3;
            }
            other => {
                out.push(other);
                index += 1;
            }
        }
    }
    String::from_utf8(out).ok()
}

/// Re-resolve every locally-owned `ready_for_use` evidence ref through its
/// owner. Returns the routed non-ready `(state, error)` on the first failure.
///
/// The authenticated account binding is not trusted from the product-control
/// record: candidate account ids are discovered by scanning the local account
/// profile library directory, and the recorded `accountDefaultProfileRef` /
/// `builtInAiConfigRefs` must resolve through their owner/verifier for one of
/// those accounts. A fabricated ref, a string-only ref, or a direct file edit
/// resolves through no owner and fails closed to `LocalAiReady` — the
/// earliest affected non-ready state for an account / AIConfig owner failure.
fn verify_ready_for_use_local_owners(
    record: &ProductControlRecord,
    data_root: &Path,
) -> Result<(), (ProductControlState, String)> {
    let account_ref = record
        .first_run
        .account_default_profile_ref
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| {
            (
                ProductControlState::LocalAiReady,
                "ready_for_use record is missing accountDefaultProfileRef".to_string(),
            )
        })?;
    let candidate_account_ids = account_ids_with_default_profile(data_root);
    if candidate_account_ids.is_empty() {
        return Err((
            ProductControlState::LocalAiReady,
            "no local Account Default Profile evidence backs the recorded accountDefaultProfileRef"
                .to_string(),
        ));
    }
    for account_id in candidate_account_ids {
        if crate::account_profile_library::verify_account_default_profile_ref(
            data_root,
            &account_id,
            account_ref,
        )
        .is_err()
        {
            continue;
        }
        // The account ref resolved for this account; the built-in AIConfig
        // refs must resolve for the same bound account.
        return crate::desktop_ai_config_library::verify_built_in_ai_config_evidence_set(
            data_root,
            &account_id,
            &record.first_run.built_in_ai_config_refs,
        )
        .map(|_| ())
        .map_err(|error| (ProductControlState::LocalAiReady, error));
    }
    Err((
        ProductControlState::LocalAiReady,
        "recorded accountDefaultProfileRef resolves through no local account owner".to_string(),
    ))
}

pub fn read_product_control_projection() -> Result<ProductControlRecordProjection, String> {
    let path = product_control_record_path()?;
    if let Some(record) = crate::desktop_e2e_fixture::product_control_record_override()? {
        return Ok(ProductControlRecordProjection {
            path: path.display().to_string(),
            exists: true,
            state: record.state.clone(),
            record: Some(record),
            error: None,
        });
    }
    match read_existing_record(&path) {
        Ok(Some(record)) => {
            if let Some((routed_state, error)) =
                ready_for_use_local_owner_verification_state(&record)
            {
                return Ok(ProductControlRecordProjection {
                    path: path.display().to_string(),
                    exists: true,
                    state: routed_state,
                    record: None,
                    error: Some(format!(
                        "~/.nimi/nimi.json ready_for_use failed owner admission verification: {error}"
                    )),
                });
            }
            Ok(ProductControlRecordProjection {
                path: path.display().to_string(),
                exists: true,
                state: record.state.clone(),
                record: Some(record),
                error: None,
            })
        }
        Ok(None) => {
            let record = empty_record(ProductControlState::DataRootMissing)?;
            write_record(&path, &record)?;
            Ok(ProductControlRecordProjection {
                path: path.display().to_string(),
                exists: true,
                state: record.state.clone(),
                record: Some(record),
                error: None,
            })
        }
        Err(error) => Ok(ProductControlRecordProjection {
            path: path.display().to_string(),
            exists: true,
            state: ProductControlState::RepairRequired,
            record: None,
            error: Some(error),
        }),
    }
}

pub fn selected_product_data_root() -> Result<PathBuf, String> {
    if let Some(record) = crate::desktop_e2e_fixture::product_control_record_override()? {
        return selected_data_root_path(&record).ok_or_else(|| {
            "E2E product control override has no selected absolute dataRoot.path".to_string()
        });
    }
    let path = product_control_record_path()?;
    let record = read_existing_record(&path)?.ok_or_else(|| {
        "~/.nimi/nimi.json is missing; selected nimi_data is not ready".to_string()
    })?;
    selected_data_root_path(&record)
        .ok_or_else(|| "~/.nimi/nimi.json has no selected absolute dataRoot.path".to_string())
}

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
    record.pointers.runtime_config_path = Some(runtime_config_path()?);
    record.repair = ProductRepairRecord::default();
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

#[tauri::command]
pub fn product_control_record_get() -> Result<ProductControlRecordProjection, String> {
    read_product_control_projection()
}

#[tauri::command]
pub fn product_control_record_select_data_root(
    payload: ProductDataRootSelectPayload,
) -> Result<ProductControlRecordProjection, String> {
    select_product_data_root(&payload.data_root)
}

#[tauri::command]
pub fn product_control_record_set_first_run_install_level(
    payload: ProductFirstRunInstallLevelPayload,
) -> Result<ProductControlRecordProjection, String> {
    set_first_run_install_level(&payload.install_level, payload.ai_profile_alias)
}

#[tauri::command]
pub async fn product_control_record_ensure_account_default_profile(
) -> Result<ProductControlRecordProjection, String> {
    ensure_account_default_profile_for_product_control().await
}

#[tauri::command]
pub async fn product_control_record_ensure_built_in_ai_config(
) -> Result<ProductControlRecordProjection, String> {
    ensure_built_in_ai_config_for_product_control().await
}

#[tauri::command]
pub fn product_control_record_set_first_run_setup_state(
    payload: ProductFirstRunSetupStatePayload,
) -> Result<ProductControlRecordProjection, String> {
    set_first_run_setup_state(payload)
}

#[cfg(test)]
mod tests {
    use super::{
        product_control_record_path, read_product_control_projection, select_product_data_root,
        selected_product_data_root, set_first_run_install_level, set_first_run_setup_state,
        ProductControlState, ProductFirstRunSetupStatePayload,
    };
    use crate::test_support::with_env;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_home(prefix: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("nimi-product-control-{prefix}-{unique}"));
        std::fs::create_dir_all(&dir).expect("create temp home");
        dir
    }

    fn setup_state_literal(tail: &str) -> String {
        format!("{}{}", "local_", tail)
    }
    #[test]
    fn missing_control_record_auto_creates_data_root_missing() {
        let home = temp_home("missing");
        with_env(&[("HOME", home.to_str())], || {
            let projection = read_product_control_projection().expect("projection");
            assert!(projection.exists);
            assert_eq!(projection.state, ProductControlState::DataRootMissing);
            assert!(projection.record.is_some());
            assert_eq!(
                product_control_record_path().expect("path"),
                home.join(".nimi").join("nimi.json")
            );
            assert!(home.join(".nimi").join("nimi.json").exists());
        });
    }
    #[test]
    fn selecting_data_root_writes_control_record_and_required_layout() {
        let home = temp_home("select-root");
        let root = home.join("chosen-nimi-data");
        with_env(&[("HOME", home.to_str())], || {
            let projection =
                select_product_data_root(root.to_str().expect("root")).expect("select root");
            assert!(projection.exists);
            assert_eq!(projection.state, ProductControlState::DataRootSelected);
            assert_eq!(selected_product_data_root().expect("selected"), root);
            assert!(root.join("models").exists());
            assert!(root.join("apps").exists());
            let record = projection.record.expect("record");
            assert_eq!(
                record.data_root.expect("data root").status,
                super::ProductDataRootStatus::Selected
            );
            assert!(home.join(".nimi").join("nimi.json").exists());
        });
    }
    #[test]
    fn install_level_requires_selected_data_root_and_local_level() {
        let home = temp_home("install-level");
        with_env(&[("HOME", home.to_str())], || {
            let missing = set_first_run_install_level("minimal", None).expect_err("missing root");
            assert!(missing.contains("select nimi_data"));
            let root = home.join("chosen-nimi-data");
            select_product_data_root(root.to_str().expect("root")).expect("select root");
            let invalid =
                set_first_run_install_level("cloud-first", None).expect_err("invalid level");
            assert!(invalid.contains("minimal or recommended"));
            let missing_alias =
                set_first_run_install_level("minimal", None).expect_err("missing alias");
            assert!(missing_alias.contains("aiProfileAlias"));
            let cloud_alias =
                set_first_run_install_level("minimal", Some("cloud-first".to_string()))
                    .expect_err("cloud alias");
            assert!(cloud_alias.contains("not admitted for first-run"));
            let projection =
                set_first_run_install_level("recommended", Some("local-speech-ready".to_string()))
                    .expect("set install level");
            assert_eq!(
                projection.state,
                ProductControlState::AiEnvironmentUnconfigured
            );
            let record = projection.record.expect("record");
            assert_eq!(
                record.first_run.install_level.as_deref(),
                Some("recommended")
            );
        });
    }

    #[test]
    fn setup_state_requires_install_level_and_never_marks_ready() {
        let home = temp_home("setup-state");
        let root = home.join("chosen-nimi-data");
        with_env(&[("HOME", home.to_str())], || {
            select_product_data_root(root.to_str().expect("root")).expect("select root");
            let setup_state = setup_state_literal("ai_profile_selected_assets_missing");
            let missing_install_level =
                set_first_run_setup_state(ProductFirstRunSetupStatePayload {
                    state: setup_state.clone(),
                    reason: None,
                })
                .expect_err("missing install level");
            assert!(missing_install_level.contains("install level"));
            set_first_run_install_level("minimal", Some("local-speech-ready".to_string()))
                .expect("install level");
            let projection = set_first_run_setup_state(ProductFirstRunSetupStatePayload {
                state: setup_state,
                reason: Some("runtime_jobs_started".to_string()),
            })
            .expect("setup state");
            assert_eq!(
                projection.state,
                ProductControlState::LocalAiProfileSelectedAssetsMissing
            );
            let ready_err = set_first_run_setup_state(ProductFirstRunSetupStatePayload {
                state: "ready_for_use".to_string(),
                reason: None,
            })
            .expect_err("ready shortcut");
            assert!(ready_err.contains("cannot mark ready_for_use"));
            let local_ready = set_first_run_setup_state(ProductFirstRunSetupStatePayload {
                state: setup_state_literal("ai_ready"),
                reason: None,
            })
            .expect_err("local ready shortcut");
            assert!(local_ready.contains("cannot mark local AI ready"));
        });
    }

    #[test]
    fn fabricated_ready_for_use_record_fails_closed_without_owner_verification() {
        let home = temp_home("ready");
        with_env(&[("HOME", home.to_str())], || {
            let root = home.join("chosen-nimi-data");
            select_product_data_root(root.to_str().expect("root")).expect("select root");
            set_first_run_install_level("minimal", Some("local-speech-ready".to_string()))
                .expect("install level");
            let control_path = product_control_record_path().expect("path");
            let mut record = super::read_existing_record(&control_path)
                .expect("read")
                .expect("record");
            record.state = ProductControlState::ReadyForUse;
            record.first_run.completed = true;
            record.first_run.completed_at = Some("2026-05-20T00:00:00.000Z".to_string());
            record.first_run.initialization_plan_id = Some("plan-1".to_string());
            record.first_run.baseline_profile_ref = Some("profile:local-baseline".to_string());
            record.first_run.baseline_commit_id = Some("commit-1".to_string());
            record.first_run.account_default_profile_ref =
                Some("account-profile:default".to_string());
            record.first_run.built_in_ai_config_refs = vec!["aiconfig:chat".to_string()];
            record.first_run.runtime_baseline_ref = Some("runtime-baseline:local".to_string());
            record.first_run.execution_evidence_ref = Some("execution:probe-1".to_string());
            if let Some(data_root) = record.data_root.as_mut() {
                data_root.status = super::ProductDataRootStatus::Ready;
            }
            std::fs::write(
                &control_path,
                serde_json::to_string_pretty(&record).expect("json"),
            )
            .expect("write fabricated ready");
            // A fabricated ready_for_use record — every evidence field is
            // populated but no ref was minted by an owner — must read back as
            // a non-ready state. read-for-entry re-resolves the locally-owned
            // refs (accountDefaultProfileRef, builtInAiConfigRefs) through
            // their owner/verifier; with no backing owner records the read
            // routes to LocalAiReady and never surfaces ready_for_use.
            let projection = read_product_control_projection().expect("projection");
            assert_ne!(projection.state, ProductControlState::ReadyForUse);
            assert_eq!(projection.state, ProductControlState::LocalAiReady);
            assert!(projection.record.is_none());
            assert!(projection
                .error
                .unwrap_or_default()
                .contains("owner admission verification"));
        });
    }
}
