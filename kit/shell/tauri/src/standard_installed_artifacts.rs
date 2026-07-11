use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine as _;
use nimi_shell_protected_local::InstalledArtifactBytes;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::runtime_bridge::{RuntimeBridgeInstalledHost, RuntimeBridgeInstalledHostError};

const COMMAND: &str = "artifacts_read_runtime_bytes";
const MAX_ARTIFACT_ID_LENGTH: usize = 512;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct InstalledArtifactReadPayload {
    artifact_id: String,
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledArtifactReadResult {
    pub data_base64: String,
    pub mime_type: String,
    pub size_bytes: i64,
    pub mime_inferred: bool,
}

pub async fn artifacts_read_runtime_bytes_for_host(
    host: &RuntimeBridgeInstalledHost,
    payload: Value,
) -> Result<InstalledArtifactReadResult, String> {
    let artifact_id = parse_artifact_id(payload)?;
    let artifact = host
        .read_artifact_bytes(artifact_id)
        .await
        .map_err(map_installed_host_error)?;
    Ok(project_artifact(artifact))
}

fn parse_artifact_id(payload: Value) -> Result<String, String> {
    let parsed: InstalledArtifactReadPayload = serde_json::from_value(payload).map_err(|_| {
        crate::capabilities::standard_shell_error(
            "invalid-payload",
            "tauri-installed-artifact-payload-invalid",
            "send_only_runtime_artifact_id",
            "tauri",
            Some(json!({ "command": COMMAND })),
        )
    })?;
    let normalized = parsed.artifact_id.trim();
    if normalized.is_empty()
        || normalized != parsed.artifact_id
        || normalized.len() > MAX_ARTIFACT_ID_LENGTH
    {
        return Err(crate::capabilities::standard_shell_error(
            "invalid-payload",
            "tauri-installed-artifact-payload-invalid",
            "provide_exact_runtime_artifact_id",
            "tauri",
            Some(json!({ "command": COMMAND })),
        ));
    }
    Ok(parsed.artifact_id)
}

fn project_artifact(artifact: InstalledArtifactBytes) -> InstalledArtifactReadResult {
    InstalledArtifactReadResult {
        data_base64: BASE64_STANDARD.encode(artifact.bytes),
        mime_type: artifact.mime_type,
        size_bytes: artifact.size_bytes,
        mime_inferred: artifact.mime_inferred,
    }
}

fn map_installed_host_error(error: RuntimeBridgeInstalledHostError) -> String {
    let reason_code = error.reason_code();
    crate::capabilities::standard_shell_error(
        standard_code(reason_code),
        reason_code,
        action_hint(reason_code),
        if reason_code.starts_with("installed-artifact-") {
            "runtime"
        } else {
            "tauri"
        },
        Some(json!({ "command": COMMAND, "retryable": error.retryable() })),
    )
}

fn standard_code(reason_code: &str) -> &'static str {
    match reason_code {
        "protected-carrier-required" => "protected-carrier-required",
        "runtime-service-unavailable" | "installed-artifact-runtime-unavailable" => {
            "runtime-service-unavailable"
        }
        "runtime-service-untrusted" | "installed-artifact-runtime-untrusted" => {
            "runtime-service-untrusted"
        }
        "runtime-service-repair-required" => "runtime-service-repair-required",
        "installed-artifact-invalid-input" => "invalid-payload",
        "installed-artifact-forbidden" => "runtime-permission-denied",
        "installed-artifact-not-found" => "not-found",
        "installed-artifact-too-large" => "resource-exhausted",
        _ => "runtime-service-untrusted",
    }
}

fn action_hint(reason_code: &str) -> &'static str {
    match reason_code {
        "installed-artifact-invalid-input" => "provide_exact_runtime_artifact_id",
        "installed-artifact-forbidden" => "request_installed_artifact_read_grant",
        "installed-artifact-not-found" => "refresh_runtime_artifact_projection",
        "installed-artifact-too-large" => "use_streaming_artifact_surface_when_admitted",
        "runtime-service-repair-required" => "repair_verified_runtime_service",
        "protected-carrier-required" => "install_verified_tauri_protected_carrier",
        _ => "restart_verified_installed_app_host",
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use nimi_shell_protected_local::{InstalledArtifactReadError, InstalledArtifactReadReasonCode};

    #[test]
    fn payload_accepts_only_the_artifact_selector() {
        assert_eq!(
            parse_artifact_id(json!({ "artifactId": "artifact-one" })).expect("artifact id"),
            "artifact-one"
        );
        for payload in [
            json!({}),
            json!({ "artifactId": " artifact-one" }),
            json!({ "artifactId": "artifact-one", "sessionProof": "forged" }),
        ] {
            let error = parse_artifact_id(payload).expect_err("payload rejected");
            assert!(error.contains("tauri-installed-artifact-payload-invalid"));
        }
    }

    #[test]
    fn projection_contains_only_renderer_safe_artifact_fields() {
        let result = project_artifact(InstalledArtifactBytes {
            bytes: b"artifact".to_vec(),
            mime_type: "text/plain".to_string(),
            size_bytes: 8,
            mime_inferred: false,
        });
        assert_eq!(result.data_base64, "YXJ0aWZhY3Q=");
        assert_eq!(result.mime_type, "text/plain");
        assert_eq!(result.size_bytes, 8);
        assert!(!result.mime_inferred);
    }

    #[test]
    fn typed_runtime_denials_map_to_standard_codes_without_detail() {
        for (reason, expected_code) in [
            (
                InstalledArtifactReadReasonCode::Forbidden,
                "runtime-permission-denied",
            ),
            (InstalledArtifactReadReasonCode::NotFound, "not-found"),
            (
                InstalledArtifactReadReasonCode::TooLarge,
                "resource-exhausted",
            ),
        ] {
            let error = map_installed_host_error(RuntimeBridgeInstalledHostError::Artifact(
                InstalledArtifactReadError::new(reason, false),
            ));
            let envelope: Value = serde_json::from_str(&error).expect("standard error");
            assert_eq!(envelope["code"], expected_code);
            assert_eq!(envelope["reasonCode"], reason.as_str());
            assert!(!error.contains("sessionProof"));
        }
    }
}
