use serde_json::{json, Value as JsonValue};
use tonic::transport::Channel;

use crate::generated::{
    ai_config_owner, list_local_app_shared_local_agent_ai_config_options_request,
    list_local_app_shared_local_agent_ai_config_options_response, AiConfig,
    AiConfigCloudConnectorOptionsQuery, AiConfigCloudTargetOptionsQuery,
    AiConfigLocalLoadoutOptionsQuery, GetLocalAppSharedLocalAgentAiConfigRequest,
    ListLocalAppSharedLocalAgentAiConfigOptionsRequest, LocalAgentCapabilityParticipation,
    LocalAgentCapabilityParticipationRole, LocalAppSharedLocalAgentAiConfigProjection,
    OverwriteLocalAppSharedLocalAgentAiConfigRequest, ReasonCode,
    SharedLocalAgentPresetVoiceOption, SharedLocalAgentPresetVoiceOptionsQuery,
    SharedLocalAgentVoiceAssetOption, SharedLocalAgentVoiceAssetOptionsQuery,
};
use crate::grpc_status::local_app_error_from_status;
use crate::{
    LocalAppOperationError, LocalAppSharedAgentAIConfigLocalOptionsRequest,
    LocalAppSharedAgentAIConfigOverwriteRequest,
};

use super::app_ai_config::{
    parse_capabilities, project_capability, project_cloud_connector, project_cloud_target,
    project_effective_selection, project_local_resource, required_text_value,
};
use super::untrusted;

pub(super) async fn get(channel: Channel) -> Result<JsonValue, LocalAppOperationError> {
    let response = crate::grpc_limits::runtime_agent_client(channel)
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
    let response = crate::grpc_limits::runtime_agent_client(channel)
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
        "participation": object.get("participation").cloned().ok_or_else(untrusted)?,
        "reasonCode": reason.as_str_name(),
    }))
}

pub(super) async fn list_local_options(
    channel: Channel,
    request: LocalAppSharedAgentAIConfigLocalOptionsRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    let query = match request.kind.as_str() {
        "local-loadouts" => {
            list_local_app_shared_local_agent_ai_config_options_request::Query::LocalLoadouts(
                AiConfigLocalLoadoutOptionsQuery {
                    capability_contract: required_text_value(&request.capability_contract)?,
                    search: request.search,
                },
            )
        }
        "cloud-connectors" => {
            list_local_app_shared_local_agent_ai_config_options_request::Query::CloudConnectors(
                AiConfigCloudConnectorOptionsQuery {
                    capability_contract: required_text_value(&request.capability_contract)?,
                    search: request.search,
                },
            )
        }
        "cloud-targets" => {
            list_local_app_shared_local_agent_ai_config_options_request::Query::CloudTargets(
                AiConfigCloudTargetOptionsQuery {
                    capability_contract: required_text_value(&request.capability_contract)?,
                    connector_ref: required_text_value(&request.connector_ref)?,
                    search: request.search,
                },
            )
        }
        "preset-voices" => {
            list_local_app_shared_local_agent_ai_config_options_request::Query::PresetVoices(
                SharedLocalAgentPresetVoiceOptionsQuery {},
            )
        }
        "voice-assets" => {
            list_local_app_shared_local_agent_ai_config_options_request::Query::VoiceAssets(
                SharedLocalAgentVoiceAssetOptionsQuery {},
            )
        }
        _ => return Err(untrusted()),
    };
    let response = crate::grpc_limits::runtime_agent_client(channel)
        .list_local_app_shared_local_agent_ai_config_options(
            ListLocalAppSharedLocalAgentAiConfigOptionsRequest { query: Some(query) },
        )
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    let (kind, options) = match response.result.ok_or_else(untrusted)? {
        list_local_app_shared_local_agent_ai_config_options_response::Result::LocalLoadouts(
            value,
        ) if request.kind == "local-loadouts" => (
            "local-loadouts",
            value
                .options
                .into_iter()
                .map(project_local_resource)
                .collect::<Result<Vec<_>, _>>()?,
        ),
        list_local_app_shared_local_agent_ai_config_options_response::Result::CloudConnectors(
            value,
        ) if request.kind == "cloud-connectors" => (
            "cloud-connectors",
            value
                .options
                .into_iter()
                .map(project_cloud_connector)
                .collect::<Result<Vec<_>, _>>()?,
        ),
        list_local_app_shared_local_agent_ai_config_options_response::Result::CloudTargets(
            value,
        ) if request.kind == "cloud-targets" => (
            "cloud-targets",
            value
                .options
                .into_iter()
                .map(project_cloud_target)
                .collect::<Result<Vec<_>, _>>()?,
        ),
        list_local_app_shared_local_agent_ai_config_options_response::Result::PresetVoices(
            value,
        ) if request.kind == "preset-voices" => (
            "preset-voices",
            project_preset_voice_options(value.options)?,
        ),
        list_local_app_shared_local_agent_ai_config_options_response::Result::VoiceAssets(
            value,
        ) if request.kind == "voice-assets" => {
            ("voice-assets", project_voice_asset_options(value.options)?)
        }
        _ => return Err(untrusted()),
    };
    Ok(json!({ "kind": kind, "options": options, "truncated": response.truncated }))
}

fn project_voice_asset_options(
    values: Vec<SharedLocalAgentVoiceAssetOption>,
) -> Result<Vec<JsonValue>, LocalAppOperationError> {
    if values.len() > 100 {
        return Err(untrusted());
    }
    values
        .into_iter()
        .map(|value| {
            Ok(json!({
                "voiceAssetId": bounded_preset_voice_text(&value.voice_asset_id, 128)?,
            }))
        })
        .collect()
}

fn project_preset_voice_options(
    values: Vec<SharedLocalAgentPresetVoiceOption>,
) -> Result<Vec<JsonValue>, LocalAppOperationError> {
    if values.len() > 100 {
        return Err(untrusted());
    }
    values.into_iter().map(project_preset_voice).collect()
}

fn project_preset_voice(
    value: SharedLocalAgentPresetVoiceOption,
) -> Result<JsonValue, LocalAppOperationError> {
    let voice_id = bounded_preset_voice_text(&value.voice_id, 128)?;
    let name = bounded_preset_voice_text(&value.name, 256)?;
    if value.supported_langs.len() > 32 {
        return Err(untrusted());
    }
    let supported_langs = value
        .supported_langs
        .into_iter()
        .map(|lang| bounded_preset_voice_text(&lang, 64))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(json!({
        "voiceId": voice_id,
        "name": name,
        "supportedLangs": supported_langs,
    }))
}

fn bounded_preset_voice_text(
    value: &str,
    max_chars: usize,
) -> Result<String, LocalAppOperationError> {
    if value.is_empty() || value.trim() != value || value.chars().count() > max_chars {
        return Err(untrusted());
    }
    Ok(value.to_string())
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
    let participation = project_participation(projection.participation)?;
    Ok(json!({
        "config": config,
        "revision": projection.revision,
        "effectiveSelections": effective,
        "participation": participation,
    }))
}

fn project_participation(
    rows: Vec<LocalAgentCapabilityParticipation>,
) -> Result<Vec<JsonValue>, LocalAppOperationError> {
    let expected = [
        (
            LocalAgentCapabilityParticipationRole::ConversationPrimary,
            "conversation.primary",
            "text.generate",
        ),
        (
            LocalAgentCapabilityParticipationRole::MemoryEmbedding,
            "memory.embedding",
            "text.embed",
        ),
        (
            LocalAgentCapabilityParticipationRole::ConversationInputVoice,
            "conversation.input.voice",
            "audio.transcribe",
        ),
        (
            LocalAgentCapabilityParticipationRole::ConversationOutputVoice,
            "conversation.output.voice",
            "audio.synthesize",
        ),
        (
            LocalAgentCapabilityParticipationRole::ConversationRealtime,
            "conversation.realtime",
            "realtime.interact",
        ),
        (
            LocalAgentCapabilityParticipationRole::ConversationActionImage,
            "conversation.action.image",
            "image.generate",
        ),
    ];
    if rows.len() != expected.len() {
        return Err(untrusted());
    }
    rows.into_iter()
        .zip(expected)
        .map(|(row, (expected_role, role, capability))| {
            if LocalAgentCapabilityParticipationRole::try_from(row.role).map_err(|_| untrusted())?
                != expected_role
                || row.capability_contract != capability
            {
                return Err(untrusted());
            }
            Ok(json!({ "role": role, "capabilityContract": capability }))
        })
        .collect()
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

    #[test]
    fn shared_projection_preserves_the_fixed_six_row_participation() {
        let projected = project_participation(vec![
            LocalAgentCapabilityParticipation {
                role: LocalAgentCapabilityParticipationRole::ConversationPrimary.into(),
                capability_contract: "text.generate".to_string(),
            },
            LocalAgentCapabilityParticipation {
                role: LocalAgentCapabilityParticipationRole::MemoryEmbedding.into(),
                capability_contract: "text.embed".to_string(),
            },
            LocalAgentCapabilityParticipation {
                role: LocalAgentCapabilityParticipationRole::ConversationInputVoice.into(),
                capability_contract: "audio.transcribe".to_string(),
            },
            LocalAgentCapabilityParticipation {
                role: LocalAgentCapabilityParticipationRole::ConversationOutputVoice.into(),
                capability_contract: "audio.synthesize".to_string(),
            },
            LocalAgentCapabilityParticipation {
                role: LocalAgentCapabilityParticipationRole::ConversationRealtime.into(),
                capability_contract: "realtime.interact".to_string(),
            },
            LocalAgentCapabilityParticipation {
                role: LocalAgentCapabilityParticipationRole::ConversationActionImage.into(),
                capability_contract: "image.generate".to_string(),
            },
        ])
        .expect("fixed LocalAgent participation");
        assert_eq!(projected.len(), 6);
        assert_eq!(projected[4]["role"], "conversation.realtime");
        assert_eq!(projected[4]["capabilityContract"], "realtime.interact");
    }

    #[test]
    fn shared_preset_voice_projection_enforces_closed_bounds() {
        let projected = project_preset_voice_options(vec![SharedLocalAgentPresetVoiceOption {
            voice_id: "serena".to_string(),
            name: "Serena".to_string(),
            supported_langs: vec!["zh".to_string(), "en".to_string()],
        }])
        .expect("bounded preset voice");
        assert_eq!(projected[0]["voiceId"], "serena");
        assert!(
            project_preset_voice_options(vec![SharedLocalAgentPresetVoiceOption {
                voice_id: "v".repeat(129),
                name: "Voice".to_string(),
                supported_langs: vec![],
            }])
            .is_err()
        );
        assert!(project_preset_voice_options(
            (0..101)
                .map(|index| SharedLocalAgentPresetVoiceOption {
                    voice_id: format!("voice-{index}"),
                    name: format!("Voice {index}"),
                    supported_langs: vec![],
                })
                .collect(),
        )
        .is_err());
    }

    #[test]
    fn shared_voice_asset_projection_exposes_only_bounded_identity() {
        let projected = project_voice_asset_options(vec![SharedLocalAgentVoiceAssetOption {
            voice_asset_id: "voice-asset-1".to_string(),
        }])
        .expect("bounded VoiceAsset option");
        assert_eq!(projected, vec![json!({"voiceAssetId": "voice-asset-1"})]);
        assert!(
            project_voice_asset_options(vec![SharedLocalAgentVoiceAssetOption {
                voice_asset_id: "v".repeat(129),
            }])
            .is_err()
        );
    }
}
