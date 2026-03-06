use std::collections::{BTreeMap, BTreeSet};

use super::provider_adapter::{
    default_policy_gate_for_provider, default_provider_hints_for_provider_capability,
    infer_backend_hint_for_provider, nexa_capability_requires_npu, nexa_model_has_npu_candidate,
    nexa_policy_gate_allows_npu, provider_available_for_capability, provider_backend_hint_from_hints,
    provider_from_engine, probe_model_matches_capability_for_provider, resolve_adapter_for_provider,
    with_provider_backend_hint,
};
use super::reason_codes::{
    LOCAL_AI_ADAPTER_MISMATCH, LOCAL_AI_CAPABILITY_MISSING, LOCAL_AI_SERVICE_UNREACHABLE,
};
use super::service_artifacts::find_service_artifact;
use super::types::{
    LocalAiCapabilityMatrixEntry, LocalAiDeviceProfile, LocalAiModelRecord, LocalAiModelStatus,
    LocalAiNodeDescriptor, LocalAiProviderNexaHints, LocalAiRuntimeState, LocalAiServiceDescriptor,
    LocalAiServiceStatus,
};

fn normalize_optional(input: Option<&str>) -> Option<String> {
    input
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn service_ready(service: &LocalAiServiceDescriptor) -> bool {
    service.status == LocalAiServiceStatus::Active || service.status == LocalAiServiceStatus::Installed
}

fn model_matches_capability(model: &LocalAiModelRecord, capability: &str) -> bool {
    model.status != LocalAiModelStatus::Removed
        && model
            .capabilities
            .iter()
            .any(|item| item.trim().eq_ignore_ascii_case(capability))
}

fn model_matches_provider(model: &LocalAiModelRecord, provider: &str) -> bool {
    provider_from_engine(model.engine.as_str()).eq_ignore_ascii_case(provider)
}

fn models_for_service_provider_capability<'a>(
    service: &LocalAiServiceDescriptor,
    models: &'a [LocalAiModelRecord],
    provider: &str,
    capability: &str,
) -> Vec<&'a LocalAiModelRecord> {
    if let Some(local_model_id) = normalize_optional(service.local_model_id.as_deref()) {
        return models
            .iter()
            .filter(|model| {
                model
                    .local_model_id
                    .trim()
                    .eq_ignore_ascii_case(local_model_id.as_str())
                    && model_matches_capability(model, capability)
                    && model_matches_provider(model, provider)
            })
            .collect::<Vec<_>>();
    }

    let mut selected = models
        .iter()
        .filter(|model| {
            model_matches_capability(model, capability) && model_matches_provider(model, provider)
        })
        .collect::<Vec<_>>();
    selected.sort_by(|left, right| {
        left.local_model_id
            .cmp(&right.local_model_id)
            .then(left.model_id.cmp(&right.model_id))
    });
    selected
}

fn probe_models_for_capability<'a>(
    provider: &str,
    probe_models: &'a [String],
    capability: &str,
) -> Vec<&'a String> {
    let mut selected = probe_models
        .iter()
        .filter(|item| probe_model_matches_capability_for_provider(provider, item.as_str(), capability))
        .collect::<Vec<_>>();
    selected.sort_by(|left, right| left.cmp(right));
    selected
}

fn backend_source_rank(value: &str) -> i32 {
    match value.trim().to_ascii_lowercase().as_str() {
        "installed-model" => 3,
        "provider-probe" => 2,
        "catalog" => 1,
        _ => 0,
    }
}

fn prefer_row(candidate: &LocalAiCapabilityMatrixEntry, current: &LocalAiCapabilityMatrixEntry) -> bool {
    if candidate.available != current.available {
        return candidate.available;
    }

    let candidate_source_rank = backend_source_rank(candidate.backend_source.as_str());
    let current_source_rank = backend_source_rank(current.backend_source.as_str());
    if candidate_source_rank != current_source_rank {
        return candidate_source_rank > current_source_rank;
    }

    let candidate_reason_rank = if candidate.reason_code.is_some() { 0 } else { 1 };
    let current_reason_rank = if current.reason_code.is_some() { 0 } else { 1 };
    if candidate_reason_rank != current_reason_rank {
        return candidate_reason_rank > current_reason_rank;
    }

    let candidate_model = candidate.model_id.as_deref().unwrap_or_default();
    let current_model = current.model_id.as_deref().unwrap_or_default();
    candidate_model < current_model
}

#[derive(Debug, Clone)]
struct NexaGateEvidence {
    host_npu_ready: bool,
    model_probe_has_npu_candidate: bool,
    policy_gate_allows_npu: bool,
    npu_usable: bool,
    gate_reason: String,
    gate_detail: String,
}

fn nexa_gate_reason_and_detail(
    host_npu_ready: bool,
    model_probe_has_npu_candidate: bool,
    policy_gate_allows_npu: bool,
    npu_usable: bool,
) -> (String, String) {
    if npu_usable {
        return (
            "NPU_USABLE".to_string(),
            "nexa npu gate open".to_string(),
        );
    }
    if !host_npu_ready {
        return (
            "NPU_HOST_NOT_READY".to_string(),
            "hostNpuReady=false".to_string(),
        );
    }
    if !model_probe_has_npu_candidate {
        return (
            "NPU_MODEL_CANDIDATE_MISSING".to_string(),
            "modelProbeHasNpuCandidate=false".to_string(),
        );
    }
    if !policy_gate_allows_npu {
        return (
            "NPU_POLICY_DENIED".to_string(),
            "policyGateAllowsNpu=false".to_string(),
        );
    }
    (
        "NPU_GATE_UNKNOWN".to_string(),
        "nexa npu gate rejected".to_string(),
    )
}

fn nexa_gate_summary(evidence: &NexaGateEvidence) -> String {
    format!(
        "npu(hostReady={},modelCandidate={},policyAllows={},usable={})",
        evidence.host_npu_ready,
        evidence.model_probe_has_npu_candidate,
        evidence.policy_gate_allows_npu,
        evidence.npu_usable
    )
}

pub fn build_capability_matrix_with_probe_and_device(
    state: &LocalAiRuntimeState,
    probe_models_by_service: &BTreeMap<String, Vec<String>>,
    device_profile: Option<&LocalAiDeviceProfile>,
) -> Vec<LocalAiCapabilityMatrixEntry> {
    let mut output = Vec::<LocalAiCapabilityMatrixEntry>::new();

    for service in &state.services {
        if service.status == LocalAiServiceStatus::Removed {
            continue;
        }
        let Some(artifact) = find_service_artifact(service.service_id.as_str())
            .or_else(|| find_service_artifact(service.engine.as_str()))
        else {
            continue;
        };
        let provider = provider_from_engine(artifact.engine.as_str());
        let probe_models = probe_models_by_service
            .get(service.service_id.as_str())
            .cloned()
            .unwrap_or_default();
        let nexa_gate = if provider.eq_ignore_ascii_case("nexa") {
            let host_npu_ready = device_profile
                .map(|profile| profile.npu.ready)
                .unwrap_or(false);
            let model_probe_has_npu_candidate = probe_models
                .iter()
                .any(|model_id| nexa_model_has_npu_candidate(model_id.as_str()));
            let policy_gate_allows_npu = nexa_policy_gate_allows_npu();
            let npu_usable = host_npu_ready
                && model_probe_has_npu_candidate
                && policy_gate_allows_npu;
            let (gate_reason, gate_detail) = nexa_gate_reason_and_detail(
                host_npu_ready,
                model_probe_has_npu_candidate,
                policy_gate_allows_npu,
                npu_usable,
            );
            Some(NexaGateEvidence {
                host_npu_ready,
                model_probe_has_npu_candidate,
                policy_gate_allows_npu,
                npu_usable,
                gate_reason,
                gate_detail,
            })
        } else {
            None
        };
        let policy_gate = if let Some(gate) = nexa_gate.as_ref() {
            Some(nexa_gate_summary(gate))
        } else {
            default_policy_gate_for_provider(provider.as_str())
        };

        for node in artifact.nodes {
            let installed_models = models_for_service_provider_capability(
                service,
                state.models.as_slice(),
                provider.as_str(),
                node.capability.as_str(),
            );
            let mut probe_candidates = probe_models_for_capability(
                provider.as_str(),
                probe_models.as_slice(),
                node.capability.as_str(),
            );
            if !installed_models.is_empty() {
                let installed_model_ids = installed_models
                    .iter()
                    .map(|item| item.model_id.to_ascii_lowercase())
                    .collect::<BTreeSet<_>>();
                probe_candidates.retain(|item| {
                    !installed_model_ids.contains(item.trim().to_ascii_lowercase().as_str())
                });
            }

            let mut push_entry = |model_id: Option<String>,
                                  model_engine: Option<String>,
                                  backend_source: &str| {
                let mut provider_hints = default_provider_hints_for_provider_capability(
                    provider.as_str(),
                    node.capability.as_str(),
                );
                let backend = infer_backend_hint_for_provider(
                    provider.as_str(),
                    node.capability.as_str(),
                    model_id.as_deref(),
                )
                .or_else(|| {
                    provider_backend_hint_from_hints(provider.as_str(), provider_hints.as_ref())
                });
                with_provider_backend_hint(
                    provider.as_str(),
                    &mut provider_hints,
                    backend.clone(),
                    node.capability.as_str(),
                );
                if let Some(gate) = nexa_gate.as_ref() {
                    if provider_hints.is_none() {
                        provider_hints = default_provider_hints_for_provider_capability(
                            provider.as_str(),
                            node.capability.as_str(),
                        );
                    }
                    if let Some(hints) = provider_hints.as_mut() {
                        if hints.nexa.is_none() {
                            hints.nexa = Some(LocalAiProviderNexaHints::default());
                        }
                        if let Some(nexa) = hints.nexa.as_mut() {
                            nexa.policy_gate = policy_gate.clone();
                            nexa.host_npu_ready = Some(gate.host_npu_ready);
                            nexa.model_probe_has_npu_candidate =
                                Some(gate.model_probe_has_npu_candidate);
                            nexa.policy_gate_allows_npu = Some(gate.policy_gate_allows_npu);
                            nexa.npu_usable = Some(gate.npu_usable);
                            nexa.gate_reason = Some(gate.gate_reason.clone());
                            nexa.gate_detail = Some(gate.gate_detail.clone());
                        }
                    }
                }

                let (adapter, adapter_error) = match resolve_adapter_for_provider(
                    provider.as_str(),
                    node.capability.as_str(),
                    provider_hints.as_ref(),
                    None,
                ) {
                    Ok(adapter) => (adapter, None),
                    Err(error) => (
                        super::provider_adapter::default_adapter_for_provider_capability(
                            provider.as_str(),
                            node.capability.as_str(),
                        ),
                        Some(error),
                    ),
                };

                let mut available = service_ready(service);
                let mut reason_code = None::<String>;
                if let Some(error) = adapter_error {
                    available = false;
                    reason_code = Some(
                        error
                            .split(':')
                            .next()
                            .unwrap_or(LOCAL_AI_ADAPTER_MISMATCH)
                            .trim()
                            .to_string(),
                    );
                } else if !service_ready(service) {
                    available = false;
                    reason_code = Some(LOCAL_AI_SERVICE_UNREACHABLE.to_string());
                } else if !provider_available_for_capability(provider.as_str(), node.capability.as_str()) {
                    available = false;
                    reason_code = Some(LOCAL_AI_CAPABILITY_MISSING.to_string());
                } else if model_id.is_none() {
                    available = false;
                    reason_code = Some(LOCAL_AI_CAPABILITY_MISSING.to_string());
                } else if provider.eq_ignore_ascii_case("nexa")
                    && nexa_capability_requires_npu(node.capability.as_str())
                {
                    let gate_allows = nexa_gate
                        .as_ref()
                        .map(|item| item.npu_usable)
                        .unwrap_or(false);
                    if !gate_allows {
                        available = false;
                        reason_code = Some(LOCAL_AI_CAPABILITY_MISSING.to_string());
                    }
                }

                output.push(LocalAiCapabilityMatrixEntry {
                    service_id: service.service_id.clone(),
                    node_id: node.node_id.clone(),
                    capability: node.capability.clone(),
                    provider: provider.clone(),
                    model_id,
                    model_engine,
                    backend,
                    backend_source: backend_source.to_string(),
                    adapter,
                    available,
                    reason_code,
                    provider_hints,
                    policy_gate: policy_gate.clone(),
                });
            };

            if installed_models.is_empty() && probe_candidates.is_empty() {
                push_entry(None, None, "catalog");
                continue;
            }

            for model in &installed_models {
                push_entry(
                    Some(model.model_id.clone()),
                    Some(model.engine.clone()),
                    "installed-model",
                );
            }

            for probe_model in &probe_candidates {
                push_entry(
                    Some((*probe_model).clone()),
                    Some(format!("{}-probe", provider)),
                    "provider-probe",
                );
            }
        }
    }

    output.sort_by(|left, right| {
        left.provider
            .cmp(&right.provider)
            .then(left.service_id.cmp(&right.service_id))
            .then(left.capability.cmp(&right.capability))
            .then(left.node_id.cmp(&right.node_id))
            .then(left.model_id.cmp(&right.model_id))
    });
    output
}

pub fn refresh_state_capability_matrix_with_probe_and_device(
    state: &mut LocalAiRuntimeState,
    probe_models_by_service: &BTreeMap<String, Vec<String>>,
    device_profile: Option<&LocalAiDeviceProfile>,
) {
    state.capability_matrix = build_capability_matrix_with_probe_and_device(
        state,
        probe_models_by_service,
        device_profile,
    );
}

fn matches_filter(value: &str, filter: Option<&str>) -> bool {
    match filter {
        None => true,
        Some(expected) => value.trim().eq_ignore_ascii_case(expected.trim()),
    }
}

pub fn list_nodes_from_matrix(
    matrix: &[LocalAiCapabilityMatrixEntry],
    capability: Option<&str>,
    service_id: Option<&str>,
    provider: Option<&str>,
) -> Vec<LocalAiNodeDescriptor> {
    let mut by_node = BTreeMap::<String, LocalAiCapabilityMatrixEntry>::new();

    for row in matrix {
        if !matches_filter(row.capability.as_str(), capability) {
            continue;
        }
        if !matches_filter(row.service_id.as_str(), service_id) {
            continue;
        }
        if !matches_filter(row.provider.as_str(), provider) {
            continue;
        }
        let key = format!("{}::{}::{}", row.provider, row.service_id, row.node_id);
        if let Some(existing) = by_node.get_mut(&key) {
            if prefer_row(row, existing) {
                *existing = row.clone();
            }
            continue;
        }
        by_node.insert(key, row.clone());
    }

    let mut output = by_node
        .into_values()
        .map(|row| LocalAiNodeDescriptor {
            node_id: row.node_id.clone(),
            title: row.node_id.clone(),
            service_id: row.service_id.clone(),
            capabilities: vec![row.capability.clone()],
            provider: row.provider.clone(),
            adapter: row.adapter.clone(),
            backend: row.backend.clone(),
            backend_source: normalize_optional(Some(row.backend_source.as_str())),
            available: row.available,
            reason_code: row.reason_code.clone(),
            provider_hints: row.provider_hints.clone(),
            policy_gate: row.policy_gate.clone(),
            api_path: None,
            input_schema: None,
            output_schema: None,
            read_only: true,
        })
        .collect::<Vec<_>>();

    output.sort_by(|left, right| {
        left.provider
            .cmp(&right.provider)
            .then(left.node_id.cmp(&right.node_id))
            .then(left.service_id.cmp(&right.service_id))
    });
    output
}
