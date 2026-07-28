use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(deny_unknown_fields)]
pub struct StandardPlatformProjectionPayload {
    pub projection_id: String,
    pub updated_at: Option<String>,
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
    use serde_json::{json, Value};

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
