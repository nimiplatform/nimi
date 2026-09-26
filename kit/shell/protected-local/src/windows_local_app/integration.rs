use super::{invalid_payload, untrusted};
use crate::generated::*;
use crate::grpc_status::local_app_error_from_status;
use crate::LocalAppOperationError;
use serde_json::{json, Value};
use tonic::transport::Channel;

fn exact(input: &Value, keys: &[&str]) -> Result<(), LocalAppOperationError> {
    let row = input.as_object().ok_or_else(invalid_payload)?;
    if row.len() != keys.len()
        || keys.iter().any(|key| !row.contains_key(*key))
        || input.to_string().len() > 33 * 1024 * 1024
    {
        return Err(invalid_payload());
    }
    Ok(())
}
fn text(
    input: &Value,
    key: &str,
    max: usize,
    empty: bool,
) -> Result<String, LocalAppOperationError> {
    let value = input[key].as_str().ok_or_else(invalid_payload)?;
    if (!empty && value.trim().is_empty()) || value.len() > max || value.contains('\0') {
        return Err(invalid_payload());
    }
    Ok(value.into())
}
fn number(input: &Value, key: &str, max: u32) -> Result<u32, LocalAppOperationError> {
    let value = input[key].as_u64().ok_or_else(invalid_payload)?;
    if value > max as u64 {
        return Err(invalid_payload());
    }
    Ok(value as u32)
}
fn names(input: &Value, key: &str) -> Result<Vec<String>, LocalAppOperationError> {
    let values = input[key].as_array().ok_or_else(invalid_payload)?;
    if values.len() > 128 {
        return Err(invalid_payload());
    }
    let mut names = Vec::new();
    for value in values {
        let name = value.as_str().ok_or_else(invalid_payload)?;
        if name.is_empty() || name.len() > 256 || names.iter().any(|n| n == name) {
            return Err(invalid_payload());
        }
        names.push(name.to_string())
    }
    Ok(names)
}
fn operation(input: &Value) -> Result<IntegrationOperation, LocalAppOperationError> {
    exact(
        input,
        &[
            "name",
            "description",
            "inputSchemaJson",
            "outputSchemaJson",
            "effect",
            "supportsCancel",
            "retryPolicy",
        ],
    )?;
    let input_schema_json = text(input, "inputSchemaJson", 65536, false)?;
    let output_schema_json = text(input, "outputSchemaJson", 65536, false)?;
    for encoded in [&input_schema_json, &output_schema_json] {
        let schema: Value = serde_json::from_str(encoded).map_err(|_| invalid_payload())?;
        if !schema.is_object() && !schema.is_boolean() {
            return Err(invalid_payload());
        }
    }
    let effect = text(input, "effect", 16, false)?;
    let retry_policy = text(input, "retryPolicy", 16, false)?;
    if !["read", "write"].contains(&effect.as_str())
        || !["none", "safe"].contains(&retry_policy.as_str())
    {
        return Err(invalid_payload());
    }
    Ok(IntegrationOperation {
        name: text(input, "name", 128, false)?,
        description: text(input, "description", 4096, true)?,
        input_schema_json,
        output_schema_json,
        effect,
        supports_cancel: input["supportsCancel"]
            .as_bool()
            .ok_or_else(invalid_payload)?,
        retry_policy,
    })
}
fn operations(input: &Value) -> Result<Vec<IntegrationOperation>, LocalAppOperationError> {
    let list = input["operations"].as_array().ok_or_else(invalid_payload)?;
    if list.is_empty() || list.len() > 128 {
        return Err(invalid_payload());
    }
    list.iter().map(operation).collect()
}
fn project_operation(v: IntegrationOperation) -> Value {
    json!({"name":v.name,"description":v.description,"inputSchemaJson":v.input_schema_json,"outputSchemaJson":v.output_schema_json,"effect":v.effect,"supportsCancel":v.supports_cancel,"retryPolicy":v.retry_policy})
}
fn target(v: IntegrationTarget) -> Value {
    json!({"targetRef":v.target_ref,"integrationId":v.integration_id,"displayName":v.display_name,"accountLabel":v.account_label,"kind":v.kind,"available":v.available,"operations":v.operations.into_iter().map(project_operation).collect::<Vec<_>>(),"skill":v.skill,"permittedOperations":v.permitted_operations})
}
fn permission(v: IntegrationPermission) -> Value {
    json!({"consumerRef":v.consumer_ref,"targetRef":v.target_ref,"operations":v.operations,"consumer":v.consumer.map(consumer)})
}
fn consumer(v: IntegrationConsumer) -> Value {
    json!({"consumerRef":v.consumer_ref,"appId":v.app_id,"displayName":v.display_name,"sourceKind":v.source_kind})
}
fn timestamp(v: Option<prost_types::Timestamp>) -> Result<Value, LocalAppOperationError> {
    let Some(v) = v else { return Ok(Value::Null) };
    let value = time::OffsetDateTime::from_unix_timestamp(v.seconds)
        .map_err(|_| untrusted())?
        .replace_nanosecond(u32::try_from(v.nanos).map_err(|_| untrusted())?)
        .map_err(|_| untrusted())?;
    Ok(json!(value
        .format(&time::format_description::well_known::Rfc3339)
        .map_err(|_| untrusted())?))
}
fn call(v: IntegrationCall) -> Result<Value, LocalAppOperationError> {
    if !["accepted", "completed", "failed", "canceled", "unconfirmed"].contains(&v.status.as_str())
        || v.result_json.len() > 1024 * 1024
    {
        return Err(untrusted());
    }
    Ok(
        json!({"callId":v.call_id,"targetRef":v.target_ref,"operation":v.operation,"status":v.status,"resultJson":v.result_json,"errorCode":v.error_code,"consumerDisplayName":v.consumer_display_name,"createdAt":timestamp(v.created_at)?,"updatedAt":timestamp(v.updated_at)?,"targetDisplayName":v.target_display_name,"accountLabel":v.account_label}),
    )
}

#[cfg(test)]
mod call_fact_tests {
    use super::*;

    #[test]
    fn call_projection_retains_admission_attribution() {
        let projected = call(IntegrationCall {
            call_id: "ic_example".into(),
            status: "unconfirmed".into(),
            consumer_display_name: "Nimi Day".into(),
            target_display_name: "Original connection".into(),
            account_label: "@original_bot".into(),
            ..Default::default()
        })
        .expect("valid call fact");
        assert_eq!(projected["callId"], "ic_example");
        assert_eq!(projected["status"], "unconfirmed");
        assert_eq!(projected["consumerDisplayName"], "Nimi Day");
        assert_eq!(projected["targetDisplayName"], "Original connection");
        assert_eq!(projected["accountLabel"], "@original_bot");
        assert_eq!(projected["resultJson"], "");
    }
}

// @nimi-authority: rule.nimi.runtime.integration.public-carrier
pub(super) async fn list_catalog(
    channel: Channel,
    input: Value,
) -> Result<Value, LocalAppOperationError> {
    exact(&input, &[])?;
    let request = ListIntegrationCatalogRequest {};
    let response = crate::grpc_limits::runtime_integration_client(channel)
        .list_integration_catalog(request)
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    Ok(json!({"targets":response.targets.into_iter().map(target).collect::<Vec<_>>()}))
}
pub(super) async fn list_connections(
    channel: Channel,
    input: Value,
) -> Result<Value, LocalAppOperationError> {
    exact(&input, &[])?;
    let request = ListIntegrationConnectionsRequest {};
    let response = crate::grpc_limits::runtime_integration_client(channel)
        .list_integration_connections(request)
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    Ok(json!({"connections":response.connections.into_iter().map(target).collect::<Vec<_>>()}))
}
pub(super) async fn invoke(
    channel: Channel,
    input: Value,
) -> Result<Value, LocalAppOperationError> {
    exact(&input, &["targetRef", "operation", "inputJson"])?;
    let request = InvokeIntegrationCallRequest {
        target_ref: text(&input, "targetRef", 512, false)?,
        operation: text(&input, "operation", 256, false)?,
        input_json: text(&input, "inputJson", 256 * 1024, false)?,
    };
    let response = crate::grpc_limits::runtime_integration_client(channel)
        .invoke_integration_call(request)
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    Ok(json!({"call":call(response.call.ok_or_else(untrusted)?)?}))
}
pub(super) async fn get_call(
    channel: Channel,
    input: Value,
) -> Result<Value, LocalAppOperationError> {
    exact(&input, &["callId"])?;
    let request = GetIntegrationCallRequest {
        call_id: text(&input, "callId", 512, false)?,
    };
    let response = crate::grpc_limits::runtime_integration_client(channel)
        .get_integration_call(request)
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    Ok(json!({"call":call(response.call.ok_or_else(untrusted)?)?}))
}
pub(super) async fn list_calls(
    channel: Channel,
    input: Value,
) -> Result<Value, LocalAppOperationError> {
    exact(&input, &["limit"])?;
    let request = ListIntegrationCallsRequest {
        limit: number(&input, "limit", 100)?,
    };
    let response = crate::grpc_limits::runtime_integration_client(channel)
        .list_integration_calls(request)
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    Ok(json!({"calls":response.calls.into_iter().map(call).collect::<Result<Vec<_>,_>>()?}))
}
pub(super) async fn cancel_call(
    channel: Channel,
    input: Value,
) -> Result<Value, LocalAppOperationError> {
    exact(&input, &["callId"])?;
    let request = CancelIntegrationCallRequest {
        call_id: text(&input, "callId", 512, false)?,
    };
    let response = crate::grpc_limits::runtime_integration_client(channel)
        .cancel_integration_call(request)
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    Ok(json!({"call":call(response.call.ok_or_else(untrusted)?)?}))
}
pub(super) async fn register_provider(
    channel: Channel,
    input: Value,
) -> Result<Value, LocalAppOperationError> {
    exact(
        &input,
        &["integrationId", "displayName", "operations", "skill"],
    )?;
    let request = RegisterIntegrationProviderRequest {
        integration_id: text(&input, "integrationId", 512, false)?,
        display_name: text(&input, "displayName", 512, false)?,
        operations: operations(&input)?,
        skill: text(&input, "skill", 32768, true)?,
    };
    let response = crate::grpc_limits::runtime_integration_client(channel)
        .register_integration_provider(request)
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    Ok(json!({"target":target(response.target.ok_or_else(untrusted)?)}))
}
pub(super) async fn unregister_provider(
    channel: Channel,
    input: Value,
) -> Result<Value, LocalAppOperationError> {
    exact(&input, &["targetRef"])?;
    let request = UnregisterIntegrationProviderRequest {
        target_ref: text(&input, "targetRef", 512, false)?,
    };
    let response = crate::grpc_limits::runtime_integration_client(channel)
        .unregister_integration_provider(request)
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    Ok(json!({"removed":response.removed}))
}
pub(super) async fn poll_provider(
    channel: Channel,
    input: Value,
) -> Result<Value, LocalAppOperationError> {
    exact(&input, &["waitMs"])?;
    let request = PollIntegrationProviderRequest {
        wait_ms: number(&input, "waitMs", 25000)?,
    };
    let response = crate::grpc_limits::runtime_integration_client(channel)
        .poll_integration_provider(request)
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    Ok(
        json!({"calls":response.calls.into_iter().map(|v|json!({"callId":v.call_id,"targetRef":v.target_ref,"operation":v.operation,"inputJson":v.input_json,"consumerDisplayName":v.consumer_display_name})).collect::<Vec<_>>(),"canceledCallIds":response.canceled_call_ids}),
    )
}
pub(super) async fn complete_provider(
    channel: Channel,
    input: Value,
) -> Result<Value, LocalAppOperationError> {
    exact(&input, &["callId", "resultJson", "errorCode"])?;
    let request = CompleteIntegrationProviderRequest {
        call_id: text(&input, "callId", 512, false)?,
        result_json: text(&input, "resultJson", 1024 * 1024, true)?,
        error_code: text(&input, "errorCode", 512, true)?,
    };
    let response = crate::grpc_limits::runtime_integration_client(channel)
        .complete_integration_provider(request)
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    Ok(json!({"accepted":response.accepted}))
}
pub(super) async fn get_management(
    channel: Channel,
    input: Value,
) -> Result<Value, LocalAppOperationError> {
    exact(&input, &[])?;
    let request = GetIntegrationManagementRequest {};
    let response = crate::grpc_limits::runtime_integration_client(channel)
        .get_integration_management(request)
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    Ok(
        json!({"targets":response.targets.into_iter().map(target).collect::<Vec<_>>(),"permissions":response.permissions.into_iter().map(permission).collect::<Vec<_>>(),"consumers":response.consumers.into_iter().map(consumer).collect::<Vec<_>>(),"calls":response.calls.into_iter().map(call).collect::<Result<Vec<_>,_>>()?}),
    )
}
pub(super) async fn put_connection(
    channel: Channel,
    input: Value,
) -> Result<Value, LocalAppOperationError> {
    exact(
        &input,
        &[
            "targetRef",
            "adapter",
            "endpoint",
            "displayName",
            "accountLabel",
            "secret",
        ],
    )?;
    let request = PutIntegrationConnectionRequest {
        target_ref: text(&input, "targetRef", 512, true)?,
        adapter: text(&input, "adapter", 16, false)?,
        endpoint: text(&input, "endpoint", 4096, true)?,
        display_name: text(&input, "displayName", 512, false)?,
        account_label: text(&input, "accountLabel", 512, true)?,
        secret: text(&input, "secret", 16384, true)?,
    };
    let response = crate::grpc_limits::runtime_integration_client(channel)
        .put_integration_connection(request)
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    Ok(json!({"connection":target(response.connection.ok_or_else(untrusted)?)}))
}
pub(super) async fn remove_connection(
    channel: Channel,
    input: Value,
) -> Result<Value, LocalAppOperationError> {
    exact(&input, &["targetRef"])?;
    let request = RemoveIntegrationConnectionRequest {
        target_ref: text(&input, "targetRef", 512, false)?,
    };
    let response = crate::grpc_limits::runtime_integration_client(channel)
        .remove_integration_connection(request)
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    Ok(json!({"removed":response.removed}))
}
pub(super) async fn set_permission(
    channel: Channel,
    input: Value,
) -> Result<Value, LocalAppOperationError> {
    exact(&input, &["consumerRef", "targetRef", "operations"])?;
    let request = SetIntegrationPermissionRequest {
        consumer_ref: text(&input, "consumerRef", 512, false)?,
        target_ref: text(&input, "targetRef", 512, false)?,
        operations: names(&input, "operations")?,
    };
    let response = crate::grpc_limits::runtime_integration_client(channel)
        .set_integration_permission(request)
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    Ok(json!({"permission":permission(response.permission.ok_or_else(untrusted)?)}))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn schemas_allow_64k_and_boolean_with_a_33mib_aggregate_boundary() {
        let schema = json!({"type":"object","description":"x".repeat(48 * 1024)}).to_string();
        let value = json!({"name":"read","description":"","inputSchemaJson":schema,"outputSchemaJson":"true","effect":"read","supportsCancel":false,"retryPolicy":"safe"});
        assert!(operation(&value).is_ok());
        let many = json!({"operations":vec![value.clone();30]});
        assert!(exact(&many, &["operations"]).is_ok());
        assert_eq!(operations(&many).unwrap().len(), 30);
        for schema in ["[]".to_string(), "null".to_string(), "x".repeat(65537)] {
            let mut invalid = value.clone();
            invalid["inputSchemaJson"] = json!(schema);
            assert!(operation(&invalid).is_err());
        }
        let oversized = json!({"data":"x".repeat(33 * 1024 * 1024)});
        assert!(exact(&oversized, &["data"]).is_err());
    }
    #[test]
    fn call_timestamps_retain_the_runtime_fraction() {
        let projected = timestamp(Some(prost_types::Timestamp {
            seconds: 1_790_000_000,
            nanos: 123_456_789,
        }))
        .unwrap();
        assert!(projected.as_str().unwrap().contains(".123456789"));
        assert!(timestamp(Some(prost_types::Timestamp {
            seconds: 0,
            nanos: -1
        }))
        .is_err());
    }
}
