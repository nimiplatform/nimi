use std::collections::HashMap;
use std::fmt;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tonic::metadata::MetadataValue;
use tonic::Request;

use super::error_map::bridge_error;
use super::{RuntimeBridgeAppSession, RuntimeBridgeProtectedAccessToken};

static IDEMPOTENCY_COUNTER: AtomicU64 = AtomicU64::new(1);
const SUPPORTED_PROTOCOL_VERSION: &str = "1.0.0";
const SUPPORTED_PARTICIPANT_PROTOCOL_VERSION: &str = "1.0.0";
const RESERVED_METADATA_KEYS: &[&str] = &[
    "authorization",
    "x-nimi-protocol-version",
    "x-nimi-participant-protocol-version",
    "x-nimi-participant-id",
    "x-nimi-domain",
    "x-nimi-idempotency-key",
    "x-nimi-caller-kind",
    "x-nimi-caller-id",
    "x-nimi-app-id",
    "x-nimi-trace-id",
    "x-nimi-surface-id",
    "x-nimi-key-source",
    "x-nimi-provider-endpoint",
    "x-nimi-provider-api-key",
    "x-nimi-access-token-id",
    "x-nimi-access-token-secret",
    "x-nimi-session-id",
    "x-nimi-session-token",
];

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeBridgeMetadata {
    pub protocol_version: Option<String>,
    pub participant_protocol_version: Option<String>,
    pub participant_id: Option<String>,
    pub domain: Option<String>,
    pub app_id: Option<String>,
    pub trace_id: Option<String>,
    pub idempotency_key: Option<String>,
    pub caller_kind: Option<String>,
    pub caller_id: Option<String>,
    pub surface_id: Option<String>,
    pub key_source: Option<String>,
    pub provider_endpoint: Option<String>,
    pub provider_api_key: Option<String>,
    pub extra: Option<HashMap<String, String>>,
}

fn redact_secret(value: &str) -> String {
    if value.trim().is_empty() {
        String::new()
    } else {
        "***REDACTED***".to_string()
    }
}

impl fmt::Debug for RuntimeBridgeMetadata {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let mut debug = f.debug_struct("RuntimeBridgeMetadata");
        debug
            .field("protocol_version", &self.protocol_version)
            .field(
                "participant_protocol_version",
                &self.participant_protocol_version,
            )
            .field("participant_id", &self.participant_id)
            .field("domain", &self.domain)
            .field("app_id", &self.app_id)
            .field("trace_id", &self.trace_id)
            .field("idempotency_key", &self.idempotency_key)
            .field("caller_kind", &self.caller_kind)
            .field("caller_id", &self.caller_id)
            .field("surface_id", &self.surface_id)
            .field("key_source", &self.key_source)
            .field("provider_endpoint", &self.provider_endpoint)
            .field(
                "provider_api_key",
                &self
                    .provider_api_key
                    .as_ref()
                    .map(|value| redact_secret(value.as_str())),
            );

        let redacted_extra = self.extra.as_ref().map(|extra| {
            extra
                .iter()
                .map(|(key, value)| {
                    if key.trim().eq_ignore_ascii_case("x-nimi-provider-api-key") {
                        (key.clone(), redact_secret(value.as_str()))
                    } else {
                        (key.clone(), value.clone())
                    }
                })
                .collect::<HashMap<String, String>>()
        });
        debug.field("extra", &redacted_extra).finish()
    }
}

#[derive(Clone, Default)]
pub struct RuntimeBridgeTrustedMetadata {
    pub metadata: Option<RuntimeBridgeMetadata>,
    pub authorization: Option<String>,
    pub protected_access_token: Option<RuntimeBridgeProtectedAccessToken>,
    pub app_session: Option<RuntimeBridgeAppSession>,
}

impl fmt::Debug for RuntimeBridgeTrustedMetadata {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("RuntimeBridgeTrustedMetadata")
            .field("metadata", &self.metadata)
            .field(
                "authorization",
                &self
                    .authorization
                    .as_ref()
                    .map(|value| redact_secret(value)),
            )
            .field("protected_access_token", &self.protected_access_token)
            .field("app_session", &self.app_session)
            .finish()
    }
}

#[derive(Debug)]
pub(crate) struct RuntimeBridgeResolvedMetadata {
    pub metadata: Option<RuntimeBridgeMetadata>,
    pub authorization: Option<String>,
    pub protected_access_token: Option<RuntimeBridgeProtectedAccessToken>,
    pub app_session: Option<RuntimeBridgeAppSession>,
}

fn normalize(value: Option<&str>) -> Option<String> {
    let text = value.unwrap_or("").trim();
    if text.is_empty() {
        None
    } else {
        Some(text.to_string())
    }
}

fn insert_metadata_value(
    request: &mut Request<Vec<u8>>,
    key: &'static str,
    value: Option<String>,
) -> Result<(), String> {
    let Some(value) = value else {
        return Ok(());
    };

    let metadata_value = MetadataValue::try_from(value.as_str())
        .map_err(|_| bridge_error("RUNTIME_BRIDGE_METADATA_INVALID", key))?;
    request.metadata_mut().insert(key, metadata_value);
    Ok(())
}

fn is_semver_like(value: &str) -> bool {
    let parts: Vec<&str> = value.split('.').collect();
    if parts.len() != 3 {
        return false;
    }
    parts
        .iter()
        .all(|part| !part.is_empty() && part.chars().all(|ch| ch.is_ascii_digit()))
}

fn validate_protocol_version(value: &str, expected: &str, header: &str) -> Result<String, String> {
    if !is_semver_like(value) {
        return Err(bridge_error(
            "RUNTIME_BRIDGE_PROTOCOL_VERSION_INVALID",
            header,
        ));
    }
    if value != expected {
        return Err(bridge_error(
            "RUNTIME_BRIDGE_PROTOCOL_VERSION_UNSUPPORTED",
            header,
        ));
    }
    Ok(value.to_string())
}

fn normalized_metadata_key(value: &str) -> String {
    value
        .chars()
        .filter(|ch| *ch != '-' && *ch != '_')
        .collect::<String>()
        .to_ascii_lowercase()
}

fn renderer_forbidden_metadata_kind(key: &str) -> Option<&'static str> {
    const IDENTITY_KEYS: &[&str] = &[
        "appid",
        "participantid",
        "callerkind",
        "callerid",
        "xnimiappid",
        "xnimiparticipantid",
        "xnimicallerkind",
        "xnimicallerid",
    ];
    const AUTH_KEYS: &[&str] = &[
        "authorization",
        "protectedaccesstoken",
        "appsession",
        "accesstokenid",
        "accesstokensecret",
        "sessionid",
        "sessiontoken",
        "providerapikey",
        "xnimiauthorization",
        "xnimiprotectedaccesstoken",
        "xnimiappsession",
        "xnimiaccesstokenid",
        "xnimiaccesstokensecret",
        "xnimisessionid",
        "xnimisessiontoken",
        "xnimiproviderapikey",
    ];
    let normalized = normalized_metadata_key(key);
    if IDENTITY_KEYS.contains(&normalized.as_str()) {
        return Some("identity");
    }
    if AUTH_KEYS.contains(&normalized.as_str())
        || normalized.contains("authorization")
        || normalized.contains("accesstoken")
        || normalized.contains("session")
        || normalized.contains("providerapikey")
        || normalized.contains("secret")
    {
        return Some("auth");
    }
    None
}

fn renderer_host_owned_metadata_error(kind: &str, field: &str) -> String {
    let code = if kind == "identity" {
        "RUNTIME_BRIDGE_RENDERER_HOST_OWNED_IDENTITY_METADATA_FORBIDDEN"
    } else {
        "RUNTIME_BRIDGE_RENDERER_HOST_OWNED_AUTH_METADATA_FORBIDDEN"
    };
    bridge_error(code, field)
}

fn reject_renderer_host_owned_field(field: &str, present: bool, kind: &str) -> Result<(), String> {
    if present {
        return Err(renderer_host_owned_metadata_error(kind, field));
    }
    Ok(())
}

fn assert_renderer_metadata_allowed_with_trusted_provider(
    metadata: Option<&RuntimeBridgeMetadata>,
    authorization: Option<&str>,
    protected_access_token: Option<&RuntimeBridgeProtectedAccessToken>,
    app_session: Option<&RuntimeBridgeAppSession>,
) -> Result<(), String> {
    reject_renderer_host_owned_field("authorization", normalize(authorization).is_some(), "auth")?;
    reject_renderer_host_owned_field(
        "protectedAccessToken",
        protected_access_token.is_some(),
        "auth",
    )?;
    reject_renderer_host_owned_field("appSession", app_session.is_some(), "auth")?;

    let Some(metadata) = metadata else {
        return Ok(());
    };
    reject_renderer_host_owned_field(
        "appId",
        normalize(metadata.app_id.as_deref()).is_some(),
        "identity",
    )?;
    reject_renderer_host_owned_field(
        "participantId",
        normalize(metadata.participant_id.as_deref()).is_some(),
        "identity",
    )?;
    reject_renderer_host_owned_field(
        "callerKind",
        normalize(metadata.caller_kind.as_deref()).is_some(),
        "identity",
    )?;
    reject_renderer_host_owned_field(
        "callerId",
        normalize(metadata.caller_id.as_deref()).is_some(),
        "identity",
    )?;
    reject_renderer_host_owned_field(
        "providerApiKey",
        normalize(metadata.provider_api_key.as_deref()).is_some(),
        "auth",
    )?;

    if let Some(extra) = metadata.extra.as_ref() {
        for key in extra.keys() {
            if let Some(kind) = renderer_forbidden_metadata_kind(key) {
                return Err(renderer_host_owned_metadata_error(kind, key));
            }
        }
    }
    Ok(())
}

fn merge_metadata_extra(
    renderer: Option<HashMap<String, String>>,
    trusted: Option<HashMap<String, String>>,
) -> Option<HashMap<String, String>> {
    let mut merged = HashMap::new();
    if let Some(extra) = renderer {
        merged.extend(extra);
    }
    if let Some(extra) = trusted {
        merged.extend(extra);
    }
    if merged.is_empty() {
        None
    } else {
        Some(merged)
    }
}

pub(crate) fn resolve_trusted_runtime_bridge_metadata(
    renderer_metadata: Option<&RuntimeBridgeMetadata>,
    renderer_authorization: Option<&str>,
    renderer_protected_access_token: Option<&RuntimeBridgeProtectedAccessToken>,
    renderer_app_session: Option<&RuntimeBridgeAppSession>,
    trusted: Option<RuntimeBridgeTrustedMetadata>,
) -> Result<RuntimeBridgeResolvedMetadata, String> {
    assert_renderer_metadata_allowed_with_trusted_provider(
        renderer_metadata,
        renderer_authorization,
        renderer_protected_access_token,
        renderer_app_session,
    )?;

    let renderer_metadata = renderer_metadata.cloned().unwrap_or_default();
    let trusted = trusted.unwrap_or_default();
    let trusted_metadata = trusted.metadata.clone().unwrap_or_default();
    let metadata = RuntimeBridgeMetadata {
        protocol_version: renderer_metadata
            .protocol_version
            .or(trusted_metadata.protocol_version),
        participant_protocol_version: renderer_metadata
            .participant_protocol_version
            .or(trusted_metadata.participant_protocol_version),
        participant_id: trusted_metadata.participant_id,
        domain: renderer_metadata.domain.or(trusted_metadata.domain),
        app_id: trusted_metadata.app_id,
        trace_id: renderer_metadata.trace_id.or(trusted_metadata.trace_id),
        idempotency_key: renderer_metadata
            .idempotency_key
            .or(trusted_metadata.idempotency_key),
        caller_kind: trusted_metadata.caller_kind,
        caller_id: trusted_metadata.caller_id,
        surface_id: trusted_metadata.surface_id.or(renderer_metadata.surface_id),
        key_source: renderer_metadata.key_source.or(trusted_metadata.key_source),
        provider_endpoint: renderer_metadata
            .provider_endpoint
            .or(trusted_metadata.provider_endpoint),
        provider_api_key: trusted_metadata.provider_api_key,
        extra: merge_metadata_extra(renderer_metadata.extra, trusted_metadata.extra),
    };
    if normalize(metadata.app_id.as_deref()).is_none() {
        return Err(bridge_error(
            "RUNTIME_BRIDGE_TRUSTED_METADATA_APP_ID_REQUIRED",
            "x-nimi-app-id",
        ));
    }

    Ok(RuntimeBridgeResolvedMetadata {
        metadata: Some(metadata),
        authorization: normalize(trusted.authorization.as_deref()),
        protected_access_token: trusted.protected_access_token,
        app_session: trusted.app_session,
    })
}

pub fn apply_metadata(
    request: &mut Request<Vec<u8>>,
    metadata: Option<&RuntimeBridgeMetadata>,
    authorization: Option<&str>,
    protected_access_token: Option<&RuntimeBridgeProtectedAccessToken>,
    app_session: Option<&RuntimeBridgeAppSession>,
    method_id: &str,
) -> Result<(), String> {
    let value = metadata.cloned().unwrap_or_default();

    let protocol_version = validate_protocol_version(
        normalize(value.protocol_version.as_deref())
            .unwrap_or_else(|| SUPPORTED_PROTOCOL_VERSION.to_string())
            .as_str(),
        SUPPORTED_PROTOCOL_VERSION,
        "x-nimi-protocol-version",
    )?;
    let participant_protocol_version = validate_protocol_version(
        normalize(value.participant_protocol_version.as_deref())
            .unwrap_or_else(|| SUPPORTED_PARTICIPANT_PROTOCOL_VERSION.to_string())
            .as_str(),
        SUPPORTED_PARTICIPANT_PROTOCOL_VERSION,
        "x-nimi-participant-protocol-version",
    )?;
    let app_id = normalize(value.app_id.as_deref())
        .ok_or_else(|| bridge_error("RUNTIME_BRIDGE_METADATA_APP_ID_REQUIRED", "x-nimi-app-id"))?;
    let participant_id =
        normalize(value.participant_id.as_deref()).unwrap_or_else(|| app_id.clone());
    let domain = normalize(value.domain.as_deref()).unwrap_or_else(|| "runtime.rpc".to_string());
    let caller_kind =
        normalize(value.caller_kind.as_deref()).unwrap_or_else(|| "third-party-app".to_string());
    let caller_id = normalize(value.caller_id.as_deref()).unwrap_or_else(|| app_id.clone());
    let idempotency_key = normalize(value.idempotency_key.as_deref()).unwrap_or_else(|| {
        let counter = IDEMPOTENCY_COUNTER.fetch_add(1, Ordering::Relaxed);
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis();
        format!("bridge-{}-{}-{}", method_id.replace('/', "_"), now, counter)
    });

    insert_metadata_value(request, "x-nimi-protocol-version", Some(protocol_version))?;
    insert_metadata_value(
        request,
        "x-nimi-participant-protocol-version",
        Some(participant_protocol_version),
    )?;
    insert_metadata_value(request, "x-nimi-participant-id", Some(participant_id))?;
    insert_metadata_value(request, "x-nimi-domain", Some(domain))?;
    insert_metadata_value(request, "x-nimi-idempotency-key", Some(idempotency_key))?;
    insert_metadata_value(request, "x-nimi-caller-kind", Some(caller_kind))?;
    insert_metadata_value(request, "x-nimi-caller-id", Some(caller_id))?;
    insert_metadata_value(request, "x-nimi-app-id", Some(app_id))?;
    insert_metadata_value(
        request,
        "x-nimi-trace-id",
        normalize(value.trace_id.as_deref()),
    )?;
    insert_metadata_value(
        request,
        "x-nimi-surface-id",
        normalize(value.surface_id.as_deref()),
    )?;
    insert_metadata_value(
        request,
        "x-nimi-key-source",
        normalize(value.key_source.as_deref()),
    )?;
    insert_metadata_value(
        request,
        "x-nimi-provider-endpoint",
        normalize(value.provider_endpoint.as_deref()),
    )?;
    insert_metadata_value(
        request,
        "x-nimi-provider-api-key",
        normalize(value.provider_api_key.as_deref()),
    )?;
    insert_metadata_value(request, "authorization", normalize(authorization))?;
    insert_metadata_value(
        request,
        "x-nimi-access-token-id",
        normalize(protected_access_token.map(|value| value.token_id.as_str())),
    )?;
    insert_metadata_value(
        request,
        "x-nimi-access-token-secret",
        normalize(protected_access_token.map(|value| value.secret.as_str())),
    )?;
    insert_metadata_value(
        request,
        "x-nimi-session-id",
        normalize(app_session.map(|value| value.session_id.as_str())),
    )?;
    insert_metadata_value(
        request,
        "x-nimi-session-token",
        normalize(app_session.map(|value| value.session_token.as_str())),
    )?;

    if let Some(extra) = value.extra {
        for (key, extra_value) in extra {
            let normalized_key = key.trim().to_ascii_lowercase();
            if normalized_key.is_empty() {
                continue;
            }
            if !normalized_key.starts_with("x-nimi-") {
                continue;
            }
            if RESERVED_METADATA_KEYS.contains(&normalized_key.as_str()) {
                return Err(bridge_error(
                    "RUNTIME_BRIDGE_METADATA_RESERVED_KEY",
                    normalized_key.as_str(),
                ));
            }
            let metadata_key = tonic::metadata::MetadataKey::from_bytes(normalized_key.as_bytes())
                .map_err(|_| {
                    bridge_error("RUNTIME_BRIDGE_METADATA_INVALID", normalized_key.as_str())
                })?;
            let metadata_value = MetadataValue::try_from(extra_value.as_str()).map_err(|_| {
                bridge_error("RUNTIME_BRIDGE_METADATA_INVALID", normalized_key.as_str())
            })?;
            request.metadata_mut().insert(metadata_key, metadata_value);
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use std::collections::HashMap;

    use tonic::Request;

    use super::{
        apply_metadata, resolve_trusted_runtime_bridge_metadata, RuntimeBridgeAppSession,
        RuntimeBridgeMetadata, RuntimeBridgeProtectedAccessToken, RuntimeBridgeTrustedMetadata,
    };

    fn read_metadata(request: &Request<Vec<u8>>, key: &str) -> Option<String> {
        request
            .metadata()
            .get(key)
            .and_then(|value| value.to_str().ok())
            .map(|value| value.to_string())
    }

    fn app_metadata(app_id: &str) -> RuntimeBridgeMetadata {
        RuntimeBridgeMetadata {
            app_id: Some(app_id.to_string()),
            ..RuntimeBridgeMetadata::default()
        }
    }

    fn protected_access_token() -> RuntimeBridgeProtectedAccessToken {
        RuntimeBridgeProtectedAccessToken {
            token_id: "host-protected-token-id".to_string(),
            secret: "host-protected-token-secret".to_string(),
        }
    }

    fn app_session() -> RuntimeBridgeAppSession {
        RuntimeBridgeAppSession {
            session_id: "host-session-id".to_string(),
            session_token: "host-session-token".to_string(),
        }
    }

    fn trusted_metadata(app_id: &str) -> RuntimeBridgeTrustedMetadata {
        RuntimeBridgeTrustedMetadata {
            metadata: Some(RuntimeBridgeMetadata {
                app_id: Some(app_id.to_string()),
                participant_id: Some(app_id.to_string()),
                caller_kind: Some("local-developer-app".to_string()),
                caller_id: Some(format!("{app_id}.local-developer")),
                surface_id: Some("host.surface".to_string()),
                ..RuntimeBridgeMetadata::default()
            }),
            authorization: Some("Bearer host-token".to_string()),
            protected_access_token: Some(protected_access_token()),
            app_session: Some(app_session()),
        }
    }

    #[test]
    fn trusted_metadata_rejects_renderer_authorization() {
        let error = resolve_trusted_runtime_bridge_metadata(
            None,
            Some("Bearer renderer-token"),
            None,
            None,
            Some(trusted_metadata("nimi.parentos")),
        )
        .expect_err("renderer authorization should fail closed when trusted metadata is enabled");

        assert!(error.contains("RUNTIME_BRIDGE_RENDERER_HOST_OWNED_AUTH_METADATA_FORBIDDEN"));
        assert!(error.contains("authorization"));
    }

    #[test]
    fn trusted_metadata_rejects_renderer_protected_access_and_app_session() {
        let error = resolve_trusted_runtime_bridge_metadata(
            None,
            None,
            Some(&RuntimeBridgeProtectedAccessToken {
                token_id: "renderer-token-id".to_string(),
                secret: "renderer-token-secret".to_string(),
            }),
            None,
            Some(trusted_metadata("nimi.parentos")),
        )
        .expect_err("renderer protected access should fail closed");

        assert!(error.contains("RUNTIME_BRIDGE_RENDERER_HOST_OWNED_AUTH_METADATA_FORBIDDEN"));
        assert!(error.contains("protectedAccessToken"));

        let error = resolve_trusted_runtime_bridge_metadata(
            None,
            None,
            None,
            Some(&RuntimeBridgeAppSession {
                session_id: "renderer-session-id".to_string(),
                session_token: "renderer-session-token".to_string(),
            }),
            Some(trusted_metadata("nimi.parentos")),
        )
        .expect_err("renderer app session should fail closed");

        assert!(error.contains("RUNTIME_BRIDGE_RENDERER_HOST_OWNED_AUTH_METADATA_FORBIDDEN"));
        assert!(error.contains("appSession"));
    }

    #[test]
    fn trusted_metadata_rejects_renderer_identity_fields() {
        let renderer = RuntimeBridgeMetadata {
            app_id: Some("renderer.app".to_string()),
            participant_id: Some("renderer.participant".to_string()),
            caller_kind: Some("renderer-kind".to_string()),
            caller_id: Some("renderer-caller".to_string()),
            ..RuntimeBridgeMetadata::default()
        };

        let error = resolve_trusted_runtime_bridge_metadata(
            Some(&renderer),
            None,
            None,
            None,
            Some(trusted_metadata("nimi.parentos")),
        )
        .expect_err("renderer identity metadata should fail closed");

        assert!(error.contains("RUNTIME_BRIDGE_RENDERER_HOST_OWNED_IDENTITY_METADATA_FORBIDDEN"));
        assert!(error.contains("appId"));
    }

    #[test]
    fn trusted_metadata_merges_host_identity_and_auth_with_renderer_call_metadata() {
        let mut renderer_extra = HashMap::new();
        renderer_extra.insert("x-nimi-renderer-extra".to_string(), "renderer".to_string());
        let renderer = RuntimeBridgeMetadata {
            domain: Some("runtime.renderer".to_string()),
            trace_id: Some("trace-renderer".to_string()),
            idempotency_key: Some("idem-renderer".to_string()),
            surface_id: Some("renderer.surface".to_string()),
            key_source: Some("renderer-key-source".to_string()),
            provider_endpoint: Some("https://runtime.example.test".to_string()),
            extra: Some(renderer_extra),
            ..RuntimeBridgeMetadata::default()
        };
        let mut trusted = trusted_metadata("nimi.parentos");
        if let Some(metadata) = trusted.metadata.as_mut() {
            let mut trusted_extra = HashMap::new();
            trusted_extra.insert("x-nimi-host-extra".to_string(), "host".to_string());
            metadata.domain = Some("runtime.host".to_string());
            metadata.extra = Some(trusted_extra);
        }

        let resolved = resolve_trusted_runtime_bridge_metadata(
            Some(&renderer),
            None,
            None,
            None,
            Some(trusted),
        )
        .expect("trusted metadata should merge");
        let mut request = Request::new(Vec::<u8>::new());
        apply_metadata(
            &mut request,
            resolved.metadata.as_ref(),
            resolved.authorization.as_deref(),
            resolved.protected_access_token.as_ref(),
            resolved.app_session.as_ref(),
            "//nimi.runtime.v1.RuntimeAiService/ExecuteScenario",
        )
        .expect("merged metadata should apply");

        assert_eq!(
            read_metadata(&request, "x-nimi-app-id").as_deref(),
            Some("nimi.parentos")
        );
        assert_eq!(
            read_metadata(&request, "x-nimi-participant-id").as_deref(),
            Some("nimi.parentos")
        );
        assert_eq!(
            read_metadata(&request, "x-nimi-caller-kind").as_deref(),
            Some("local-developer-app")
        );
        assert_eq!(
            read_metadata(&request, "x-nimi-caller-id").as_deref(),
            Some("nimi.parentos.local-developer")
        );
        assert_eq!(
            read_metadata(&request, "x-nimi-domain").as_deref(),
            Some("runtime.renderer")
        );
        assert_eq!(
            read_metadata(&request, "x-nimi-surface-id").as_deref(),
            Some("host.surface")
        );
        assert_eq!(
            read_metadata(&request, "authorization").as_deref(),
            Some("Bearer host-token")
        );
        assert_eq!(
            read_metadata(&request, "x-nimi-access-token-id").as_deref(),
            Some("host-protected-token-id")
        );
        assert_eq!(
            read_metadata(&request, "x-nimi-session-id").as_deref(),
            Some("host-session-id")
        );
        assert_eq!(
            read_metadata(&request, "x-nimi-renderer-extra").as_deref(),
            Some("renderer")
        );
        assert_eq!(
            read_metadata(&request, "x-nimi-host-extra").as_deref(),
            Some("host")
        );
    }

    #[test]
    fn apply_metadata_requires_explicit_app_identity() {
        let mut request = Request::new(Vec::<u8>::new());
        let error = apply_metadata(
            &mut request,
            None,
            None,
            None,
            None,
            "//nimi.runtime.v1.RuntimeAiService/ExecuteScenario",
        )
        .expect_err("missing app identity should fail closed");

        assert!(error.contains("RUNTIME_BRIDGE_METADATA_APP_ID_REQUIRED"));
        assert!(read_metadata(&request, "x-nimi-app-id").is_none());
        assert!(read_metadata(&request, "x-nimi-participant-id").is_none());
        assert!(read_metadata(&request, "x-nimi-caller-id").is_none());
    }

    #[test]
    fn apply_metadata_populates_protocol_defaults_from_explicit_app_identity() {
        let mut request = Request::new(Vec::<u8>::new());
        let metadata = app_metadata("app.example");
        apply_metadata(
            &mut request,
            Some(&metadata),
            None,
            None,
            None,
            "//nimi.runtime.v1.RuntimeAiService/ExecuteScenario",
        )
        .expect("apply metadata defaults");

        assert_eq!(
            read_metadata(&request, "x-nimi-protocol-version").as_deref(),
            Some("1.0.0")
        );
        assert_eq!(
            read_metadata(&request, "x-nimi-participant-protocol-version").as_deref(),
            Some("1.0.0")
        );
        assert_eq!(
            read_metadata(&request, "x-nimi-domain").as_deref(),
            Some("runtime.rpc")
        );
        assert_eq!(
            read_metadata(&request, "x-nimi-caller-kind").as_deref(),
            Some("third-party-app")
        );
        assert_eq!(
            read_metadata(&request, "x-nimi-app-id").as_deref(),
            Some("app.example")
        );
        assert_eq!(
            read_metadata(&request, "x-nimi-participant-id").as_deref(),
            Some("app.example")
        );
        assert_eq!(
            read_metadata(&request, "x-nimi-caller-id").as_deref(),
            Some("app.example")
        );

        let idempotency_key = read_metadata(&request, "x-nimi-idempotency-key")
            .expect("idempotency key should be generated");
        assert!(idempotency_key.starts_with("bridge-"));
    }

    #[test]
    fn apply_metadata_respects_explicit_fields_and_extra_whitelist() {
        let mut extra = HashMap::new();
        extra.insert("x-nimi-extra".to_string(), "allow".to_string());
        extra.insert("authorization".to_string(), "deny".to_string());

        let metadata = RuntimeBridgeMetadata {
            protocol_version: Some("1.0.0".to_string()),
            participant_protocol_version: Some("1.0.0".to_string()),
            participant_id: Some("desktop-core".to_string()),
            domain: Some("runtime.test".to_string()),
            app_id: Some("nimi.desktop".to_string()),
            trace_id: Some("trace-1".to_string()),
            idempotency_key: Some("idem-1".to_string()),
            caller_kind: Some("desktop-core".to_string()),
            caller_id: Some("renderer".to_string()),
            surface_id: Some("settings".to_string()),
            key_source: Some("inline".to_string()),
            provider_endpoint: Some("https://api.example.com/v1".to_string()),
            provider_api_key: Some("secret-token".to_string()),
            extra: Some(extra),
        };

        let mut request = Request::new(Vec::<u8>::new());
        apply_metadata(
            &mut request,
            Some(&metadata),
            Some("Bearer top-level-token"),
            None,
            None,
            "//nimi.runtime.v1.RuntimeAiService/ExecuteScenario",
        )
        .expect("apply metadata with explicit values");

        assert_eq!(
            read_metadata(&request, "x-nimi-protocol-version").as_deref(),
            Some("1.0.0")
        );
        assert_eq!(
            read_metadata(&request, "x-nimi-participant-protocol-version").as_deref(),
            Some("1.0.0")
        );
        assert_eq!(
            read_metadata(&request, "x-nimi-participant-id").as_deref(),
            Some("desktop-core")
        );
        assert_eq!(
            read_metadata(&request, "x-nimi-domain").as_deref(),
            Some("runtime.test")
        );
        assert_eq!(
            read_metadata(&request, "x-nimi-app-id").as_deref(),
            Some("nimi.desktop")
        );
        assert_eq!(
            read_metadata(&request, "x-nimi-trace-id").as_deref(),
            Some("trace-1")
        );
        assert_eq!(
            read_metadata(&request, "x-nimi-idempotency-key").as_deref(),
            Some("idem-1")
        );
        assert_eq!(
            read_metadata(&request, "x-nimi-caller-kind").as_deref(),
            Some("desktop-core")
        );
        assert_eq!(
            read_metadata(&request, "x-nimi-caller-id").as_deref(),
            Some("renderer")
        );
        assert_eq!(
            read_metadata(&request, "x-nimi-surface-id").as_deref(),
            Some("settings")
        );
        assert_eq!(
            read_metadata(&request, "x-nimi-key-source").as_deref(),
            Some("inline")
        );
        assert_eq!(
            read_metadata(&request, "x-nimi-provider-endpoint").as_deref(),
            Some("https://api.example.com/v1")
        );
        assert_eq!(
            read_metadata(&request, "x-nimi-provider-api-key").as_deref(),
            Some("secret-token")
        );
        assert_eq!(
            read_metadata(&request, "x-nimi-extra").as_deref(),
            Some("allow")
        );
        assert_eq!(
            read_metadata(&request, "authorization").as_deref(),
            Some("Bearer top-level-token")
        );
    }

    #[test]
    fn apply_metadata_rejects_unsupported_protocol_version() {
        let metadata = RuntimeBridgeMetadata {
            protocol_version: Some("2.0.0".to_string()),
            ..RuntimeBridgeMetadata::default()
        };

        let mut request = Request::new(Vec::<u8>::new());
        let error = apply_metadata(
            &mut request,
            Some(&metadata),
            None,
            None,
            None,
            "//nimi.runtime.v1.RuntimeAiService/ExecuteScenario",
        )
        .expect_err("unsupported protocol version should fail");

        assert!(error.contains("RUNTIME_BRIDGE_PROTOCOL_VERSION_UNSUPPORTED"));
    }

    #[test]
    fn apply_metadata_rejects_invalid_extra_value() {
        let mut extra = HashMap::new();
        extra.insert("x-nimi-bad".to_string(), "line1\r\nline2".to_string());

        let metadata = RuntimeBridgeMetadata {
            extra: Some(extra),
            ..app_metadata("app.example")
        };

        let mut request = Request::new(Vec::<u8>::new());
        let error = apply_metadata(
            &mut request,
            Some(&metadata),
            None,
            None,
            None,
            "//nimi.runtime.v1.RuntimeAiService/ExecuteScenario",
        )
        .expect_err("metadata with invalid header value should fail");

        assert!(error.contains("RUNTIME_BRIDGE_METADATA_INVALID"));
    }

    #[test]
    fn apply_metadata_rejects_reserved_extra_key_override() {
        let mut extra = HashMap::new();
        extra.insert("x-nimi-protocol-version".to_string(), "9.9.9".to_string());

        let metadata = RuntimeBridgeMetadata {
            extra: Some(extra),
            ..app_metadata("app.example")
        };

        let mut request = Request::new(Vec::<u8>::new());
        let error = apply_metadata(
            &mut request,
            Some(&metadata),
            None,
            None,
            None,
            "//nimi.runtime.v1.RuntimeAiService/ExecuteScenario",
        )
        .expect_err("reserved metadata key override should fail");

        assert!(error.contains("RUNTIME_BRIDGE_METADATA_RESERVED_KEY"));
    }

    #[test]
    fn runtime_bridge_metadata_debug_redacts_provider_api_key() {
        let mut extra = HashMap::new();
        extra.insert(
            "x-nimi-provider-api-key".to_string(),
            "top-secret-value".to_string(),
        );

        let metadata = RuntimeBridgeMetadata {
            provider_api_key: Some("top-secret-value".to_string()),
            extra: Some(extra),
            ..RuntimeBridgeMetadata::default()
        };

        let debug = format!("{:?}", metadata);
        assert!(!debug.contains("top-secret-value"));
        assert!(debug.contains("***REDACTED***"));
    }

    #[test]
    fn apply_metadata_includes_protected_access_token_headers() {
        let mut request = Request::new(Vec::<u8>::new());
        let metadata = app_metadata("app.example");
        let protected_access_token = RuntimeBridgeProtectedAccessToken {
            token_id: "protected-token-id".to_string(),
            secret: "protected-token-secret".to_string(),
        };

        apply_metadata(
            &mut request,
            Some(&metadata),
            None,
            Some(&protected_access_token),
            None,
            "//nimi.runtime.v1.RuntimeAiService/ExecuteScenario",
        )
        .expect("apply metadata with protected access token");

        assert_eq!(
            read_metadata(&request, "x-nimi-access-token-id").as_deref(),
            Some("protected-token-id")
        );
        assert_eq!(
            read_metadata(&request, "x-nimi-access-token-secret").as_deref(),
            Some("protected-token-secret")
        );
    }

    #[test]
    fn apply_metadata_includes_runtime_app_session_headers() {
        let mut request = Request::new(Vec::<u8>::new());
        let metadata = app_metadata("app.example");
        let app_session = RuntimeBridgeAppSession {
            session_id: "runtime-session-id".to_string(),
            session_token: "runtime-session-token".to_string(),
        };

        apply_metadata(
            &mut request,
            Some(&metadata),
            None,
            None,
            Some(&app_session),
            "//nimi.runtime.v1.RuntimeAppService/SendAppMessage",
        )
        .expect("apply metadata with runtime app session");

        assert_eq!(
            read_metadata(&request, "x-nimi-session-id").as_deref(),
            Some("runtime-session-id")
        );
        assert_eq!(
            read_metadata(&request, "x-nimi-session-token").as_deref(),
            Some("runtime-session-token")
        );
    }
}
