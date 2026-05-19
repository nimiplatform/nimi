use crate::desktop_paths::{normalize_desktop_absolute_path, resolve_nimi_dir};
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
pub struct ProductReadyForUsePayload {
    pub initialization_plan_id: String,
    pub baseline_profile_ref: String,
    pub baseline_commit_id: String,
    pub account_default_profile_ref: String,
    pub built_in_ai_config_refs: Vec<String>,
    pub runtime_baseline_ref: String,
    pub execution_evidence_ref: String,
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

fn now_iso_timestamp() -> String {
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

fn read_existing_record(path: &Path) -> Result<Option<ProductControlRecord>, String> {
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
        if matches!(record.state, ProductControlState::ReadyForUse)
            && data_root.status != ProductDataRootStatus::Ready
        {
            return Err(
                "~/.nimi/nimi.json ready_for_use requires dataRoot.status=ready".to_string(),
            );
        }
    }
    if matches!(record.state, ProductControlState::ReadyForUse) {
        validate_ready_for_use_evidence(&record.first_run)?;
    }
    Ok(())
}

fn non_empty(value: &Option<String>, field: &str) -> Result<(), String> {
    if value
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .is_some()
    {
        return Ok(());
    }
    Err(format!("~/.nimi/nimi.json ready_for_use requires {field}"))
}

fn validate_ready_for_use_evidence(first_run: &ProductFirstRunRecord) -> Result<(), String> {
    if !first_run.completed {
        return Err("~/.nimi/nimi.json ready_for_use requires firstRun.completed=true".to_string());
    }
    non_empty(&first_run.completed_at, "firstRun.completedAt")?;
    non_empty(
        &first_run.initialization_plan_id,
        "firstRun.initializationPlanId",
    )?;
    non_empty(
        &first_run.baseline_profile_ref,
        "firstRun.baselineProfileRef",
    )?;
    non_empty(&first_run.baseline_commit_id, "firstRun.baselineCommitId")?;
    non_empty(
        &first_run.account_default_profile_ref,
        "firstRun.accountDefaultProfileRef",
    )?;
    non_empty(
        &first_run.runtime_baseline_ref,
        "firstRun.runtimeBaselineRef",
    )?;
    non_empty(
        &first_run.execution_evidence_ref,
        "firstRun.executionEvidenceRef",
    )?;
    if first_run.built_in_ai_config_refs.is_empty()
        || first_run
            .built_in_ai_config_refs
            .iter()
            .any(|value| value.trim().is_empty())
    {
        return Err(
            "~/.nimi/nimi.json ready_for_use requires firstRun.builtInAiConfigRefs".to_string(),
        );
    }
    Ok(())
}

fn selected_data_root_path(record: &ProductControlRecord) -> Option<PathBuf> {
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

fn write_record(path: &Path, record: &ProductControlRecord) -> Result<(), String> {
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
        Ok(Some(record)) => Ok(ProductControlRecordProjection {
            path: path.display().to_string(),
            exists: true,
            state: record.state.clone(),
            record: Some(record),
            error: None,
        }),
        Ok(None) => Ok(ProductControlRecordProjection {
            path: path.display().to_string(),
            exists: false,
            state: ProductControlState::ConfigMissing,
            record: None,
            error: None,
        }),
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
    record.first_run.install_level = Some(normalized);
    record.first_run.ai_profile_alias = ai_profile_alias
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
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

fn trim_required(value: String, field: &str) -> Result<String, String> {
    let trimmed = value.trim().to_string();
    if trimmed.is_empty() {
        return Err(format!("{field} is required"));
    }
    Ok(trimmed)
}

pub fn mark_ready_for_use(
    payload: ProductReadyForUsePayload,
) -> Result<ProductControlRecordProjection, String> {
    let control_path = product_control_record_path()?;
    let mut record = read_existing_record(&control_path)?.ok_or_else(|| {
        "~/.nimi/nimi.json is missing; select nimi_data before ready_for_use".to_string()
    })?;
    if selected_data_root_path(&record).is_none() {
        return Err("selected nimi_data is required before ready_for_use".to_string());
    }
    if record.first_run.install_level.as_deref().is_none() {
        return Err("first-run install level is required before ready_for_use".to_string());
    }
    let built_in_ai_config_refs = payload
        .built_in_ai_config_refs
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    if built_in_ai_config_refs.is_empty() {
        return Err("builtInAiConfigRefs is required".to_string());
    }
    let now_ms = now_unix_ms();
    let now_iso = now_iso_timestamp();
    if let Some(data_root) = record.data_root.as_mut() {
        ensure_data_root_layout(Path::new(&data_root.path))?;
        data_root.status = ProductDataRootStatus::Ready;
        data_root.verified_at = now_iso.clone();
        data_root.verified_at_unix_ms = now_ms;
    }
    record.first_run.completed = true;
    record.first_run.completed_at = Some(now_iso);
    record.first_run.initialization_plan_id = Some(trim_required(
        payload.initialization_plan_id,
        "initializationPlanId",
    )?);
    record.first_run.baseline_profile_ref = Some(trim_required(
        payload.baseline_profile_ref,
        "baselineProfileRef",
    )?);
    record.first_run.baseline_commit_id = Some(trim_required(
        payload.baseline_commit_id,
        "baselineCommitId",
    )?);
    record.first_run.account_default_profile_ref = Some(trim_required(
        payload.account_default_profile_ref,
        "accountDefaultProfileRef",
    )?);
    record.first_run.built_in_ai_config_refs = built_in_ai_config_refs;
    record.first_run.runtime_baseline_ref = Some(trim_required(
        payload.runtime_baseline_ref,
        "runtimeBaselineRef",
    )?);
    record.first_run.execution_evidence_ref = Some(trim_required(
        payload.execution_evidence_ref,
        "executionEvidenceRef",
    )?);
    record.state = ProductControlState::ReadyForUse;
    record.repair = ProductRepairRecord::default();
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
pub fn product_control_record_mark_ready_for_use(
    payload: ProductReadyForUsePayload,
) -> Result<ProductControlRecordProjection, String> {
    mark_ready_for_use(payload)
}

#[cfg(test)]
mod tests {
    use super::{
        mark_ready_for_use, product_control_record_path, read_product_control_projection,
        select_product_data_root, selected_product_data_root, set_first_run_install_level,
        ProductControlState, ProductReadyForUsePayload,
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

    #[test]
    fn missing_control_record_projects_config_missing() {
        let home = temp_home("missing");
        with_env(&[("HOME", home.to_str())], || {
            let projection = read_product_control_projection().expect("projection");
            assert!(!projection.exists);
            assert_eq!(projection.state, ProductControlState::ConfigMissing);
            assert_eq!(
                product_control_record_path().expect("path"),
                home.join(".nimi").join("nimi.json")
            );
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
    fn ready_for_use_requires_local_install_level_and_evidence() {
        let home = temp_home("ready");
        with_env(&[("HOME", home.to_str())], || {
            let root = home.join("chosen-nimi-data");
            select_product_data_root(root.to_str().expect("root")).expect("select root");
            let missing_install = mark_ready_for_use(ProductReadyForUsePayload {
                initialization_plan_id: "plan-1".to_string(),
                baseline_profile_ref: "profile:local-baseline".to_string(),
                baseline_commit_id: "commit-1".to_string(),
                account_default_profile_ref: "account-profile:default".to_string(),
                built_in_ai_config_refs: vec!["aiconfig:chat".to_string()],
                runtime_baseline_ref: "runtime-baseline:local".to_string(),
                execution_evidence_ref: "execution:probe-1".to_string(),
            })
            .expect_err("install level required");
            assert!(missing_install.contains("install level"));

            set_first_run_install_level("minimal", Some("local-baseline".to_string()))
                .expect("install level");
            let missing_configs = mark_ready_for_use(ProductReadyForUsePayload {
                initialization_plan_id: "plan-1".to_string(),
                baseline_profile_ref: "profile:local-baseline".to_string(),
                baseline_commit_id: "commit-1".to_string(),
                account_default_profile_ref: "account-profile:default".to_string(),
                built_in_ai_config_refs: vec![],
                runtime_baseline_ref: "runtime-baseline:local".to_string(),
                execution_evidence_ref: "execution:probe-1".to_string(),
            })
            .expect_err("ai config evidence required");
            assert!(missing_configs.contains("builtInAiConfigRefs"));

            let projection = mark_ready_for_use(ProductReadyForUsePayload {
                initialization_plan_id: "plan-1".to_string(),
                baseline_profile_ref: "profile:local-baseline".to_string(),
                baseline_commit_id: "commit-1".to_string(),
                account_default_profile_ref: "account-profile:default".to_string(),
                built_in_ai_config_refs: vec![
                    "aiconfig:chat".to_string(),
                    "aiconfig:voice".to_string(),
                ],
                runtime_baseline_ref: "runtime-baseline:local".to_string(),
                execution_evidence_ref: "execution:probe-1".to_string(),
            })
            .expect("ready");
            assert_eq!(projection.state, ProductControlState::ReadyForUse);
            let record = projection.record.expect("record");
            assert!(record.first_run.completed);
            assert_eq!(
                record.data_root.expect("data root").status,
                super::ProductDataRootStatus::Ready
            );
            assert_eq!(
                record.first_run.account_default_profile_ref.as_deref(),
                Some("account-profile:default")
            );
        });
    }
}
