use serde::Serialize;
use url::Url;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledNimiAppLaunchBinding {
    pub app_id: String,
    pub app_instance_id: String,
    pub device_id: String,
    pub launch_host_id: String,
    pub launch_nonce: String,
    pub release_descriptor_ref: String,
    pub realm_base_url: String,
}

#[derive(Debug, Clone, Copy)]
pub struct InstalledNimiAppLaunchBindingInput<'a> {
    pub app_id: &'a str,
    pub app_instance_id: &'a str,
    pub device_id: &'a str,
    pub launch_host_id: &'a str,
    pub launch_nonce: &'a str,
    pub release_descriptor_ref: &'a str,
    pub realm_base_url: &'a str,
}

#[derive(Debug, Clone, Copy)]
pub struct InstalledNimiAppLaunchBindingEnvConfig<'a> {
    pub app_id: &'a str,
    pub default_app_instance_id: &'a str,
    pub default_device_id: &'a str,
    pub default_release_descriptor_ref: &'a str,
    pub launch_host_id: &'a str,
    pub launch_nonce_env_keys: &'a [&'a str],
    pub realm_base_url_env_keys: &'a [&'a str],
    pub app_instance_id_env_keys: &'a [&'a str],
    pub device_id_env_keys: &'a [&'a str],
    pub release_descriptor_ref_env_keys: &'a [&'a str],
}

pub fn resolve_installed_nimi_app_launch_binding_from_env(
    config: InstalledNimiAppLaunchBindingEnvConfig<'_>,
) -> Result<InstalledNimiAppLaunchBinding, String> {
    let app_instance_id = optional_env_text(config.app_instance_id_env_keys)
        .unwrap_or_else(|| config.default_app_instance_id.to_string());
    let device_id = optional_env_text(config.device_id_env_keys)
        .unwrap_or_else(|| config.default_device_id.to_string());
    let release_descriptor_ref = optional_env_text(config.release_descriptor_ref_env_keys)
        .unwrap_or_else(|| config.default_release_descriptor_ref.to_string());
    let launch_nonce = optional_env_text(config.launch_nonce_env_keys)
        .ok_or_else(|| "Installed app Tauri launch binding requires launchNonce".to_string())?;
    let realm_base_url = optional_env_text(config.realm_base_url_env_keys)
        .ok_or_else(|| "Installed app Tauri launch binding requires realmBaseUrl".to_string())?;

    resolve_installed_nimi_app_launch_binding_from_values(InstalledNimiAppLaunchBindingInput {
        app_id: config.app_id,
        app_instance_id: &app_instance_id,
        device_id: &device_id,
        launch_host_id: config.launch_host_id,
        launch_nonce: &launch_nonce,
        release_descriptor_ref: &release_descriptor_ref,
        realm_base_url: &realm_base_url,
    })
}

pub fn resolve_installed_nimi_app_launch_binding_from_values(
    input: InstalledNimiAppLaunchBindingInput<'_>,
) -> Result<InstalledNimiAppLaunchBinding, String> {
    Ok(InstalledNimiAppLaunchBinding {
        app_id: require_text(input.app_id, "appId")?,
        app_instance_id: require_text(input.app_instance_id, "appInstanceId")?,
        device_id: require_text(input.device_id, "deviceId")?,
        launch_host_id: require_text(input.launch_host_id, "launchHostId")?,
        launch_nonce: require_text(input.launch_nonce, "launchNonce")?,
        release_descriptor_ref: require_text(input.release_descriptor_ref, "releaseDescriptorRef")?,
        realm_base_url: normalize_realm_base_url(input.realm_base_url)?,
    })
}

pub fn build_installed_nimi_app_launch_binding_script(
    binding: &InstalledNimiAppLaunchBinding,
) -> Result<String, serde_json::Error> {
    let binding_json = serde_json::to_string(binding)?;
    Ok(format!(
        "(function(){{var runtime=window.__NIMI_TAURI_RUNTIME__||{{}};runtime.installedAppLaunchBinding={binding_json};window.__NIMI_TAURI_RUNTIME__=runtime;}})();"
    ))
}

fn require_text(value: &str, field: &str) -> Result<String, String> {
    let normalized = value.trim();
    if normalized.is_empty() {
        return Err(format!(
            "Installed app Tauri launch binding requires {field}"
        ));
    }
    Ok(normalized.to_string())
}

fn normalize_realm_base_url(value: &str) -> Result<String, String> {
    let normalized = require_text(value, "realmBaseUrl")?;
    Url::parse(&normalized)
        .map(|url| url.to_string())
        .map_err(|_| {
            format!("Installed app Tauri launch binding has invalid realmBaseUrl: {normalized}")
        })
}

fn optional_env_text(keys: &[&str]) -> Option<String> {
    keys.iter()
        .find_map(|key| std::env::var(key).ok())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}
