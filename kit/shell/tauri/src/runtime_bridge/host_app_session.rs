use std::sync::{
    atomic::{AtomicU64, Ordering},
    Arc,
};
use std::time::{SystemTime, UNIX_EPOCH};

use tokio::sync::Mutex;
use tonic::metadata::MetadataValue;
use tonic::Request;

use super::generated::runtime_auth_service_client::RuntimeAuthServiceClient;
use super::generated::{
    AppMode, AppModeManifest, OpenSessionRequest, RegisterAppRequest, WorldRelation,
};
use super::{channel_pool, daemon_manager, RuntimeBridgeAppSession};

const DEFAULT_TTL_SECONDS: i32 = 3_600;
const DEFAULT_REFRESH_SKEW_MS: u64 = 60_000;
static HOST_REQUEST_COUNTER: AtomicU64 = AtomicU64::new(1);
pub const RUNTIME_BRIDGE_DESKTOP_TAURI_ACCOUNT_SOURCE_HOST: &str = "desktop-tauri-account-host";
pub const RUNTIME_BRIDGE_TAURI_STANDARD_SHELL_SOURCE_HOST: &str = "tauri-standard-shell";

#[derive(Debug, Clone)]
pub struct RuntimeBridgeHostAppSessionConfig {
    pub app_id: String,
    pub app_instance_id: String,
    pub device_id: String,
    pub app_version: String,
    pub capabilities: Vec<String>,
    pub developer_registration: bool,
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
            developer_registration: false,
            ttl_seconds: DEFAULT_TTL_SECONDS,
            refresh_skew_ms: DEFAULT_REFRESH_SKEW_MS,
        })
    }

    pub fn local_developer_app(
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
            developer_registration: true,
            ttl_seconds: DEFAULT_TTL_SECONDS,
            refresh_skew_ms: DEFAULT_REFRESH_SKEW_MS,
        })
    }
}

#[derive(Debug, Clone)]
struct CachedHostAppSession {
    session: RuntimeBridgeAppSession,
    expires_at_ms: u64,
}

#[derive(Debug, Default)]
struct HostAppSessionState {
    registered: bool,
    cached: Option<CachedHostAppSession>,
    channel_generation: usize,
}

#[derive(Debug, Clone)]
pub struct RuntimeBridgeHostAppSessionProvider {
    config: Arc<RuntimeBridgeHostAppSessionConfig>,
    state: Arc<Mutex<HostAppSessionState>>,
}

impl RuntimeBridgeHostAppSessionProvider {
    pub fn new(config: RuntimeBridgeHostAppSessionConfig) -> Result<Self, String> {
        validate_config(&config)?;
        Ok(Self {
            config: Arc::new(config),
            state: Arc::new(Mutex::new(HostAppSessionState {
                channel_generation: channel_pool::invalidation_count(),
                ..HostAppSessionState::default()
            })),
        })
    }

    pub async fn resolve(&self) -> Result<RuntimeBridgeAppSession, String> {
        let mut state = self.state.lock().await;
        let channel_generation = channel_pool::invalidation_count();
        if state.channel_generation != channel_generation {
            state.registered = false;
            state.cached = None;
            state.channel_generation = channel_generation;
        }
        let now_ms = unix_time_ms();
        if let Some(cached) = state.cached.as_ref() {
            if cached.expires_at_ms.saturating_sub(now_ms) > self.config.refresh_skew_ms {
                return Ok(cached.session.clone());
            }
        }

        let channel = channel_pool::shared_unary_channel(&daemon_manager::grpc_addr()).await?;
        let mut client = RuntimeAuthServiceClient::new(channel);
        if !state.registered {
            let response = client
                .register_app(host_request(
                    RegisterAppRequest {
                        app_id: self.config.app_id.clone(),
                        app_instance_id: self.config.app_instance_id.clone(),
                        device_id: self.config.device_id.clone(),
                        app_version: self.config.app_version.clone(),
                        capabilities: self.config.capabilities.clone(),
                        mode_manifest: Some(AppModeManifest {
                            app_mode: AppMode::Full as i32,
                            runtime_required: true,
                            realm_required: true,
                            world_relation: WorldRelation::None as i32,
                        }),
                        developer_registration: self.config.developer_registration,
                    },
                    &self.config,
                )?)
                .await
                .map_err(|error| format!("RUNTIME_BRIDGE_HOST_APP_REGISTER_FAILED: {error}"))?
                .into_inner();
            if !response.accepted {
                return Err(format!(
                    "RUNTIME_BRIDGE_HOST_APP_REGISTER_REJECTED: {}",
                    response.reason_code
                ));
            }
            state.registered = true;
        }

        let response = client
            .open_session(host_request(
                OpenSessionRequest {
                    app_id: self.config.app_id.clone(),
                    app_instance_id: self.config.app_instance_id.clone(),
                    device_id: self.config.device_id.clone(),
                    subject_user_id: String::new(),
                    ttl_seconds: self.config.ttl_seconds,
                },
                &self.config,
            )?)
            .await
            .map_err(|error| format!("RUNTIME_BRIDGE_HOST_APP_SESSION_OPEN_FAILED: {error}"))?
            .into_inner();
        let session_id = require_text(&response.session_id, "session_id")?;
        let session_token = require_text(&response.session_token, "session_token")?;
        let expires_at_ms = response
            .expires_at
            .as_ref()
            .and_then(timestamp_millis)
            .unwrap_or_else(|| now_ms.saturating_add(self.config.ttl_seconds as u64 * 1_000));
        let cached = CachedHostAppSession {
            session: RuntimeBridgeAppSession {
                session_id,
                session_token,
            },
            expires_at_ms,
        };
        let session = cached.session.clone();
        state.cached = Some(cached);
        Ok(session)
    }
}

fn host_request<T>(
    value: T,
    config: &RuntimeBridgeHostAppSessionConfig,
) -> Result<Request<T>, String> {
    let mut request = Request::new(value);
    let idempotency_key = format!(
        "tauri-host-session-{}-{}-{}",
        config.app_id,
        unix_time_ms(),
        HOST_REQUEST_COUNTER.fetch_add(1, Ordering::Relaxed),
    );
    for (key, value) in [
        ("x-nimi-protocol-version", "1.0.0"),
        ("x-nimi-participant-protocol-version", "1.0.0"),
        ("x-nimi-participant-id", config.app_id.as_str()),
        ("x-nimi-domain", "runtime.auth"),
        ("x-nimi-app-id", config.app_id.as_str()),
        ("x-nimi-app-instance-id", config.app_instance_id.as_str()),
        ("x-nimi-device-id", config.device_id.as_str()),
        ("x-nimi-caller-kind", "desktop-shell"),
        ("x-nimi-caller-id", config.app_instance_id.as_str()),
        ("x-nimi-surface-id", "tauri-standard-shell"),
        ("x-nimi-idempotency-key", idempotency_key.as_str()),
    ] {
        request.metadata_mut().insert(
            key,
            MetadataValue::try_from(value)
                .map_err(|_| format!("RUNTIME_BRIDGE_HOST_APP_METADATA_INVALID: {key}"))?,
        );
    }
    Ok(request)
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

fn timestamp_millis(value: &prost_types::Timestamp) -> Option<u64> {
    if value.seconds <= 0 {
        return None;
    }
    let millis = (value.seconds as u64)
        .saturating_mul(1_000)
        .saturating_add((value.nanos.max(0) as u64) / 1_000_000);
    Some(millis)
}

fn unix_time_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
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

    #[test]
    fn local_developer_config_preserves_caller_binding_and_requests_developer_registration() {
        let config = RuntimeBridgeHostAppSessionConfig::local_developer_app(
            "nimi.tester",
            "nimi.tester.local-developer",
            "nimi-tester-local-developer-device",
            vec![
                "data.scope.read#realm.worlds.read-probe".to_string(),
                "account.session.read".to_string(),
                "account.session.read".to_string(),
            ],
        )
        .expect("local developer config");
        assert_eq!(config.app_id, "nimi.tester");
        assert_eq!(config.app_instance_id, "nimi.tester.local-developer");
        assert_eq!(config.device_id, "nimi-tester-local-developer-device");
        assert!(config.developer_registration);
        assert_eq!(
            config.capabilities,
            vec![
                "account.session.read",
                "data.scope.read#realm.worlds.read-probe"
            ]
        );
    }

    #[test]
    fn host_session_requests_carry_complete_runtime_protocol_envelope() {
        let config = RuntimeBridgeHostAppSessionConfig::local_developer_app(
            "nimi.tester",
            "nimi.tester.local-developer",
            "nimi-tester-local-developer-device",
            vec!["account.session.read".to_string()],
        )
        .expect("config");
        let request = host_request((), &config).expect("host request");
        let metadata = request.metadata();
        assert_eq!(
            metadata
                .get("x-nimi-domain")
                .and_then(|value| value.to_str().ok()),
            Some("runtime.auth")
        );
        assert_eq!(
            metadata
                .get("x-nimi-app-instance-id")
                .and_then(|value| value.to_str().ok()),
            Some("nimi.tester.local-developer")
        );
        assert_eq!(
            metadata
                .get("x-nimi-device-id")
                .and_then(|value| value.to_str().ok()),
            Some("nimi-tester-local-developer-device")
        );
        assert!(metadata.get("x-nimi-idempotency-key").is_some());
    }

    #[tokio::test]
    async fn channel_invalidation_prevents_reusing_a_cached_host_session() {
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
        {
            let mut state = provider.state.lock().await;
            state.registered = true;
            state.cached = Some(CachedHostAppSession {
                session: RuntimeBridgeAppSession {
                    session_id: "stale-session".to_string(),
                    session_token: "stale-token".to_string(),
                },
                expires_at_ms: unix_time_ms().saturating_add(3_600_000),
            });
        }

        channel_pool::invalidate_channel();
        let resolved = provider.resolve().await.ok();

        assert_ne!(
            resolved.map(|session| session.session_id),
            Some("stale-session".to_string()),
            "a Runtime channel generation change must invalidate the host app session cache",
        );
    }
}
