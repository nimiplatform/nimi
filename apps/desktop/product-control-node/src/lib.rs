use napi_derive::napi;
use nimi_desktop_product_control_core::{
    account_profile_library,
    account_profile_library::LibraryAIProfilePayload,
    desktop_ai_config_library,
    runtime_bridge::generated::{
        ExecutionBaselineCapabilityProof, ExecutionEvidenceRef, ExecutionSchedulingJudgement,
    },
};
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::Path;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AccountInput {
    data_root: String,
    account_id: String,
    #[serde(default)]
    ai_profile_alias: String,
    #[serde(default)]
    install_level: String,
    #[serde(default)]
    account_default_profile_ref: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AccountProfileLibraryInput {
    data_root: String,
    account_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AccountProfileLibraryEntryInput {
    data_root: String,
    account_id: String,
    profile: LibraryAIProfilePayload,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AccountProfileLibraryImportInput {
    data_root: String,
    account_id: String,
    profiles: Vec<LibraryAIProfilePayload>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AccountProfileLibraryExportInput {
    data_root: String,
    account_id: String,
    #[serde(default)]
    profile_ids: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AccountProfileLibraryDeleteInput {
    data_root: String,
    account_id: String,
    profile_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BuiltInInput {
    data_root: String,
    account_id: String,
    ai_profile_alias: String,
    install_level: String,
    execution_evidence: ExecutionEvidenceInput,
    #[serde(default)]
    surface_id: String,
    #[serde(default)]
    built_in_ai_config_refs: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExecutionEvidenceInput {
    execution_evidence_ref: String,
    selected_local_factory_ai_profile_ref: String,
    install_level: String,
    runtime_baseline_ref: String,
    data_root_ref: String,
    local_execution_target_evidence: Vec<String>,
    selected_baseline_capability_proof: Vec<ExecutionProofInput>,
    #[serde(default)]
    submit_specific_scheduling_judgement: Option<ExecutionSchedulingInput>,
    terminal_result: String,
    observed_at: String,
    runtime_audit_sequence: Vec<String>,
    runtime_verifier_identity: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExecutionProofInput {
    capability: String,
    scenario_type: i32,
    bound_consumer_id: String,
    bound_asset_id: String,
    local_route_target: String,
    route_policy: i32,
    model_resolved: String,
    terminal_result: String,
    reason_code: String,
    trace_id: String,
    executed_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ExecutionSchedulingInput {
    evaluated: bool,
    capability: String,
    scheduling_state: String,
    detail: String,
    evaluated_at: String,
}

#[napi(js_name = "ensureAccountDefaultProfile")]
pub fn ensure_account_default_profile(input: Value) -> Value {
    outcome(|| {
        let input: AccountInput = parse(input)?;
        account_profile_library::ensure_account_default_profile(
            Path::new(&input.data_root),
            &input.account_id,
            &input.ai_profile_alias,
            &input.install_level,
        )
    })
}

#[napi(js_name = "readAccountDefaultProfile")]
pub fn read_account_default_profile(input: Value) -> Value {
    outcome(|| {
        let input: AccountInput = parse(input)?;
        account_profile_library::read_account_default_profile_ai_profile(
            Path::new(&input.data_root),
            &input.account_id,
        )
    })
}

#[napi(js_name = "verifyAccountDefaultProfile")]
pub fn verify_account_default_profile(input: Value) -> Value {
    outcome(|| {
        let input: AccountInput = parse(input)?;
        account_profile_library::verify_account_default_profile_ref(
            Path::new(&input.data_root),
            &input.account_id,
            &input.account_default_profile_ref,
        )
    })
}

#[napi(js_name = "listAccountProfileLibrary")]
pub fn list_account_profile_library(input: Value) -> Value {
    library_outcome(|| {
        let input: AccountProfileLibraryInput = parse(input)?;
        account_profile_library::list_account_profile_library(
            Path::new(&input.data_root),
            &input.account_id,
        )
    })
}

#[napi(js_name = "createAccountProfileLibraryProfile")]
pub fn create_account_profile_library_profile(input: Value) -> Value {
    library_outcome(|| {
        let input: AccountProfileLibraryEntryInput = parse(input)?;
        account_profile_library::create_account_profile_library_entry(
            Path::new(&input.data_root),
            &input.account_id,
            input.profile,
        )
    })
}

#[napi(js_name = "editAccountProfileLibraryProfile")]
pub fn edit_account_profile_library_profile(input: Value) -> Value {
    library_outcome(|| {
        let input: AccountProfileLibraryEntryInput = parse(input)?;
        account_profile_library::edit_account_profile_library_entry(
            Path::new(&input.data_root),
            &input.account_id,
            input.profile,
        )
    })
}

#[napi(js_name = "importAccountProfileLibraryProfiles")]
pub fn import_account_profile_library_profiles(input: Value) -> Value {
    library_outcome(|| {
        let input: AccountProfileLibraryImportInput = parse(input)?;
        account_profile_library::import_account_profile_library_entries(
            Path::new(&input.data_root),
            &input.account_id,
            input.profiles,
        )
    })
}

#[napi(js_name = "exportAccountProfileLibraryProfiles")]
pub fn export_account_profile_library_profiles(input: Value) -> Value {
    library_outcome(|| {
        let input: AccountProfileLibraryExportInput = parse(input)?;
        account_profile_library::export_account_profile_library_entries(
            Path::new(&input.data_root),
            &input.account_id,
            input.profile_ids,
        )
    })
}

#[napi(js_name = "deleteAccountProfileLibraryProfile")]
pub fn delete_account_profile_library_profile(input: Value) -> Value {
    library_outcome(|| {
        let input: AccountProfileLibraryDeleteInput = parse(input)?;
        account_profile_library::delete_account_profile_library_entry(
            Path::new(&input.data_root),
            &input.account_id,
            &input.profile_id,
        )
    })
}

#[napi(js_name = "ensureBuiltInAiConfigEvidenceSet")]
pub fn ensure_built_in_ai_config_evidence_set(input: Value) -> Value {
    outcome(|| {
        let input: BuiltInInput = parse(input)?;
        let bindings = bindings(&input.execution_evidence)?;
        desktop_ai_config_library::ensure_built_in_ai_config_evidence_set(
            Path::new(&input.data_root),
            &input.account_id,
            &input.ai_profile_alias,
            &input.install_level,
            &bindings,
        )
    })
}

#[napi(js_name = "readBuiltInAiConfigForScopeInit")]
pub fn read_built_in_ai_config_for_scope_init(input: Value) -> Value {
    outcome(|| {
        let input: BuiltInInput = parse(input)?;
        let bindings = bindings(&input.execution_evidence)?;
        desktop_ai_config_library::read_built_in_ai_config_for_scope_init(
            Path::new(&input.data_root),
            &input.account_id,
            &input.surface_id,
            &input.built_in_ai_config_refs,
            &bindings,
        )
    })
}

#[napi(js_name = "verifyBuiltInAiConfigEvidenceSet")]
pub fn verify_built_in_ai_config_evidence_set(input: Value) -> Value {
    outcome(|| {
        let input: BuiltInInput = parse(input)?;
        let bindings = bindings(&input.execution_evidence)?;
        desktop_ai_config_library::verify_built_in_ai_config_evidence_set(
            Path::new(&input.data_root),
            &input.account_id,
            &input.built_in_ai_config_refs,
            Some(&bindings),
        )
    })
}

fn bindings(
    input: &ExecutionEvidenceInput,
) -> Result<Vec<desktop_ai_config_library::BuiltInAiConfigCapability>, String> {
    desktop_ai_config_library::runtime_capability_bindings_from_execution_evidence_ref(
        &execution_evidence(input),
    )
}

fn execution_evidence(input: &ExecutionEvidenceInput) -> ExecutionEvidenceRef {
    ExecutionEvidenceRef {
        execution_evidence_ref: input.execution_evidence_ref.clone(),
        selected_local_factory_ai_profile_ref: input.selected_local_factory_ai_profile_ref.clone(),
        install_level: input.install_level.clone(),
        runtime_baseline_ref: input.runtime_baseline_ref.clone(),
        data_root_ref: input.data_root_ref.clone(),
        local_execution_target_evidence: input.local_execution_target_evidence.clone(),
        selected_baseline_capability_proof: input
            .selected_baseline_capability_proof
            .iter()
            .map(|proof| ExecutionBaselineCapabilityProof {
                capability: proof.capability.clone(),
                scenario_type: proof.scenario_type,
                bound_consumer_id: proof.bound_consumer_id.clone(),
                bound_asset_id: proof.bound_asset_id.clone(),
                local_route_target: proof.local_route_target.clone(),
                route_policy: proof.route_policy,
                model_resolved: proof.model_resolved.clone(),
                terminal_result: proof.terminal_result.clone(),
                reason_code: proof.reason_code.clone(),
                trace_id: proof.trace_id.clone(),
                executed_at: proof.executed_at.clone(),
            })
            .collect(),
        submit_specific_scheduling_judgement: input
            .submit_specific_scheduling_judgement
            .as_ref()
            .map(|judgement| ExecutionSchedulingJudgement {
                evaluated: judgement.evaluated,
                capability: judgement.capability.clone(),
                scheduling_state: judgement.scheduling_state.clone(),
                detail: judgement.detail.clone(),
                evaluated_at: judgement.evaluated_at.clone(),
            }),
        terminal_result: input.terminal_result.clone(),
        observed_at: input.observed_at.clone(),
        runtime_audit_sequence: input.runtime_audit_sequence.clone(),
        runtime_verifier_identity: input.runtime_verifier_identity.clone(),
    }
}

fn parse<T: for<'de> Deserialize<'de>>(value: Value) -> Result<T, String> {
    serde_json::from_value(value)
        .map_err(|error| format!("desktop-product-control-input-invalid: {error}"))
}

fn outcome<T: serde::Serialize>(operation: impl FnOnce() -> Result<T, String>) -> Value {
    match operation() {
        Ok(value) => json!({ "status": "ok", "value": value }),
        Err(error) => json!({
            "status": "error",
            "reasonCode": reason_code(&error),
            "retryable": false,
        }),
    }
}

fn library_outcome<T: serde::Serialize>(operation: impl FnOnce() -> Result<T, String>) -> Value {
    match operation() {
        Ok(value) => json!({ "status": "ok", "value": value }),
        Err(error) => json!({
            "status": "error",
            "reasonCode": if error.contains("input-invalid") {
                "desktop-account-profile-library-input-invalid"
            } else {
                "desktop-account-profile-library-invalid"
            },
            "retryable": false,
        }),
    }
}

fn reason_code(error: &str) -> &'static str {
    let normalized = error.to_ascii_lowercase();
    if normalized.contains("mismatched")
        || normalized.contains("stale")
        || normalized.contains("tamper")
    {
        "desktop-first-run-evidence-invalid"
    } else if normalized.contains(" is missing")
        || normalized.contains("missing or unreadable")
        || normalized.contains("no such file")
    {
        "desktop-first-run-evidence-missing"
    } else if normalized.contains("input-invalid") {
        "desktop-first-run-evidence-input-invalid"
    } else {
        "desktop-first-run-evidence-invalid"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn data_root(label: &str) -> String {
        let suffix = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let path = std::env::temp_dir().join(format!("nimi-product-control-node-{label}-{suffix}"));
        std::fs::create_dir_all(&path).expect("create data root");
        path.to_string_lossy().into_owned()
    }

    fn profile(profile_id: &str, title: &str) -> Value {
        json!({
            "profileId": profile_id,
            "version": "v1",
            "title": title,
            "description": "native binding profile",
            "tags": ["test"],
            "capabilities": {
                "text.generate": {
                    "readinessPolicy": "required",
                    "contractState": "proposed"
                }
            }
        })
    }

    fn ok_value(outcome: Value) -> Value {
        assert_eq!(outcome["status"], "ok");
        outcome["value"].clone()
    }

    #[test]
    fn account_profile_library_native_binding_runs_complete_lifecycle() {
        let root = data_root("lifecycle");
        let base = || json!({ "dataRoot": root, "accountId": "account-a" });

        let listed = ok_value(list_account_profile_library(base()));
        assert_eq!(listed["profiles"].as_array().expect("profiles").len(), 0);
        assert_eq!(listed["libraryRef"], "account-profile-library:account-a");

        let created = ok_value(create_account_profile_library_profile(json!({
            "dataRoot": root,
            "accountId": "account-a",
            "profile": profile("created", "Created")
        })));
        assert_eq!(created["profiles"][0]["profile"]["title"], "Created");

        let edited = ok_value(edit_account_profile_library_profile(json!({
            "dataRoot": root,
            "accountId": "account-a",
            "profile": profile("created", "Edited")
        })));
        assert_eq!(edited["profiles"][0]["profile"]["title"], "Edited");

        let imported = ok_value(import_account_profile_library_profiles(json!({
            "dataRoot": root,
            "accountId": "account-a",
            "profiles": [profile("imported", "Imported")]
        })));
        assert_eq!(imported["profiles"].as_array().expect("profiles").len(), 2);

        let exported = ok_value(export_account_profile_library_profiles(json!({
            "dataRoot": root,
            "accountId": "account-a",
            "profileIds": ["created", "imported"]
        })));
        assert_eq!(exported.as_array().expect("exported profiles").len(), 2);

        let deleted = ok_value(delete_account_profile_library_profile(json!({
            "dataRoot": root,
            "accountId": "account-a",
            "profileId": "created"
        })));
        assert_eq!(deleted["profiles"].as_array().expect("profiles").len(), 1);
    }

    #[test]
    fn account_profile_library_native_binding_rejects_unknown_fields() {
        let root = data_root("strict");
        let outcome = create_account_profile_library_profile(json!({
            "dataRoot": root,
            "accountId": "account-a",
            "profile": {
                "profileId": "bad",
                "title": "Bad",
                "description": "bad",
                "tags": [],
                "capabilities": {},
                "rendererOwnedState": true
            }
        }));
        assert_eq!(outcome["status"], "error");
        assert_eq!(
            outcome["reasonCode"],
            "desktop-account-profile-library-input-invalid"
        );
    }
}
