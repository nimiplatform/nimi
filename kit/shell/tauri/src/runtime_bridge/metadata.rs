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
    "x-nimi-access-token-id",
    "x-nimi-access-token-secret",
    "x-nimi-session-id",
    "x-nimi-session-token",
];

#[derive(Clone, Default, Deserialize, Serialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
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
            .field("extra", &self.extra)
            .finish()
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

fn is_retired_caller_ai_input_metadata_key(key: &str) -> bool {
    const RETIRED_KEYS: &[&str] = &[
        "keysource",
        "providertype",
        "providerendpoint",
        "providerapikey",
    ];
    let normalized = key.trim().to_ascii_lowercase();
    let suffix = normalized.strip_prefix("x-nimi-").unwrap_or(&normalized);
    let compact = normalized_metadata_key(suffix);
    RETIRED_KEYS.contains(&compact.as_str())
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
        "xnimisourcehost",
        "xnimiappinstanceid",
        "xnimideviceid",
        "xnimilaunchhostid",
        "xnimilaunchnonce",
        "xnimireleasedescriptorref",
        "xnimicapabilitysetref",
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
    if let Some(extra) = metadata.extra.as_ref() {
        for key in extra.keys() {
            if is_retired_caller_ai_input_metadata_key(key) {
                return Err(bridge_error(
                    "RUNTIME_BRIDGE_CALLER_AI_INPUT_METADATA_RETIRED",
                    key,
                ));
            }
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
            if is_retired_caller_ai_input_metadata_key(&normalized_key) {
                return Err(bridge_error(
                    "RUNTIME_BRIDGE_CALLER_AI_INPUT_METADATA_RETIRED",
                    normalized_key.as_str(),
                ));
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
#[path = "metadata_tests.rs"]
mod metadata_tests;
