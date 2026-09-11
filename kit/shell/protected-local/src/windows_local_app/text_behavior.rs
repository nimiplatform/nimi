use std::collections::BTreeMap;

use prost_types::{value::Kind, ListValue, Struct, Value as ProtoValue};
use serde::Deserialize;
use serde_json::{json, Value};

use crate::generated::{
    text_output_item, text_turn_item, LocalAppTextCandidateMessage, LocalAppTextGenerateOutput,
    ResponseFormat, ResponseFormatKind, StreamLocalAppTextTurnRequest, TextOutputItem,
    TextOutputText, TextTurnItem, ToolCall, ToolChoiceMode, ToolResult, ToolSpec, ToolSpecKind,
};
use crate::{LocalAppOperationError, LocalAppTextTurnRequest};

use super::{invalid_payload, untrusted};

const MAX_REQUEST_BYTES: usize = 1024 * 1024;
const MAX_OUTPUT_BYTES: usize = 256 * 1024;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FunctionTool {
    #[serde(rename = "type")]
    kind: Option<String>,
    name: String,
    #[serde(default)]
    description: String,
    input_schema: Value,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct FunctionCall {
    id: String,
    name: String,
    arguments: Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FunctionResult {
    tool_call_id: String,
    tool_name: String,
    result: Value,
    #[serde(default)]
    is_error: bool,
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case", deny_unknown_fields)]
enum OutputItem {
    Text {
        text: String,
    },
    ToolCall {
        #[serde(rename = "toolCall")]
        tool_call: FunctionCall,
    },
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case", deny_unknown_fields)]
enum TurnItem {
    Output {
        output: OutputItem,
    },
    ToolResult {
        #[serde(rename = "toolResult")]
        tool_result: FunctionResult,
    },
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct NamedChoice {
    #[serde(rename = "type")]
    kind: String,
    name: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct StructuredFormat {
    #[serde(rename = "type")]
    kind: String,
    schema: Option<Value>,
    #[serde(default)]
    name: String,
    #[serde(default)]
    description: String,
    #[serde(default)]
    strict: bool,
}

// @nimi-authority: rule.nimi.runtime.ai-provider.local-app-text-behaviors
pub(super) fn request(
    input: LocalAppTextTurnRequest,
) -> Result<StreamLocalAppTextTurnRequest, LocalAppOperationError> {
    if serde_json::to_vec(&input)
        .map_err(|_| invalid_payload())?
        .len()
        > MAX_REQUEST_BYTES
        || input.messages.is_empty()
        || input.messages.len() > 128
        || input.tools.len() > 64
        || input
            .temperature
            .is_some_and(|v| !v.is_finite() || !(0.0..=2.0).contains(&v))
        || input
            .top_p
            .is_some_and(|v| !v.is_finite() || !(0.0..=1.0).contains(&v))
        || input.max_tokens.is_some_and(|v| v < 0)
        || input.top_k.is_some_and(|v| v < 0)
        || input
            .presence_penalty
            .is_some_and(|v| !v.is_finite() || !(-2.0..=2.0).contains(&v))
        || input
            .frequency_penalty
            .is_some_and(|v| !v.is_finite() || !(-2.0..=2.0).contains(&v))
        || input.stop.iter().any(|v| v.trim().is_empty())
    {
        return Err(invalid_payload());
    }
    let mut saw_user = false;
    let messages = input
        .messages
        .into_iter()
        .enumerate()
        .map(|(index, message)| {
            match message.role.as_str() {
                "system" if index == 0 && message.turn_items.is_empty() => {}
                "user" if message.turn_items.is_empty() => saw_user = true,
                "assistant" => {}
                _ => return Err(invalid_payload()),
            }
            if (message.turn_items.is_empty() && message.text.trim().is_empty())
                || (!message.turn_items.is_empty() && !message.text.is_empty())
            {
                return Err(invalid_payload());
            }
            Ok(LocalAppTextCandidateMessage {
                role: message.role,
                text: message.text,
                turn_items: message
                    .turn_items
                    .into_iter()
                    .map(parse_turn_item)
                    .collect::<Result<_, _>>()?,
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    if !saw_user {
        return Err(invalid_payload());
    }
    let tools = input
        .tools
        .into_iter()
        .map(|value| {
            let tool: FunctionTool =
                serde_json::from_value(value).map_err(|_| invalid_payload())?;
            identifier(&tool.name)?;
            if tool.kind.as_deref().is_some_and(|kind| kind != "function") {
                return Err(invalid_payload());
            }
            Ok(ToolSpec {
                name: tool.name,
                description: tool.description,
                input_schema: Some(proto_struct(tool.input_schema)?),
                kind: ToolSpecKind::Function as i32,
                provider_tool_id: String::new(),
                provider_args: None,
                provider_metadata: None,
            })
        })
        .collect::<Result<Vec<_>, _>>()?;
    let (tool_choice, tool_choice_name) = match input.tool_choice {
        None => (ToolChoiceMode::Unspecified, String::new()),
        Some(Value::String(value)) => (
            match value.as_str() {
                "auto" => ToolChoiceMode::Auto,
                "none" => ToolChoiceMode::None,
                "required" => ToolChoiceMode::Required,
                _ => return Err(invalid_payload()),
            },
            String::new(),
        ),
        Some(value) => {
            let choice: NamedChoice =
                serde_json::from_value(value).map_err(|_| invalid_payload())?;
            if choice.kind != "tool" {
                return Err(invalid_payload());
            }
            identifier(&choice.name)?;
            (ToolChoiceMode::Tool, choice.name)
        }
    };
    let response_format = input
        .response_format
        .map(|value| {
            let format: StructuredFormat =
                serde_json::from_value(value).map_err(|_| invalid_payload())?;
            let kind = match format.kind.as_str() {
                "text" => ResponseFormatKind::Text,
                "json-object" => ResponseFormatKind::JsonObject,
                "json-schema" => ResponseFormatKind::JsonSchema,
                _ => return Err(invalid_payload()),
            };
            if (kind == ResponseFormatKind::JsonSchema && format.schema.is_none())
                || (kind != ResponseFormatKind::JsonSchema
                    && (format.schema.is_some() || format.strict))
            {
                return Err(invalid_payload());
            }
            Ok(ResponseFormat {
                kind: kind as i32,
                json_schema: format.schema.map(proto_struct).transpose()?,
                schema_name: format.name,
                schema_description: format.description,
                strict: format.strict,
            })
        })
        .transpose()?;
    Ok(StreamLocalAppTextTurnRequest {
        messages,
        tools,
        tool_choice: tool_choice as i32,
        tool_choice_name,
        response_format,
        temperature: input.temperature,
        top_p: input.top_p,
        max_tokens: input.max_tokens,
        top_k: input.top_k,
        presence_penalty: input.presence_penalty,
        frequency_penalty: input.frequency_penalty,
        stop: input.stop,
        seed: input.seed,
    })
}

fn parse_turn_item(value: Value) -> Result<TextTurnItem, LocalAppOperationError> {
    let item: TurnItem = serde_json::from_value(value).map_err(|_| invalid_payload())?;
    let item = match item {
        TurnItem::Output { output } => text_turn_item::Item::Output(TextOutputItem {
            item: Some(match output {
                OutputItem::Text { text } => {
                    if text.is_empty() {
                        return Err(invalid_payload());
                    }
                    text_output_item::Item::Text(TextOutputText { text })
                }
                OutputItem::ToolCall { tool_call } => {
                    identifier(&tool_call.id)?;
                    identifier(&tool_call.name)?;
                    if !tool_call.arguments.is_object() {
                        return Err(invalid_payload());
                    }
                    text_output_item::Item::ToolCall(ToolCall {
                        id: tool_call.id,
                        name: tool_call.name,
                        arguments_json: serde_json::to_string(&tool_call.arguments)
                            .map_err(|_| invalid_payload())?,
                        dynamic: false,
                        provider_metadata: None,
                    })
                }
            }),
        }),
        TurnItem::ToolResult { tool_result } => {
            identifier(&tool_result.tool_call_id)?;
            identifier(&tool_result.tool_name)?;
            text_turn_item::Item::ToolResult(ToolResult {
                tool_call_id: tool_result.tool_call_id,
                tool_name: tool_result.tool_name,
                result: Some(proto_value(tool_result.result)?),
                is_error: tool_result.is_error,
                preliminary: false,
                dynamic: false,
                provider_metadata: None,
            })
        }
    };
    Ok(TextTurnItem { item: Some(item) })
}

fn identifier(value: &str) -> Result<(), LocalAppOperationError> {
    if value.is_empty()
        || value.len() > 128
        || value.trim() != value
        || value.chars().any(char::is_control)
    {
        return Err(invalid_payload());
    }
    Ok(())
}

fn proto_struct(value: Value) -> Result<Struct, LocalAppOperationError> {
    let Value::Object(object) = value else {
        return Err(invalid_payload());
    };
    let fields = object
        .into_iter()
        .map(|(key, value)| Ok((key, proto_value(value)?)))
        .collect::<Result<BTreeMap<_, _>, _>>()?;
    Ok(Struct { fields })
}

fn proto_value(value: Value) -> Result<ProtoValue, LocalAppOperationError> {
    let kind = match value {
        Value::Null => Kind::NullValue(0),
        Value::Bool(value) => Kind::BoolValue(value),
        Value::Number(value) => Kind::NumberValue(
            value
                .as_f64()
                .filter(|v| v.is_finite())
                .ok_or_else(invalid_payload)?,
        ),
        Value::String(value) => Kind::StringValue(value),
        Value::Array(values) => Kind::ListValue(ListValue {
            values: values
                .into_iter()
                .map(proto_value)
                .collect::<Result<_, _>>()?,
        }),
        value @ Value::Object(_) => Kind::StructValue(proto_struct(value)?),
    };
    Ok(ProtoValue { kind: Some(kind) })
}

pub(super) fn project_tool_call(call: ToolCall) -> Result<Value, LocalAppOperationError> {
    identifier(&call.id).map_err(|_| untrusted())?;
    identifier(&call.name).map_err(|_| untrusted())?;
    if call.dynamic || call.provider_metadata.is_some() {
        return Err(untrusted());
    }
    let arguments: Value = serde_json::from_str(&call.arguments_json).map_err(|_| untrusted())?;
    if !arguments.is_object() {
        return Err(untrusted());
    }
    Ok(json!({"id": call.id, "name": call.name, "arguments": arguments}))
}

pub(super) fn finish_reason(reason: i32) -> Result<&'static str, LocalAppOperationError> {
    match reason {
        1 => Ok("stop"),
        2 => Ok("length"),
        3 => Ok("tool-calls"),
        4 => Ok("content-filter"),
        _ => Err(untrusted()),
    }
}

pub(super) fn project_output(
    output: LocalAppTextGenerateOutput,
) -> Result<Value, LocalAppOperationError> {
    let finish = finish_reason(output.finish_reason)?;
    let mut has_call = false;
    let items = output
        .items
        .into_iter()
        .map(|item| match item.item {
            Some(text_output_item::Item::Text(value)) if !value.text.is_empty() => {
                Ok(json!({"type": "text", "text": value.text}))
            }
            Some(text_output_item::Item::ToolCall(call)) => {
                has_call = true;
                Ok(json!({"type": "tool-call", "toolCall": project_tool_call(call)?}))
            }
            _ => Err(untrusted()),
        })
        .collect::<Result<Vec<_>, _>>()?;
    if items.is_empty()
        || (finish == "tool-calls" && !has_call)
        || serde_json::to_vec(&items).map_err(|_| untrusted())?.len() > MAX_OUTPUT_BYTES
    {
        return Err(untrusted());
    }
    Ok(json!({"type": "text-generate", "items": items, "finishReason": finish}))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn function_transcript_and_response_schema_cross_the_typed_boundary() {
        let input: LocalAppTextTurnRequest = serde_json::from_value(json!({
            "messages": [
                {"role": "user", "text": "search"},
                {"role": "assistant", "turnItems": [
                    {"type": "output", "output": {"type": "tool-call", "toolCall": {"id": "c1", "name": "search", "arguments": {"q": "Nimi"}}}},
                    {"type": "tool-result", "toolResult": {"toolCallId": "c1", "toolName": "search", "result": {"items": []}, "isError": false}}
                ]}
            ],
            "tools": [{"name": "search", "inputSchema": {"type": "object"}}],
            "toolChoice": "none",
            "responseFormat": {"type": "json-schema", "schema": {"type": "object"}, "strict": true}
        })).unwrap();
        let out = request(input).unwrap();
        assert_eq!(out.messages[1].turn_items.len(), 2);
        assert_eq!(out.tools[0].kind, ToolSpecKind::Function as i32);
        assert_eq!(out.tool_choice, ToolChoiceMode::None as i32);
        assert!(out.response_format.unwrap().strict);
    }

    #[test]
    fn authority_and_provider_fields_are_not_accepted() {
        assert!(serde_json::from_value::<LocalAppTextTurnRequest>(
            json!({"messages": [{"role": "user", "text": "hi"}], "provider": "bypass"})
        )
        .is_err());
        let input = serde_json::from_value(json!({"messages": [{"role": "user", "text": "hi"}], "tools": [{"name": "x", "inputSchema": {}, "providerMetadata": {}}]})).unwrap();
        assert!(request(input).is_err());
    }
}
