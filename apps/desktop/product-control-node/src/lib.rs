use napi_derive::napi;
use nimi_desktop_product_control_core::{
    account_profile_library, desktop_ai_config_library,
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
