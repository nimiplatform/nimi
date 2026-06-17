use super::*;
use chrono::DateTime;
use sha2::{Digest, Sha256};

pub(crate) fn validate_normalized_id(value: &str, field_name: &str) -> Result<String, String> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(format!("{field_name} is required"));
    }
    if trimmed.len() > 256 {
        return Err(format!("{field_name} must be 256 characters or shorter"));
    }
    if trimmed == "." || trimmed == ".." || trimmed.contains("://") {
        return Err(format!("{field_name} contains unsupported characters"));
    }
    if !trimmed.chars().any(|ch| ch.is_ascii_alphanumeric()) {
        return Err(format!("{field_name} contains unsupported characters"));
    }
    for ch in trimmed.chars() {
        let allowed =
            ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-' | '.' | '~' | ':' | '@' | '+');
        if !allowed {
            return Err(format!(
                "{field_name} contains unsupported characters: {:?}",
                trimmed
            ));
        }
    }
    Ok(trimmed.to_string())
}

pub(crate) fn expected_local_agent_ref(owner_user_id: &str, runtime_source_ref: &str) -> String {
    format!("{LOCAL_AGENT_REF_PREFIX}{owner_user_id}:{runtime_source_ref}")
}

pub(crate) fn validate_local_agent_scope(
    owner_user_id: &str,
    runtime_source_ref: &str,
    local_agent_ref: &str,
) -> Result<LocalAgentScope, String> {
    let owner_user_id = validate_normalized_id(owner_user_id, "ownerUserId")?;
    let runtime_source_ref = validate_normalized_id(runtime_source_ref, "runtimeSourceRef")?;
    let local_agent_ref = validate_normalized_id(local_agent_ref, "localAgentRef")?;
    if local_agent_ref == runtime_source_ref {
        return Err("localAgentRef must not be a bare runtimeSourceRef".to_string());
    }
    if !local_agent_ref.starts_with(LOCAL_AGENT_REF_PREFIX) {
        return Err("localAgentRef must start with local-agent:".to_string());
    }
    let expected = expected_local_agent_ref(&owner_user_id, &runtime_source_ref);
    if local_agent_ref != expected {
        return Err(
            "localAgentRef must equal local-agent:${ownerUserId}:${runtimeSourceRef}".to_string(),
        );
    }
    Ok(LocalAgentScope {
        owner_user_id,
        runtime_source_ref,
        local_agent_ref,
    })
}

fn can_use_raw_scope_path_segment(value: &str) -> bool {
    let body = value.strip_prefix('~').unwrap_or(value);
    if body.is_empty() || value.len() > 128 {
        return false;
    }
    let mut chars = body.chars();
    matches!(chars.next(), Some(first) if first.is_ascii_lowercase() || first.is_ascii_digit())
        && body
            .chars()
            .all(|ch| ch.is_ascii_lowercase() || ch.is_ascii_digit() || ch == '_' || ch == '-')
}

pub(crate) fn local_scope_path_segment(value: &str) -> String {
    if can_use_raw_scope_path_segment(value) {
        return value.to_string();
    }
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    let digest = format!("{:x}", hasher.finalize());
    format!("id_{}", &digest[..24])
}

pub(crate) fn validate_hex_suffix(
    value: &str,
    prefix: &str,
    field_name: &str,
) -> Result<(), String> {
    let Some(suffix) = value.strip_prefix(prefix) else {
        return Err(format!("{field_name} must start with {prefix}"));
    };
    if suffix.len() != 12
        || !suffix
            .chars()
            .all(|ch| ch.is_ascii_hexdigit() && !ch.is_ascii_uppercase())
    {
        return Err(format!(
            "{field_name} must end with 12 lowercase hex characters"
        ));
    }
    Ok(())
}

pub(crate) fn validate_background_id(value: &str, field_name: &str) -> Result<(), String> {
    validate_hex_suffix(value, "bg_", field_name)
}

pub(crate) fn validate_local_asset_id(value: &str, field_name: &str) -> Result<(), String> {
    if value.starts_with("live2d_") {
        return validate_hex_suffix(value, "live2d_", field_name);
    }
    if value.starts_with("vrm_") {
        return validate_hex_suffix(value, "vrm_", field_name);
    }
    Err(format!("{field_name} must start with live2d_ or vrm_"))
}

pub(crate) fn validate_live2d_adapter_manifest_ref(
    value: &str,
    field_name: &str,
) -> Result<(), String> {
    validate_hex_suffix(value, "live2d_adapter_", field_name)
}

pub(crate) fn validate_live2d_calibration_ref(value: &str, field_name: &str) -> Result<(), String> {
    validate_hex_suffix(value, "live2d_calibration_", field_name)
}

pub(crate) fn validate_utc_timestamp(value: &str, field_name: &str) -> Result<(), String> {
    if !value.ends_with('Z') {
        return Err(format!("{field_name} must use UTC Z timestamp form"));
    }
    DateTime::parse_from_rfc3339(value)
        .map(|_| ())
        .map_err(|error| format!("{field_name} is not a valid timestamp: {error}"))
}

fn validate_optional_timestamp(value: Option<&String>, field_name: &str) -> Result<(), String> {
    if let Some(timestamp) = value {
        validate_utc_timestamp(timestamp, field_name)?;
    }
    Ok(())
}

fn validate_module_version(version: u8, field_name: &str) -> Result<(), String> {
    if version != AGENT_CENTER_CONFIG_SCHEMA_VERSION {
        return Err(format!("{field_name} must be 1"));
    }
    Ok(())
}

fn validate_agent_center_config(config: &AgentCenterLocalConfig) -> Result<(), String> {
    validate_module_version(config.schema_version, "schema_version")?;
    if config.config_kind != AGENT_CENTER_CONFIG_KIND {
        return Err("config_kind must be agent_center_local_config".to_string());
    }
    validate_normalized_id(&config.account_id, "account_id")?;
    validate_local_agent_scope(
        &config.owner_user_id,
        &config.runtime_source_ref,
        &config.local_agent_ref,
    )?;

    validate_module_version(
        config.modules.appearance.schema_version,
        "modules.appearance.schema_version",
    )?;
    if let Some(background_id) = &config.modules.appearance.background_asset_id {
        validate_background_id(background_id, "modules.appearance.background_asset_id")?;
    }

    validate_module_version(
        config.modules.avatar_asset.schema_version,
        "modules.avatar_asset.schema_version",
    )?;
    if let Some(local_asset_ref) = &config.modules.avatar_asset.local_avatar_asset_ref {
        validate_local_asset_id(
            local_asset_ref,
            "modules.avatar_asset.local_avatar_asset_ref",
        )?;
        match config.modules.avatar_asset.backend_kind {
            AgentCenterAvatarBackendKind::Live2d if !local_asset_ref.starts_with("live2d_") => {
                return Err(
                    "modules.avatar_asset.backend_kind must match local Avatar asset id prefix"
                        .to_string(),
                );
            }
            AgentCenterAvatarBackendKind::Vrm if !local_asset_ref.starts_with("vrm_") => {
                return Err(
                    "modules.avatar_asset.backend_kind must match local Avatar asset id prefix"
                        .to_string(),
                );
            }
            AgentCenterAvatarBackendKind::Future => {
                return Err(
                    "modules.avatar_asset.backend_kind future cannot be selected for a local Avatar asset"
                        .to_string(),
                );
            }
            _ => {}
        }
    }
    match config.modules.avatar_asset.live2d_adapter_manifest_source {
        AgentCenterLive2dAdapterManifestSource::None => {
            if config
                .modules
                .avatar_asset
                .live2d_adapter_manifest_ref
                .is_some()
            {
                return Err(
                    "modules.avatar_asset.live2d_adapter_manifest_ref requires external sidecar source"
                        .to_string(),
                );
            }
        }
        AgentCenterLive2dAdapterManifestSource::EmbeddedCreatorManifest => {
            if config
                .modules
                .avatar_asset
                .live2d_adapter_manifest_ref
                .is_some()
            {
                return Err(
                    "modules.avatar_asset.live2d_adapter_manifest_ref must be empty for embedded source"
                        .to_string(),
                );
            }
            if config.modules.avatar_asset.backend_kind != AgentCenterAvatarBackendKind::Live2d {
                return Err(
                    "modules.avatar_asset.live2d_adapter_manifest_source requires live2d backend"
                        .to_string(),
                );
            }
        }
        AgentCenterLive2dAdapterManifestSource::ExternalSidecarManifest => {
            if config.modules.avatar_asset.backend_kind != AgentCenterAvatarBackendKind::Live2d {
                return Err(
                    "modules.avatar_asset.live2d_adapter_manifest_source requires live2d backend"
                        .to_string(),
                );
            }
            let Some(manifest_ref) = &config.modules.avatar_asset.live2d_adapter_manifest_ref
            else {
                return Err(
                    "modules.avatar_asset.live2d_adapter_manifest_ref is required for external sidecar source"
                        .to_string(),
                );
            };
            validate_live2d_adapter_manifest_ref(
                manifest_ref,
                "modules.avatar_asset.live2d_adapter_manifest_ref",
            )?;
        }
    }
    if let Some(profile_ref) = &config.modules.avatar_asset.backend_capability_profile_ref {
        validate_normalized_id(
            profile_ref,
            "modules.avatar_asset.backend_capability_profile_ref",
        )?;
    }
    if let Some(calibration_ref) = &config.modules.avatar_asset.live2d_calibration_ref {
        if config.modules.avatar_asset.backend_kind != AgentCenterAvatarBackendKind::Live2d {
            return Err(
                "modules.avatar_asset.live2d_calibration_ref requires live2d backend".to_string(),
            );
        }
        validate_live2d_calibration_ref(
            calibration_ref,
            "modules.avatar_asset.live2d_calibration_ref",
        )?;
    }
    validate_utc_timestamp(
        &config.modules.avatar_asset.updated_at,
        "modules.avatar_asset.updated_at",
    )?;
    validate_normalized_id(
        &config.modules.avatar_asset.provenance.evidence_ref,
        "modules.avatar_asset.provenance.evidence_ref",
    )?;
    validate_module_version(
        config.modules.local_history.schema_version,
        "modules.local_history.schema_version",
    )?;
    validate_optional_timestamp(
        config.modules.local_history.last_cleared_at.as_ref(),
        "modules.local_history.last_cleared_at",
    )?;

    validate_module_version(
        config.modules.voice.schema_version,
        "modules.voice.schema_version",
    )?;

    validate_module_version(
        config.modules.ui.schema_version,
        "modules.ui.schema_version",
    )?;
    Ok(())
}

pub(crate) fn validate_agent_center_config_scope(
    config: &AgentCenterLocalConfig,
    account_id: &str,
    scope: &LocalAgentScope,
) -> Result<(), String> {
    validate_agent_center_config(config)?;
    if config.account_id != account_id
        || config.owner_user_id != scope.owner_user_id
        || config.runtime_source_ref != scope.runtime_source_ref
        || config.local_agent_ref != scope.local_agent_ref
    {
        return Err(
            "Agent Center config identity does not match requested local agent scope".to_string(),
        );
    }
    Ok(())
}

pub(crate) fn default_config(account_id: &str, scope: &LocalAgentScope) -> AgentCenterLocalConfig {
    AgentCenterLocalConfig {
        schema_version: AGENT_CENTER_CONFIG_SCHEMA_VERSION,
        config_kind: AGENT_CENTER_CONFIG_KIND.to_string(),
        account_id: account_id.to_string(),
        owner_user_id: scope.owner_user_id.clone(),
        runtime_source_ref: scope.runtime_source_ref.clone(),
        local_agent_ref: scope.local_agent_ref.clone(),
        modules: AgentCenterLocalConfigModules {
            appearance: AgentCenterAppearanceModule {
                schema_version: AGENT_CENTER_CONFIG_SCHEMA_VERSION,
                background_asset_id: None,
                motion: AgentCenterMotionPreference::System,
            },
            avatar_asset: AgentCenterAvatarAssetModule {
                schema_version: AGENT_CENTER_CONFIG_SCHEMA_VERSION,
                conversation_anchor_scope: AgentCenterAvatarConversationAnchorScope::CurrentAnchor,
                local_avatar_asset_ref: None,
                live2d_adapter_manifest_source: AgentCenterLive2dAdapterManifestSource::None,
                live2d_adapter_manifest_ref: None,
                live2d_calibration_ref: None,
                avatar_instance_policy: AgentCenterAvatarInstancePolicy::ReuseActiveInstance,
                backend_kind: AgentCenterAvatarBackendKind::Live2d,
                backend_capability_profile_ref: None,
                generated_motion_provider_policy:
                    AgentCenterGeneratedMotionProviderPolicy::RequireProfileSupport,
                launch_mode: AgentCenterAvatarLaunchMode::Manual,
                debug_profile: AgentCenterAvatarDebugProfile::Standard,
                updated_at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
                provenance: AgentCenterAvatarConfigProvenance {
                    source: AgentCenterAvatarConfigProvenanceSource::RuntimeProjection,
                    evidence_ref: "agent-center-avatar-config-default".to_string(),
                },
            },
            local_history: AgentCenterLocalHistoryModule {
                schema_version: AGENT_CENTER_CONFIG_SCHEMA_VERSION,
                last_cleared_at: None,
            },
            voice: AgentCenterVoiceModule {
                schema_version: AGENT_CENTER_CONFIG_SCHEMA_VERSION,
                avatar_autoplay: false,
            },
            ui: AgentCenterUiModule {
                schema_version: AGENT_CENTER_CONFIG_SCHEMA_VERSION,
                last_section: AgentCenterSectionId::Overview,
            },
        },
    }
}

pub(crate) fn scope_from_payload(
    payload: &DesktopAgentCenterConfigScopePayload,
) -> Result<(String, LocalAgentScope), String> {
    Ok((
        validate_normalized_id(&payload.account_id, "accountId")?,
        validate_local_agent_scope(
            &payload.owner_user_id,
            &payload.runtime_source_ref,
            &payload.local_agent_ref,
        )?,
    ))
}

fn project_missing_pre_cutover_modules(
    value: &mut serde_json::Value,
    scope: &LocalAgentScope,
) {
    let Some(object) = value.as_object_mut() else {
        return;
    };
    object.insert(
        "owner_user_id".to_string(),
        serde_json::Value::String(scope.owner_user_id.clone()),
    );
    object.insert(
        "runtime_source_ref".to_string(),
        serde_json::Value::String(scope.runtime_source_ref.clone()),
    );
    object.insert(
        "local_agent_ref".to_string(),
        serde_json::Value::String(scope.local_agent_ref.clone()),
    );
    let Some(modules) = object.get_mut("modules").and_then(serde_json::Value::as_object_mut)
    else {
        return;
    };
    modules.entry("voice".to_string()).or_insert_with(|| serde_json::json!({
        "schema_version": AGENT_CENTER_CONFIG_SCHEMA_VERSION,
        "avatar_autoplay": false,
    }));
    if let Some(avatar_asset) = modules
        .get_mut("avatar_asset")
        .and_then(serde_json::Value::as_object_mut)
    {
        avatar_asset
            .entry("live2d_calibration_ref".to_string())
            .or_insert(serde_json::Value::Null);
    }
}

pub(crate) fn config_from_stored_json(
    raw: &str,
    account_id: &str,
    scope: &LocalAgentScope,
) -> Result<(AgentCenterLocalConfig, bool), String> {
    match serde_json::from_str::<AgentCenterLocalConfig>(raw) {
        Ok(config) => {
            validate_agent_center_config_scope(&config, account_id, scope)?;
            Ok((config, false))
        }
        Err(strict_error) => {
            let mut value = serde_json::from_str::<serde_json::Value>(raw)
                .map_err(|_| format!("failed to parse Agent Center config: {strict_error}"))?;
            let Some(object) = value.as_object_mut() else {
                return Err(format!(
                    "failed to parse Agent Center config: {strict_error}"
                ));
            };
            object.insert(
                "account_id".to_string(),
                serde_json::Value::String(account_id.to_string()),
            );
            project_missing_pre_cutover_modules(&mut value, scope);
            let config: AgentCenterLocalConfig =
                serde_json::from_value(value).map_err(|error| {
                    format!(
                    "failed to parse Agent Center config after scoped identity projection: {error}"
                )
                })?;
            validate_agent_center_config_scope(&config, account_id, scope)?;
            Ok((config, true))
        }
    }
}
