use super::types::*;
use chrono::DateTime;
use sha2::{Digest, Sha256};
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

const AGENT_CENTER_CONFIG_SCHEMA_VERSION: u8 = 1;
const AGENT_CENTER_CONFIG_KIND: &str = "agent_center_local_config";
const CONFIG_FILE_NAME: &str = "config.json";
const LOCK_FILE_NAME: &str = "config.json.lock";
const LOCAL_AGENT_REF_PREFIX: &str = "local-agent:";

#[derive(Debug, Clone)]
pub(super) struct LocalAgentScope {
    pub(super) owner_user_id: String,
    pub(super) realm_agent_id: String,
    pub(super) local_agent_ref: String,
}

struct ConfigWriteLock {
    path: PathBuf,
}

impl Drop for ConfigWriteLock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

fn now_nanos() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or(0)
}

pub(super) fn validate_normalized_id(value: &str, field_name: &str) -> Result<String, String> {
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

pub(super) fn expected_local_agent_ref(owner_user_id: &str, realm_agent_id: &str) -> String {
    format!("{LOCAL_AGENT_REF_PREFIX}{owner_user_id}:{realm_agent_id}")
}

pub(super) fn validate_local_agent_scope(
    owner_user_id: &str,
    realm_agent_id: &str,
    local_agent_ref: &str,
) -> Result<LocalAgentScope, String> {
    let owner_user_id = validate_normalized_id(owner_user_id, "ownerUserId")?;
    let realm_agent_id = validate_normalized_id(realm_agent_id, "realmAgentId")?;
    let local_agent_ref = validate_normalized_id(local_agent_ref, "localAgentRef")?;
    if local_agent_ref == realm_agent_id {
        return Err("localAgentRef must not be a bare realmAgentId".to_string());
    }
    if !local_agent_ref.starts_with(LOCAL_AGENT_REF_PREFIX) {
        return Err("localAgentRef must start with local-agent:".to_string());
    }
    let expected = expected_local_agent_ref(&owner_user_id, &realm_agent_id);
    if local_agent_ref != expected {
        return Err(
            "localAgentRef must equal local-agent:${ownerUserId}:${realmAgentId}".to_string(),
        );
    }
    Ok(LocalAgentScope {
        owner_user_id,
        realm_agent_id,
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

pub(super) fn local_scope_path_segment(value: &str) -> String {
    if can_use_raw_scope_path_segment(value) {
        return value.to_string();
    }
    let mut hasher = Sha256::new();
    hasher.update(value.as_bytes());
    let digest = format!("{:x}", hasher.finalize());
    format!("id_{}", &digest[..24])
}

pub(super) fn validate_hex_suffix(
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

pub(super) fn validate_background_id(value: &str, field_name: &str) -> Result<(), String> {
    validate_hex_suffix(value, "bg_", field_name)
}

pub(super) fn validate_local_asset_id(value: &str, field_name: &str) -> Result<(), String> {
    if value.starts_with("live2d_") {
        return validate_hex_suffix(value, "live2d_", field_name);
    }
    if value.starts_with("vrm_") {
        return validate_hex_suffix(value, "vrm_", field_name);
    }
    Err(format!("{field_name} must start with live2d_ or vrm_"))
}

pub(super) fn validate_live2d_adapter_manifest_ref(
    value: &str,
    field_name: &str,
) -> Result<(), String> {
    validate_hex_suffix(value, "live2d_adapter_", field_name)
}

pub(super) fn validate_utc_timestamp(value: &str, field_name: &str) -> Result<(), String> {
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
        &config.realm_agent_id,
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
        validate_normalized_id(local_asset_ref, "modules.avatar_asset.local_avatar_asset_ref")?;
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
        config.modules.ui.schema_version,
        "modules.ui.schema_version",
    )?;
    Ok(())
}

fn default_config(account_id: String, scope: LocalAgentScope) -> AgentCenterLocalConfig {
    AgentCenterLocalConfig {
        schema_version: AGENT_CENTER_CONFIG_SCHEMA_VERSION,
        config_kind: AGENT_CENTER_CONFIG_KIND.to_string(),
        account_id,
        owner_user_id: scope.owner_user_id,
        realm_agent_id: scope.realm_agent_id,
        local_agent_ref: scope.local_agent_ref,
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
            ui: AgentCenterUiModule {
                schema_version: AGENT_CENTER_CONFIG_SCHEMA_VERSION,
                last_section: AgentCenterSectionId::Overview,
            },
        },
    }
}

fn scope_from_payload(
    payload: &DesktopAgentCenterConfigScopePayload,
) -> Result<(String, LocalAgentScope), String> {
    Ok((
        validate_normalized_id(&payload.account_id, "accountId")?,
        validate_local_agent_scope(
            &payload.owner_user_id,
            &payload.realm_agent_id,
            &payload.local_agent_ref,
        )?,
    ))
}

pub(super) fn agent_center_dir(account_id: &str, local_agent_ref: &str) -> Result<PathBuf, String> {
    Ok(crate::desktop_paths::resolve_nimi_data_dir()?
        .join("accounts")
        .join(local_scope_path_segment(account_id))
        .join("agents")
        .join(local_scope_path_segment(local_agent_ref))
        .join("agent-center"))
}

fn config_path(account_id: &str, local_agent_ref: &str) -> Result<PathBuf, String> {
    Ok(agent_center_dir(account_id, local_agent_ref)?.join(CONFIG_FILE_NAME))
}

fn acquire_write_lock(dir: &Path) -> Result<ConfigWriteLock, String> {
    fs::create_dir_all(dir).map_err(|error| {
        format!(
            "failed to create Agent Center config directory ({}): {error}",
            dir.display()
        )
    })?;
    let path = dir.join(LOCK_FILE_NAME);
    let mut file = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&path)
        .map_err(|error| format!("Agent Center config is currently locked: {error}"))?;
    file.write_all(std::process::id().to_string().as_bytes())
        .map_err(|error| format!("failed to write Agent Center config lock: {error}"))?;
    Ok(ConfigWriteLock { path })
}

fn atomic_write_json(path: &Path, config: &AgentCenterLocalConfig) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "Agent Center config path has no parent".to_string())?;
    fs::create_dir_all(parent).map_err(|error| {
        format!(
            "failed to create Agent Center config directory ({}): {error}",
            parent.display()
        )
    })?;
    let raw = serde_json::to_string_pretty(config)
        .map_err(|error| format!("failed to serialize Agent Center config: {error}"))?;
    let tmp_path = parent.join(format!(
        ".config.json.tmp.{}.{}",
        std::process::id(),
        now_nanos()
    ));
    fs::write(&tmp_path, raw).map_err(|error| {
        format!(
            "failed to write Agent Center config temp file ({}): {error}",
            tmp_path.display()
        )
    })?;
    fs::rename(&tmp_path, path).map_err(|error| {
        let _ = fs::remove_file(&tmp_path);
        format!(
            "failed to finalize Agent Center config ({}): {error}",
            path.display()
        )
    })
}

#[tauri::command]
pub(crate) fn desktop_agent_center_config_get(
    payload: DesktopAgentCenterConfigScopePayload,
) -> Result<AgentCenterLocalConfig, String> {
    let (account_id, scope) = scope_from_payload(&payload)?;
    let path = config_path(&account_id, &scope.local_agent_ref)?;
    if !path.exists() {
        return Ok(default_config(account_id, scope));
    }
    let raw = fs::read_to_string(&path).map_err(|error| {
        format!(
            "failed to read Agent Center config ({}): {error}",
            path.display()
        )
    })?;
    let config = serde_json::from_str::<AgentCenterLocalConfig>(&raw).map_err(|error| {
        format!(
            "failed to parse Agent Center config ({}): {error}",
            path.display()
        )
    })?;
    validate_agent_center_config(&config)?;
    if config.account_id != account_id
        || config.owner_user_id != scope.owner_user_id
        || config.realm_agent_id != scope.realm_agent_id
        || config.local_agent_ref != scope.local_agent_ref
    {
        return Err(
            "Agent Center config scope does not match requested account/localAgentRef".to_string(),
        );
    }
    Ok(config)
}

#[tauri::command]
pub(crate) fn desktop_agent_center_config_put(
    payload: DesktopAgentCenterConfigPutPayload,
) -> Result<AgentCenterLocalConfig, String> {
    let (account_id, scope) = scope_from_payload(&DesktopAgentCenterConfigScopePayload {
        account_id: payload.account_id,
        owner_user_id: payload.owner_user_id,
        realm_agent_id: payload.realm_agent_id,
        local_agent_ref: payload.local_agent_ref,
    })?;
    if payload.config.account_id != account_id
        || payload.config.owner_user_id != scope.owner_user_id
        || payload.config.realm_agent_id != scope.realm_agent_id
        || payload.config.local_agent_ref != scope.local_agent_ref
    {
        return Err(
            "Agent Center config scope does not match payload account/localAgentRef".to_string(),
        );
    }
    validate_agent_center_config(&payload.config)?;
    let dir = agent_center_dir(&account_id, &scope.local_agent_ref)?;
    let _lock = acquire_write_lock(&dir)?;
    let path = dir.join(CONFIG_FILE_NAME);
    atomic_write_json(&path, &payload.config)?;
    Ok(payload.config)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_support::with_env;

    fn temp_home(prefix: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("nimi-agent-center-{prefix}-{}", now_nanos()));
        fs::create_dir_all(&dir).expect("create temp home");
        dir
    }

    fn owner_user_id() -> String {
        "owner_1".to_string()
    }

    fn realm_agent_id() -> String {
        "agent_1".to_string()
    }

    fn local_agent_ref() -> String {
        "local-agent:owner_1:agent_1".to_string()
    }

    fn local_scope() -> LocalAgentScope {
        validate_local_agent_scope(&owner_user_id(), &realm_agent_id(), &local_agent_ref())
            .expect("local scope")
    }

    fn scope_payload() -> DesktopAgentCenterConfigScopePayload {
        DesktopAgentCenterConfigScopePayload {
            account_id: "account_1".to_string(),
            owner_user_id: owner_user_id(),
            realm_agent_id: realm_agent_id(),
            local_agent_ref: local_agent_ref(),
        }
    }

    fn valid_config() -> AgentCenterLocalConfig {
        let mut config = default_config("account_1".to_string(), local_scope());
        config.modules.avatar_asset.local_avatar_asset_ref = Some("live2d_ab12cd34ef56".to_string());
        config.modules.avatar_asset.backend_kind = AgentCenterAvatarBackendKind::Live2d;
        config
    }

    #[test]
    fn local_agent_scope_requires_exact_derived_ref() {
        assert!(
            validate_local_agent_scope("owner_1", "agent_1", "local-agent:owner_1:agent_1").is_ok()
        );
        assert!(validate_local_agent_scope("owner_1", "agent_1", "agent_1").is_err());
        assert!(
            validate_local_agent_scope("owner_1", "agent_1", "local-agent:owner_2:agent_1")
                .is_err()
        );
        assert!(
            validate_local_agent_scope("owner_1", "agent_1", "local-agent:owner_1:agent_2")
                .is_err()
        );
        assert!(validate_local_agent_scope("owner_1", "agent_1", "agent:abc.def+1").is_err());
    }

    #[test]
    fn missing_config_returns_default_without_creating_file() {
        let home = temp_home("default");
        with_env(&[("HOME", home.to_str())], || {
            let config = desktop_agent_center_config_get(scope_payload()).expect("default config");
            assert_eq!(config.config_kind, AGENT_CENTER_CONFIG_KIND);
            assert!(config.modules.avatar_asset.local_avatar_asset_ref.is_none());
            assert!(!home
                .join(format!(
                    ".nimi/data/accounts/account_1/agents/{}/agent-center/config.json",
                    local_scope_path_segment(&local_agent_ref())
                ))
                .exists());
        });
    }

    #[test]
    fn put_persists_and_get_reads_valid_config() {
        let home = temp_home("persist");
        with_env(&[("HOME", home.to_str())], || {
            let config = valid_config();
            desktop_agent_center_config_put(DesktopAgentCenterConfigPutPayload {
                account_id: "account_1".to_string(),
                owner_user_id: owner_user_id(),
                realm_agent_id: realm_agent_id(),
                local_agent_ref: local_agent_ref(),
                config,
            })
            .expect("put config");
            let loaded = desktop_agent_center_config_get(scope_payload()).expect("get config");
            assert_eq!(
                loaded.modules.avatar_asset.local_avatar_asset_ref.as_deref(),
                Some("live2d_ab12cd34ef56")
            );
        });
    }

    #[test]
    fn put_rejects_scope_mismatch() {
        let home = temp_home("scope");
        with_env(&[("HOME", home.to_str())], || {
            let err = desktop_agent_center_config_put(DesktopAgentCenterConfigPutPayload {
                account_id: "account_1".to_string(),
                owner_user_id: owner_user_id(),
                realm_agent_id: "agent_2".to_string(),
                local_agent_ref: "local-agent:owner_1:agent_2".to_string(),
                config: valid_config(),
            })
            .expect_err("scope mismatch");
            assert!(err.contains("scope"));
        });
    }

    #[test]
    fn get_rejects_unknown_fields_in_stored_json() {
        let home = temp_home("unknown");
        with_env(&[("HOME", home.to_str())], || {
            let dir = home.join(format!(
                ".nimi/data/accounts/account_1/agents/{}/agent-center",
                local_scope_path_segment(&local_agent_ref())
            ));
            fs::create_dir_all(&dir).expect("dir");
            fs::write(
                dir.join(CONFIG_FILE_NAME),
                r#"{
                  "schema_version": 1,
                  "config_kind": "agent_center_local_config",
                  "account_id": "account_1",
                  "owner_user_id": "owner_1",
                  "realm_agent_id": "agent_1",
                  "local_agent_ref": "local-agent:owner_1:agent_1",
                  "runtime_profile": "forbidden",
                  "modules": {
                    "appearance": {"schema_version": 1, "background_asset_id": null, "motion": "system"},
                    "avatar_asset": {
                      "schema_version": 1,
                      "selected_package": null,
                      "conversation_anchor_scope": "current_anchor",
                      "local_avatar_asset_ref": null,
                      "live2d_adapter_manifest_source": "none",
                      "live2d_adapter_manifest_ref": null,
                      "avatar_instance_policy": "reuse_active_instance",
                      "backend_kind": "live2d",
                      "backend_capability_profile_ref": null,
                      "generated_motion_provider_policy": "require_profile_support",
                      "launch_mode": "manual",
                      "debug_profile": "standard",
                      "updated_at": "2026-04-27T00:00:00Z",
                      "provenance": {"source": "runtime_projection", "evidence_ref": "agent-center-avatar-config-default"},
                      "last_validated_at": null
                    },
                    "local_history": {"schema_version": 1, "last_cleared_at": null},
                    "ui": {"schema_version": 1, "last_section": "overview"}
                  }
                }"#,
            )
            .expect("write corrupt config");
            let err = desktop_agent_center_config_get(scope_payload())
                .expect_err("unknown field rejected");
            assert!(err.contains("runtime_profile") || err.contains("unknown field"));
        });
    }
}
