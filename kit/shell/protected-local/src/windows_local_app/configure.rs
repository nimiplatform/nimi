use serde_json::{json, Map as JsonMap, Value as JsonValue};
use tonic::transport::Channel;

use crate::generated::runtime_agent_service_client::RuntimeAgentServiceClient;
use crate::generated::{
    AgentPresentationAssetMaterial, AgentPresentationAssetRole, AgentPresentationBackendKind,
    AgentPresentationProfile, CommitLocalAppAgentPresentationRequest,
    GetLocalAppAgentAutonomySnapshotRequest, GetLocalAppAgentConfigurationSnapshotRequest,
    GetLocalAppAgentPresentationSnapshotRequest, GetLocalAppAgentReadinessSnapshotRequest,
    LocalAppAgentAutonomyConfig, LocalAppAgentAutonomyIntent, LocalAppAgentAutonomyMode,
    LocalAppAgentAutonomyProjection, LocalAppAgentCapabilityReadiness,
    LocalAppAgentModelSettingsProjection, LocalAppAgentPresentationIntent,
    LocalAppAgentPresentationProjection, LocalAppAgentReadinessProjection,
    LocalAppAgentReadinessState, LocalAppAgentRouteIntent, RoutePolicy,
    UpdateLocalAppAgentAutonomyRequest, UpdateLocalAppAgentConfigurationRequest,
};
use crate::grpc_status::local_app_error_from_status;
use crate::{
    LocalAppAgentCommitPresentationRequest, LocalAppAgentHandleRequest,
    LocalAppAgentUpdateAutonomyRequest, LocalAppAgentUpdateConfigurationRequest,
    LocalAppOperationError,
};

use super::{invalid_payload, require_text, untrusted};

pub(super) async fn configuration_snapshot(
    channel: Channel,
    request: LocalAppAgentHandleRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    require_text(&request.agent_handle)?;
    let response = RuntimeAgentServiceClient::new(channel)
        .get_local_app_agent_configuration_snapshot(GetLocalAppAgentConfigurationSnapshotRequest {
            agent_handle: request.agent_handle,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    project_configuration(response.projection.ok_or_else(untrusted)?)
}

pub(super) async fn update_configuration(
    channel: Channel,
    request: LocalAppAgentUpdateConfigurationRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    require_text(&request.agent_handle)?;
    if request.expected_configuration_revision == 0 {
        return Err(invalid_payload());
    }
    let route_intents = parse_route_intents(request.route_intents)?;
    let response = RuntimeAgentServiceClient::new(channel)
        .update_local_app_agent_configuration(UpdateLocalAppAgentConfigurationRequest {
            agent_handle: request.agent_handle,
            expected_configuration_revision: request.expected_configuration_revision,
            route_intents,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    project_configuration(response.projection.ok_or_else(untrusted)?)
}

pub(super) async fn readiness_snapshot(
    channel: Channel,
    request: LocalAppAgentHandleRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    require_text(&request.agent_handle)?;
    let response = RuntimeAgentServiceClient::new(channel)
        .get_local_app_agent_readiness_snapshot(GetLocalAppAgentReadinessSnapshotRequest {
            agent_handle: request.agent_handle,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    project_readiness(response.projection.ok_or_else(untrusted)?)
}

pub(super) async fn autonomy_snapshot(
    channel: Channel,
    request: LocalAppAgentHandleRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    require_text(&request.agent_handle)?;
    let response = RuntimeAgentServiceClient::new(channel)
        .get_local_app_agent_autonomy_snapshot(GetLocalAppAgentAutonomySnapshotRequest {
            agent_handle: request.agent_handle,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    project_autonomy(response.projection.ok_or_else(untrusted)?)
}

pub(super) async fn update_autonomy(
    channel: Channel,
    request: LocalAppAgentUpdateAutonomyRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    require_text(&request.agent_handle)?;
    if request.expected_autonomy_revision == 0 {
        return Err(invalid_payload());
    }
    let intent = parse_autonomy_intent(request.intent)?;
    let response = RuntimeAgentServiceClient::new(channel)
        .update_local_app_agent_autonomy(UpdateLocalAppAgentAutonomyRequest {
            agent_handle: request.agent_handle,
            expected_autonomy_revision: request.expected_autonomy_revision,
            intent: Some(intent),
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    project_autonomy(response.projection.ok_or_else(untrusted)?)
}

pub(super) async fn presentation_snapshot(
    channel: Channel,
    request: LocalAppAgentHandleRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    require_text(&request.agent_handle)?;
    let response = RuntimeAgentServiceClient::new(channel)
        .get_local_app_agent_presentation_snapshot(GetLocalAppAgentPresentationSnapshotRequest {
            agent_handle: request.agent_handle,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    project_presentation(response.projection.ok_or_else(untrusted)?)
}

pub(super) async fn commit_presentation(
    channel: Channel,
    request: LocalAppAgentCommitPresentationRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    require_text(&request.agent_handle)?;
    let intent = parse_presentation_intent(request.intent)?;
    let imported_assets = parse_presentation_assets(request.imported_assets)?;
    let response = RuntimeAgentServiceClient::new(channel)
        .commit_local_app_agent_presentation(CommitLocalAppAgentPresentationRequest {
            agent_handle: request.agent_handle,
            expected_presentation_revision: request.expected_presentation_revision,
            intent: Some(intent),
            imported_assets,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    project_presentation(response.projection.ok_or_else(untrusted)?)
}

fn project_configuration(
    projection: LocalAppAgentModelSettingsProjection,
) -> Result<JsonValue, LocalAppOperationError> {
    Ok(json!({
        "capabilities": projection.capabilities,
        "routeIntents": projection.route_intents.into_iter().map(project_route_intent).collect::<Result<Vec<_>, _>>()?,
        "readiness": projection.readiness.into_iter().map(project_capability_readiness).collect::<Result<Vec<_>, _>>()?,
        "configurationRevision": projection.configuration_revision.to_string(),
    }))
}

fn project_readiness(
    projection: LocalAppAgentReadinessProjection,
) -> Result<JsonValue, LocalAppOperationError> {
    Ok(json!({
        "capabilities": projection.capabilities.into_iter().map(project_capability_readiness).collect::<Result<Vec<_>, _>>()?,
        "configurationRevision": projection.configuration_revision.to_string(),
    }))
}

fn project_route_intent(
    intent: LocalAppAgentRouteIntent,
) -> Result<JsonValue, LocalAppOperationError> {
    let route_policy = match RoutePolicy::try_from(intent.route_policy).map_err(|_| untrusted())? {
        RoutePolicy::Local => "local",
        RoutePolicy::Cloud => "cloud",
        RoutePolicy::Unspecified => return Err(untrusted()),
    };
    Ok(json!({
        "capability": intent.capability,
        "provider": intent.provider,
        "model": intent.model,
        "routePolicy": route_policy,
    }))
}

fn project_capability_readiness(
    readiness: LocalAppAgentCapabilityReadiness,
) -> Result<JsonValue, LocalAppOperationError> {
    let state =
        match LocalAppAgentReadinessState::try_from(readiness.state).map_err(|_| untrusted())? {
            LocalAppAgentReadinessState::Ready => "ready",
            LocalAppAgentReadinessState::Blocked => "blocked",
            LocalAppAgentReadinessState::Unavailable => "unavailable",
            LocalAppAgentReadinessState::Failed => "failed",
            LocalAppAgentReadinessState::Unspecified => return Err(untrusted()),
        };
    Ok(json!({
        "capability": readiness.capability,
        "state": state,
        "reason": readiness.reason,
        "observedAt": readiness.observed_at.map(project_timestamp),
    }))
}

fn project_autonomy(
    projection: LocalAppAgentAutonomyProjection,
) -> Result<JsonValue, LocalAppOperationError> {
    Ok(json!({
        "enabled": projection.enabled,
        "config": projection.config.map(project_autonomy_config).transpose()?,
        "usedTokensInWindow": projection.used_tokens_in_window,
        "windowStartedAt": projection.window_started_at.map(project_timestamp),
        "budgetExhausted": projection.budget_exhausted,
        "suspendedUntil": projection.suspended_until.map(project_timestamp),
        "autonomyRevision": projection.autonomy_revision.to_string(),
    }))
}

fn project_autonomy_config(
    config: LocalAppAgentAutonomyConfig,
) -> Result<JsonValue, LocalAppOperationError> {
    let mode = match LocalAppAgentAutonomyMode::try_from(config.mode).map_err(|_| untrusted())? {
        LocalAppAgentAutonomyMode::Off => "off",
        LocalAppAgentAutonomyMode::Low => "low",
        LocalAppAgentAutonomyMode::Medium => "medium",
        LocalAppAgentAutonomyMode::High => "high",
        LocalAppAgentAutonomyMode::Unspecified => return Err(untrusted()),
    };
    Ok(json!({
        "dailyTokenBudget": config.daily_token_budget,
        "maxTokensPerHook": config.max_tokens_per_hook,
        "minHookInterval": config.min_hook_interval.map(project_duration),
        "suspendUntil": config.suspend_until.map(project_timestamp),
        "mode": mode,
    }))
}

fn project_presentation(
    projection: LocalAppAgentPresentationProjection,
) -> Result<JsonValue, LocalAppOperationError> {
    Ok(json!({
        "profile": projection.profile.map(project_presentation_profile).transpose()?,
        "defaultVoiceReference": projection.default_voice_reference,
        "presentationRevision": projection.presentation_revision.to_string(),
    }))
}

fn project_presentation_profile(
    profile: AgentPresentationProfile,
) -> Result<JsonValue, LocalAppOperationError> {
    let backend_kind = project_backend_kind(profile.backend_kind)?;
    Ok(json!({
        "backendKind": backend_kind,
        "avatarAssetRef": profile.avatar_asset_ref,
        "expressionProfileRef": profile.expression_profile_ref,
        "idlePreset": profile.idle_preset,
        "interactionPolicyRef": profile.interaction_policy_ref,
        "defaultVoiceReference": profile.default_voice_reference,
        "avatarAutoplay": profile.avatar_autoplay,
        "backgroundAssetRef": profile.background_asset_ref,
        "revision": profile.revision.to_string(),
    }))
}

fn project_backend_kind(value: i32) -> Result<&'static str, LocalAppOperationError> {
    Ok(
        match AgentPresentationBackendKind::try_from(value).map_err(|_| untrusted())? {
            AgentPresentationBackendKind::Vrm => "vrm",
            AgentPresentationBackendKind::Live2d => "live2d",
            AgentPresentationBackendKind::Sprite2d => "sprite2d",
            AgentPresentationBackendKind::Canvas2d => "canvas2d",
            AgentPresentationBackendKind::Video => "video",
            AgentPresentationBackendKind::Unspecified => return Err(untrusted()),
        },
    )
}

fn project_timestamp(value: prost_types::Timestamp) -> JsonValue {
    json!({"seconds": value.seconds.to_string(), "nanos": value.nanos})
}

fn project_duration(value: prost_types::Duration) -> JsonValue {
    json!({"seconds": value.seconds.to_string(), "nanos": value.nanos})
}

fn parse_route_intents(
    value: JsonValue,
) -> Result<Vec<LocalAppAgentRouteIntent>, LocalAppOperationError> {
    let values = value.as_array().ok_or_else(invalid_payload)?;
    if values.is_empty() {
        return Err(invalid_payload());
    }
    values
        .iter()
        .map(|value| {
            let object = exact_object(value, &["capability", "provider", "model", "routePolicy"])?;
            let route_policy = match text(object, "routePolicy")? {
                "local" => RoutePolicy::Local,
                "cloud" => RoutePolicy::Cloud,
                _ => return Err(invalid_payload()),
            };
            Ok(LocalAppAgentRouteIntent {
                capability: text(object, "capability")?.to_string(),
                provider: optional_text(object, "provider")?.to_string(),
                model: text(object, "model")?.to_string(),
                route_policy: route_policy as i32,
            })
        })
        .collect()
}

fn parse_autonomy_intent(
    value: JsonValue,
) -> Result<LocalAppAgentAutonomyIntent, LocalAppOperationError> {
    let object = allowed_object(&value, &["enabled", "config"])?;
    let enabled = match object.get("enabled") {
        Some(JsonValue::Bool(value)) => Some(*value),
        Some(JsonValue::Null) | None => None,
        _ => return Err(invalid_payload()),
    };
    let config = match object.get("config") {
        Some(JsonValue::Object(_)) => Some(parse_autonomy_config(
            object.get("config").expect("present"),
        )?),
        Some(JsonValue::Null) | None => None,
        _ => return Err(invalid_payload()),
    };
    if enabled.is_none() && config.is_none() {
        return Err(invalid_payload());
    }
    Ok(LocalAppAgentAutonomyIntent { enabled, config })
}

fn parse_autonomy_config(
    value: &JsonValue,
) -> Result<LocalAppAgentAutonomyConfig, LocalAppOperationError> {
    let object = allowed_object(
        value,
        &[
            "dailyTokenBudget",
            "maxTokensPerHook",
            "minHookInterval",
            "suspendUntil",
            "mode",
        ],
    )?;
    let mode = match text(object, "mode")? {
        "off" => LocalAppAgentAutonomyMode::Off,
        "low" => LocalAppAgentAutonomyMode::Low,
        "medium" => LocalAppAgentAutonomyMode::Medium,
        "high" => LocalAppAgentAutonomyMode::High,
        _ => return Err(invalid_payload()),
    };
    Ok(LocalAppAgentAutonomyConfig {
        daily_token_budget: integer(object, "dailyTokenBudget")?,
        max_tokens_per_hook: integer(object, "maxTokensPerHook")?,
        min_hook_interval: optional_duration(object.get("minHookInterval"))?,
        suspend_until: optional_timestamp(object.get("suspendUntil"))?,
        mode: mode as i32,
    })
}

fn parse_presentation_intent(
    value: JsonValue,
) -> Result<LocalAppAgentPresentationIntent, LocalAppOperationError> {
    let object = exact_object(
        &value,
        &[
            "backendKind",
            "avatarAssetRef",
            "expressionProfileRef",
            "idlePreset",
            "interactionPolicyRef",
            "defaultVoiceReference",
            "avatarAutoplay",
            "backgroundAssetRef",
        ],
    )?;
    let backend_kind = match text(object, "backendKind")? {
        "vrm" => AgentPresentationBackendKind::Vrm,
        "live2d" => AgentPresentationBackendKind::Live2d,
        "sprite2d" => AgentPresentationBackendKind::Sprite2d,
        "canvas2d" => AgentPresentationBackendKind::Canvas2d,
        "video" => AgentPresentationBackendKind::Video,
        _ => return Err(invalid_payload()),
    };
    let avatar_autoplay = object
        .get("avatarAutoplay")
        .and_then(JsonValue::as_bool)
        .ok_or_else(invalid_payload)?;
    Ok(LocalAppAgentPresentationIntent {
        backend_kind: backend_kind as i32,
        avatar_asset_ref: optional_text(object, "avatarAssetRef")?.to_string(),
        expression_profile_ref: optional_text(object, "expressionProfileRef")?.to_string(),
        idle_preset: optional_text(object, "idlePreset")?.to_string(),
        interaction_policy_ref: optional_text(object, "interactionPolicyRef")?.to_string(),
        default_voice_reference: optional_text(object, "defaultVoiceReference")?.to_string(),
        avatar_autoplay,
        background_asset_ref: optional_text(object, "backgroundAssetRef")?.to_string(),
    })
}

fn parse_presentation_assets(
    value: JsonValue,
) -> Result<Vec<AgentPresentationAssetMaterial>, LocalAppOperationError> {
    let values = value.as_array().ok_or_else(invalid_payload)?;
    if values.len() > 2 {
        return Err(invalid_payload());
    }
    values
        .iter()
        .map(|value| {
            let object = exact_object(
                value,
                &["role", "fileName", "mediaType", "content", "sha256"],
            )?;
            let role = match text(object, "role")? {
                "avatar" => AgentPresentationAssetRole::Avatar,
                "background" => AgentPresentationAssetRole::Background,
                _ => return Err(invalid_payload()),
            };
            let content_values = object
                .get("content")
                .and_then(JsonValue::as_array)
                .ok_or_else(invalid_payload)?;
            if content_values.is_empty() || content_values.len() > 64 * 1024 * 1024 {
                return Err(invalid_payload());
            }
            let content = content_values
                .iter()
                .map(|value| {
                    value
                        .as_u64()
                        .filter(|byte| *byte <= 255)
                        .map(|byte| byte as u8)
                        .ok_or_else(invalid_payload)
                })
                .collect::<Result<Vec<_>, _>>()?;
            Ok(AgentPresentationAssetMaterial {
                role: role as i32,
                file_name: text(object, "fileName")?.to_string(),
                media_type: text(object, "mediaType")?.to_string(),
                content,
                sha256: text(object, "sha256")?.to_string(),
            })
        })
        .collect()
}

fn allowed_object<'a>(
    value: &'a JsonValue,
    keys: &[&str],
) -> Result<&'a JsonMap<String, JsonValue>, LocalAppOperationError> {
    let object = value.as_object().ok_or_else(invalid_payload)?;
    if object.keys().any(|key| !keys.contains(&key.as_str())) {
        return Err(invalid_payload());
    }
    Ok(object)
}

fn exact_object<'a>(
    value: &'a JsonValue,
    keys: &[&str],
) -> Result<&'a JsonMap<String, JsonValue>, LocalAppOperationError> {
    let object = value.as_object().ok_or_else(invalid_payload)?;
    if object.len() != keys.len() || keys.iter().any(|key| !object.contains_key(*key)) {
        return Err(invalid_payload());
    }
    Ok(object)
}

fn text<'a>(
    object: &'a JsonMap<String, JsonValue>,
    key: &str,
) -> Result<&'a str, LocalAppOperationError> {
    let value = optional_text(object, key)?;
    if value.is_empty() {
        return Err(invalid_payload());
    }
    Ok(value)
}

fn optional_text<'a>(
    object: &'a JsonMap<String, JsonValue>,
    key: &str,
) -> Result<&'a str, LocalAppOperationError> {
    let value = object
        .get(key)
        .and_then(JsonValue::as_str)
        .ok_or_else(invalid_payload)?;
    if value.trim() != value || value.len() > 512 {
        return Err(invalid_payload());
    }
    Ok(value)
}

fn integer(object: &JsonMap<String, JsonValue>, key: &str) -> Result<i64, LocalAppOperationError> {
    object
        .get(key)
        .and_then(JsonValue::as_i64)
        .filter(|value| *value >= 0)
        .ok_or_else(invalid_payload)
}

fn optional_timestamp(
    value: Option<&JsonValue>,
) -> Result<Option<prost_types::Timestamp>, LocalAppOperationError> {
    match value {
        None | Some(JsonValue::Null) => Ok(None),
        Some(value) => parse_seconds_nanos(value)
            .map(|(seconds, nanos)| Some(prost_types::Timestamp { seconds, nanos })),
    }
}

fn optional_duration(
    value: Option<&JsonValue>,
) -> Result<Option<prost_types::Duration>, LocalAppOperationError> {
    match value {
        None | Some(JsonValue::Null) => Ok(None),
        Some(value) => parse_seconds_nanos(value)
            .map(|(seconds, nanos)| Some(prost_types::Duration { seconds, nanos })),
    }
}

fn parse_seconds_nanos(value: &JsonValue) -> Result<(i64, i32), LocalAppOperationError> {
    let object = exact_object(value, &["seconds", "nanos"])?;
    let seconds = object
        .get("seconds")
        .and_then(JsonValue::as_str)
        .and_then(|value| value.parse::<i64>().ok())
        .ok_or_else(invalid_payload)?;
    let nanos = object
        .get("nanos")
        .and_then(JsonValue::as_i64)
        .and_then(|value| i32::try_from(value).ok())
        .filter(|value| (0..1_000_000_000).contains(value))
        .ok_or_else(invalid_payload)?;
    Ok((seconds, nanos))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fresh_presentation_revision_crosses_the_native_boundary_as_decimal_zero() {
        let projected = project_presentation(LocalAppAgentPresentationProjection {
            profile: None,
            previous_profile: None,
            default_voice_reference: String::new(),
            presentation_revision: 0,
        })
        .expect("fresh presentation projection");
        assert_eq!(projected["presentationRevision"], "0");
    }

    #[test]
    fn imported_presentation_assets_cross_the_native_boundary_as_owned_bytes() {
        let assets = parse_presentation_assets(serde_json::json!([{
            "role": "avatar",
            "fileName": "avatar.vrm",
            "mediaType": "model/gltf-binary",
            "content": [1, 2, 255],
            "sha256": "abc123"
        }]))
        .expect("imported presentation asset");
        assert_eq!(assets.len(), 1);
        assert_eq!(assets[0].role, AgentPresentationAssetRole::Avatar as i32);
        assert_eq!(assets[0].content, vec![1, 2, 255]);
    }

    #[test]
    fn configure_mutation_revisions_remain_u64_without_number_projection() {
        let projected = project_readiness(LocalAppAgentReadinessProjection {
            capabilities: Vec::new(),
            configuration_revision: u64::MAX,
        })
        .expect("readiness projection");
        assert_eq!(projected["configurationRevision"], u64::MAX.to_string());
    }
}
