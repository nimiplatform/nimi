use std::time::Duration;

use serde_json::{json, Map as JsonMap, Value as JsonValue};
use tonic::{transport::Channel, Request};

use crate::generated::{InvokeRealmUnaryRequest, InvokeRealmUnaryResponse};
use crate::grpc_status::{local_app_error_from_status, local_app_realm_reason_from_response};
use crate::{
    LocalAppOperationError, LocalAppReasonCode, LocalAppWorldCharacterCreateRequest,
    LocalAppWorldCharacterGetRequest, LocalAppWorldCharacterListRequest,
    LocalAppWorldCharacterReplaceRequest, LocalAppWorldCoreCreateRequest,
    LocalAppWorldCoreGetRequest, LocalAppWorldCoreListRequest, LocalAppWorldCoreReplaceRequest,
    LocalAppWorldEntityCreateRequest, LocalAppWorldEntityGetRequest,
    LocalAppWorldEntityListRequest, LocalAppWorldRelationshipGetRequest,
    LocalAppWorldRelationshipListRequest,
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

// @nimi-authority: rule.nimi.platform.core-protocol.world-creator-app-operations
pub(super) async fn get(
    channel: Channel,
    request: LocalAppWorldCoreGetRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    validate_identifier(&request.world_id)?;
    let result = invoke_exact(
        channel,
        "WorldCoreController_getWorldCore",
        json!({"path": {"worldId": request.world_id}, "query": {}}),
    )
    .await?;
    if !result.is_object() {
        return Err(untrusted());
    }
    Ok(result)
}

pub(super) async fn replace(
    channel: Channel,
    request: LocalAppWorldCoreReplaceRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    validate_identifier(&request.world_id)?;
    if !request.body.is_object() {
        return Err(invalid_payload());
    }
    let result = invoke_exact(
        channel,
        "WorldCoreController_replaceWorldCore",
        json!({"path": {"worldId": request.world_id}, "query": {}, "body": request.body}),
    )
    .await?;
    if !result.is_object() {
        return Err(untrusted());
    }
    Ok(result)
}

pub(super) async fn list_characters(
    channel: Channel,
    request: LocalAppWorldCharacterListRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    validate_identifier(&request.world_id)?;
    let mut query = JsonMap::new();
    if let Some(value) = request.visibility {
        validate_visibility(&value)?;
        query.insert("visibility".to_string(), JsonValue::from(value));
    }
    if let Some(value) = request.after_id {
        validate_identifier(&value)?;
        query.insert("afterId".to_string(), JsonValue::from(value));
    }
    if let Some(value) = request.take {
        if !(1..=500).contains(&value) {
            return Err(invalid_payload());
        }
        query.insert("take".to_string(), JsonValue::from(value));
    }
    let result = invoke_exact(
        channel,
        "WorldCoreController_listWorldCharacters",
        json!({"path": {"worldId": request.world_id}, "query": query}),
    )
    .await?;
    if !result
        .as_array()
        .is_some_and(|rows| rows.len() <= 500 && rows.iter().all(JsonValue::is_object))
    {
        return Err(untrusted());
    }
    Ok(result)
}

pub(super) async fn get_character(
    channel: Channel,
    request: LocalAppWorldCharacterGetRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    validate_identifier(&request.character_id)?;
    let result = invoke_exact(
        channel,
        "WorldCoreController_getWorldCharacter",
        json!({"path": {"characterId": request.character_id}, "query": {}}),
    )
    .await?;
    if !result.is_object() {
        return Err(untrusted());
    }
    Ok(result)
}

pub(super) async fn create_character(
    channel: Channel,
    request: LocalAppWorldCharacterCreateRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    validate_identifier(&request.world_id)?;
    if !request.body.is_object() {
        return Err(invalid_payload());
    }
    let result = invoke_exact(
        channel,
        "WorldCoreController_createWorldCharacter",
        json!({"path": {"worldId": request.world_id}, "query": {}, "body": request.body}),
    )
    .await?;
    if !result.is_object() {
        return Err(untrusted());
    }
    Ok(result)
}

pub(super) async fn replace_character(
    channel: Channel,
    request: LocalAppWorldCharacterReplaceRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    validate_identifier(&request.character_id)?;
    if !request.body.is_object() {
        return Err(invalid_payload());
    }
    let result = invoke_exact(
        channel,
        "WorldCoreController_replaceWorldCharacter",
        json!({"path": {"characterId": request.character_id}, "query": {}, "body": request.body}),
    )
    .await?;
    if !result.is_object() {
        return Err(untrusted());
    }
    Ok(result)
}

pub(super) async fn list_entities(
    channel: Channel,
    request: LocalAppWorldEntityListRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    validate_identifier(&request.world_id)?;
    let mut query = JsonMap::new();
    if let Some(value) = request.kind {
        validate_identifier(&value)?;
        query.insert("kind".to_string(), JsonValue::from(value));
    }
    if let Some(value) = request.after_id {
        validate_identifier(&value)?;
        query.insert("afterId".to_string(), JsonValue::from(value));
    }
    if let Some(value) = request.take {
        if !(1..=500).contains(&value) {
            return Err(invalid_payload());
        }
        query.insert("take".to_string(), JsonValue::from(value));
    }
    let result = invoke_exact(
        channel,
        "WorldCoreController_listWorldEntities",
        json!({"path": {"worldId": request.world_id}, "query": query}),
    )
    .await?;
    if !result
        .as_array()
        .is_some_and(|rows| rows.len() <= 500 && rows.iter().all(JsonValue::is_object))
    {
        return Err(untrusted());
    }
    Ok(result)
}

pub(super) async fn get_entity(
    channel: Channel,
    request: LocalAppWorldEntityGetRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    validate_identifier(&request.entity_id)?;
    let result = invoke_exact(
        channel,
        "WorldCoreController_getWorldEntity",
        json!({"path": {"entityId": request.entity_id}, "query": {}}),
    )
    .await?;
    if !result.is_object() {
        return Err(untrusted());
    }
    Ok(result)
}

pub(super) async fn create_entity(
    channel: Channel,
    request: LocalAppWorldEntityCreateRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    validate_identifier(&request.world_id)?;
    if !request.body.is_object() {
        return Err(invalid_payload());
    }
    let result = invoke_exact(
        channel,
        "WorldCoreController_createWorldEntity",
        json!({"path": {"worldId": request.world_id}, "query": {}, "body": request.body}),
    )
    .await?;
    if !result.is_object() {
        return Err(untrusted());
    }
    Ok(result)
}

pub(super) async fn list_relationships(
    channel: Channel,
    request: LocalAppWorldRelationshipListRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    validate_identifier(&request.world_id)?;
    let mut query = JsonMap::new();
    if let Some(value) = request.entity_id {
        validate_identifier(&value)?;
        query.insert("entityId".to_string(), JsonValue::from(value));
    }
    if let Some(value) = request.source_entity_id {
        validate_identifier(&value)?;
        query.insert("sourceEntityId".to_string(), JsonValue::from(value));
    }
    if let Some(value) = request.target_entity_id {
        validate_identifier(&value)?;
        query.insert("targetEntityId".to_string(), JsonValue::from(value));
    }
    if let Some(value) = request.r#type {
        validate_identifier(&value)?;
        query.insert("type".to_string(), JsonValue::from(value));
    }
    if let Some(value) = request.after_id {
        validate_identifier(&value)?;
        query.insert("afterId".to_string(), JsonValue::from(value));
    }
    if let Some(value) = request.take {
        if !(1..=500).contains(&value) {
            return Err(invalid_payload());
        }
        query.insert("take".to_string(), JsonValue::from(value));
    }
    let result = invoke_exact(
        channel,
        "WorldCoreController_listWorldRelationships",
        json!({"path": {"worldId": request.world_id}, "query": query}),
    )
    .await?;
    if !result
        .as_array()
        .is_some_and(|rows| rows.len() <= 500 && rows.iter().all(JsonValue::is_object))
    {
        return Err(untrusted());
    }
    Ok(result)
}

pub(super) async fn get_relationship(
    channel: Channel,
    request: LocalAppWorldRelationshipGetRequest,
) -> Result<JsonValue, LocalAppOperationError> {
    validate_identifier(&request.relationship_id)?;
    let result = invoke_exact(
        channel,
        "WorldCoreController_getWorldRelationship",
        json!({"path": {"relationshipId": request.relationship_id}, "query": {}}),
    )
    .await?;
    if !result.is_object() {
        return Err(untrusted());
    }
    Ok(result)
}

fn validate_identifier(value: &str) -> Result<(), LocalAppOperationError> {
    if value.is_empty() || value.trim() != value || value.len() > 512 || value.contains('\0') {
        return Err(invalid_payload());
    }
    Ok(())
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
    let reason =
        local_app_realm_reason_from_response(response.reason_code, response.account_reason_code)
            .ok_or_else(untrusted)?;
    let retryable = matches!(
        reason,
        LocalAppReasonCode::RealmUnavailable
            | LocalAppReasonCode::RateLimited
            | LocalAppReasonCode::UpstreamFailed
    );
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
    fn world_creator_failures_preserve_realm_semantics() {
        use crate::generated::{AccountReasonCode, ReasonCode};
        for (code, account_code, http_status, expected, retryable) in [
            (
                ReasonCode::RealmConflict,
                AccountReasonCode::BrokerConflict,
                409,
                LocalAppReasonCode::ContentConflict,
                false,
            ),
            (
                ReasonCode::RealmRateLimited,
                AccountReasonCode::BrokerRateLimited,
                429,
                LocalAppReasonCode::RateLimited,
                true,
            ),
            (
                ReasonCode::RealmUnavailable,
                AccountReasonCode::BrokerRealmUnavailable,
                503,
                LocalAppReasonCode::RealmUnavailable,
                true,
            ),
            (
                ReasonCode::RealmContractInvalid,
                AccountReasonCode::BrokerContractFailed,
                502,
                LocalAppReasonCode::ContractInvalid,
                false,
            ),
        ] {
            let error = project_response(InvokeRealmUnaryResponse {
                accepted: false,
                reason_code: code as i32,
                account_reason_code: account_code as i32,
                http_status,
                ..Default::default()
            })
            .expect_err("Realm failure");
            assert_eq!(error.reason_code(), expected);
            assert_eq!(error.retryable(), retryable);
        }
    }

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

pub(super) async fn creation_eligibility(
    channel: Channel,
) -> Result<JsonValue, LocalAppOperationError> {
    let value = invoke_exact(
        channel,
        "WorldCoreController_getWorldCreationEligibility",
        json!({"path": {}, "query": {}}),
    )
    .await?;
    if !value.as_object().is_some_and(|record| {
        record.len() == 1
            && record
                .get("canCreateWorld")
                .is_some_and(JsonValue::is_boolean)
    }) {
        return Err(untrusted());
    }
    Ok(value)
}
