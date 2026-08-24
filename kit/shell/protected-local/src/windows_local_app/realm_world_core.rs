use std::time::Duration;

use serde_json::{json, Map as JsonMap, Value as JsonValue};
use tonic::{transport::Channel, Request};

use crate::generated::{InvokeRealmUnaryRequest, InvokeRealmUnaryResponse};
use crate::grpc_status::{local_app_error_from_status, local_app_reason_from_proto};
use crate::{
    LocalAppOperationError, LocalAppReasonCode, LocalAppWorldCoreCreateRequest,
    LocalAppWorldCoreListRequest,
};

use super::{invalid_payload, untrusted};

const ACTION_EXECUTED: i32 = 1;
const LIST_WORLD_CORES_METHOD_ID: &str = "WorldCoreController_listWorldCores";
const CREATE_WORLD_CORE_METHOD_ID: &str = "WorldCoreController_createWorldCore";
const OPERATION_TIMEOUT_MS: i32 = 30_000;
const CARRIER_TIMEOUT: Duration = Duration::from_secs(35);
const MAX_REQUEST_JSON_BYTES: usize = 2 * 1024 * 1024;
const MAX_RESPONSE_JSON_BYTES: usize = 1024 * 1024;

pub(super) async fn list(
    channel: Channel,
    request: LocalAppWorldCoreListRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    let mut query = JsonMap::new();
    if let Some(take) = request.take {
        query.insert("take".to_string(), JsonValue::from(take));
    }
    if let Some(visibility) = request.visibility {
        validate_visibility(&visibility)?;
        query.insert("visibility".to_string(), JsonValue::String(visibility));
    }
    let result = invoke_exact(
        channel,
        LIST_WORLD_CORES_METHOD_ID,
        json!({"path": {}, "query": query}),
    )
    .await?;
    let JsonValue::Array(worlds) = &result else {
        return Err(untrusted());
    };
    if worlds.iter().any(|world| !world.is_object()) {
        return Err(untrusted());
    }
    Ok(result)
}

pub(super) async fn create(
    channel: Channel,
    request: LocalAppWorldCoreCreateRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    if !request.body.is_object() {
        return Err(invalid_payload());
    }
    let result = invoke_exact(
        channel,
        CREATE_WORLD_CORE_METHOD_ID,
        json!({"path": {}, "query": {}, "body": request.body}),
    )
    .await?;
    if !result.is_object() {
        return Err(untrusted());
    }
    Ok(result)
}

async fn invoke_exact(
    channel: Channel,
    method_id: &'static str,
    request_value: JsonValue,
) -> Result<JsonValue, LocalAppOperationError> {
    let request_json = serde_json::to_string(&request_value).map_err(|_| invalid_payload())?;
    if request_json.len() > MAX_REQUEST_JSON_BYTES {
        return Err(LocalAppOperationError::new(
            LocalAppReasonCode::ResourceExhausted,
            false,
        ));
    }
    let mut request = Request::new(InvokeRealmUnaryRequest {
        caller: None,
        method_id: method_id.to_string(),
        realm_base_url: String::new(),
        request_json,
        timeout_ms: OPERATION_TIMEOUT_MS,
    });
    request.set_timeout(CARRIER_TIMEOUT);
    let response = crate::grpc_limits::runtime_account_client(channel)
        .invoke_realm_unary(request)
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    project_response(response)
}

fn project_response(
    response: InvokeRealmUnaryResponse,
) -> Result<JsonValue, LocalAppOperationError> {
    if response.accepted {
        if response.reason_code != ACTION_EXECUTED
            || response.account_reason_code != ACTION_EXECUTED
            || response.production_inert
            || !(200..300).contains(&response.http_status)
            || !response.error_message.is_empty()
            || response.response_json.len() > MAX_RESPONSE_JSON_BYTES
        {
            return Err(untrusted());
        }
        return serde_json::from_str(&response.response_json).map_err(|_| untrusted());
    }
    if !response.response_json.is_empty()
        || response.reason_code == ACTION_EXECUTED
        || response.account_reason_code == ACTION_EXECUTED
    {
        return Err(untrusted());
    }
    let reason = local_app_reason_from_proto(response.reason_code).ok_or_else(untrusted)?;
    let retryable = matches!(response.reason_code, 661 | 664 | 667);
    Err(LocalAppOperationError::new(reason, retryable))
}

fn validate_visibility(value: &str) -> Result<(), LocalAppOperationError> {
    if matches!(value, "private" | "unlisted" | "public" | "system") {
        Ok(())
    } else {
        Err(invalid_payload())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn exact_world_core_response_projection_is_closed() {
        let list = project_response(InvokeRealmUnaryResponse {
            accepted: true,
            response_json: "[{\"id\":\"world-1\"}]".to_string(),
            reason_code: ACTION_EXECUTED,
            account_reason_code: ACTION_EXECUTED,
            production_inert: false,
            http_status: 200,
            error_message: String::new(),
        })
        .expect("valid list response");
        assert!(list.is_array());

        let failure = project_response(InvokeRealmUnaryResponse {
            accepted: false,
            response_json: String::new(),
            reason_code: 662,
            account_reason_code: 30,
            production_inert: false,
            http_status: 404,
            error_message: "private upstream detail".to_string(),
        })
        .expect_err("not found");
        assert_eq!(failure.reason_code(), LocalAppReasonCode::NotFound);
        assert!(!failure.to_string().contains("private"));
    }

    #[test]
    fn list_visibility_is_exact() {
        for visibility in ["private", "unlisted", "public", "system"] {
            validate_visibility(visibility).expect(visibility);
        }
        assert_eq!(
            validate_visibility("all").unwrap_err().reason_code(),
            LocalAppReasonCode::InvalidPayload
        );
    }
}
