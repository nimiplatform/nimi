use serde_json::{json, Value as JsonValue};
use tonic::transport::Channel;

use crate::generated::{
    ai_config_owner, runtime_agent_service_client::RuntimeAgentServiceClient, AiConfig,
    AiConfigLocalLoadoutOptionsQuery, GetLocalAppSharedLocalAgentAiConfigRequest,
    ListLocalAppSharedLocalAgentAiConfigOptionsRequest, LocalAppSharedLocalAgentAiConfigProjection,
    OverwriteLocalAppSharedLocalAgentAiConfigRequest, ReasonCode,
};
use crate::grpc_status::local_app_error_from_status;
use crate::{
    LocalAppOperationError, LocalAppSharedAgentAIConfigLocalOptionsRequest,
    LocalAppSharedAgentAIConfigOverwriteRequest,
};

use super::app_ai_config::{
    parse_capabilities, project_capability, project_effective_selection, project_local_resource,
    required_text_value,
};
use super::untrusted;

pub(super) async fn get(channel: Channel) -> Result<JsonValue, LocalAppOperationError> {
    let response = RuntimeAgentServiceClient::new(channel)
        .get_local_app_shared_local_agent_ai_config(GetLocalAppSharedLocalAgentAiConfigRequest {})
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    project_snapshot(response.projection.ok_or_else(untrusted)?)
}

pub(super) async fn overwrite(
    channel: Channel,
    request: LocalAppSharedAgentAIConfigOverwriteRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    let response = RuntimeAgentServiceClient::new(channel)
        .overwrite_local_app_shared_local_agent_ai_config(
            OverwriteLocalAppSharedLocalAgentAiConfigRequest {
                expected_revision: required_text_value(&request.expected_revision)?,
                capabilities: parse_capabilities(request.capabilities)?,
            },
        )
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    let projection = response.projection.ok_or_else(untrusted)?;
    let reason = ReasonCode::try_from(response.reason_code).map_err(|_| untrusted())?;
    if response.committed && reason != ReasonCode::Unspecified {
        return Err(untrusted());
    }
    if !response.committed && reason != ReasonCode::AgentAiConfigRevisionConflict {
        return Err(untrusted());
    }
    let snapshot = project_snapshot(projection)?;
    let object = snapshot.as_object().ok_or_else(untrusted)?;
    Ok(json!({
        "outcome": if response.committed { "committed" } else { "conflict" },
        "config": object.get("config").cloned().unwrap_or(JsonValue::Null),
        "revision": object.get("revision").cloned().ok_or_else(untrusted)?,
        "effectiveSelections": object.get("effectiveSelections").cloned().ok_or_else(untrusted)?,
        "reasonCode": reason.as_str_name(),
    }))
}

pub(super) async fn list_local_options(
    channel: Channel,
    request: LocalAppSharedAgentAIConfigLocalOptionsRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    let response = RuntimeAgentServiceClient::new(channel)
        .list_local_app_shared_local_agent_ai_config_options(
            ListLocalAppSharedLocalAgentAiConfigOptionsRequest {
                local_loadouts: Some(AiConfigLocalLoadoutOptionsQuery {
                    capability_contract: required_text_value(&request.capability_contract)?,
                    search: request.search,
                }),
            },
        )
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    let local = response.local_loadouts.ok_or_else(untrusted)?;
    let options = local
        .options
        .into_iter()
        .map(project_local_resource)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(json!({ "kind": "local-loadouts", "options": options, "truncated": response.truncated }))
}

fn project_snapshot(
    projection: LocalAppSharedLocalAgentAiConfigProjection,
) -> Result<JsonValue, LocalAppOperationError> {
    if projection.revision.trim().is_empty() {
        return Err(untrusted());
    }
    let config = projection.config.map(project_config).transpose()?;
    let effective = projection
        .effective_selections
        .into_iter()
        .map(project_effective_selection)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(json!({
        "config": config,
        "revision": projection.revision,
        "effectiveSelections": effective,
    }))
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
