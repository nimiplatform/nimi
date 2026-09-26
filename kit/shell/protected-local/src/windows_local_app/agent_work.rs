use super::{invalid_payload, untrusted};
use crate::generated::*;
use crate::grpc_status::local_app_error_from_status;
use crate::{LocalAppOperationError, LocalAppRealtimeSubscriptionReceiver};
use serde::Deserialize;
use serde_json::{json, Value};
use tonic::transport::Channel;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Scope {
    agent_handle: String,
    execution_id: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Agent {
    agent_handle: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Start {
    agent_handle: String,
    request_id: String,
    prompt: String,
    work: Work,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Work {
    work_id: String,
    instructions: String,
    sources: Vec<Source>,
    tools: Vec<Tool>,
    routine_name: Option<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Source {
    source_id: String,
    title: String,
    content: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Tool {
    name: String,
    description: String,
    input_schema_json: String,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ResultInput {
    agent_handle: String,
    execution_id: String,
    call_id: String,
    result_json: String,
    is_error: bool,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Subscribe {
    agent_handle: String,
    execution_id: String,
    after_sequence: Option<String>,
}
fn parse<T: serde::de::DeserializeOwned>(value: Value) -> Result<T, LocalAppOperationError> {
    if value.to_string().len() > 128 * 1024 {
        return Err(invalid_payload());
    }
    serde_json::from_value(value).map_err(|_| invalid_payload())
}
fn text(value: &str, max: usize, empty: bool) -> Result<(), LocalAppOperationError> {
    if (!empty && value.trim().is_empty()) || value.len() > max || value.contains('\0') {
        Err(invalid_payload())
    } else {
        Ok(())
    }
}
fn agent(value: &str) -> Result<(), LocalAppOperationError> {
    if !value.starts_with("agent_ref_") || value.len() != 53 {
        Err(invalid_payload())
    } else {
        Ok(())
    }
}
fn scope(value: &Scope) -> Result<(), LocalAppOperationError> {
    agent(&value.agent_handle)?;
    text(&value.execution_id, 256, false)
}
fn project(value: LocalAppAgentWorkExecution) -> Result<Value, LocalAppOperationError> {
    let state = match LocalAppAgentWorkState::try_from(value.state) {
        Ok(LocalAppAgentWorkState::Running) => "running",
        Ok(LocalAppAgentWorkState::WaitingTool) => "waiting_tool",
        Ok(LocalAppAgentWorkState::Succeeded) => "succeeded",
        Ok(LocalAppAgentWorkState::Failed) => "failed",
        Ok(LocalAppAgentWorkState::Cancelled) => "cancelled",
        _ => return Err(untrusted()),
    };
    if value.execution_id.is_empty()
        || value.execution_id.len() > 256
        || value.output_text.len() > 1024 * 1024
        || (state != "succeeded" && !value.output_text.is_empty())
    {
        return Err(untrusted());
    }
    let reason = if value.reason_code == 0 {
        String::new()
    } else {
        ReasonCode::try_from(value.reason_code)
            .map_err(|_| untrusted())?
            .as_str_name()
            .to_string()
    };
    Ok(
        json!({"executionId":value.execution_id,"workId":value.work_id,"state":state,"outputText":value.output_text,"reasonCode":reason,"message":value.message,"sequence":value.sequence.to_string()}),
    )
}
fn project_call(value: LocalAppAgentWorkToolCall) -> Result<Value, LocalAppOperationError> {
    if value.call_id.is_empty()
        || value.execution_id.is_empty()
        || value.name.len() > 64
        || value.arguments_json.len() > 32768
    {
        return Err(untrusted());
    }
    let args: Value = serde_json::from_str(&value.arguments_json).map_err(|_| untrusted())?;
    if !args.is_object() {
        return Err(untrusted());
    }
    Ok(
        json!({"callId":value.call_id,"executionId":value.execution_id,"name":value.name,"argumentsJson":value.arguments_json}),
    )
}
pub(super) async fn references(
    channel: Channel,
    input: Value,
) -> Result<Value, LocalAppOperationError> {
    if input.as_object().is_none_or(|v| !v.is_empty()) {
        return Err(invalid_payload());
    }
    let value = crate::grpc_limits::runtime_agent_client(channel)
        .list_local_app_agent_work_references(ListLocalAppAgentWorkReferencesRequest {})
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    Ok(
        json!({"references":value.references.into_iter().map(|v|json!({"agentHandle":v.agent_handle,"agentBinding":v.agent_binding,"activityAgentRef":v.activity_agent_ref,"displayName":v.display_name,"avatarUrl":v.avatar_url})).collect::<Vec<_>>()}),
    )
}
pub(super) async fn start(channel: Channel, input: Value) -> Result<Value, LocalAppOperationError> {
    let input: Start = parse(input)?;
    agent(&input.agent_handle)?;
    text(&input.request_id, 256, false)?;
    text(&input.prompt, 32768, false)?;
    let w = input.work;
    text(&w.work_id, 256, false)?;
    text(&w.instructions, 8192, true)?;
    if w.sources.len() > 16 || w.tools.len() > 16 {
        return Err(invalid_payload());
    }
    let sources = w
        .sources
        .into_iter()
        .map(|v| {
            text(&v.source_id, 256, false)?;
            text(&v.title, 256, false)?;
            text(&v.content, 16384, false)?;
            Ok(LocalAppAgentWorkSource {
                source_id: v.source_id,
                title: v.title,
                content: v.content,
            })
        })
        .collect::<Result<Vec<_>, LocalAppOperationError>>()?;
    let tools = w
        .tools
        .into_iter()
        .map(|v| {
            text(&v.name, 64, false)?;
            text(&v.description, 2048, true)?;
            text(&v.input_schema_json, 8192, false)?;
            let schema: Value =
                serde_json::from_str(&v.input_schema_json).map_err(|_| invalid_payload())?;
            if schema.get("type").and_then(Value::as_str) != Some("object") {
                return Err(invalid_payload());
            }
            Ok(LocalAppAgentWorkTool {
                name: v.name,
                description: v.description,
                input_schema_json: v.input_schema_json,
            })
        })
        .collect::<Result<Vec<_>, LocalAppOperationError>>()?;
    let value = crate::grpc_limits::runtime_agent_client(channel)
        .start_local_app_agent_work(StartLocalAppAgentWorkRequest {
            agent_handle: input.agent_handle,
            request_id: input.request_id,
            prompt: input.prompt,
            work: Some(LocalAppAgentWorkInput {
                work_id: w.work_id,
                instructions: w.instructions,
                sources,
                tools,
                routine_name: w.routine_name,
            }),
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    Ok(json!({"executionId":value.execution_id}))
}
pub(super) async fn get(channel: Channel, input: Value) -> Result<Value, LocalAppOperationError> {
    let input: Scope = parse(input)?;
    scope(&input)?;
    let value = crate::grpc_limits::runtime_agent_client(channel)
        .get_local_app_agent_work(GetLocalAppAgentWorkRequest {
            agent_handle: input.agent_handle,
            execution_id: input.execution_id,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    Ok(json!({"execution":project(value.execution.ok_or_else(untrusted)?)?}))
}
pub(super) async fn status(
    channel: Channel,
    input: Value,
) -> Result<Value, LocalAppOperationError> {
    let input: Agent = parse(input)?;
    agent(&input.agent_handle)?;
    let value = crate::grpc_limits::runtime_agent_client(channel)
        .get_local_app_agent_work_status(GetLocalAppAgentWorkStatusRequest {
            agent_handle: input.agent_handle,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    Ok(json!({"busy":value.busy,"ownExecutionId":value.own_execution_id}))
}
pub(super) async fn list_calls(
    channel: Channel,
    input: Value,
) -> Result<Value, LocalAppOperationError> {
    let input: Scope = parse(input)?;
    scope(&input)?;
    let value = crate::grpc_limits::runtime_agent_client(channel)
        .list_local_app_agent_work_tool_calls(ListLocalAppAgentWorkToolCallsRequest {
            agent_handle: input.agent_handle,
            execution_id: input.execution_id,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    if value.calls.len() > 16 {
        return Err(untrusted());
    }
    Ok(json!({"calls":value.calls.into_iter().map(project_call).collect::<Result<Vec<_>,_>>()?}))
}
pub(super) async fn submit_result(
    channel: Channel,
    input: Value,
) -> Result<Value, LocalAppOperationError> {
    let input: ResultInput = parse(input)?;
    agent(&input.agent_handle)?;
    text(&input.execution_id, 256, false)?;
    text(&input.call_id, 256, false)?;
    text(&input.result_json, 32768, false)?;
    let _: Value = serde_json::from_str(&input.result_json).map_err(|_| invalid_payload())?;
    let value = crate::grpc_limits::runtime_agent_client(channel)
        .submit_local_app_agent_work_tool_result(SubmitLocalAppAgentWorkToolResultRequest {
            agent_handle: input.agent_handle,
            execution_id: input.execution_id,
            call_id: input.call_id.clone(),
            result_json: input.result_json,
            is_error: input.is_error,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    if value.call_id != input.call_id {
        return Err(untrusted());
    }
    Ok(json!({"callId":value.call_id}))
}
pub(super) async fn cancel(
    channel: Channel,
    input: Value,
) -> Result<Value, LocalAppOperationError> {
    let input: Scope = parse(input)?;
    scope(&input)?;
    let value = crate::grpc_limits::runtime_agent_client(channel)
        .cancel_local_app_agent_work(CancelLocalAppAgentWorkRequest {
            agent_handle: input.agent_handle,
            execution_id: input.execution_id,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    Ok(json!({"execution":project(value.execution.ok_or_else(untrusted)?)?}))
}
pub(super) async fn subscribe(
    channel: Channel,
    input: Value,
) -> Result<LocalAppRealtimeSubscriptionReceiver, LocalAppOperationError> {
    let input: Subscribe = parse(input)?;
    agent(&input.agent_handle)?;
    text(&input.execution_id, 256, false)?;
    let after_sequence = input
        .after_sequence
        .unwrap_or_else(|| "0".into())
        .parse::<u64>()
        .map_err(|_| invalid_payload())?;
    let mut stream = crate::grpc_limits::runtime_agent_client(channel)
        .subscribe_local_app_agent_work_events(SubscribeLocalAppAgentWorkEventsRequest {
            agent_handle: input.agent_handle,
            execution_id: input.execution_id,
            after_sequence,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    let (sender, receiver) = tokio::sync::mpsc::channel(32);
    tokio::spawn(async move {
        loop {
            tokio::select! {_ = sender.closed()=>break,message=stream.message()=>match message{Ok(Some(value))=>{let projected=project_event(value);if sender.send(projected).await.is_err(){break}},Ok(None)=>break,Err(status)=>{let _=sender.send(Err(local_app_error_from_status(status))).await;break}}}
        }
    });
    Ok(receiver)
}
fn project_event(value: LocalAppAgentWorkEvent) -> Result<Value, LocalAppOperationError> {
    let mut base = json!({"executionId":value.execution_id,"sequence":value.sequence.to_string()});
    match value.event.ok_or_else(untrusted)? {
        local_app_agent_work_event::Event::Snapshot(v) => {
            base["type"] = json!("snapshot");
            base["execution"] = project(v)?
        }
        local_app_agent_work_event::Event::TextDelta(v) => {
            if v.len() > 32768 {
                return Err(untrusted());
            }
            base["type"] = json!("text-delta");
            base["delta"] = json!(v)
        }
        local_app_agent_work_event::Event::ToolCall(v) => {
            base["type"] = json!("tool-call");
            base["call"] = project_call(v)?
        }
    }
    Ok(base)
}
