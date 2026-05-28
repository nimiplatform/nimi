//! Product-control record (`~/.nimi/nimi.json`) — the first-run / Apps
//! lifecycle truth surface.
//!
//! Split by responsibility into cohesive submodules; this module root composes
//! them and exposes the stable Tauri command surface. The backend
//! `AdmitProductReadyForUse` admission operation lives in the sibling
//! `desktop_product_control_admission` module.

mod operations;
mod paths;
mod pointers;
mod projection;
mod ready_verification;
mod record;
mod record_store;

pub use operations::*;
pub use paths::*;
pub use projection::*;
pub use record::*;
pub(crate) use record_store::*;

#[tauri::command]
pub async fn product_control_record_get() -> Result<ProductControlRecordProjection, String> {
    let projection = read_product_control_projection()?;
    if matches!(projection.state, ProductControlState::ReadyForUse) {
        return crate::desktop_product_control_admission::admit_product_ready_for_use(
            &crate::desktop_product_control_admission::BridgeAdmissionRuntimeResolvers,
        )
        .await;
    }
    Ok(projection)
}

#[tauri::command]
pub fn product_control_record_select_data_root(
    payload: ProductDataRootSelectPayload,
) -> Result<ProductControlRecordProjection, String> {
    select_product_data_root(&payload.data_root)
}

/// Opens the OS native directory picker so the first-run Storage phase can
/// resolve an absolute `nimi_data` folder without a raw path text field.
///
/// This command only resolves a path; it does not mutate the product-control
/// record. The renderer passes the returned absolute path to
/// `product_control_record_select_data_root`, which owns recording and
/// fail-closed validation (`P-COLD-010`). `Ok(None)` means the user cancelled
/// the dialog — that is a normal, non-error outcome.
#[tauri::command]
pub fn product_control_pick_data_root_directory() -> Result<Option<String>, String> {
    let start_dir = dirs::home_dir().unwrap_or_else(std::env::temp_dir);
    let selected = rfd::FileDialog::new()
        .set_directory(&start_dir)
        .set_title("Choose where Nimi stores models and data")
        .pick_folder();
    Ok(selected.map(|path| path.to_string_lossy().to_string()))
}

/// Resolves the OS-conventional default `nimi_data` directory the first-run
/// Storage phase pre-fills as the recommended location.
///
/// This is a read-only proposal: it neither creates the directory nor mutates
/// the product-control record. The renderer pre-fills the returned absolute
/// path so the Storage phase never starts from an empty field, and the user
/// still explicitly confirms it through `product_control_record_select_data_root`,
/// which owns recording and fail-closed validation (`P-COLD-010`).
#[tauri::command]
pub fn product_control_default_data_root_directory() -> Result<String, String> {
    Ok(crate::desktop_paths::default_data_root_proposal()?
        .display()
        .to_string())
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
pub async fn product_control_record_prepare_first_run_local_ai_ready(
) -> Result<ProductControlRecordProjection, String> {
    prepare_first_run_local_ai_ready_for_product_control().await
}

#[tauri::command]
pub async fn account_default_profile_for_scope_init(
) -> Result<crate::account_profile_library::AccountDefaultProfileAIProfile, String> {
    read_account_default_profile_for_scope_init().await
}

#[tauri::command]
pub async fn built_in_ai_config_for_scope_init(
    payload: ProductBuiltInAiConfigScopePayload,
) -> Result<crate::desktop_ai_config_library::BuiltInAiConfigForScopeInit, String> {
    read_built_in_ai_config_for_scope_init(&payload.surface_id).await
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
    fn stale_data_root_record_routes_repair_required_without_recreating_pointers() {
        // Cross-layer acceptance (manual scenario 5 + the migration gate): an
        // existing product-control record with a stale / corrupt shape — here a
        // record that selected a data root but no longer carries the
        // dataRoot.path the state requires — must route to repair_required and
        // must NOT be silently replaced with a fresh data_root_missing record.
        // Silently recreating the pointers would orphan the user's existing
        // data root. read-for-entry fails closed: state=repair_required,
        // record=None, and the on-disk file is left byte-for-byte intact for
        // the admitted repair flow.
        let home = temp_home("stale-data-root");
        with_env(&[("HOME", home.to_str())], || {
            let root = home.join("chosen-nimi-data");
            select_product_data_root(root.to_str().expect("root")).expect("select root");
            set_first_run_install_level("minimal", Some("local-speech-ready".to_string()))
                .expect("install level");
            let control_path = product_control_record_path().expect("path");

            // Corrupt the record into a stale shape: a data-root-bearing state
            // with the dataRoot pointer dropped. validate_record rejects this,
            // so read-for-entry must route to repair_required.
            let mut record = serde_json::from_str::<serde_json::Value>(
                &std::fs::read_to_string(&control_path).expect("read record"),
            )
            .expect("parse record");
            record
                .as_object_mut()
                .expect("object")
                .insert("dataRoot".to_string(), serde_json::Value::Null);
            let stale_raw = serde_json::to_string_pretty(&record).expect("json");
            std::fs::write(&control_path, &stale_raw).expect("write stale record");

            let projection = read_product_control_projection().expect("projection");
            assert_eq!(projection.state, ProductControlState::RepairRequired);
            // The migration gate does not hand back a recreated record.
            assert!(projection.record.is_none());
            assert!(projection
                .error
                .clone()
                .unwrap_or_default()
                .contains("dataRoot.path"));
            // The on-disk file is untouched — no silent pointer recreation that
            // would orphan the user's selected data root.
            let after_raw = std::fs::read_to_string(&control_path).expect("read after");
            assert_eq!(after_raw, stale_raw);
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
