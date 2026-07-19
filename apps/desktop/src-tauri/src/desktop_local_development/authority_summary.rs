use nimi_shell_tauri::capabilities::runtime::{
    self as runtime_bridge, DeveloperModeState, LocalDevelopmentAuthoritySummary,
    LocalDevelopmentSummaryAvailability, NimiHostErrorReasonCode,
};
use serde::Serialize;
use std::{
    fs,
    path::{Path, PathBuf},
    time::Duration,
};
use tokio::sync::oneshot;

const MAX_SAFE_JSON_INTEGER: u64 = 9_007_199_254_740_991;
const PRESENCE_HEARTBEAT_INTERVAL: Duration = Duration::from_millis(3_000);
const SUMMARY_UNTRUSTED: &str = "local-development-authority-summary-untrusted";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AuthoritySummaryDescriptor {
    schema_version: u8,
    desktop_app_id: String,
    desktop_pid: u32,
    captured_at: String,
    developer_mode: DeveloperModeSummaryDescriptor,
    project_authorization: ProjectAuthorizationSummaryDescriptor,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct DeveloperModeSummaryDescriptor {
    availability: String,
    state: String,
    reason_code: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectAuthorizationSummaryDescriptor {
    availability: String,
    active_count: u64,
    denied_count: u64,
    revoked_count: u64,
    reason_code: String,
}

pub(super) fn spawn_heartbeat(
    presence_path: PathBuf,
    authority_summary_path: PathBuf,
    endpoint: String,
    started_at: String,
    mut shutdown: oneshot::Receiver<()>,
) {
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(PRESENCE_HEARTBEAT_INTERVAL);
        loop {
            tokio::select! {
                _ = interval.tick() => {
                    if let Err(error) = super::domain::write_presence(&presence_path, &endpoint, &started_at) {
                        eprintln!("[local-development] presence heartbeat failed: {error}");
                    }
                    match runtime_bridge::get_local_development_authority_summary().await {
                        Ok(summary) => {
                            if let Err(error) = write_authority_summary(&authority_summary_path, summary) {
                                let _ = fs::remove_file(&authority_summary_path);
                                eprintln!("[local-development] authority summary write failed: {error}");
                            }
                        }
                        Err(error) => {
                            let _ = fs::remove_file(&authority_summary_path);
                            eprintln!(
                                "[local-development] authority summary unavailable: {}",
                                error.reason_code().as_str()
                            );
                        }
                    }
                }
                _ = &mut shutdown => break,
            }
        }
    });
}

pub(super) fn write_authority_summary(
    path: &Path,
    summary: LocalDevelopmentAuthoritySummary,
) -> Result<(), String> {
    let descriptor = authority_summary_descriptor(summary)?;
    crate::desktop_open_intent::presence::write_presence_document(path, &descriptor)
}

fn authority_summary_descriptor(
    summary: LocalDevelopmentAuthoritySummary,
) -> Result<AuthoritySummaryDescriptor, String> {
    for count in [
        summary.project_authorization.active_count,
        summary.project_authorization.denied_count,
        summary.project_authorization.revoked_count,
    ] {
        validate_summary_count(count)?;
    }

    match (
        summary.developer_mode.availability,
        summary.developer_mode.state,
    ) {
        (
            LocalDevelopmentSummaryAvailability::Available,
            DeveloperModeState::Enabled | DeveloperModeState::Disabled,
        )
        | (LocalDevelopmentSummaryAvailability::Unavailable, DeveloperModeState::Unavailable) => {}
        _ => return Err(SUMMARY_UNTRUSTED.to_string()),
    }
    if summary.project_authorization.availability
        == LocalDevelopmentSummaryAvailability::Unavailable
        && (summary.project_authorization.active_count != 0
            || summary.project_authorization.denied_count != 0
            || summary.project_authorization.revoked_count != 0)
    {
        return Err(SUMMARY_UNTRUSTED.to_string());
    }
    Ok(AuthoritySummaryDescriptor {
        schema_version: 1,
        desktop_app_id: "nimi.desktop".to_string(),
        desktop_pid: std::process::id(),
        captured_at: crate::desktop_open_intent::presence::now_iso8601(),
        developer_mode: DeveloperModeSummaryDescriptor {
            availability: availability_text(summary.developer_mode.availability).to_string(),
            state: summary.developer_mode.state.as_str().to_string(),
            reason_code: summary_reason(
                summary.developer_mode.availability,
                summary.developer_mode.unavailable_reason,
            )?,
        },
        project_authorization: ProjectAuthorizationSummaryDescriptor {
            availability: availability_text(summary.project_authorization.availability).to_string(),
            active_count: summary.project_authorization.active_count,
            denied_count: summary.project_authorization.denied_count,
            revoked_count: summary.project_authorization.revoked_count,
            reason_code: summary_reason(
                summary.project_authorization.availability,
                summary.project_authorization.unavailable_reason,
            )?,
        },
    })
}

fn validate_summary_count(value: u64) -> Result<(), String> {
    if value > MAX_SAFE_JSON_INTEGER {
        return Err(SUMMARY_UNTRUSTED.to_string());
    }
    Ok(())
}

fn availability_text(value: LocalDevelopmentSummaryAvailability) -> &'static str {
    match value {
        LocalDevelopmentSummaryAvailability::Available => "available",
        LocalDevelopmentSummaryAvailability::Unavailable => "unavailable",
    }
}

fn summary_reason(
    availability: LocalDevelopmentSummaryAvailability,
    unavailable_reason: Option<NimiHostErrorReasonCode>,
) -> Result<String, String> {
    match (availability, unavailable_reason) {
        (LocalDevelopmentSummaryAvailability::Available, None) => Ok("action-executed".to_string()),
        (
            LocalDevelopmentSummaryAvailability::Unavailable,
            Some(
                reason @ (NimiHostErrorReasonCode::PrincipalUnauthorized
                | NimiHostErrorReasonCode::LocalAppOperationUnavailable),
            ),
        ) => Ok(reason.as_str().to_string()),
        _ => Err(SUMMARY_UNTRUSTED.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use nimi_shell_tauri::capabilities::runtime::{
        LocalDevelopmentDeveloperModeSummary, LocalDevelopmentProjectAuthorizationSummary,
    };

    fn available_summary() -> LocalDevelopmentAuthoritySummary {
        LocalDevelopmentAuthoritySummary {
            developer_mode: LocalDevelopmentDeveloperModeSummary {
                availability: LocalDevelopmentSummaryAvailability::Available,
                state: DeveloperModeState::Enabled,
                unavailable_reason: None,
            },
            project_authorization: LocalDevelopmentProjectAuthorizationSummary {
                availability: LocalDevelopmentSummaryAvailability::Available,
                active_count: 2,
                denied_count: 5,
                revoked_count: 7,
                unavailable_reason: None,
            },
        }
    }

    fn sorted_keys(value: &serde_json::Value) -> Vec<String> {
        let mut keys = value
            .as_object()
            .expect("object")
            .keys()
            .cloned()
            .collect::<Vec<_>>();
        keys.sort();
        keys
    }

    #[test]
    fn projection_has_only_bounded_diagnostic_fields() {
        let value = serde_json::to_value(
            authority_summary_descriptor(available_summary()).expect("descriptor"),
        )
        .expect("serialize descriptor");
        assert_eq!(
            sorted_keys(&value),
            vec![
                "capturedAt",
                "desktopAppId",
                "desktopPid",
                "developerMode",
                "projectAuthorization",
                "schemaVersion",
            ]
        );
        assert_eq!(
            sorted_keys(&value["developerMode"]),
            vec!["availability", "reasonCode", "state"]
        );
        assert_eq!(
            sorted_keys(&value["projectAuthorization"]),
            vec![
                "activeCount",
                "availability",
                "deniedCount",
                "reasonCode",
                "revokedCount",
            ]
        );
        assert_eq!(value["developerMode"]["reasonCode"], "action-executed");
        assert_eq!(value["projectAuthorization"]["activeCount"], 2);
    }

    #[test]
    fn projection_preserves_explicit_bounded_unavailability() {
        let unavailable = LocalDevelopmentAuthoritySummary {
            developer_mode: LocalDevelopmentDeveloperModeSummary {
                availability: LocalDevelopmentSummaryAvailability::Unavailable,
                state: DeveloperModeState::Unavailable,
                unavailable_reason: Some(NimiHostErrorReasonCode::PrincipalUnauthorized),
            },
            project_authorization: LocalDevelopmentProjectAuthorizationSummary {
                availability: LocalDevelopmentSummaryAvailability::Unavailable,
                active_count: 0,
                denied_count: 0,
                revoked_count: 0,
                unavailable_reason: Some(NimiHostErrorReasonCode::PrincipalUnauthorized),
            },
        };
        let value = serde_json::to_value(
            authority_summary_descriptor(unavailable).expect("unavailable descriptor"),
        )
        .expect("serialize unavailable descriptor");
        assert_eq!(
            value["developerMode"]["reasonCode"],
            "principal-unauthorized"
        );
    }

    #[test]
    fn projection_rejects_inconsistent_or_unsafe_values() {
        let mut summary = available_summary();
        summary.developer_mode.unavailable_reason =
            Some(NimiHostErrorReasonCode::PrincipalUnauthorized);
        assert!(authority_summary_descriptor(summary).is_err());

        let mut summary = available_summary();
        summary.project_authorization.availability =
            LocalDevelopmentSummaryAvailability::Unavailable;
        summary.project_authorization.unavailable_reason =
            Some(NimiHostErrorReasonCode::PrincipalUnauthorized);
        assert!(authority_summary_descriptor(summary).is_err());

        let mut summary = available_summary();
        summary.project_authorization.active_count = MAX_SAFE_JSON_INTEGER + 1;
        assert!(authority_summary_descriptor(summary).is_err());
    }
}
