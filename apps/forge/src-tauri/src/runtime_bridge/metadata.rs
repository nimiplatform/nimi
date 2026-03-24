use std::collections::HashMap;
use std::fmt;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use tonic::metadata::MetadataValue;
use tonic::Request;

use super::error_map::bridge_error;

static IDEMPOTENCY_COUNTER: AtomicU64 = AtomicU64::new(1);
const SUPPORTED_PROTOCOL_VERSION: &str = "1.0.0";
const SUPPORTED_PARTICIPANT_PROTOCOL_VERSION: &str = "1.0.0";
const RESERVED_METADATA_KEYS: &[&str] = &[
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

pub fn apply_metadata(
    request: &mut Request<Vec<u8>>,
    metadata: Option<&RuntimeBridgeMetadata>,
    authorization: Option<&str>,
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
    let app_id = normalize(value.app_id.as_deref());
    let participant_id = normalize(value.participant_id.as_deref())
        .or_else(|| app_id.clone())
        .unwrap_or_else(|| "nimi.forge".to_string());
    let domain = normalize(value.domain.as_deref()).unwrap_or_else(|| "runtime.rpc".to_string());
    let caller_kind =
        normalize(value.caller_kind.as_deref()).unwrap_or_else(|| "third-party-app".to_string());
    let caller_id = normalize(value.caller_id.as_deref())
        .or_else(|| app_id.clone())
        .unwrap_or_else(|| "app:nimi.forge".to_string());
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
    insert_metadata_value(request, "x-nimi-app-id", app_id)?;
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

    use super::{apply_metadata, RuntimeBridgeMetadata};

    fn read_metadata(request: &Request<Vec<u8>>, key: &str) -> Option<String> {
        request
            .metadata()
            .get(key)
            .and_then(|value| value.to_str().ok())
            .map(|value| value.to_string())
    }

    #[test]
    fn apply_metadata_populates_defaults() {
        let mut request = Request::new(Vec::<u8>::new());
        apply_metadata(
            &mut request,
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
            read_metadata(&request, "x-nimi-participant-id").as_deref(),
            Some("nimi.forge")
        );
        assert_eq!(
            read_metadata(&request, "x-nimi-caller-id").as_deref(),
            Some("app:nimi.forge")
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
            ..RuntimeBridgeMetadata::default()
        };

        let mut request = Request::new(Vec::<u8>::new());
        let error = apply_metadata(
            &mut request,
            Some(&metadata),
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
            ..RuntimeBridgeMetadata::default()
        };

        let mut request = Request::new(Vec::<u8>::new());
        let error = apply_metadata(
            &mut request,
            Some(&metadata),
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
}
