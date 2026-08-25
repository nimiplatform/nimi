use std::time::Duration;

use serde_json::{json, Map as JsonMap, Value as JsonValue};
use tonic::{transport::Channel, Request};

use crate::generated::{
    AccountReasonCode, InvokeRealmUnaryRequest, InvokeRealmUnaryResponse, ReasonCode,
};
use crate::grpc_status::{
    local_app_error_from_status, local_app_persona_reason_from_realm_response,
};
use crate::{
    LocalAppOperationError, LocalAppPersonaCharacterCreateRequest,
    LocalAppPersonaCharacterDeleteRequest,
    LocalAppPersonaCharacterGetOwnedRequest, LocalAppPersonaCharacterListOwnedRequest,
    LocalAppPersonaCharacterReplaceRequest, LocalAppReasonCode,
};

use super::{invalid_payload, untrusted};

const LIST_METHOD_ID: &str = "WorldCoreController_listPersonaCharacters";
const GET_METHOD_ID: &str = "WorldCoreController_getPersonaCharacter";
const CREATE_METHOD_ID: &str = "WorldCoreController_createPersonaCharacter";
const REPLACE_METHOD_ID: &str = "WorldCoreController_replacePersonaCharacter";
const DELETE_METHOD_ID: &str = "WorldCoreController_deletePersonaCharacter";
const OPERATION_TIMEOUT_MS: i32 = 30_000;
const CARRIER_TIMEOUT: Duration = Duration::from_secs(35);
const MAX_REQUEST_JSON_BYTES: usize = 2 * 1024 * 1024;
const MAX_RESPONSE_JSON_BYTES: usize = 1024 * 1024;

// @nimi-authority: rule.nimi.platform.core-protocol.p-proto-048
pub(super) async fn list_owned(
    channel: Channel,
    request: LocalAppPersonaCharacterListOwnedRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    let mut query =
        JsonMap::from_iter([("scope".to_string(), JsonValue::String("owned".to_string()))]);
    if let Some(world_id) = request.world_id {
        query.insert(
            "worldId".to_string(),
            JsonValue::String(validate_identifier(world_id)?),
        );
    }
    if let Some(visibility) = request.visibility {
        validate_writable_visibility(&visibility)?;
        query.insert("visibility".to_string(), JsonValue::String(visibility));
    }
    if let Some(after_id) = request.after_id {
        query.insert(
            "afterId".to_string(),
            JsonValue::String(validate_identifier(after_id)?),
        );
    }
    if let Some(take) = request.take {
        if !(1..=500).contains(&take) {
            return Err(invalid_payload());
        }
        query.insert("take".to_string(), JsonValue::from(take));
    }
    let result = invoke_exact(channel, LIST_METHOD_ID, json!({"path": {}, "query": query})).await?;
    if !result
        .as_array()
        .is_some_and(|items| items.len() <= 500 && items.iter().all(JsonValue::is_object))
    {
        return Err(untrusted());
    }
    Ok(result)
}

pub(super) async fn get_owned(
    channel: Channel,
    request: LocalAppPersonaCharacterGetOwnedRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    let persona_id = validate_identifier(request.persona_character_id)?;
    let result = invoke_exact(
        channel,
        GET_METHOD_ID,
        json!({"path": {"personaCharacterId": persona_id}, "query": {}}),
    )
    .await?;
    require_object(result)
}

pub(super) async fn create(
    channel: Channel,
    request: LocalAppPersonaCharacterCreateRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    validate_write_envelope(&request.body, false)?;
    let result = invoke_exact(
        channel,
        CREATE_METHOD_ID,
        json!({"path": {}, "query": {}, "body": request.body}),
    )
    .await?;
    require_object(result)
}

pub(super) async fn replace(
    channel: Channel,
    request: LocalAppPersonaCharacterReplaceRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    let persona_id = validate_identifier(request.persona_character_id)?;
    validate_write_envelope(&request.body, true)?;
    let result = invoke_exact(
        channel,
        REPLACE_METHOD_ID,
        json!({"path": {"personaCharacterId": persona_id}, "query": {}, "body": request.body}),
    )
    .await?;
    require_object(result)
}

pub(super) async fn delete(
    channel: Channel,
    request: LocalAppPersonaCharacterDeleteRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    let persona_id = validate_identifier(request.persona_character_id)?;
    let result = invoke_exact(
        channel,
        DELETE_METHOD_ID,
        json!({"path": {"personaCharacterId": persona_id}, "query": {}}),
    )
    .await?;
    let Some(object) = result.as_object() else {
        return Err(untrusted());
    };
    if object.len() != 2
        || object.get("personaCharacterId").and_then(JsonValue::as_str) != Some(persona_id.as_str())
        || object.get("deleted").and_then(JsonValue::as_bool) != Some(true)
    {
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
            LocalAppReasonCode::RequestTooLarge,
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
        if ReasonCode::try_from(response.reason_code).ok() != Some(ReasonCode::ActionExecuted)
            || AccountReasonCode::try_from(response.account_reason_code).ok()
                != Some(AccountReasonCode::ActionExecuted)
            || response.production_inert
            || !(200..300).contains(&response.http_status)
            || !response.error_message.is_empty()
        {
            return Err(untrusted());
        }
        if response.response_json.len() > MAX_RESPONSE_JSON_BYTES {
            return Err(LocalAppOperationError::new(
                LocalAppReasonCode::ResponseTooLarge,
                false,
            ));
        }
        return serde_json::from_str(&response.response_json).map_err(|_| untrusted());
    }
    if !response.response_json.is_empty()
        || !response.error_message.is_empty()
        || ReasonCode::try_from(response.reason_code).ok() == Some(ReasonCode::ActionExecuted)
        || AccountReasonCode::try_from(response.account_reason_code).ok()
            == Some(AccountReasonCode::ActionExecuted)
    {
        return Err(untrusted());
    }
    let reason = local_app_persona_reason_from_realm_response(
        response.reason_code,
        response.account_reason_code,
    )
    .ok_or_else(untrusted)?;
    let retryable = matches!(
        reason,
        LocalAppReasonCode::RealmUnavailable
            | LocalAppReasonCode::RateLimited
            | LocalAppReasonCode::UpstreamFailed
    );
    Err(LocalAppOperationError::new(reason, retryable))
}

fn validate_write_envelope(value: &JsonValue, replace: bool) -> Result<(), LocalAppOperationError> {
    let Some(object) = value.as_object() else {
        return Err(invalid_payload());
    };
    let keys = if replace {
        &[
            "baseContentHash",
            "worldId",
            "visibility",
            "origin",
            "profile",
        ][..]
    } else {
        &["worldId", "visibility", "origin", "profile"][..]
    };
    if object.len() != keys.len() || keys.iter().any(|key| !object.contains_key(*key)) {
        return Err(invalid_payload());
    }
    validate_identifier(
        object
            .get("worldId")
            .and_then(JsonValue::as_str)
            .unwrap_or_default()
            .to_string(),
    )?;
    validate_writable_visibility(
        object
            .get("visibility")
            .and_then(JsonValue::as_str)
            .unwrap_or_default(),
    )?;
    let Some(profile) = object.get("profile").and_then(JsonValue::as_object) else {
        return Err(invalid_payload());
    };
    if !object.get("origin").is_some_and(JsonValue::is_object)
        || profile.contains_key("profileHash")
        || profile.contains_key("profileCoverage")
    {
        return Err(invalid_payload());
    }
    if replace
        && !object
            .get("baseContentHash")
            .and_then(JsonValue::as_str)
            .is_some_and(is_hash)
    {
        return Err(invalid_payload());
    }
    let encoded = serde_json::to_vec(value).map_err(|_| invalid_payload())?;
    if encoded.len() > MAX_REQUEST_JSON_BYTES {
        return Err(LocalAppOperationError::new(
            LocalAppReasonCode::RequestTooLarge,
            false,
        ));
    }
    Ok(())
}

fn require_object(value: JsonValue) -> Result<JsonValue, LocalAppOperationError> {
    if value.is_object() {
        Ok(value)
    } else {
        Err(untrusted())
    }
}

fn validate_identifier(value: String) -> Result<String, LocalAppOperationError> {
    if value.is_empty()
        || value.trim() != value
        || value.len() > 512
        || value.chars().any(char::is_control)
    {
        return Err(invalid_payload());
    }
    Ok(value)
}

fn validate_writable_visibility(value: &str) -> Result<(), LocalAppOperationError> {
    if matches!(value, "private" | "unlisted" | "public") {
        Ok(())
    } else {
        Err(invalid_payload())
    }
}

fn is_hash(value: &str) -> bool {
    value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opaque_product_fields_are_not_a_carrier_authority_catalog() {
        let body = json!({
            "worldId": "world-1",
            "visibility": "private",
            "origin": {"kind": "forge"},
            "profile": {
                "profileSchemaVersion": "realm.character-profile-core/v1",
                "narrative": "Bearer abcdefgh.abcdefgh.abcdefgh",
                "authoring": {"extensions": {"future.product": {"fields": {
                    "token": "product-token", "secret": "story-secret", "classification": "story"
                }}}}
            }
        });
        assert!(validate_write_envelope(&body, false).is_ok());
    }

    #[test]
    fn system_write_visibility_and_output_profile_fields_are_rejected() {
        for body in [
            json!({"worldId":"world-1","visibility":"system","origin":{},"profile":{}}),
            json!({"worldId":"world-1","visibility":"private","origin":{},"profile":{"profileHash":"x"}}),
        ] {
            assert!(validate_write_envelope(&body, false).is_err());
        }
    }

    #[test]
    fn failure_projection_uses_central_generated_mapping_and_stays_sanitized() {
        let error = project_response(InvokeRealmUnaryResponse {
            accepted: false,
            reason_code: ReasonCode::RealmConflict as i32,
            account_reason_code: AccountReasonCode::BrokerConflict as i32,
            ..Default::default()
        })
        .expect_err("conflict");
        assert_eq!(error.reason_code(), LocalAppReasonCode::ContentConflict);

        let invalid = project_response(InvokeRealmUnaryResponse {
            accepted: false,
            reason_code: ReasonCode::RealmConflict as i32,
            account_reason_code: AccountReasonCode::BrokerConflict as i32,
            error_message: "private".to_string(),
            ..Default::default()
        })
        .expect_err("raw detail must be rejected");
        assert_eq!(
            invalid.reason_code(),
            LocalAppReasonCode::RuntimeServiceUntrusted
        );
    }
}
