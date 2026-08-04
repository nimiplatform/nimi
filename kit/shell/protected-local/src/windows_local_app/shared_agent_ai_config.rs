use serde_json::{json, Value as JsonValue};
use tonic::transport::Channel;

use crate::generated::runtime_agent_service_client::RuntimeAgentServiceClient;
use crate::generated::{
    ai_config_owner, AiConfig, ApplyLocalAppSharedLocalAgentAiProfileRequest,
    GetLocalAppSharedLocalAgentAiConfigRequest, LocalAppSharedLocalAgentAiConfigProjection,
    OverwriteLocalAppSharedLocalAgentAiConfigRequest,
    PreviewLocalAppSharedLocalAgentAiProfileRequest,
};
use crate::grpc_status::local_app_error_from_status;
use crate::{
    LocalAppOperationError, LocalAppReasonCode, LocalAppSharedAgentAIConfigOverwriteRequest,
    LocalAppSharedAgentAIProfileRequest,
};

use super::app_ai_config::{parse_capabilities, project_capability};

const MAX_PROFILE_JSON_BYTES: usize = 4 * 1024 * 1024;
const MAX_JSON_DEPTH: usize = 32;
const MAX_JSON_NODES: usize = 100_000;

pub(super) async fn get(channel: Channel) -> Result<JsonValue, LocalAppOperationError> {
    let response = RuntimeAgentServiceClient::new(channel)
        .get_local_app_shared_local_agent_ai_config(GetLocalAppSharedLocalAgentAiConfigRequest {})
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    project_projection(response.projection.ok_or_else(untrusted)?)
}

pub(super) async fn overwrite(
    channel: Channel,
    request: LocalAppSharedAgentAIConfigOverwriteRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    let response = RuntimeAgentServiceClient::new(channel)
        .overwrite_local_app_shared_local_agent_ai_config(
            OverwriteLocalAppSharedLocalAgentAiConfigRequest {
                capabilities: parse_capabilities(request.capabilities)?,
            },
        )
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    project_projection(response.projection.ok_or_else(untrusted)?)
}

pub(super) async fn preview_profile(
    channel: Channel,
    request: LocalAppSharedAgentAIProfileRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    let profile_json = validate_profile_json(request.profile_json)?;
    let response = RuntimeAgentServiceClient::new(channel)
        .preview_local_app_shared_local_agent_ai_profile(
            PreviewLocalAppSharedLocalAgentAiProfileRequest { profile_json },
        )
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    let before = response.before.map(project_projection).transpose()?;
    let after = project_projection(response.after.ok_or_else(untrusted)?)?;
    Ok(json!({ "before": before, "after": after }))
}

pub(super) async fn apply_profile(
    channel: Channel,
    request: LocalAppSharedAgentAIProfileRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    let profile_json = validate_profile_json(request.profile_json)?;
    let response = RuntimeAgentServiceClient::new(channel)
        .apply_local_app_shared_local_agent_ai_profile(
            ApplyLocalAppSharedLocalAgentAiProfileRequest { profile_json },
        )
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    project_projection(response.projection.ok_or_else(untrusted)?)
}

fn project_projection(
    projection: LocalAppSharedLocalAgentAiConfigProjection,
) -> Result<JsonValue, LocalAppOperationError> {
    project_config(projection.config.ok_or_else(untrusted)?)
}

fn project_config(config: AiConfig) -> Result<JsonValue, LocalAppOperationError> {
    match config.owner.and_then(|owner| owner.owner) {
        Some(ai_config_owner::Owner::RuntimeLocalAgentSubsystem(_)) => {}
        _ => return Err(untrusted()),
    }
    let capabilities = config
        .capabilities
        .into_iter()
        .map(project_capability)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(json!({
        "owner": {
            "owner": {
                "oneofKind": "runtimeLocalAgentSubsystem",
                "runtimeLocalAgentSubsystem": {},
            },
        },
        "capabilities": capabilities,
    }))
}

fn validate_profile_json(value: String) -> Result<Vec<u8>, LocalAppOperationError> {
    if value.trim().is_empty() || value.len() > MAX_PROFILE_JSON_BYTES {
        return Err(invalid_payload());
    }
    let parsed: JsonValue = serde_json::from_str(&value).map_err(|_| invalid_payload())?;
    let mut nodes = 0usize;
    validate_json_value(&parsed, 0, &mut nodes)?;
    Ok(value.into_bytes())
}

fn validate_json_value(
    value: &JsonValue,
    depth: usize,
    nodes: &mut usize,
) -> Result<(), LocalAppOperationError> {
    *nodes = nodes.saturating_add(1);
    if depth > MAX_JSON_DEPTH || *nodes > MAX_JSON_NODES {
        return Err(invalid_payload());
    }
    match value {
        JsonValue::Array(values) => {
            for value in values {
                validate_json_value(value, depth + 1, nodes)?;
            }
        }
        JsonValue::Object(values) => {
            for value in values.values() {
                validate_json_value(value, depth + 1, nodes)?;
            }
        }
        _ => {}
    }
    Ok(())
}

fn invalid_payload() -> LocalAppOperationError {
    LocalAppOperationError::new(LocalAppReasonCode::InvalidPayload, false)
}

fn untrusted() -> LocalAppOperationError {
    LocalAppOperationError::new(LocalAppReasonCode::RuntimeServiceUntrusted, false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::generated::{AiConfigOwner, AiConfigRuntimeLocalAgentSubsystemOwner};

    #[test]
    fn shared_projection_uses_only_the_fixed_subsystem_owner_marker() {
        let projected = project_config(AiConfig {
            owner: Some(AiConfigOwner {
                owner: Some(ai_config_owner::Owner::RuntimeLocalAgentSubsystem(
                    AiConfigRuntimeLocalAgentSubsystemOwner {},
                )),
            }),
            capabilities: Vec::new(),
        })
        .expect("shared LocalAgent projection");
        assert_eq!(
            projected["owner"]["owner"]["oneofKind"],
            "runtimeLocalAgentSubsystem"
        );
        assert_eq!(
            projected["owner"]["owner"]
                .as_object()
                .map(|value| value.len()),
            Some(2)
        );
    }

    #[test]
    fn profile_carrier_checks_json_format_without_interpreting_profile_semantics() {
        assert!(validate_profile_json("{\"portable\":true}".to_string()).is_ok());
        assert_eq!(
            validate_profile_json("{".to_string())
                .expect_err("malformed JSON")
                .reason_code(),
            LocalAppReasonCode::InvalidPayload
        );
    }
}
