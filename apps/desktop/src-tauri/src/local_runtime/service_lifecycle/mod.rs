use super::service_artifacts::{find_service_artifact, service_artifact_registry};
use super::types::{
    now_iso_timestamp, LocalAiDependencyKind, LocalAiDeviceProfile, LocalAiPreflightDecision,
    LocalAiServiceArtifactType, LocalAiServiceDescriptor, LocalAiServiceStatus,
};
mod managed;

use self::managed::{
    bootstrap_marker_provider, build_service_health_url,
    default_loopback_endpoint_for_artifact, is_loopback_endpoint, maybe_authenticate_request,
    normalize_non_empty, parse_version_parts, port_available, resolve_effective_endpoint,
    managed_provider_strategy,
};
pub use self::managed::{is_managed_service, start_managed_service, stop_managed_service};

pub fn normalize_service_descriptor(descriptor: &mut LocalAiServiceDescriptor) {
    let Some(artifact) = find_service_artifact(descriptor.service_id.as_str())
        .or_else(|| find_service_artifact(descriptor.engine.as_str()))
    else {
        return;
    };
    if descriptor.engine.trim().is_empty() {
        descriptor.engine = artifact.engine.clone();
    }
    if descriptor.artifact_type.is_none() {
        descriptor.artifact_type = Some(artifact.artifact_type.clone());
    }
    if descriptor
        .endpoint
        .as_deref()
        .unwrap_or_default()
        .trim()
        .is_empty()
        && artifact.artifact_type == LocalAiServiceArtifactType::AttachedEndpoint
    {
        descriptor.endpoint = Some(default_loopback_endpoint_for_artifact(&artifact));
    }
}

fn evaluate_preflight_check(
    check: &str,
    reason_code: &str,
    params: Option<&serde_json::Value>,
    endpoint: Option<&str>,
    profile: &LocalAiDeviceProfile,
) -> LocalAiPreflightDecision {
    let normalized = check.trim().to_ascii_lowercase();
    if normalized == "python-version" {
        let min_version = params
            .and_then(|value| value.get("minVersion"))
            .and_then(|value| value.as_str())
            .unwrap_or("3.10");
        let has_python = profile.python.available;
        let current = profile.python.version.clone().unwrap_or_default();
        let ok = has_python
            && match (
                parse_version_parts(current.as_str()),
                parse_version_parts(min_version),
            ) {
                (Some((major, minor)), Some((min_major, min_minor))) => {
                    major > min_major || (major == min_major && minor >= min_minor)
                }
                _ => false,
            };
        return LocalAiPreflightDecision {
            dependency_id: None,
            target: "service".to_string(),
            check: check.to_string(),
            ok,
            reason_code: if ok {
                "LOCAL_AI_PREFLIGHT_OK".to_string()
            } else {
                reason_code.to_string()
            },
            detail: if ok {
                format!("python-version check passed: current={current}, min={min_version}")
            } else {
                format!("python-version check failed: current={current}, min={min_version}")
            },
        };
    }
    if normalized == "nvidia-gpu" {
        let vendor = profile.gpu.vendor.clone().unwrap_or_default();
        let ok = profile.gpu.available && vendor.to_ascii_lowercase().contains("nvidia");
        return LocalAiPreflightDecision {
            dependency_id: None,
            target: "service".to_string(),
            check: check.to_string(),
            ok,
            reason_code: if ok {
                "LOCAL_AI_PREFLIGHT_OK".to_string()
            } else {
                reason_code.to_string()
            },
            detail: if ok {
                format!(
                    "nvidia-gpu check passed: vendor={}, model={}",
                    vendor,
                    profile.gpu.model.clone().unwrap_or_default()
                )
            } else {
                format!(
                    "nvidia-gpu check failed: vendor={}, available={}",
                    vendor, profile.gpu.available
                )
            },
        };
    }
    if normalized == "port-available" {
        let port = params
            .and_then(|value| value.get("port"))
            .and_then(|value| value.as_u64())
            .unwrap_or(0) as u16;
        let ok = port > 0 && port_available(profile, port);
        return LocalAiPreflightDecision {
            dependency_id: None,
            target: "service".to_string(),
            check: check.to_string(),
            ok,
            reason_code: if ok {
                "LOCAL_AI_PREFLIGHT_OK".to_string()
            } else {
                reason_code.to_string()
            },
            detail: if ok {
                format!("port-available check passed: port={port}")
            } else {
                format!("port-available check failed: port={port}")
            },
        };
    }
    if normalized == "disk-space" {
        let min_bytes = params
            .and_then(|value| value.get("minBytes"))
            .and_then(|value| value.as_u64())
            .unwrap_or(0);
        let ok = profile.disk_free_bytes >= min_bytes;
        return LocalAiPreflightDecision {
            dependency_id: None,
            target: "service".to_string(),
            check: check.to_string(),
            ok,
            reason_code: if ok {
                "LOCAL_AI_PREFLIGHT_OK".to_string()
            } else {
                reason_code.to_string()
            },
            detail: if ok {
                format!(
                    "disk-space check passed: freeBytes={} requiredBytes={min_bytes}",
                    profile.disk_free_bytes
                )
            } else {
                format!(
                    "disk-space check failed: freeBytes={} requiredBytes={min_bytes}",
                    profile.disk_free_bytes
                )
            },
        };
    }
    if normalized == "endpoint-loopback" {
        let endpoint = normalize_non_empty(endpoint).unwrap_or_default();
        let ok = is_loopback_endpoint(endpoint.as_str());
        return LocalAiPreflightDecision {
            dependency_id: None,
            target: "service".to_string(),
            check: check.to_string(),
            ok,
            reason_code: if ok {
                "LOCAL_AI_PREFLIGHT_OK".to_string()
            } else {
                reason_code.to_string()
            },
            detail: if ok {
                format!("endpoint-loopback check passed: endpoint={endpoint}")
            } else if endpoint.is_empty() {
                "endpoint-loopback check failed: endpoint is required".to_string()
            } else {
                format!("endpoint-loopback check failed: endpoint={endpoint}")
            },
        };
    }

    LocalAiPreflightDecision {
        dependency_id: None,
        target: "service".to_string(),
        check: check.to_string(),
        ok: true,
        reason_code: "LOCAL_AI_PREFLIGHT_OK".to_string(),
        detail: "unknown preflight check skipped".to_string(),
    }
}

pub fn preflight_service_artifact(
    dependency_id: Option<&str>,
    service_id: &str,
    endpoint: Option<&str>,
    profile: &LocalAiDeviceProfile,
) -> Result<Vec<LocalAiPreflightDecision>, String> {
    let artifact = find_service_artifact(service_id)
        .ok_or_else(|| format!("LOCAL_AI_SERVICE_ARTIFACT_NOT_FOUND: serviceId={service_id}"))?;
    let effective_endpoint = resolve_effective_endpoint(&artifact, endpoint);
    let mut decisions = Vec::<LocalAiPreflightDecision>::new();
    for rule in artifact.preflight {
        let mut decision = evaluate_preflight_check(
            rule.check.as_str(),
            rule.reason_code.as_str(),
            rule.params.as_ref(),
            effective_endpoint.as_deref(),
            profile,
        );
        decision.dependency_id = dependency_id.map(|value| value.to_string());
        decisions.push(decision);
    }
    Ok(decisions)
}

pub fn resolve_node_host_service(node_id: &str) -> Option<(String, String)> {
    let normalized_node_id = node_id.trim();
    if normalized_node_id.is_empty() {
        return None;
    }
    for artifact in service_artifact_registry() {
        for node in artifact.nodes {
            if node.node_id.trim().eq_ignore_ascii_case(normalized_node_id) {
                return Some((artifact.service_id, node.capability));
            }
        }
    }
    None
}

pub fn preflight_dependency(
    dependency_id: Option<&str>,
    kind: &LocalAiDependencyKind,
    service_id: Option<&str>,
    engine: Option<&str>,
    node_id: Option<&str>,
    workflow_id: Option<&str>,
    profile: &LocalAiDeviceProfile,
) -> Result<Vec<LocalAiPreflightDecision>, String> {
    if *kind == LocalAiDependencyKind::Service {
        let service_id = normalize_non_empty(service_id).ok_or_else(|| {
            "LOCAL_AI_DEPENDENCY_SERVICE_ID_MISSING: selected service dependency missing serviceId"
                .to_string()
        })?;
        return preflight_service_artifact(dependency_id, service_id.as_str(), None, profile);
    }

    if *kind == LocalAiDependencyKind::Model {
        let engine = normalize_non_empty(engine).unwrap_or_else(|| "localai".to_string());
        if let Some(artifact) = find_service_artifact(engine.as_str()) {
            return preflight_service_artifact(
                dependency_id,
                artifact.service_id.as_str(),
                None,
                profile,
            );
        }
    }

    if *kind == LocalAiDependencyKind::Node {
        let node_id = normalize_non_empty(node_id).ok_or_else(|| {
            "LOCAL_AI_DEPENDENCY_NODE_ID_MISSING: selected node dependency missing nodeId"
                .to_string()
        })?;
        let mapped_service = resolve_node_host_service(node_id.as_str());
        let resolved_service_id = if let Some(explicit_service_id) = normalize_non_empty(service_id)
        {
            if let Some((artifact_service_id, _)) = mapped_service.as_ref() {
                if !artifact_service_id.eq_ignore_ascii_case(explicit_service_id.as_str()) {
                    return Err(format!(
                        "LOCAL_AI_NODE_SERVICE_MISMATCH: nodeId={} dependencyServiceId={} artifactServiceId={}",
                        node_id, explicit_service_id, artifact_service_id
                    ));
                }
            }
            explicit_service_id
        } else if let Some((artifact_service_id, _)) = mapped_service {
            artifact_service_id
        } else {
            return Err(format!(
                "LOCAL_AI_NODE_SERVICE_REQUIRED: nodeId={} requires serviceId or catalog mapping",
                node_id
            ));
        };
        return preflight_service_artifact(
            dependency_id,
            resolved_service_id.as_str(),
            None,
            profile,
        );
    }

    if *kind == LocalAiDependencyKind::Workflow {
        let workflow_id = normalize_non_empty(workflow_id).ok_or_else(|| {
            "LOCAL_AI_DEPENDENCY_WORKFLOW_ID_MISSING: selected workflow dependency missing workflowId"
                .to_string()
        })?;
        return Ok(vec![LocalAiPreflightDecision {
            dependency_id: dependency_id.map(|value| value.to_string()),
            target: "workflow".to_string(),
            check: "workflow-declaration".to_string(),
            ok: true,
            reason_code: "LOCAL_AI_PREFLIGHT_OK".to_string(),
            detail: format!("workflow dependency declared: workflowId={workflow_id}"),
        }]);
    }

    Ok(Vec::new())
}

pub fn build_service_descriptor(
    service_id: &str,
    title: Option<&str>,
    endpoint: Option<&str>,
    capabilities: &[String],
    local_model_id: Option<&str>,
) -> Result<LocalAiServiceDescriptor, String> {
    let artifact = find_service_artifact(service_id)
        .ok_or_else(|| format!("LOCAL_AI_SERVICE_ARTIFACT_NOT_FOUND: serviceId={service_id}"))?;
    let now = now_iso_timestamp();
    let title = title
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| service_id.to_string());
    let endpoint = resolve_effective_endpoint(&artifact, endpoint);
    if artifact.artifact_type == LocalAiServiceArtifactType::AttachedEndpoint
        && endpoint.as_deref().unwrap_or_default().trim().is_empty()
    {
        return Err(format!(
            "LOCAL_AI_SERVICE_ENDPOINT_REQUIRED: serviceId={} requires endpoint for attached-endpoint artifact",
            service_id
        ));
    }
    let local_model_id = local_model_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    Ok(LocalAiServiceDescriptor {
        service_id: service_id.to_string(),
        title,
        engine: artifact.engine,
        artifact_type: Some(artifact.artifact_type),
        endpoint,
        capabilities: capabilities.to_vec(),
        local_model_id,
        status: LocalAiServiceStatus::Installed,
        detail: Some("service installed".to_string()),
        installed_at: now.clone(),
        updated_at: now,
    })
}

pub fn bootstrap_service_artifact(service_id: &str) -> Result<Option<String>, String> {
    let artifact = find_service_artifact(service_id)
        .ok_or_else(|| format!("LOCAL_AI_SERVICE_ARTIFACT_NOT_FOUND: serviceId={service_id}"))?;
    let marker = artifact
        .install
        .bootstrap
        .as_deref()
        .map(|value| value.trim())
        .unwrap_or_default();
    if marker.is_empty() {
        return Ok(None);
    }
    if let Some(provider) = bootstrap_marker_provider(marker) {
        let Some(strategy) = managed_provider_strategy(provider) else {
            return Err(format!(
                "LOCAL_AI_CAPABILITY_MISSING: unsupported bootstrap marker serviceId={} marker={marker}",
                artifact.service_id
            ));
        };
        if !(strategy.enabled)() {
            return Err(format!(
                "LOCAL_AI_CAPABILITY_MISSING: bootstrap marker requires enabled {} strategy serviceId={} marker={marker}",
                strategy.provider, artifact.service_id
            ));
        }
        return (strategy.bootstrap)(&artifact, marker);
    }
    if marker.eq_ignore_ascii_case("python-venv") {
        return Ok(Some(format!(
            "python bootstrap marker acknowledged: serviceId={}",
            artifact.service_id
        )));
    }
    Err(format!(
        "LOCAL_AI_CAPABILITY_MISSING: unsupported bootstrap marker serviceId={} marker={marker}",
        artifact.service_id
    ))
}

pub fn probe_service_endpoint_health(service_id: &str, endpoint: &str) -> Result<String, String> {
    let artifact = find_service_artifact(service_id)
        .ok_or_else(|| format!("LOCAL_AI_SERVICE_ARTIFACT_NOT_FOUND: serviceId={service_id}"))?;
    let effective_endpoint = resolve_effective_endpoint(&artifact, Some(endpoint))
        .ok_or_else(|| format!("LOCAL_AI_SERVICE_ENDPOINT_REQUIRED: serviceId={service_id}"))?;
    let health_url = build_service_health_url(
        effective_endpoint.as_str(),
        artifact.health.endpoint.as_str(),
    )?;
    let timeout_ms = artifact.health.timeout_ms.clamp(250, 10_000);
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_millis(timeout_ms))
        .build()
        .map_err(|error| {
            format!(
                "LOCAL_AI_SERVICE_HEALTH_HTTP_CLIENT_FAILED: serviceId={} error={error}",
                artifact.service_id
            )
        })?;
    let request = maybe_authenticate_request(
        client.get(health_url.as_str()),
        artifact.service_id.as_str(),
    );
    match request.send() {
        Ok(response) if response.status().is_success() => Ok(format!(
            "service endpoint healthy: serviceId={} endpoint={}",
            artifact.service_id, health_url
        )),
        Ok(response) => Err(format!(
            "LOCAL_AI_SERVICE_HEALTH_UNREACHABLE: serviceId={} endpoint={} status={}",
            artifact.service_id,
            health_url,
            response.status().as_u16()
        )),
        Err(error) => Err(format!(
            "LOCAL_AI_SERVICE_HEALTH_UNREACHABLE: serviceId={} endpoint={} error={error}",
            artifact.service_id, health_url
        )),
    }
}

pub fn probe_service_capability_models(
    service_id: &str,
    endpoint: &str,
) -> Result<serde_json::Value, String> {
    let artifact = find_service_artifact(service_id)
        .ok_or_else(|| format!("LOCAL_AI_SERVICE_ARTIFACT_NOT_FOUND: serviceId={service_id}"))?;
    let probe_endpoint = artifact
        .health
        .capability_probe_endpoint
        .as_deref()
        .unwrap_or("/v1/models");
    let effective_endpoint = resolve_effective_endpoint(&artifact, Some(endpoint))
        .ok_or_else(|| format!("LOCAL_AI_SERVICE_ENDPOINT_REQUIRED: serviceId={service_id}"))?;
    let probe_url = build_service_health_url(effective_endpoint.as_str(), probe_endpoint)?;
    let timeout_ms = artifact.health.timeout_ms.clamp(250, 10_000);
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_millis(timeout_ms))
        .build()
        .map_err(|error| {
            format!(
                "LOCAL_AI_SERVICE_HEALTH_HTTP_CLIENT_FAILED: serviceId={} error={error}",
                artifact.service_id
            )
        })?;

    let request =
        maybe_authenticate_request(client.get(probe_url.as_str()), artifact.service_id.as_str());
    let response = request.send().map_err(|error| {
        format!(
            "LOCAL_AI_SERVICE_UNREACHABLE: serviceId={} endpoint={} error={error}",
            artifact.service_id, probe_url
        )
    })?;
    if response.status() == reqwest::StatusCode::UNAUTHORIZED
        || response.status() == reqwest::StatusCode::FORBIDDEN
    {
        return Err(format!(
            "LOCAL_AI_AUTH_FAILED: serviceId={} endpoint={} status={}",
            artifact.service_id,
            probe_url,
            response.status().as_u16()
        ));
    }
    if !response.status().is_success() {
        return Err(format!(
            "LOCAL_AI_SERVICE_UNREACHABLE: serviceId={} endpoint={} status={}",
            artifact.service_id,
            probe_url,
            response.status().as_u16()
        ));
    }
    let body = response.text().map_err(|error| {
        format!(
            "LOCAL_AI_PROVIDER_INTERNAL_ERROR: serviceId={} endpoint={} error={error}",
            artifact.service_id, probe_url
        )
    })?;
    serde_json::from_str::<serde_json::Value>(body.as_str()).map_err(|error| {
        format!(
            "LOCAL_AI_PROVIDER_INTERNAL_ERROR: serviceId={} endpoint={} error={error}",
            artifact.service_id, probe_url
        )
    })
}
