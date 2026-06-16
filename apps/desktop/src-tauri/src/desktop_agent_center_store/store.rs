use super::run_agent_center_resource_blocking;
use super::types::*;
use std::fs;

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

#[path = "store_io.rs"]
mod store_io;
#[path = "store_validation.rs"]
mod store_validation;

pub(super) use store_io::*;
pub(super) use store_validation::*;

pub(crate) fn desktop_agent_center_config_get_blocking(
    account_id: &str,
    payload: DesktopAgentCenterConfigScopePayload,
) -> Result<AgentCenterLocalConfig, String> {
    let (_renderer_account_id, scope) = scope_from_payload(&payload)?;
    let account_id = validate_normalized_id(account_id, "accountId")?;
    let path = config_path(&account_id, &scope.local_agent_ref)?;
    if !path.exists() {
        return Ok(default_config(&account_id, &scope));
    }
    let raw = fs::read_to_string(&path).map_err(|error| {
        format!(
            "failed to read Agent Center config ({}): {error}",
            path.display()
        )
    })?;
    let (config, projected) =
        config_from_stored_json(&raw, &account_id, &scope).map_err(|error| {
            format!(
                "failed to parse Agent Center config ({}): {error}",
                path.display()
            )
        })?;
    if projected {
        atomic_write_json(&path, &config)?;
    }
    Ok(config)
}

#[tauri::command]
pub(crate) async fn desktop_agent_center_config_get(
    payload: DesktopAgentCenterConfigScopePayload,
) -> Result<AgentCenterLocalConfig, String> {
    let account_id = super::active_agent_center_account_id().await?;
    run_agent_center_resource_blocking("desktop_agent_center_config_get", move || {
        desktop_agent_center_config_get_blocking(&account_id, payload)
    })
    .await
}

pub(crate) fn desktop_agent_center_config_put_blocking(
    account_id: &str,
    payload: DesktopAgentCenterConfigPutPayload,
) -> Result<AgentCenterLocalConfig, String> {
    let (_renderer_account_id, scope) =
        scope_from_payload(&DesktopAgentCenterConfigScopePayload {
            account_id: payload.account_id,
            owner_user_id: payload.owner_user_id,
            realm_agent_id: payload.realm_agent_id,
            local_agent_ref: payload.local_agent_ref,
        })?;
    let account_id = validate_normalized_id(account_id, "accountId")?;
    validate_agent_center_config_scope(&payload.config, &account_id, &scope)?;
    let dir = agent_center_dir(&account_id, &scope.local_agent_ref)?;
    let _lock = acquire_write_lock(&dir)?;
    let path = dir.join(CONFIG_FILE_NAME);
    atomic_write_json(&path, &payload.config)?;
    Ok(payload.config)
}

#[tauri::command]
pub(crate) async fn desktop_agent_center_config_put(
    payload: DesktopAgentCenterConfigPutPayload,
) -> Result<AgentCenterLocalConfig, String> {
    let account_id = super::active_agent_center_account_id().await?;
    run_agent_center_resource_blocking("desktop_agent_center_config_put", move || {
        desktop_agent_center_config_put_blocking(&account_id, payload)
    })
    .await
}

#[cfg(test)]
#[path = "store_tests.rs"]
mod store_tests;
