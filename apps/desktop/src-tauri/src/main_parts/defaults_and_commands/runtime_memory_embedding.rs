use super::*;
use crate::runtime_bridge::http_addr;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MemoryEmbeddingScopeRefPayload {
    kind: String,
    owner_id: String,
    #[serde(default)]
    surface_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MemoryEmbeddingRuntimeTargetRefPayload {
    kind: String,
    agent_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MemoryEmbeddingCloudBindingPayload {
    connector_id: String,
    model_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MemoryEmbeddingLocalBindingPayload {
    target_id: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MemoryEmbeddingBindingIntentSnapshotPayload {
    #[serde(default)]
    source_kind: Option<String>,
    #[serde(default)]
    cloud_binding: Option<MemoryEmbeddingCloudBindingPayload>,
    #[serde(default)]
    local_binding: Option<MemoryEmbeddingLocalBindingPayload>,
    #[serde(default)]
    revision_token: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MemoryEmbeddingRuntimeInspectPayload {
    scope_ref: MemoryEmbeddingScopeRefPayload,
    target_ref: MemoryEmbeddingRuntimeTargetRefPayload,
    #[serde(default)]
    binding_intent_snapshot: Option<MemoryEmbeddingBindingIntentSnapshotPayload>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MemoryEmbeddingRuntimeBindPayload {
    scope_ref: MemoryEmbeddingScopeRefPayload,
    target_ref: MemoryEmbeddingRuntimeTargetRefPayload,
    #[serde(default)]
    binding_intent_snapshot: Option<MemoryEmbeddingBindingIntentSnapshotPayload>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MemoryEmbeddingRuntimeCutoverPayload {
    scope_ref: MemoryEmbeddingScopeRefPayload,
    target_ref: MemoryEmbeddingRuntimeTargetRefPayload,
    #[serde(default)]
    binding_intent_snapshot: Option<MemoryEmbeddingBindingIntentSnapshotPayload>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MemoryEmbeddingOperationReadinessPayload {
    bind_allowed: bool,
    cutover_allowed: bool,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MemoryEmbeddingRuntimeInspectResult {
    binding_intent_present: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    binding_source_kind: Option<String>,
    resolution_state: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    resolved_profile_identity: Option<String>,
    canonical_bank_status: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    blocked_reason_code: Option<String>,
    operation_readiness: MemoryEmbeddingOperationReadinessPayload,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MemoryEmbeddingRuntimeBindResult {
    outcome: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    blocked_reason_code: Option<String>,
    canonical_bank_status_after: String,
    pending_cutover: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct MemoryEmbeddingRuntimeCutoverResult {
    outcome: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    blocked_reason_code: Option<String>,
    canonical_bank_status_after: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    trace_id: Option<String>,
}

fn validate_scope_ref(scope_ref: &MemoryEmbeddingScopeRefPayload) -> Result<(), String> {
    if scope_ref.kind.trim().is_empty() {
        return Err("scopeRef.kind is required".to_string());
    }
    if scope_ref.owner_id.trim().is_empty() {
        return Err("scopeRef.ownerId is required".to_string());
    }
    if let Some(surface_id) = scope_ref.surface_id.as_deref() {
        if surface_id.trim().is_empty() {
            return Err("scopeRef.surfaceId must be omitted or non-empty".to_string());
        }
    }
    Ok(())
}

fn validate_target_ref(target_ref: &MemoryEmbeddingRuntimeTargetRefPayload) -> Result<(), String> {
    if target_ref.kind.trim() != "agent-core" {
        return Err("targetRef.kind must be agent-core".to_string());
    }
    if target_ref.agent_id.trim().is_empty() {
        return Err("targetRef.agentId is required".to_string());
    }
    Ok(())
}

fn validate_binding_intent_snapshot(
    snapshot: Option<&MemoryEmbeddingBindingIntentSnapshotPayload>,
) -> Result<(), String> {
    let Some(snapshot) = snapshot else {
        return Ok(());
    };
    if let Some(revision_token) = snapshot.revision_token.as_deref() {
        if revision_token.trim().is_empty() {
            return Err(
                "bindingIntentSnapshot.revisionToken must be omitted or non-empty".to_string(),
            );
        }
    }
    match snapshot
        .source_kind
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        Some("cloud") => {
            let cloud = snapshot.cloud_binding.as_ref().ok_or_else(|| {
                "bindingIntentSnapshot.cloudBinding is required for cloud source".to_string()
            })?;
            if cloud.connector_id.trim().is_empty() {
                return Err(
                    "bindingIntentSnapshot.cloudBinding.connectorId is required".to_string()
                );
            }
            if cloud.model_id.trim().is_empty() {
                return Err("bindingIntentSnapshot.cloudBinding.modelId is required".to_string());
            }
        }
        Some("local") => {
            let local = snapshot.local_binding.as_ref().ok_or_else(|| {
                "bindingIntentSnapshot.localBinding is required for local source".to_string()
            })?;
            if local.target_id.trim().is_empty() {
                return Err("bindingIntentSnapshot.localBinding.targetId is required".to_string());
            }
        }
        Some(_) => {
            return Err("bindingIntentSnapshot.sourceKind must be cloud or local".to_string())
        }
        None => {}
    }
    Ok(())
}

fn runtime_private_memory_embedding_url(path: &str) -> String {
    let addr = http_addr();
    let normalized_addr = if addr.starts_with("http://") || addr.starts_with("https://") {
        addr
    } else {
        format!("http://{}", addr)
    };
    format!(
        "{}/{}",
        normalized_addr.trim_end_matches('/'),
        path.trim_start_matches('/')
    )
}

async fn execute_memory_embedding_http<Request, Response>(
    url: &str,
    payload: &Request,
) -> Result<Response, String>
where
    Request: Serialize + ?Sized,
    Response: for<'de> Deserialize<'de>,
{
    let client = shared_http_client()?;
    let response = client
        .post(url)
        .json(payload)
        .send()
        .await
        .map_err(|error| error.to_string())?;
    let status = response.status();
    let body = response.text().await.map_err(|error| error.to_string())?;
    if !status.is_success() {
        if let Ok(value) = serde_json::from_str::<serde_json::Value>(body.as_str()) {
            if let Some(message) = value.get("error").and_then(|item| item.as_str()) {
                return Err(message.trim().to_string());
            }
        }
        let normalized = body.trim();
        if normalized.is_empty() {
            return Err(format!(
                "memory embedding request failed with status {}",
                status.as_u16()
            ));
        }
        return Err(normalized.to_string());
    }
    serde_json::from_str::<Response>(body.as_str()).map_err(|error| {
        format!(
            "memory embedding request returned invalid payload: {}",
            error
        )
    })
}

#[tauri::command]
pub(crate) async fn memory_embedding_runtime_inspect(
    payload: MemoryEmbeddingRuntimeInspectPayload,
) -> Result<MemoryEmbeddingRuntimeInspectResult, String> {
    validate_scope_ref(&payload.scope_ref)?;
    validate_target_ref(&payload.target_ref)?;
    validate_binding_intent_snapshot(payload.binding_intent_snapshot.as_ref())?;
    let url = runtime_private_memory_embedding_url("/v1/runtime/private/memory/embedding/inspect");
    execute_memory_embedding_http(url.as_str(), &payload).await
}

#[tauri::command]
pub(crate) async fn memory_embedding_runtime_request_bind(
    payload: MemoryEmbeddingRuntimeBindPayload,
) -> Result<MemoryEmbeddingRuntimeBindResult, String> {
    validate_scope_ref(&payload.scope_ref)?;
    validate_target_ref(&payload.target_ref)?;
    validate_binding_intent_snapshot(payload.binding_intent_snapshot.as_ref())?;
    let url = runtime_private_memory_embedding_url("/v1/runtime/private/memory/embedding/bind");
    execute_memory_embedding_http(url.as_str(), &payload).await
}

#[tauri::command]
pub(crate) async fn memory_embedding_runtime_request_cutover(
    payload: MemoryEmbeddingRuntimeCutoverPayload,
) -> Result<MemoryEmbeddingRuntimeCutoverResult, String> {
    validate_scope_ref(&payload.scope_ref)?;
    validate_target_ref(&payload.target_ref)?;
    validate_binding_intent_snapshot(payload.binding_intent_snapshot.as_ref())?;
    let url = runtime_private_memory_embedding_url("/v1/runtime/private/memory/embedding/cutover");
    execute_memory_embedding_http(url.as_str(), &payload).await
}

#[cfg(test)]
mod tests {
    use super::{
        execute_memory_embedding_http, validate_binding_intent_snapshot,
        MemoryEmbeddingBindingIntentSnapshotPayload, MemoryEmbeddingCloudBindingPayload,
        MemoryEmbeddingRuntimeBindPayload, MemoryEmbeddingRuntimeBindResult,
        MemoryEmbeddingRuntimeInspectPayload, MemoryEmbeddingRuntimeInspectResult,
        MemoryEmbeddingRuntimeTargetRefPayload, MemoryEmbeddingScopeRefPayload,
    };
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::thread;
    use std::time::Duration;

    fn sample_scope() -> MemoryEmbeddingScopeRefPayload {
        MemoryEmbeddingScopeRefPayload {
            kind: "mod".to_string(),
            owner_id: "world.nimi.test".to_string(),
            surface_id: Some("workspace".to_string()),
        }
    }

    fn spawn_single_response_server(
        status_line: &str,
        body: &str,
    ) -> (String, thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind test server");
        let addr = listener.local_addr().expect("local addr");
        let body = body.to_string();
        let status_line = status_line.to_string();
        let handle = thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept request");
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .expect("set read timeout");
            let mut request = Vec::new();
            loop {
                let mut buffer = [0_u8; 4096];
                match stream.read(&mut buffer) {
                    Ok(0) => break,
                    Ok(read) => {
                        request.extend_from_slice(&buffer[..read]);
                        if read < buffer.len() {
                            break;
                        }
                    }
                    Err(error)
                        if matches!(
                            error.kind(),
                            std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                        ) =>
                    {
                        break;
                    }
                    Err(error) => panic!("read request: {error}"),
                }
            }
            let request = String::from_utf8_lossy(&request).to_string();
            let response = format!(
                "HTTP/1.1 {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                status_line,
                body.len(),
                body
            );
            stream
                .write_all(response.as_bytes())
                .expect("write response");
            request
        });
        (format!("http://{}", addr), handle)
    }

    fn sample_target() -> MemoryEmbeddingRuntimeTargetRefPayload {
        MemoryEmbeddingRuntimeTargetRefPayload {
            kind: "agent-core".to_string(),
            agent_id: "agent-1".to_string(),
        }
    }

    #[test]
    fn validate_binding_intent_snapshot_requires_cloud_fields() {
        let err =
            validate_binding_intent_snapshot(Some(&MemoryEmbeddingBindingIntentSnapshotPayload {
                source_kind: Some("cloud".to_string()),
                cloud_binding: Some(MemoryEmbeddingCloudBindingPayload {
                    connector_id: "".to_string(),
                    model_id: "gemini-embedding-001".to_string(),
                }),
                local_binding: None,
                revision_token: Some("rev-1".to_string()),
            }))
            .expect_err("empty connectorId should fail");
        assert_eq!(
            err,
            "bindingIntentSnapshot.cloudBinding.connectorId is required"
        );
    }

    #[tokio::test]
    async fn execute_memory_embedding_http_posts_inspect_payload() {
        let (base_url, handle) = spawn_single_response_server(
            "200 OK",
            r#"{"bindingIntentPresent":false,"resolutionState":"missing","canonicalBankStatus":"unbound","operationReadiness":{"bindAllowed":false,"cutoverAllowed":false}}"#,
        );
        let url = format!("{}/v1/runtime/private/memory/embedding/inspect", base_url);
        let result = execute_memory_embedding_http::<_, MemoryEmbeddingRuntimeInspectResult>(
            url.as_str(),
            &MemoryEmbeddingRuntimeInspectPayload {
                scope_ref: sample_scope(),
                target_ref: sample_target(),
                binding_intent_snapshot: None,
            },
        )
        .await
        .expect("inspect");
        let request = handle.join().expect("join server");
        assert!(!result.binding_intent_present);
        assert_eq!(result.resolution_state, "missing");
        assert_eq!(result.canonical_bank_status, "unbound");
        assert!(request.starts_with("POST /v1/runtime/private/memory/embedding/inspect HTTP/1.1"));
        assert!(request.contains("Content-Type: application/json"));
    }

    #[tokio::test]
    async fn execute_memory_embedding_http_surfaces_bind_error_payload() {
        let (base_url, handle) = spawn_single_response_server(
            "409 Conflict",
            r#"{"error":"memory embedding profile mismatch"}"#,
        );
        let url = format!("{}/v1/runtime/private/memory/embedding/bind", base_url);
        let err = execute_memory_embedding_http::<_, MemoryEmbeddingRuntimeBindResult>(
            url.as_str(),
            &MemoryEmbeddingRuntimeBindPayload {
                scope_ref: sample_scope(),
                target_ref: sample_target(),
                binding_intent_snapshot: Some(MemoryEmbeddingBindingIntentSnapshotPayload {
                    source_kind: Some("cloud".to_string()),
                    cloud_binding: Some(MemoryEmbeddingCloudBindingPayload {
                        connector_id: "conn-1".to_string(),
                        model_id: "gemini-embedding-001".to_string(),
                    }),
                    local_binding: None,
                    revision_token: Some("rev-2".to_string()),
                }),
            },
        )
        .await
        .expect_err("bind should fail");
        let _ = handle.join().expect("join server");
        assert_eq!(err, "memory embedding profile mismatch");
    }

    #[test]
    fn validate_target_ref_requires_agent_core_kind() {
        let err = super::validate_target_ref(&MemoryEmbeddingRuntimeTargetRefPayload {
            kind: "conversation".to_string(),
            agent_id: "agent-1".to_string(),
        })
        .expect_err("invalid kind should fail");
        assert_eq!(err, "targetRef.kind must be agent-core");
    }

    #[test]
    fn validate_target_ref_requires_agent_id() {
        let err = super::validate_target_ref(&MemoryEmbeddingRuntimeTargetRefPayload {
            kind: "agent-core".to_string(),
            agent_id: " ".to_string(),
        })
        .expect_err("empty agentId should fail");
        assert_eq!(err, "targetRef.agentId is required");
    }

    #[test]
    fn validate_scope_ref_requires_owner_id() {
        let err = super::validate_scope_ref(&MemoryEmbeddingScopeRefPayload {
            kind: "mod".to_string(),
            owner_id: "".to_string(),
            surface_id: None,
        })
        .expect_err("empty ownerId should fail");
        assert_eq!(err, "scopeRef.ownerId is required");
    }

    #[test]
    fn validate_scope_ref_allows_minimal_shape() {
        super::validate_scope_ref(&MemoryEmbeddingScopeRefPayload {
            kind: "mod".to_string(),
            owner_id: "world.nimi.minimal".to_string(),
            surface_id: None,
        })
        .expect("minimal scopeRef should pass");
    }
}
