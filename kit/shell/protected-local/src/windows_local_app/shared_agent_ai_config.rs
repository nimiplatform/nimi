use serde_json::{json, Value as JsonValue};
use tonic::transport::Channel;

use crate::generated::runtime_agent_service_client::RuntimeAgentServiceClient;
use crate::generated::{
    ai_config_owner, AiConfig, GetLocalAppSharedLocalAgentAiConfigRequest,
    LocalAppSharedLocalAgentAiConfigProjection, OverwriteLocalAppSharedLocalAgentAiConfigRequest,
};
use crate::grpc_status::local_app_error_from_status;
use crate::{LocalAppOperationError, LocalAppSharedAgentAIConfigOverwriteRequest};

use super::app_ai_config::{parse_capabilities, project_capability};
use super::untrusted;

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
}
