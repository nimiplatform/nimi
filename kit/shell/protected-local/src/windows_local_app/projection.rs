use prost_types::{value::Kind as ProtoValueKind, Struct as ProtoStruct, Value as ProtoValue};
use serde_json::{json, Map as JsonMap, Number as JsonNumber, Value as JsonValue};

use crate::LocalAppOperationError;

use super::{invalid_payload, untrusted};

const MAX_JSON_DEPTH: usize = 32;
const MAX_JSON_NODES: usize = 100_000;

pub(super) fn proto_struct(value: JsonValue) -> Result<ProtoStruct, LocalAppOperationError> {
    let JsonValue::Object(fields) = value else {
        return Err(invalid_payload());
    };
    Ok(ProtoStruct {
        fields: fields
            .into_iter()
            .map(|(key, value)| json_to_proto_value(value).map(|value| (key, value)))
            .collect::<Result<_, _>>()?,
    })
}

fn json_to_proto_value(value: JsonValue) -> Result<ProtoValue, LocalAppOperationError> {
    let kind = match value {
        JsonValue::Null => ProtoValueKind::NullValue(0),
        JsonValue::Bool(value) => ProtoValueKind::BoolValue(value),
        JsonValue::Number(value) => {
            ProtoValueKind::NumberValue(value.as_f64().ok_or_else(invalid_payload)?)
        }
        JsonValue::String(value) => ProtoValueKind::StringValue(value),
        JsonValue::Array(values) => ProtoValueKind::ListValue(prost_types::ListValue {
            values: values
                .into_iter()
                .map(json_to_proto_value)
                .collect::<Result<_, _>>()?,
        }),
        JsonValue::Object(fields) => ProtoValueKind::StructValue(ProtoStruct {
            fields: fields
                .into_iter()
                .map(|(key, value)| json_to_proto_value(value).map(|value| (key, value)))
                .collect::<Result<_, _>>()?,
        }),
    };
    Ok(ProtoValue { kind: Some(kind) })
}

pub(super) fn proto_struct_to_json(
    value: ProtoStruct,
) -> Result<JsonValue, LocalAppOperationError> {
    let mut nodes = 0usize;
    proto_struct_to_json_bounded(value, 0, &mut nodes)
}

fn proto_struct_to_json_bounded(
    value: ProtoStruct,
    depth: usize,
    nodes: &mut usize,
) -> Result<JsonValue, LocalAppOperationError> {
    if depth > MAX_JSON_DEPTH {
        return Err(untrusted());
    }
    let fields = value
        .fields
        .into_iter()
        .map(|(key, value)| {
            proto_value_to_json_bounded(value, depth + 1, nodes).map(|value| (key, value))
        })
        .collect::<Result<JsonMap<_, _>, _>>()?;
    Ok(JsonValue::Object(fields))
}

fn proto_value_to_json_bounded(
    value: ProtoValue,
    depth: usize,
    nodes: &mut usize,
) -> Result<JsonValue, LocalAppOperationError> {
    *nodes = nodes.checked_add(1).ok_or_else(untrusted)?;
    if *nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH {
        return Err(untrusted());
    }
    match value.kind.ok_or_else(untrusted)? {
        ProtoValueKind::NullValue(_) => Ok(JsonValue::Null),
        ProtoValueKind::NumberValue(value) => JsonNumber::from_f64(value)
            .map(JsonValue::Number)
            .ok_or_else(untrusted),
        ProtoValueKind::StringValue(value) => Ok(JsonValue::String(value)),
        ProtoValueKind::BoolValue(value) => Ok(JsonValue::Bool(value)),
        ProtoValueKind::StructValue(value) => proto_struct_to_json_bounded(value, depth, nodes),
        ProtoValueKind::ListValue(value) => Ok(JsonValue::Array(
            value
                .values
                .into_iter()
                .map(|value| proto_value_to_json_bounded(value, depth + 1, nodes))
                .collect::<Result<_, _>>()?,
        )),
    }
}

pub(super) fn proto_struct_text<'a>(value: &'a ProtoStruct, key: &str) -> Option<&'a str> {
    match value.fields.get(key)?.kind.as_ref()? {
        ProtoValueKind::StringValue(value) if !value.is_empty() => Some(value),
        _ => None,
    }
}

pub(super) fn timestamp_projection(value: Option<prost_types::Timestamp>) -> JsonValue {
    value.map_or(
        JsonValue::Null,
        |value| json!({"seconds": value.seconds.to_string(), "nanos": value.nanos}),
    )
}

pub(super) fn validate_safe_projection(value: &JsonValue) -> Result<(), LocalAppOperationError> {
    match value {
        JsonValue::Array(values) => {
            for value in values {
                validate_safe_projection(value)?;
            }
        }
        JsonValue::Object(fields) => {
            for (key, value) in fields {
                let normalized = key
                    .chars()
                    .filter(|character| character.is_ascii_alphanumeric())
                    .flat_map(char::to_lowercase)
                    .collect::<String>();
                if matches!(
                    normalized.as_str(),
                    "endpoint"
                        | "authorization"
                        | "token"
                        | "localappprincipalid"
                        | "localapprecordid"
                        | "trustclass"
                        | "provenancerevision"
                        | "launchlease"
                        | "bootstrap"
                        | "processid"
                        | "sessionid"
                        | "sessionproof"
                        | "accountid"
                        | "grantid"
                        | "runtimebootepoch"
                ) {
                    return Err(untrusted());
                }
                validate_safe_projection(value)?;
            }
        }
        _ => {}
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::LocalAppReasonCode;

    #[test]
    fn projection_rejects_authority_keys_at_any_depth() {
        for value in [
            json!({"sessionId": "forbidden"}),
            json!({"nested": [{"grant_id": "forbidden"}]}),
            json!({"nested": {"runtime_boot_epoch": "forbidden"}}),
        ] {
            assert_eq!(
                validate_safe_projection(&value).unwrap_err().reason_code(),
                LocalAppReasonCode::RuntimeServiceUntrusted,
            );
        }
        assert!(validate_safe_projection(&json!({"conversationAnchorId": "anchor-a"})).is_ok());
    }
}
