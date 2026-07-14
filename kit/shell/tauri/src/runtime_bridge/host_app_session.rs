use super::generated::ReasonCode;
use super::RuntimeBridgeAppSession;

const DEFAULT_TTL_SECONDS: i32 = 3_600;
const DEFAULT_REFRESH_SKEW_MS: u64 = 60_000;
pub const RUNTIME_BRIDGE_TAURI_STANDARD_SHELL_SOURCE_HOST: &str = "tauri-standard-shell";

/// Desktop-shell binding configuration. These values are not sent to the
/// protected Local App carrier and cannot establish third-party authority.
#[derive(Debug, Clone)]
pub struct RuntimeBridgeHostAppSessionConfig {
    pub app_id: String,
    pub app_instance_id: String,
    pub device_id: String,
    pub app_version: String,
    pub capabilities: Vec<String>,
    pub ttl_seconds: i32,
    pub refresh_skew_ms: u64,
}

impl RuntimeBridgeHostAppSessionConfig {
    pub fn desktop_shell(
        app_id: &str,
        app_instance_id: &str,
        device_id: &str,
        capabilities: Vec<String>,
    ) -> Result<Self, String> {
        Ok(Self {
            app_id: require_text(app_id, "app_id")?,
            app_instance_id: require_text(app_instance_id, "app_instance_id")?,
            device_id: require_text(device_id, "device_id")?,
            app_version: "1".to_string(),
            capabilities: normalize_capabilities(capabilities),
            ttl_seconds: DEFAULT_TTL_SECONDS,
            refresh_skew_ms: DEFAULT_REFRESH_SKEW_MS,
        })
    }
}

/// A Tauri Desktop host cannot mint an app session over the ordinary Runtime
/// bridge. Third-party Local Apps use `RuntimeBridgeLocalAppHost` instead.
#[derive(Debug, Clone, Default)]
pub struct RuntimeBridgeHostAppSessionProvider;

impl RuntimeBridgeHostAppSessionProvider {
    pub fn new(config: RuntimeBridgeHostAppSessionConfig) -> Result<Self, String> {
        validate_config(&config)?;
        Ok(Self)
    }

    pub async fn resolve(&self) -> Result<RuntimeBridgeAppSession, String> {
        Err(protected_carrier_required_error())
    }
}

fn protected_carrier_required_error() -> String {
    ReasonCode::DesktopControlTransportRequired
        .as_str_name()
        .to_string()
}

fn validate_config(config: &RuntimeBridgeHostAppSessionConfig) -> Result<(), String> {
    require_text(&config.app_id, "app_id")?;
    require_text(&config.app_instance_id, "app_instance_id")?;
    require_text(&config.device_id, "device_id")?;
    require_text(&config.app_version, "app_version")?;
    if config.ttl_seconds <= 0 {
        return Err("Runtime bridge host app session ttl_seconds must be positive".to_string());
    }
    Ok(())
}

fn normalize_capabilities(values: Vec<String>) -> Vec<String> {
    let mut out = values
        .into_iter()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    out.sort();
    out.dedup();
    out
}

fn require_text(value: &str, field: &str) -> Result<String, String> {
    let normalized = value.trim();
    if normalized.is_empty() {
        return Err(format!("Runtime bridge host app session requires {field}"));
    }
    Ok(normalized.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn desktop_shell_config_normalizes_capabilities_and_rejects_empty_identity() {
        let config = RuntimeBridgeHostAppSessionConfig::desktop_shell(
            " nimi.desktop ",
            "nimi.desktop.local-first-party",
            "desktop-shell",
            vec![
                "runtime.agent.read".to_string(),
                "runtime.agent.read".to_string(),
            ],
        )
        .expect("config");
        assert_eq!(config.app_id, "nimi.desktop");
        assert_eq!(config.capabilities, vec!["runtime.agent.read"]);
        assert!(
            RuntimeBridgeHostAppSessionConfig::desktop_shell("", "instance", "device", vec![])
                .is_err()
        );
    }

    #[tokio::test]
    async fn provider_refuses_ordinary_transport_before_any_session_can_be_cached() {
        let provider = RuntimeBridgeHostAppSessionProvider::new(
            RuntimeBridgeHostAppSessionConfig::desktop_shell(
                "nimi.desktop",
                "nimi.desktop.local-first-party",
                "desktop-shell",
                vec![],
            )
            .expect("config"),
        )
        .expect("provider");

        assert_eq!(
            provider
                .resolve()
                .await
                .expect_err("protected carrier required"),
            ReasonCode::DesktopControlTransportRequired.as_str_name(),
        );
        assert_eq!(
            provider
                .resolve()
                .await
                .expect_err("protected carrier required"),
            ReasonCode::DesktopControlTransportRequired.as_str_name(),
        );
    }
}
