use tonic::transport::Channel;

use crate::generated::runtime_app_service_client::RuntimeAppServiceClient;
use crate::generated::{
    ReadLocalAppStorageJsonRequest, RemoveLocalAppStorageJsonRequest,
    RemoveLocalAppStorageJsonResponse, WriteLocalAppStorageJsonRequest,
};
use crate::grpc_status::local_app_error_from_status;
use crate::{
    LocalAppOperationError, LocalAppReasonCode, LocalAppStorageDocument,
    LocalAppStorageReadRequest, LocalAppStorageRemoveRequest, LocalAppStorageRemoveResult,
    LocalAppStorageWriteRequest,
};

use super::{invalid_payload, untrusted};

const ACTION_EXECUTED: i32 = 1;
const MAX_RELATIVE_PATH_BYTES: usize = 240;
const MAX_DOCUMENT_BYTES: usize = 256 * 1024;

pub(super) async fn read_local_app_storage_json(
    channel: Channel,
    request: LocalAppStorageReadRequest,
) -> Result<LocalAppStorageDocument, LocalAppOperationError> {
    validate_relative_path(&request.relative_path)?;
    let response = RuntimeAppServiceClient::new(channel)
        .read_local_app_storage_json(ReadLocalAppStorageJsonRequest {
            relative_path: request.relative_path,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    validate_document_response(
        response.json_value,
        response.size_bytes,
        response.reason_code,
    )
}

pub(super) async fn write_local_app_storage_json(
    channel: Channel,
    request: LocalAppStorageWriteRequest,
) -> Result<LocalAppStorageDocument, LocalAppOperationError> {
    validate_relative_path(&request.relative_path)?;
    let json_value = serde_json::to_vec(&request.value).map_err(|_| invalid_payload())?;
    if json_value.len() > MAX_DOCUMENT_BYTES {
        return Err(LocalAppOperationError::new(
            LocalAppReasonCode::ResourceExhausted,
            false,
        ));
    }
    let response = RuntimeAppServiceClient::new(channel)
        .write_local_app_storage_json(WriteLocalAppStorageJsonRequest {
            relative_path: request.relative_path,
            json_value,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    validate_document_response(
        response.json_value,
        response.size_bytes,
        response.reason_code,
    )
}

pub(super) async fn remove_local_app_storage_json(
    channel: Channel,
    request: LocalAppStorageRemoveRequest,
) -> Result<LocalAppStorageRemoveResult, LocalAppOperationError> {
    validate_relative_path(&request.relative_path)?;
    let response = RuntimeAppServiceClient::new(channel)
        .remove_local_app_storage_json(RemoveLocalAppStorageJsonRequest {
            relative_path: request.relative_path,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    validate_remove_response(response)
}

fn validate_document_response(
    json_value: Vec<u8>,
    size_bytes: i64,
    reason_code: i32,
) -> Result<LocalAppStorageDocument, LocalAppOperationError> {
    let observed_size = i64::try_from(json_value.len()).map_err(|_| untrusted())?;
    if reason_code != ACTION_EXECUTED
        || json_value.len() > MAX_DOCUMENT_BYTES
        || size_bytes < 0
        || size_bytes != observed_size
    {
        return Err(untrusted());
    }
    let value = serde_json::from_slice(&json_value).map_err(|_| untrusted())?;
    Ok(LocalAppStorageDocument { value, size_bytes })
}

fn validate_remove_response(
    response: RemoveLocalAppStorageJsonResponse,
) -> Result<LocalAppStorageRemoveResult, LocalAppOperationError> {
    if response.reason_code != ACTION_EXECUTED {
        return Err(untrusted());
    }
    Ok(LocalAppStorageRemoveResult {
        removed: response.removed,
    })
}

fn validate_relative_path(value: &str) -> Result<(), LocalAppOperationError> {
    if value.is_empty()
        || value.trim() != value
        || value.len() > MAX_RELATIVE_PATH_BYTES
        || !value.is_ascii()
        || !value.ends_with(".json")
        || value.starts_with('/')
        || value.bytes().any(|byte| matches!(byte, b'\\' | b':' | 0))
    {
        return Err(LocalAppOperationError::new(
            LocalAppReasonCode::InvalidPath,
            false,
        ));
    }
    for segment in value.split('/') {
        if !valid_segment(segment) {
            return Err(LocalAppOperationError::new(
                LocalAppReasonCode::InvalidPath,
                false,
            ));
        }
    }
    Ok(())
}

fn valid_segment(segment: &str) -> bool {
    if segment.is_empty()
        || segment == "."
        || segment == ".."
        || segment.len() > 128
        || segment.ends_with('.')
        || windows_device_segment(segment)
    {
        return false;
    }
    segment.bytes().enumerate().all(|(index, byte)| {
        byte.is_ascii_alphanumeric() || (index > 0 && matches!(byte, b'.' | b'_' | b'-'))
    })
}

fn windows_device_segment(segment: &str) -> bool {
    let base = segment
        .split('.')
        .next()
        .unwrap_or_default()
        .to_ascii_uppercase();
    matches!(base.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || (base.len() == 4
            && (base.starts_with("COM") || base.starts_with("LPT"))
            && matches!(base.as_bytes()[3], b'1'..=b'9'))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn storage_response_is_bounded_and_path_free() {
        let document = validate_document_response(b"{\"value\":1}".to_vec(), 11, ACTION_EXECUTED)
            .expect("valid storage response");
        assert_eq!(document.value, serde_json::json!({"value": 1}));
        assert_eq!(document.size_bytes, 11);
        assert!(validate_relative_path("agent-chat/state.json").is_ok());
        for value in [
            "../state.json",
            "/state.json",
            "agent\\state.json",
            "CON.json",
        ] {
            assert_eq!(
                validate_relative_path(value).unwrap_err().reason_code(),
                LocalAppReasonCode::InvalidPath,
            );
        }
    }
}
