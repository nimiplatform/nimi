use serde::Deserialize;
use serde_json::{json, Value};
use tonic::transport::Channel;
use crate::{LocalAppConversationToolScopeRequest, LocalAppConversationToolResultRequest, LocalAppOperationError};
use crate::generated::{LocalAppConversationWork, LocalAppConversationWorkSource, LocalAppConversationWorkTool, ListLocalAppConversationToolCallsRequest, SubmitLocalAppConversationToolResultRequest};
use super::{invalid_payload, untrusted};

#[derive(Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
struct Work { routine_name: Option<String>, work_id: String, instructions: String, sources: Vec<Source>, tools: Vec<Tool> }
#[derive(Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
struct Source { source_id: String, title: String, content: String }
#[derive(Deserialize)]
#[serde(rename_all="camelCase", deny_unknown_fields)]
struct Tool { name: String, description: String, input_schema_json: String }

fn text(value: &str, max: usize) -> Result<(), LocalAppOperationError> {
    if value.trim().is_empty() || value.len()>max || value.contains('\0') { return Err(invalid_payload()); } Ok(())
}
pub(super) fn parse_work(value: Option<Value>) -> Result<Option<LocalAppConversationWork>, LocalAppOperationError> {
    let Some(value)=value else { return Ok(None) };
    if value.to_string().len()>65536 { return Err(invalid_payload()); }
    let input: Work=serde_json::from_value(value).map_err(|_|invalid_payload())?;
    text(&input.work_id,256)?;
    if input.instructions.len()>8192 || input.instructions.contains('\0') || input.sources.len()>16 || input.tools.len()>16 { return Err(invalid_payload()); }
    let mut sources=Vec::new();for source in input.sources { text(&source.source_id,256)?;text(&source.title,256)?;text(&source.content,16384)?;sources.push(LocalAppConversationWorkSource{source_id:source.source_id,title:source.title,content:source.content}); }
    let mut tools=Vec::new();for tool in input.tools { text(&tool.name,64)?;text(&tool.description,2048)?;text(&tool.input_schema_json,8192)?;let schema:Value=serde_json::from_str(&tool.input_schema_json).map_err(|_|invalid_payload())?;if schema.get("type").and_then(Value::as_str)!=Some("object"){return Err(invalid_payload())};tools.push(LocalAppConversationWorkTool{name:tool.name,description:tool.description,input_schema_json:tool.input_schema_json}); }
    Ok(Some(LocalAppConversationWork{routine_name:input.routine_name,work_id:input.work_id,instructions:input.instructions,sources,tools}))
}
fn scope(input:&LocalAppConversationToolScopeRequest)->Result<(),LocalAppOperationError>{
    if !input.agent_handle.starts_with("agent_ref_") || input.agent_handle.len()!=53 { return Err(invalid_payload()); }
    text(&input.conversation_anchor_id,256)?;text(&input.turn_id,256)
}
pub(super) async fn list_calls(channel:Channel,input:LocalAppConversationToolScopeRequest)->Result<Value,LocalAppOperationError>{
    scope(&input)?;
    let response=crate::grpc_limits::runtime_agent_client(channel).list_local_app_conversation_tool_calls(ListLocalAppConversationToolCallsRequest{agent_handle:input.agent_handle,conversation_anchor_id:input.conversation_anchor_id,turn_id:input.turn_id.clone()}).await.map_err(crate::grpc_status::local_app_error_from_status)?.into_inner();
    if response.calls.len()>16{return Err(untrusted());}
    let mut calls=Vec::new();for call in response.calls{
        if call.turn_id!=input.turn_id || call.call_id.is_empty() || call.call_id.len()>256 || call.name.is_empty() || call.name.len()>64 || call.arguments_json.len()>32768 {return Err(untrusted())}
        let value:Value=serde_json::from_str(&call.arguments_json).map_err(|_|untrusted())?;if !value.is_object(){return Err(untrusted())}
        calls.push(json!({"callId":call.call_id,"turnId":call.turn_id,"name":call.name,"argumentsJson":call.arguments_json}));
    }
    Ok(json!({"calls":calls}))
}
pub(super) async fn submit_result(channel:Channel,input:LocalAppConversationToolResultRequest)->Result<Value,LocalAppOperationError>{
    scope(&input.scope)?;text(&input.call_id,256)?;text(&input.result_json,32768)?;
    let _:Value=serde_json::from_str(&input.result_json).map_err(|_|invalid_payload())?;
    let response=crate::grpc_limits::runtime_agent_client(channel).submit_local_app_conversation_tool_result(SubmitLocalAppConversationToolResultRequest{agent_handle:input.scope.agent_handle,conversation_anchor_id:input.scope.conversation_anchor_id,turn_id:input.scope.turn_id,call_id:input.call_id.clone(),result_json:input.result_json,is_error:input.is_error}).await.map_err(crate::grpc_status::local_app_error_from_status)?.into_inner();
    if response.call_id!=input.call_id{return Err(untrusted())}Ok(json!({"callId":response.call_id}))
}
