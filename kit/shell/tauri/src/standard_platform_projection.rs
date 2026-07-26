use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::PathBuf;

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct StandardPlatformProjectionPayload {
    pub projection_id: String,
    pub updated_at: Option<String>,
    pub packages: Option<Vec<crate::platform_projection::apps_packages::AppsPackageRow>>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StandardPlatformProjectionResult {
    pub projection_id: String,
    pub record: Value,
}

pub fn platform_projection_get(payload: Value) -> Result<StandardPlatformProjectionResult, String> {
    let parsed =
        serde_json::from_value::<StandardPlatformProjectionPayload>(payload).map_err(|error| {
            platform_projection_error(
                "not-found",
                "tauri-platform-projection-payload-invalid",
                "use_admitted_standard_platform_projection_id",
                "",
                Some(error.to_string()),
            )
        })?;
    let projection_id = parsed.projection_id.trim().to_string();
    if projection_id.is_empty() {
        return Err(platform_projection_error(
            "not-found",
            "tauri-platform-projection-not-found",
            "use_admitted_standard_platform_projection_id",
            "",
            Some("<missing>".to_string()),
        ));
    }
    let updated_at = parsed
        .updated_at
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let record = match projection_id.as_str() {
        "factory-profile-index" => {
            let mut record =
                crate::platform_projection::factory_profile_index::build_factory_profile_index_record(
                )
                .map_err(|cause| {
                    platform_projection_error(
                        "host-internal-error",
                        "tauri-platform-projection-factory-profile-index-failed",
                        "check_platform_projection_catalog",
                        projection_id.as_str(),
                        Some(cause),
                    )
                })?;
            if let Some(updated_at) = updated_at {
                record.updated_at = updated_at;
            }
            to_record_value(record, projection_id.as_str())?
        }
        "apps-registry" => {
            let mut record = crate::platform_projection::apps_registry::build_apps_registry_record(
            )
            .map_err(|cause| {
                platform_projection_error(
                    "host-internal-error",
                    "tauri-platform-projection-apps-registry-failed",
                    "check_platform_projection_catalog",
                    projection_id.as_str(),
                    Some(cause),
                )
            })?;
            if let Some(updated_at) = updated_at {
                record.updated_at = updated_at;
            }
            to_record_value(record, projection_id.as_str())?
        }
        "apps-packages" => {
            let record =
                crate::platform_projection::apps_packages::build_apps_packages_record_from_rows(
                    updated_at.unwrap_or_else(now_iso_timestamp),
                    parsed.packages.unwrap_or_default(),
                );
            crate::platform_projection::apps_packages::validate_apps_packages_record(&record)
                .map_err(|cause| {
                    platform_projection_error(
                        "host-internal-error",
                        "tauri-platform-projection-apps-packages-failed",
                        "check_platform_projection_catalog",
                        projection_id.as_str(),
                        Some(cause),
                    )
                })?;
            to_record_value(record, projection_id.as_str())?
        }
        "apps-bridge" => {
            let registry_path = materialized_apps_registry_path(projection_id.as_str())?;
            let record = crate::platform_projection::apps_bridge::build_apps_bridge_projection(
                registry_path,
            )
            .map_err(|cause| {
                platform_projection_error(
                    "host-internal-error",
                    "tauri-platform-projection-apps-bridge-failed",
                    "check_platform_projection_catalog",
                    projection_id.as_str(),
                    Some(cause),
                )
            })?;
            to_record_value(record, projection_id.as_str())?
        }
        _ => {
            return Err(platform_projection_error(
                "not-found",
                "tauri-platform-projection-not-found",
                "use_admitted_standard_platform_projection_id",
                projection_id.as_str(),
                None,
            ));
        }
    };
    Ok(StandardPlatformProjectionResult {
        projection_id,
        record,
    })
}

fn to_record_value<T: Serialize>(record: T, projection_id: &str) -> Result<Value, String> {
    serde_json::to_value(record).map_err(|error| {
        platform_projection_error(
            "host-internal-error",
            "tauri-platform-projection-serialize-failed",
            "check_platform_projection_serializer",
            projection_id,
            Some(error.to_string()),
        )
    })
}

fn now_iso_timestamp() -> String {
    chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true)
}

fn default_projection_path(pointer: &str) -> Result<PathBuf, String> {
    let mut path = crate::desktop_paths::resolve_nimi_data_dir().map_err(|cause| {
        platform_projection_error(
            "capability-unavailable",
            "tauri-platform-projection-data-root-unavailable",
            "repair_canonical_product_control_data_root",
            "",
            Some(cause),
        )
    })?;
    for segment in pointer.split('/') {
        path.push(segment);
    }
    Ok(path)
}

fn materialized_apps_registry_path(projection_id: &str) -> Result<String, String> {
    let path =
        default_projection_path(crate::platform_projection::apps_registry::APPS_REGISTRY_POINTER)?;
    match crate::platform_projection::apps_registry::materialize_apps_registry_projection(&path)
        .map_err(|cause| {
            platform_projection_error(
                "host-internal-error",
                "tauri-platform-projection-apps-registry-materialize-failed",
                "repair_or_recreate_apps_registry_projection",
                projection_id,
                Some(cause),
            )
        })? {
        crate::governed_config::ConfigReadOutcome::Ready(_) => Ok(path.display().to_string()),
        crate::governed_config::ConfigReadOutcome::Absent => Err(platform_projection_error(
            "host-internal-error",
            "tauri-platform-projection-apps-registry-materializer-returned-absent",
            "inspect_apps_registry_projection_materializer",
            projection_id,
            None,
        )),
        crate::governed_config::ConfigReadOutcome::Repair { reason, .. } => {
            Err(platform_projection_error(
                "host-internal-error",
                "tauri-platform-projection-apps-registry-repair-required",
                "repair_apps_registry_projection_before_apps_bridge",
                projection_id,
                Some(reason),
            ))
        }
    }
}

fn platform_projection_error(
    code: &str,
    reason_code: &str,
    action_hint: &str,
    projection_id: &str,
    cause: Option<String>,
) -> String {
    crate::capabilities::standard_shell_error(
        code,
        reason_code,
        action_hint,
        "tauri",
        Some(
            json!({ "command": "platform_projection_get", "projectionId": projection_id, "cause": cause }),
        ),
    )
}

#[cfg(test)]
mod tests {
    use super::platform_projection_get;
    use crate::runtime_bridge::{with_runtime_bridge_host_hooks, RuntimeBridgeHostHooks};
    use serde_json::{json, Value};
    use std::path::PathBuf;
    use std::sync::Arc;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_data_root(prefix: &str) -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("time")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!(
            "nimi-standard-platform-projection-data-root-{prefix}-{unique}"
        ));
        std::fs::create_dir_all(&dir).expect("create temp data root");
        dir
    }

    fn envelope(error: &str) -> Value {
        serde_json::from_str::<Value>(error).expect("standard shell error envelope")
    }

    #[test]
    fn builds_factory_profile_index_projection() {
        let result = platform_projection_get(json!({
            "projectionId": "factory-profile-index",
            "updatedAt": "2026-07-09T00:00:00.000Z"
        }))
        .expect("projection");

        assert_eq!(result.projection_id, "factory-profile-index");
        assert_eq!(
            result.record.get("updatedAt").and_then(Value::as_str),
            Some("2026-07-09T00:00:00.000Z")
        );
        assert!(result
            .record
            .get("profiles")
            .and_then(Value::as_array)
            .is_some_and(|profiles| !profiles.is_empty()));
    }

    #[test]
    fn builds_empty_apps_packages_projection_with_current_schema() {
        let result = platform_projection_get(json!({
            "projectionId": "apps-packages",
            "updatedAt": "2026-07-09T00:00:00.000Z"
        }))
        .expect("projection");

        assert_eq!(result.projection_id, "apps-packages");
        assert_eq!(
            result.record.get("schemaVersion").and_then(Value::as_u64),
            Some(2)
        );
        assert_eq!(
            result
                .record
                .get("packages")
                .and_then(Value::as_array)
                .map(Vec::len),
            Some(0)
        );
    }

    #[test]
    fn builds_apps_bridge_projection_from_canonical_data_root() {
        let data_root = temp_data_root("apps-bridge");
        let hook_root = data_root.clone();
        with_runtime_bridge_host_hooks(
            RuntimeBridgeHostHooks {
                resolve_nimi_data_dir: Some(Arc::new(move || Ok(hook_root.clone()))),
                ..RuntimeBridgeHostHooks::default()
            },
            || {
                let result = platform_projection_get(json!({ "projectionId": "apps-bridge" }))
                    .expect("projection");

                let registry_path = result
                    .record
                    .get("registryPath")
                    .and_then(Value::as_str)
                    .expect("registry path");
                assert!(
                    registry_path.ends_with("apps\\registry.json")
                        || registry_path.ends_with("apps/registry.json")
                );
                assert!(PathBuf::from(registry_path).starts_with(data_root.join("apps")));
                assert!(PathBuf::from(registry_path).exists());
                assert!(result.record.get("packagesPath").is_none());
                assert!(result
                    .record
                    .get("registryRows")
                    .and_then(Value::as_array)
                    .is_some_and(|rows| !rows.is_empty()));
            },
        );
    }

    #[test]
    fn rejects_caller_supplied_apps_bridge_paths() {
        let error = platform_projection_get(json!({
            "projectionId": "apps-bridge",
            "registryPath": "C:\\attacker\\registry.json"
        }))
        .expect_err("caller path must be rejected");
        let parsed = envelope(error.as_str());
        assert_eq!(
            parsed.get("reasonCode").and_then(Value::as_str),
            Some("tauri-platform-projection-payload-invalid")
        );
    }

    #[test]
    fn rejects_unknown_projection_as_not_found() {
        let error = platform_projection_get(json!({ "projectionId": "unknown" }))
            .expect_err("unknown projection rejected");
        let parsed = envelope(error.as_str());
        assert_eq!(
            parsed.get("code").and_then(Value::as_str),
            Some("not-found")
        );
        assert_eq!(
            parsed.get("reasonCode").and_then(Value::as_str),
            Some("tauri-platform-projection-not-found")
        );
    }
}
