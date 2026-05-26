use super::reason_codes::LOCAL_AI_PREFLIGHT_UNSUPPORTED;
use super::service_artifacts::find_service_artifact;
use super::types::{LocalAiDeviceProfile, LocalAiPreflightDecision};
mod managed;

use self::managed::{
    is_loopback_endpoint, normalize_non_empty, parse_version_parts, port_available,
    resolve_effective_endpoint,
};

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
        ok: false,
        reason_code: LOCAL_AI_PREFLIGHT_UNSUPPORTED.to_string(),
        detail: format!("unknown preflight check rejected: check={check}"),
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

#[cfg(test)]
mod tests {
    use super::evaluate_preflight_check;
    use crate::local_runtime::reason_codes::LOCAL_AI_PREFLIGHT_UNSUPPORTED;
    use crate::local_runtime::types::{
        LocalAiDeviceProfile, LocalAiGpuProfile, LocalAiMemoryModel, LocalAiNpuProfile,
        LocalAiPythonProfile,
    };

    fn device_profile_fixture() -> LocalAiDeviceProfile {
        LocalAiDeviceProfile {
            os: "macos".to_string(),
            arch: "aarch64".to_string(),
            total_ram_bytes: 16 * 1024 * 1024 * 1024,
            available_ram_bytes: 8 * 1024 * 1024 * 1024,
            gpu: LocalAiGpuProfile {
                available: false,
                vendor: None,
                model: None,
                total_vram_bytes: None,
                available_vram_bytes: None,
                memory_model: LocalAiMemoryModel::Unknown,
            },
            python: LocalAiPythonProfile {
                available: false,
                version: None,
            },
            npu: LocalAiNpuProfile {
                available: false,
                ready: false,
                vendor: None,
                runtime: None,
                detail: None,
            },
            disk_free_bytes: 1024 * 1024 * 1024,
            ports: Vec::new(),
        }
    }

    #[test]
    fn unknown_preflight_checks_fail_closed() {
        let profile = device_profile_fixture();
        let decision = evaluate_preflight_check(
            "unknown-new-rule",
            "LOCAL_AI_PREFLIGHT_OK",
            None,
            None,
            &profile,
        );

        assert!(!decision.ok);
        assert_eq!(decision.reason_code, LOCAL_AI_PREFLIGHT_UNSUPPORTED);
        assert_eq!(decision.check, "unknown-new-rule");
        assert!(decision.detail.contains("unknown preflight check rejected"));
    }
}
