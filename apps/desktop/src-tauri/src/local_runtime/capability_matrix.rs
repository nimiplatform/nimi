use std::collections::{BTreeMap, BTreeSet};

use super::provider_adapter::{
    default_policy_gate_for_provider, default_provider_hints_for_provider_capability,
    infer_backend_hint_for_provider, probe_model_matches_capability_for_provider,
    provider_available_for_capability, provider_backend_hint_from_hints, provider_from_engine,
    resolve_adapter_for_provider, with_provider_backend_hint,
};
use super::reason_codes::{
    LOCAL_AI_ADAPTER_MISMATCH, LOCAL_AI_CAPABILITY_MISSING, LOCAL_AI_SERVICE_UNREACHABLE,
};
use super::service_artifacts::find_service_artifact;
use super::types::{
    is_runnable_asset_kind, LocalAiAssetRecord, LocalAiAssetStatus, LocalAiCapabilityMatrixEntry,
    LocalAiDeviceProfile, LocalAiNodeDescriptor, LocalAiRuntimeState, LocalAiServiceDescriptor,
    LocalAiServiceStatus,
};

fn normalize_optional(input: Option<&str>) -> Option<String> {
    input
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn service_ready(service: &LocalAiServiceDescriptor) -> bool {
    service.status == LocalAiServiceStatus::Active
        || service.status == LocalAiServiceStatus::Installed
}

fn asset_matches_capability(asset: &LocalAiAssetRecord, capability: &str) -> bool {
    asset.status != LocalAiAssetStatus::Removed
        && asset
            .capabilities
            .iter()
            .any(|item| item.trim().eq_ignore_ascii_case(capability))
}

fn asset_matches_provider(asset: &LocalAiAssetRecord, provider: &str) -> bool {
    provider_from_engine(asset.engine.as_str()).eq_ignore_ascii_case(provider)
}

fn assets_for_service_provider_capability<'a>(
    service: &LocalAiServiceDescriptor,
    assets: &'a [LocalAiAssetRecord],
    provider: &str,
    capability: &str,
) -> Vec<&'a LocalAiAssetRecord> {
    if let Some(local_model_id) = normalize_optional(service.local_model_id.as_deref()) {
        return assets
            .iter()
            .filter(|asset| {
                asset
                    .local_asset_id
                    .trim()
                    .eq_ignore_ascii_case(local_model_id.as_str())
                    && asset_matches_capability(asset, capability)
                    && asset_matches_provider(asset, provider)
            })
            .collect::<Vec<_>>();
    }

    let mut selected = assets
        .iter()
        .filter(|asset| {
            asset_matches_capability(asset, capability) && asset_matches_provider(asset, provider)
        })
        .collect::<Vec<_>>();
    selected.sort_by(|left, right| {
        left.local_asset_id
            .cmp(&right.local_asset_id)
            .then(left.asset_id.cmp(&right.asset_id))
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
        .filter(|item| {
            probe_model_matches_capability_for_provider(provider, item.as_str(), capability)
        })
        .collect::<Vec<_>>();
    selected.sort();
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

fn provider_priority(capability: &str, provider: &str) -> i32 {
    match capability.trim().to_ascii_lowercase().as_str() {
        "image" | "image.generate" | "image.edit" | "video" | "video.generate" | "i2v" => {
            match provider.trim().to_ascii_lowercase().as_str() {
                "media" => 3,
                "llama" => 2,
                "speech" => 1,
                _ => 0,
            }
        }
        "chat" | "embedding" => match provider.trim().to_ascii_lowercase().as_str() {
            "llama" => 3,
            "speech" => 1,
            _ => 0,
        },
        "stt"
        | "tts"
        | "audio.transcribe"
        | "audio.synthesize"
        | "voice_workflow.tts_v2v"
        | "voice_workflow.tts_t2v" => match provider.trim().to_ascii_lowercase().as_str() {
            "speech" => 3,
            "llama" => 1,
            _ => 0,
        },
        _ => 0,
    }
}

fn prefer_row(
    candidate: &LocalAiCapabilityMatrixEntry,
    current: &LocalAiCapabilityMatrixEntry,
) -> bool {
    if candidate.available != current.available {
        return candidate.available;
    }

    let candidate_source_rank = backend_source_rank(candidate.backend_source.as_str());
    let current_source_rank = backend_source_rank(current.backend_source.as_str());
    if candidate_source_rank != current_source_rank {
        return candidate_source_rank > current_source_rank;
    }

    let candidate_reason_rank = if candidate.reason_code.is_some() {
        0
    } else {
        1
    };
    let current_reason_rank = if current.reason_code.is_some() { 0 } else { 1 };
    if candidate_reason_rank != current_reason_rank {
        return candidate_reason_rank > current_reason_rank;
    }

    let candidate_provider_rank =
        provider_priority(candidate.capability.as_str(), candidate.provider.as_str());
    let current_provider_rank =
        provider_priority(current.capability.as_str(), current.provider.as_str());
    if candidate_provider_rank != current_provider_rank {
        return candidate_provider_rank > current_provider_rank;
    }

    let candidate_model = candidate.model_id.as_deref().unwrap_or_default();
    let current_model = current.model_id.as_deref().unwrap_or_default();
    candidate_model < current_model
}

pub fn build_capability_matrix_with_probe_and_device(
    state: &LocalAiRuntimeState,
    probe_models_by_service: &BTreeMap<String, Vec<String>>,
    _device_profile: Option<&LocalAiDeviceProfile>,
) -> Vec<LocalAiCapabilityMatrixEntry> {
    let mut output = Vec::<LocalAiCapabilityMatrixEntry>::new();
    let installed_assets = state
        .assets
        .iter()
        .filter(|asset| is_runnable_asset_kind(&asset.kind))
        .cloned()
        .collect::<Vec<_>>();

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
        let policy_gate = default_policy_gate_for_provider(provider.as_str());

        for node in artifact.nodes {
            let installed_assets_for_service = assets_for_service_provider_capability(
                service,
                installed_assets.as_slice(),
                provider.as_str(),
                node.capability.as_str(),
            );
            let mut probe_candidates = probe_models_for_capability(
                provider.as_str(),
                probe_models.as_slice(),
                node.capability.as_str(),
            );
            if !installed_assets_for_service.is_empty() {
                let installed_asset_ids = installed_assets_for_service
                    .iter()
                    .map(|item| item.asset_id.to_ascii_lowercase())
                    .collect::<BTreeSet<_>>();
                probe_candidates.retain(|item| {
                    !installed_asset_ids.contains(item.trim().to_ascii_lowercase().as_str())
                });
            }

            let mut push_entry =
                |model_id: Option<String>, model_engine: Option<String>, backend_source: &str| {
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
                    } else if !provider_available_for_capability(
                        provider.as_str(),
                        node.capability.as_str(),
                    ) {
                        available = false;
                        reason_code = Some(LOCAL_AI_CAPABILITY_MISSING.to_string());
                    } else if model_id.is_none() {
                        available = false;
                        reason_code = Some(LOCAL_AI_CAPABILITY_MISSING.to_string());
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

            if installed_assets_for_service.is_empty() && probe_candidates.is_empty() {
                push_entry(None, None, "catalog");
                continue;
            }

            for asset in &installed_assets_for_service {
                push_entry(
                    Some(asset.asset_id.clone()),
                    Some(asset.engine.clone()),
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
