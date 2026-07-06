use serde::Serialize;
use serde_json::json;
use std::collections::{BTreeSet, HashSet};

use crate::runtime_bridge::generated::{ExecutionEvidenceRef, RoutePolicy, ScenarioType};

const FIRST_RUN_EXECUTION_TERMINAL_READY: &str = "local_ai_ready";
const FIRST_RUN_CAPABILITY_TERMINAL_EXECUTED: &str = "local_executed";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeAiConfigCapabilityBinding {
    pub capability: String,
    pub binding: serde_json::Value,
}

fn trim(value: &str) -> String {
    value.trim().to_string()
}

fn ai_config_capability_for_scenario(scenario: ScenarioType) -> Result<&'static str, String> {
    match scenario {
        ScenarioType::TextGenerate => Ok("text.generate"),
        ScenarioType::SpeechTranscribe => Ok("audio.transcribe"),
        ScenarioType::SpeechSynthesize => Ok("audio.synthesize"),
        _ => Err(format!(
            "Runtime execution proof scenario {} is not admitted for first-run built-in AIConfig",
            scenario.as_str_name()
        )),
    }
}

pub fn project_first_run_execution_evidence_to_ai_config_bindings(
    evidence: &ExecutionEvidenceRef,
) -> Result<Vec<RuntimeAiConfigCapabilityBinding>, String> {
    let execution_evidence_ref = trim(&evidence.execution_evidence_ref);
    if execution_evidence_ref.is_empty() {
        return Err(
            "executionEvidenceRef is required for built-in AIConfig projection".to_string(),
        );
    }
    let runtime_baseline_ref = trim(&evidence.runtime_baseline_ref);
    if runtime_baseline_ref.is_empty() {
        return Err("executionEvidenceRef is missing runtimeBaselineRef".to_string());
    }
    if trim(&evidence.terminal_result) != FIRST_RUN_EXECUTION_TERMINAL_READY {
        return Err("executionEvidenceRef terminal_result is not local_ai_ready".to_string());
    }

    let mut seen = HashSet::new();
    let mut missing_floor: BTreeSet<&'static str> =
        ["audio.synthesize", "audio.transcribe", "text.generate"]
            .into_iter()
            .collect();
    let mut out = Vec::new();

    for proof in &evidence.selected_baseline_capability_proof {
        let route_policy = RoutePolicy::try_from(proof.route_policy)
            .map_err(|_| "Runtime execution proof route_policy is unknown".to_string())?;
        if route_policy != RoutePolicy::Local {
            return Err(format!(
                "Runtime execution proof for {} is not a local route",
                trim(&proof.capability)
            ));
        }
        if trim(&proof.terminal_result) != FIRST_RUN_CAPABILITY_TERMINAL_EXECUTED {
            return Err(format!(
                "Runtime execution proof for {} was not locally executed",
                trim(&proof.capability)
            ));
        }
        let scenario = ScenarioType::try_from(proof.scenario_type)
            .map_err(|_| "Runtime execution proof scenario_type is unknown".to_string())?;
        let capability = ai_config_capability_for_scenario(scenario)?;
        if !seen.insert(capability) {
            return Err(format!(
                "Runtime execution proof contains duplicate AIConfig capability {capability}"
            ));
        }

        let bound_asset_id = trim(&proof.bound_asset_id);
        if bound_asset_id.is_empty() {
            return Err(format!(
                "Runtime execution proof for {capability} is missing bound_asset_id"
            ));
        }
        let bound_consumer_id = trim(&proof.bound_consumer_id);
        if bound_consumer_id.is_empty() {
            return Err(format!(
                "Runtime execution proof for {capability} is missing bound_consumer_id"
            ));
        }
        let local_route_target = trim(&proof.local_route_target);
        if local_route_target.is_empty() {
            return Err(format!(
                "Runtime execution proof for {capability} is missing local_route_target"
            ));
        }
        let model_resolved = trim(&proof.model_resolved);
        if model_resolved.is_empty() {
            return Err(format!(
                "Runtime execution proof for {capability} is missing model_resolved"
            ));
        }
        let trace_id = trim(&proof.trace_id);
        if trace_id.is_empty() {
            return Err(format!(
                "Runtime execution proof for {capability} is missing trace_id"
            ));
        }
        missing_floor.remove(capability);
        out.push(RuntimeAiConfigCapabilityBinding {
            capability: capability.to_string(),
            binding: json!({
                "kind": "local-runtime",
                "version": "v2",
                "readinessRef": execution_evidence_ref,
                "runtime": {
                    "runtimeBaselineRef": runtime_baseline_ref,
                    "runtimeConsumerId": bound_consumer_id,
                    "boundAssetId": bound_asset_id,
                    "runtimeLocalRouteTarget": local_route_target,
                    "modelResolved": model_resolved,
                    "runtimeExecutionTraceId": trace_id,
                },
            }),
        });
    }

    if !missing_floor.is_empty() {
        return Err(format!(
            "Runtime execution proof is incomplete for first-run built-in AIConfig: missing {}",
            missing_floor.into_iter().collect::<Vec<_>>().join(",")
        ));
    }

    out.sort_by(|a, b| a.capability.cmp(&b.capability));
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::runtime_bridge::generated::ExecutionBaselineCapabilityProof;

    fn proof(
        capability: &str,
        scenario_type: ScenarioType,
        consumer_id: &str,
        asset_id: &str,
    ) -> ExecutionBaselineCapabilityProof {
        ExecutionBaselineCapabilityProof {
            capability: capability.to_string(),
            scenario_type: scenario_type as i32,
            bound_consumer_id: consumer_id.to_string(),
            bound_asset_id: asset_id.to_string(),
            local_route_target: format!("route:{consumer_id}"),
            route_policy: RoutePolicy::Local as i32,
            model_resolved: asset_id.to_string(),
            terminal_result: FIRST_RUN_CAPABILITY_TERMINAL_EXECUTED.to_string(),
            reason_code: "FIRST_RUN_EXECUTION_EVIDENCE_READY".to_string(),
            trace_id: format!("trace:{consumer_id}"),
            executed_at: "2026-01-01T00:00:00Z".to_string(),
        }
    }

    fn ready_evidence() -> ExecutionEvidenceRef {
        ExecutionEvidenceRef {
            execution_evidence_ref: "execution_evidence_test".to_string(),
            selected_local_factory_ai_profile_ref: "factory:minimal".to_string(),
            install_level: "minimal".to_string(),
            runtime_baseline_ref: "runtime-baseline:test".to_string(),
            data_root_ref: "data-root:test".to_string(),
            local_execution_target_evidence: vec!["route:llama.cpp.cpu".to_string()],
            selected_baseline_capability_proof: vec![
                proof(
                    "local_text_chat_execution",
                    ScenarioType::TextGenerate,
                    "llama.cpp.cpu",
                    "asset:text",
                ),
                proof(
                    "local_basic_stt_execution",
                    ScenarioType::SpeechTranscribe,
                    "speech.qwen3-asr.python",
                    "asset:stt",
                ),
                proof(
                    "local_basic_tts_execution",
                    ScenarioType::SpeechSynthesize,
                    "speech.qwen3-tts.python",
                    "asset:tts",
                ),
            ],
            submit_specific_scheduling_judgement: None,
            terminal_result: FIRST_RUN_EXECUTION_TERMINAL_READY.to_string(),
            observed_at: "2026-01-01T00:00:00Z".to_string(),
            runtime_audit_sequence: vec!["audit:test".to_string()],
            runtime_verifier_identity: "runtime".to_string(),
        }
    }

    #[test]
    fn projects_runtime_execution_proof_to_aiconfig_bindings() {
        let bindings =
            project_first_run_execution_evidence_to_ai_config_bindings(&ready_evidence())
                .expect("projection");
        let capabilities = bindings
            .iter()
            .map(|item| item.capability.as_str())
            .collect::<Vec<_>>();
        assert_eq!(
            capabilities,
            vec!["audio.synthesize", "audio.transcribe", "text.generate"]
        );
        let text = bindings
            .iter()
            .find(|item| item.capability == "text.generate")
            .expect("text binding");
        assert_eq!(text.binding["kind"], "local-runtime");
        assert_eq!(text.binding["version"], "v2");
        assert_eq!(text.binding["readinessRef"], "execution_evidence_test");
        assert_eq!(
            text.binding["runtime"]["runtimeBaselineRef"],
            "runtime-baseline:test"
        );
        assert_eq!(
            text.binding["runtime"]["runtimeConsumerId"],
            "llama.cpp.cpu"
        );
        assert_eq!(text.binding["runtime"]["boundAssetId"], "asset:text");
        assert_eq!(
            text.binding["runtime"]["runtimeLocalRouteTarget"],
            "route:llama.cpp.cpu"
        );
        assert_eq!(text.binding["runtime"]["modelResolved"], "asset:text");
        assert_eq!(
            text.binding["runtime"]["runtimeExecutionTraceId"],
            "trace:llama.cpp.cpu"
        );
        assert!(text.binding.get("boundAssetId").is_none());
    }

    #[test]
    fn rejects_incomplete_or_non_local_runtime_execution_proof() {
        let mut incomplete = ready_evidence();
        incomplete.selected_baseline_capability_proof.pop();
        let error = project_first_run_execution_evidence_to_ai_config_bindings(&incomplete)
            .expect_err("incomplete proof must fail");
        assert!(error.contains("incomplete"), "{error}");

        let mut cloud = ready_evidence();
        cloud.selected_baseline_capability_proof[0].route_policy = RoutePolicy::Cloud as i32;
        let error = project_first_run_execution_evidence_to_ai_config_bindings(&cloud)
            .expect_err("cloud proof must fail");
        assert!(error.contains("local route"), "{error}");
    }
}
