use super::*;

pub(super) fn select_imported_avatar_asset(
    account_id: &str,
    scope: &LocalAgentScope,
    kind: AgentCenterAvatarBackendKind,
    local_asset_id: &str,
    backend_capability_profile_ref: &str,
    embedded_live2d_adapter: bool,
) -> Result<(), String> {
    let mut config = desktop_agent_center_config_get_blocking(
        account_id,
        DesktopAgentCenterConfigScopePayload {
            account_id: account_id.to_string(),
            owner_user_id: scope.owner_user_id.clone(),
            runtime_source_ref: scope.runtime_source_ref.clone(),
            local_agent_ref: scope.local_agent_ref.clone(),
        },
    )?;
    config.modules.avatar_asset.local_avatar_asset_ref = Some(local_asset_id.to_string());
    config.modules.avatar_asset.backend_kind = kind;
    config.modules.avatar_asset.backend_capability_profile_ref =
        Some(backend_capability_profile_ref.to_string());
    if kind == AgentCenterAvatarBackendKind::Live2d && embedded_live2d_adapter {
        config.modules.avatar_asset.live2d_adapter_manifest_source =
            AgentCenterLive2dAdapterManifestSource::EmbeddedCreatorManifest;
        config.modules.avatar_asset.live2d_adapter_manifest_ref = None;
    } else {
        config.modules.avatar_asset.live2d_adapter_manifest_source =
            AgentCenterLive2dAdapterManifestSource::None;
        config.modules.avatar_asset.live2d_adapter_manifest_ref = None;
    }
    config.modules.avatar_asset.live2d_calibration_ref = None;
    config.modules.avatar_asset.updated_at =
        chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    config.modules.avatar_asset.provenance = AgentCenterAvatarConfigProvenance {
        source: AgentCenterAvatarConfigProvenanceSource::ImportValidation,
        evidence_ref: local_asset_id.to_string(),
    };
    desktop_agent_center_config_put_blocking(
        account_id,
        DesktopAgentCenterConfigPutPayload {
            account_id: account_id.to_string(),
            owner_user_id: scope.owner_user_id.clone(),
            runtime_source_ref: scope.runtime_source_ref.clone(),
            local_agent_ref: scope.local_agent_ref.clone(),
            config,
        },
    )?;
    Ok(())
}

pub(super) fn select_imported_live2d_adapter_manifest(
    account_id: &str,
    scope: &LocalAgentScope,
    local_asset_id: &str,
    manifest_ref: &str,
) -> Result<(), String> {
    let mut config = desktop_agent_center_config_get_blocking(
        account_id,
        DesktopAgentCenterConfigScopePayload {
            account_id: account_id.to_string(),
            owner_user_id: scope.owner_user_id.clone(),
            runtime_source_ref: scope.runtime_source_ref.clone(),
            local_agent_ref: scope.local_agent_ref.clone(),
        },
    )?;
    if config.modules.avatar_asset.backend_kind != AgentCenterAvatarBackendKind::Live2d
        || config
            .modules
            .avatar_asset
            .local_avatar_asset_ref
            .as_deref()
            != Some(local_asset_id)
    {
        return Err(
            "external Live2D adapter manifest requires matching runtime-projected Live2D asset evidence".to_string(),
        );
    }
    config.modules.avatar_asset.live2d_adapter_manifest_source =
        AgentCenterLive2dAdapterManifestSource::ExternalSidecarManifest;
    config.modules.avatar_asset.live2d_adapter_manifest_ref = Some(manifest_ref.to_string());
    config.modules.avatar_asset.live2d_calibration_ref = None;
    config.modules.avatar_asset.updated_at =
        chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    config.modules.avatar_asset.provenance = AgentCenterAvatarConfigProvenance {
        source: AgentCenterAvatarConfigProvenanceSource::ImportValidation,
        evidence_ref: manifest_ref.to_string(),
    };
    desktop_agent_center_config_put_blocking(
        account_id,
        DesktopAgentCenterConfigPutPayload {
            account_id: account_id.to_string(),
            owner_user_id: scope.owner_user_id.clone(),
            runtime_source_ref: scope.runtime_source_ref.clone(),
            local_agent_ref: scope.local_agent_ref.clone(),
            config,
        },
    )?;
    Ok(())
}
