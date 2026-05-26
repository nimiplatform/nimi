use std::collections::BTreeSet;
use std::sync::OnceLock;

use serde::Deserialize;

pub const LOCAL_AI_SERVICE_UNREACHABLE: &str = "LOCAL_AI_SERVICE_UNREACHABLE";
pub const LOCAL_AI_AUTH_FAILED: &str = "LOCAL_AI_AUTH_FAILED";
pub const LOCAL_AI_CAPABILITY_MISSING: &str = "LOCAL_AI_CAPABILITY_MISSING";
pub const LOCAL_AI_PROVIDER_INTERNAL_ERROR: &str = "LOCAL_AI_PROVIDER_INTERNAL_ERROR";
pub const LOCAL_AI_PROVIDER_TIMEOUT: &str = "LOCAL_AI_PROVIDER_TIMEOUT";
pub const LOCAL_AI_PREFLIGHT_UNSUPPORTED: &str = "LOCAL_AI_PREFLIGHT_UNSUPPORTED";
pub const LOCAL_AI_ADAPTER_MISMATCH: &str = "LOCAL_AI_ADAPTER_MISMATCH";

const DESKTOP_ERROR_CODES_YAML: &str = include_str!(concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../.nimi/spec/desktop/kernel/tables/error-codes.yaml"
));

#[derive(Debug, Deserialize)]
struct DesktopErrorCodeTable {
    codes: Vec<DesktopErrorCodeRow>,
}

#[derive(Debug, Deserialize)]
struct DesktopErrorCodeRow {
    code: String,
}

fn desktop_error_codes() -> &'static BTreeSet<String> {
    static DESKTOP_ERROR_CODES: OnceLock<BTreeSet<String>> = OnceLock::new();
    DESKTOP_ERROR_CODES.get_or_init(|| {
        let table: DesktopErrorCodeTable = serde_yaml::from_str(DESKTOP_ERROR_CODES_YAML)
            .expect("desktop error-code authority table must parse");
        let codes = table
            .codes
            .into_iter()
            .map(|entry| entry.code.trim().to_string())
            .filter(|code| !code.is_empty())
            .collect::<BTreeSet<_>>();
        for required in [
            LOCAL_AI_SERVICE_UNREACHABLE,
            LOCAL_AI_AUTH_FAILED,
            LOCAL_AI_CAPABILITY_MISSING,
            LOCAL_AI_PROVIDER_INTERNAL_ERROR,
            LOCAL_AI_PROVIDER_TIMEOUT,
            LOCAL_AI_PREFLIGHT_UNSUPPORTED,
            LOCAL_AI_ADAPTER_MISMATCH,
        ] {
            debug_assert!(
                codes.contains(required),
                "{required} missing from desktop error-code authority table"
            );
        }
        codes
    })
}

pub fn is_canonical_desktop_error_code(code: &str) -> bool {
    let normalized = code.trim();
    !normalized.is_empty() && desktop_error_codes().contains(normalized)
}

fn canonical_fallback(fallback: &str) -> String {
    let normalized = fallback.trim();
    if is_canonical_desktop_error_code(normalized) {
        return normalized.to_string();
    }
    if is_canonical_desktop_error_code(LOCAL_AI_PROVIDER_INTERNAL_ERROR) {
        return LOCAL_AI_PROVIDER_INTERNAL_ERROR.to_string();
    }
    "RUNTIME_CALL_FAILED".to_string()
}

fn prefixed_reason_code(error: &str) -> Option<&str> {
    let candidate = error
        .split(':')
        .next()
        .map(|value| value.trim())
        .unwrap_or_default();
    is_canonical_desktop_error_code(candidate).then_some(candidate)
}

#[cfg(test)]
pub fn normalize_local_ai_reason_code(error: &str, fallback: &str) -> String {
    let normalized = error.trim();
    if normalized.is_empty() {
        return canonical_fallback(fallback);
    }

    if let Some(prefix) = prefixed_reason_code(normalized) {
        return prefix.to_string();
    }

    canonical_fallback(fallback)
}

pub fn extract_reason_code(error: &str, fallback: &str) -> String {
    if let Some(candidate) = prefixed_reason_code(error) {
        candidate.to_string()
    } else {
        canonical_fallback(fallback)
    }
}

#[cfg(test)]
mod tests {
    use super::{
        extract_reason_code, is_canonical_desktop_error_code, normalize_local_ai_reason_code,
        LOCAL_AI_AUTH_FAILED, LOCAL_AI_CAPABILITY_MISSING, LOCAL_AI_PREFLIGHT_UNSUPPORTED,
        LOCAL_AI_PROVIDER_INTERNAL_ERROR, LOCAL_AI_PROVIDER_TIMEOUT, LOCAL_AI_SERVICE_UNREACHABLE,
    };

    #[test]
    fn local_runtime_reason_codes_are_governed_by_desktop_error_code_authority() {
        for code in [
            LOCAL_AI_SERVICE_UNREACHABLE,
            LOCAL_AI_AUTH_FAILED,
            LOCAL_AI_CAPABILITY_MISSING,
            LOCAL_AI_PROVIDER_INTERNAL_ERROR,
            LOCAL_AI_PROVIDER_TIMEOUT,
            LOCAL_AI_PREFLIGHT_UNSUPPORTED,
        ] {
            assert!(
                is_canonical_desktop_error_code(code),
                "{code} missing from authority table"
            );
        }
    }

    #[test]
    fn normalize_local_ai_reason_code_accepts_only_authority_table_prefixes() {
        assert_eq!(
            normalize_local_ai_reason_code(
                "LOCAL_AI_PROVIDER_TIMEOUT: provider timeout",
                LOCAL_AI_PROVIDER_INTERNAL_ERROR,
            ),
            LOCAL_AI_PROVIDER_TIMEOUT
        );
        assert_eq!(
            normalize_local_ai_reason_code(
                "timeout while contacting provider",
                LOCAL_AI_PROVIDER_INTERNAL_ERROR,
            ),
            LOCAL_AI_PROVIDER_INTERNAL_ERROR
        );
        assert_eq!(
            normalize_local_ai_reason_code("APP_LOCAL_SHADOW_CODE: bad", "APP_LOCAL_FALLBACK"),
            LOCAL_AI_PROVIDER_INTERNAL_ERROR
        );
    }

    #[test]
    fn extract_reason_code_rejects_app_local_unregistered_prefixes() {
        assert_eq!(
            extract_reason_code(
                "LOCAL_AI_CAPABILITY_MISSING: missing",
                LOCAL_AI_SERVICE_UNREACHABLE
            ),
            LOCAL_AI_CAPABILITY_MISSING
        );
        assert_eq!(
            extract_reason_code("APP_LOCAL_SHADOW_CODE: bad", LOCAL_AI_SERVICE_UNREACHABLE),
            LOCAL_AI_SERVICE_UNREACHABLE
        );
    }
}
