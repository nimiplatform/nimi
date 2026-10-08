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
    let request = put_connection_request(input)?;
    let response = crate::grpc_limits::runtime_integration_client(channel)
        .put_integration_connection(request)
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    Ok(json!({"connection":target(response.connection.ok_or_else(untrusted)?)}))
}

// @nimi-authority: rule.nimi.runtime.integration.connection-setup
fn connection_input(mut input: Value) -> Value {
    if input["adapter"] == "weixin" {
        if let Some(row) = input.as_object_mut() {
            row.entry("displayName").or_insert(json!(""));
        }
    }
    input
}

fn put_connection_request(input: Value) -> Result<PutIntegrationConnectionRequest, LocalAppOperationError> {
    let input = connection_input(input);
    exact(
        &input,
        &[
            "targetRef",
            "adapter",
            "displayName",
            "accountLabel",
            "secret",
            "config",
        ],
    )?;
    Ok(PutIntegrationConnectionRequest {
        target_ref: text(&input, "targetRef", 512, true)?,
        adapter: text(&input, "adapter", 16, false)?,
        display_name: text(&input, "displayName", 256, input["adapter"] == "weixin")?,
        account_label: text(&input, "accountLabel", 512, true)?,
        secret: text(&input, "secret", 16384, true)?,
        config: Some(config(&input)?),
    })
}

// @nimi-authority: rule.nimi.runtime.integration.connection-setup
fn config(input: &Value) -> Result<IntegrationConnectionConfig, LocalAppOperationError> {
    let adapter = text(input, "adapter", 16, false)?;
    let key = match adapter.as_str() {
        "mcp" => "mcp", "telegram" => "telegram", "weixin" => "weixin",
        "feishu" => "feishu", "qq-official" => "qqOfficial", "onebot-v11" => "onebotV11",
        _ => return Err(invalid_payload()),
    };
    exact(&input["config"], &[key])?;
    let value = &input["config"][key];
    let mut config = IntegrationConnectionConfig::default();
    match key {
        "mcp" => { exact(value, &["endpoint"])?; config.mcp = Some(IntegrationMcpConfig { endpoint: text(value, "endpoint", 4096, false)? }); }
        "telegram" => { exact(value, &[])?; config.telegram = Some(IntegrationTelegramConfig {}); }
        "weixin" => { exact(value, &[])?; config.weixin = Some(IntegrationWeixinConfig {}); }
        "feishu" => {
            let mode = text(value,"setupMode",16,false)?;
            let app_id = match mode.as_str() {
                "manual" => { exact(value,&["setupMode","appId"])?; text(value,"appId",256,false)? }
                "create" => { exact(value,&["setupMode"])?; String::new() }
                _ => return Err(invalid_payload()),
            };
            config.feishu = Some(IntegrationFeishuConfig { app_id, setup_mode: mode });
        }
        "qqOfficial" => { exact(value, &["appId"])?; config.qq_official = Some(IntegrationQqOfficialConfig { app_id: text(value, "appId", 256, false)? }); }
        "onebotV11" => { exact(value, &["listener", "selfId"])?; config.onebot_v11 = Some(IntegrationOneBotV11Config { listener: text(value, "listener", 256, false)?, self_id: text(value, "selfId", 256, false)? }); }
        _ => return Err(invalid_payload()),
    }
    Ok(config)
}

// @nimi-authority: rule.nimi.runtime.integration.connection-setup
fn setup(value: IntegrationConnectionSetup) -> Result<Value, LocalAppOperationError> {
    if (value.status == "already-bound" || value.status == "awaiting-new-target") && (value.adapter != "weixin" || value.target_ref.is_empty() || value.account_label.is_empty() || !value.error_code.is_empty() || !value.qr_code_url.is_empty() || !value.verification_url.is_empty()) {
        return Err(untrusted());
    }
    Ok(json!({"setupId":value.setup_id,"adapter":value.adapter,"targetRef":value.target_ref,"status":value.status,"expiresAt":timestamp(value.expires_at)?,"qrCodeUrl":value.qr_code_url,"verificationUrl":value.verification_url,"accountLabel":value.account_label,"errorCode":value.error_code}))
}

pub(super) async fn start_connection_setup(channel: Channel, input: Value) -> Result<Value, LocalAppOperationError> {
    let request = start_connection_setup_request(input)?;
    let response = crate::grpc_limits::runtime_integration_client(channel).start_integration_connection_setup(request).await.map_err(local_app_error_from_status)?.into_inner();
    Ok(json!({"setup":setup(response.setup.ok_or_else(untrusted)?)?}))
}
fn start_connection_setup_request(input: Value) -> Result<StartIntegrationConnectionSetupRequest, LocalAppOperationError> {
    let input = connection_input(input);
    exact(&input, &["targetRef", "adapter", "displayName", "accountLabel", "config"])?;
    Ok(StartIntegrationConnectionSetupRequest {
        target_ref: text(&input, "targetRef", 512, true)?, adapter: text(&input, "adapter", 16, false)?,
        display_name: text(&input, "displayName", 256, input["adapter"] == "weixin")?, account_label: text(&input, "accountLabel", 256, true)?, config: Some(config(&input)?),
    })
}
pub(super) async fn get_connection_setup(channel: Channel, input: Value) -> Result<Value, LocalAppOperationError> {
    exact(&input, &["setupId"])?;
    let request = GetIntegrationConnectionSetupRequest { setup_id: text(&input, "setupId", 512, false)? };
    let response = crate::grpc_limits::runtime_integration_client(channel).get_integration_connection_setup(request).await.map_err(local_app_error_from_status)?.into_inner();
    Ok(json!({"setup":setup(response.setup.ok_or_else(untrusted)?)?}))
}
pub(super) async fn submit_connection_setup(channel: Channel, input: Value) -> Result<Value, LocalAppOperationError> {
    let request = submit_connection_setup_request(input)?;
    let response = crate::grpc_limits::runtime_integration_client(channel).submit_integration_connection_setup(request).await.map_err(local_app_error_from_status)?.into_inner();
    Ok(json!({"setup":setup(response.setup.ok_or_else(untrusted)?)?}))
}
// @nimi-authority: rule.nimi.runtime.integration.connection-setup
fn submit_connection_setup_request(input: Value) -> Result<SubmitIntegrationConnectionSetupRequest, LocalAppOperationError> {
    exact(&input, &["setupId", "secret", "verificationCode", "action"])?;
    let action = match text(&input, "action", 32, true)?.as_str() {
        "" => IntegrationConnectionSetupAction::Unspecified,
        "create-new-target" => IntegrationConnectionSetupAction::CreateNewTarget,
        _ => return Err(invalid_payload()),
    };
    let secret = text(&input, "secret", 16384, true)?;
    let verification_code = text(&input, "verificationCode", 256, true)?;
    if action == IntegrationConnectionSetupAction::CreateNewTarget && (!secret.is_empty() || !verification_code.is_empty()) {
        return Err(invalid_payload());
    }
    Ok(SubmitIntegrationConnectionSetupRequest { setup_id: text(&input, "setupId", 512, false)?, secret, verification_code, action: action as i32 })
}
pub(super) async fn cancel_connection_setup(channel: Channel, input: Value) -> Result<Value, LocalAppOperationError> {
    exact(&input, &["setupId"])?;
    let request = CancelIntegrationConnectionSetupRequest { setup_id: text(&input, "setupId", 512, false)? };
    let response = crate::grpc_limits::runtime_integration_client(channel).cancel_integration_connection_setup(request).await.map_err(local_app_error_from_status)?.into_inner();
    Ok(json!({"setup":setup(response.setup.ok_or_else(untrusted)?)?}))
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
    fn weixin_new_target_confirmation_has_closed_typed_action() {
        for (action, expected) in [("", IntegrationConnectionSetupAction::Unspecified), ("create-new-target", IntegrationConnectionSetupAction::CreateNewTarget)] {
            let request = submit_connection_setup_request(json!({"setupId":"iset_exact","secret":"","verificationCode":"","action":action})).expect("typed confirmation");
            assert_eq!(request.action, expected as i32);
        }
        for invalid in [json!({"setupId":"iset_exact","secret":"","verificationCode":"","action":"replace"}),json!({"setupId":"iset_exact","secret":"private","verificationCode":"","action":"create-new-target"}),json!({"setupId":"iset_exact","secret":"","verificationCode":"123456","action":"create-new-target"}),json!({"setupId":"iset_exact","secret":"","verificationCode":"","action":1}),json!({"setupId":"iset_exact","secret":"","verificationCode":"","action":"create-new-target","confirm":true})] {
            assert!(submit_connection_setup_request(invalid).is_err());
        }
        let pending = IntegrationConnectionSetup { setup_id:"iset_exact".into(),adapter:"weixin".into(),target_ref:"icon_original".into(),status:"awaiting-new-target".into(),account_label:"candidate@im.bot".into(),expires_at:Some(prost_types::Timestamp{seconds:1791288000,nanos:0}),..Default::default() };
        assert_eq!(setup(pending.clone()).unwrap()["status"],"awaiting-new-target");
        for changed in [IntegrationConnectionSetup{target_ref:String::new(),..pending.clone()},IntegrationConnectionSetup{adapter:"feishu".into(),..pending.clone()},IntegrationConnectionSetup{account_label:String::new(),..pending.clone()},IntegrationConnectionSetup{error_code:"FAILED".into(),..pending.clone()},IntegrationConnectionSetup{qr_code_url:"private".into(),..pending.clone()}] {
            assert!(setup(changed).is_err());
        }
    }
    #[test]
    fn weixin_already_bound_is_a_distinct_exact_target_projection() {
        let bound = IntegrationConnectionSetup {
            setup_id: "iset_exact".into(), adapter: "weixin".into(), target_ref: "icon_exact".into(),
            status: "already-bound".into(), account_label: "bot@im.bot".into(),
            expires_at: Some(prost_types::Timestamp { seconds: 1791288000, nanos: 0 }),
            ..Default::default()
        };
        let projected = setup(bound.clone()).expect("bound result");
        assert_eq!(projected["status"], "already-bound");
        assert_eq!(projected["targetRef"], "icon_exact");
        for changed in [IntegrationConnectionSetup { target_ref: String::new(), ..bound.clone() }, IntegrationConnectionSetup { adapter: "feishu".into(), ..bound.clone() }, IntegrationConnectionSetup { verification_url: "https://liteapp.weixin.qq.com/private".into(), ..bound.clone() }] {
            assert!(setup(changed).is_err());
        }
    }
    #[test]
    fn weixin_nameless_input_builds_real_typed_setup_and_put_requests() {
        let input=json!({"targetRef":"","adapter":"weixin","accountLabel":"","config":{"weixin":{}}});
        for name in [None,Some("")] {
            let mut setup=input.clone();
            if let Some(name)=name { setup["displayName"]=json!(name); }
            let request=start_connection_setup_request(setup.clone()).expect("Weixin setup");
            assert_eq!(request.display_name,"");
            assert!(request.config.unwrap().weixin.is_some());
            setup["secret"]=json!("");
            let request=put_connection_request(setup).expect("Weixin put input");
            assert_eq!(request.display_name,"");
            assert!(request.config.unwrap().weixin.is_some());
        }
        for name in [json!(null),json!(12),json!("x".repeat(257)),json!("invalid\0name")] {
            let mut invalid=input.clone();invalid["displayName"]=name;
            assert!(start_connection_setup_request(invalid).is_err());
        }
        let mut extra=input;extra["nickname"]=json!("unverified");
        assert!(start_connection_setup_request(extra).is_err());
    }
    #[test]
    fn other_adapter_names_remain_required_in_setup_and_put_requests() {
        for (adapter,config) in [("mcp",json!({"mcp":{"endpoint":"https://example.com/mcp"}})),("telegram",json!({"telegram":{}})),("feishu",json!({"feishu":{"setupMode":"create"}})),("qq-official",json!({"qqOfficial":{"appId":"actual"}})),("onebot-v11",json!({"onebotV11":{"listener":"127.0.0.1:46373","selfId":"123"}}))] {
            for name in [None,Some("")] {
                let mut input=json!({"targetRef":"","adapter":adapter,"accountLabel":"","config":config});
                if let Some(name)=name {input["displayName"]=json!(name)}
                assert!(start_connection_setup_request(input.clone()).is_err());
                input["secret"]=json!("");assert!(put_connection_request(input).is_err());
            }
        }
    }
    #[test]
    fn feishu_manual_and_qr_creation_keep_distinct_closed_configuration() {
        let manual=config(&json!({"adapter":"feishu","config":{"feishu":{"setupMode":"manual","appId":"cli_actual"}}})).expect("manual");
        assert_eq!(manual.feishu.unwrap().app_id,"cli_actual");
        let create=config(&json!({"adapter":"feishu","config":{"feishu":{"setupMode":"create"}}})).expect("QR creation");
        assert_eq!(create.feishu.unwrap().app_id,"");
        for detail in [json!({"setupMode":"create","appId":"existing"}),json!({"setupMode":"manual"}),json!({"setupMode":"create","secret":"private"})] {
            assert!(config(&json!({"adapter":"feishu","config":{"feishu":detail}})).is_err());
        }
    }
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
