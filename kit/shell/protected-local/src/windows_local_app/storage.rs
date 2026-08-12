use time::{format_description::well_known::Rfc3339, OffsetDateTime};
use tokio_stream::{wrappers::ReceiverStream, StreamExt};
use tonic::transport::Channel;
use unicode_normalization::UnicodeNormalization;

use crate::generated::runtime_app_service_client::RuntimeAppServiceClient;
use crate::generated::{
    read_local_app_asset_response, write_local_app_asset_request, AdoptLocalAppArtifactRequest,
    ListLocalAppAssetsRequest, LocalAppAssetRange as ProtoAssetRange,
    LocalAppAssetRecord as ProtoAssetRecord, MoveLocalAppAssetRequest, ReadLocalAppAssetRequest,
    ReadLocalAppStorageJsonRequest, RemoveLocalAppAssetRequest, RemoveLocalAppStorageJsonRequest,
    RemoveLocalAppStorageJsonResponse, StatLocalAppAssetRequest, WriteLocalAppAssetMetadata,
    WriteLocalAppAssetRequest, WriteLocalAppStorageJsonRequest,
};
use crate::grpc_status::local_app_error_from_status;
use crate::{
    LocalAppAssetAdoptRequest, LocalAppAssetListRequest, LocalAppAssetListResult,
    LocalAppAssetMoveRequest, LocalAppAssetRange, LocalAppAssetReadRequest,
    LocalAppAssetReadResult, LocalAppAssetRecord, LocalAppAssetRemoveRequest,
    LocalAppAssetRemoveResult, LocalAppAssetStatRequest, LocalAppAssetWriteReceiver,
    LocalAppAssetWriteRequest, LocalAppOperationError, LocalAppReasonCode, LocalAppStorageDocument,
    LocalAppStorageReadRequest, LocalAppStorageRemoveRequest, LocalAppStorageRemoveResult,
    LocalAppStorageWriteRequest,
};

use super::{invalid_payload, untrusted};

const ACTION_EXECUTED: i32 = 1;
const MAX_JSON_RELATIVE_PATH_BYTES: usize = 240;
const MAX_ASSET_RELATIVE_PATH_BYTES: usize = 1024;
const MAX_ASSET_PATH_COMPONENTS: usize = 32;
const MAX_ASSET_COMPONENT_BYTES: usize = 255;
const MAX_DOCUMENT_BYTES: usize = 256 * 1024;
const MAX_ASSET_CHUNK_BYTES: usize = 1024 * 1024;
const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;
const MAX_MEDIA_TYPE_BYTES: usize = 255;

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

pub(super) async fn stat_local_app_asset(
    channel: Channel,
    request: LocalAppAssetStatRequest,
) -> Result<LocalAppAssetRecord, LocalAppOperationError> {
    validate_asset_path(&request.relative_path)?;
    let response = RuntimeAppServiceClient::new(channel)
        .stat_local_app_asset(StatLocalAppAssetRequest {
            relative_path: request.relative_path,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    if response.reason_code != ACTION_EXECUTED {
        return Err(untrusted());
    }
    validate_asset_record(response.asset)
}

pub(super) async fn list_local_app_assets(
    channel: Channel,
    request: LocalAppAssetListRequest,
) -> Result<LocalAppAssetListResult, LocalAppOperationError> {
    validate_asset_prefix(&request.prefix)?;
    if request.page_size < 0 || request.page_size > 500 || request.cursor.len() > 4096 {
        return Err(invalid_payload());
    }
    let response = RuntimeAppServiceClient::new(channel)
        .list_local_app_assets(ListLocalAppAssetsRequest {
            prefix: request.prefix,
            cursor: request.cursor,
            page_size: request.page_size,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    if response.reason_code != ACTION_EXECUTED || response.next_cursor.len() > 4096 {
        return Err(untrusted());
    }
    let assets = response
        .assets
        .into_iter()
        .map(|asset| validate_asset_record(Some(asset)))
        .collect::<Result<Vec<_>, _>>()?;
    if assets.len() > 500
        || assets
            .windows(2)
            .any(|values| values[0].relative_path >= values[1].relative_path)
    {
        return Err(untrusted());
    }
    Ok(LocalAppAssetListResult {
        assets,
        next_cursor: response.next_cursor,
    })
}

pub(super) async fn write_local_app_asset(
    channel: Channel,
    request: LocalAppAssetWriteRequest,
    body: LocalAppAssetWriteReceiver,
) -> Result<LocalAppAssetRecord, LocalAppOperationError> {
    validate_asset_path(&request.relative_path)?;
    validate_media_type(&request.media_type)?;
    let metadata = WriteLocalAppAssetRequest {
        frame: Some(write_local_app_asset_request::Frame::Metadata(
            WriteLocalAppAssetMetadata {
                relative_path: request.relative_path,
                media_type: request.media_type,
                overwrite: request.overwrite,
            },
        )),
    };
    let stream = tokio_stream::once(metadata).chain(ReceiverStream::new(body).map(|body_chunk| {
        WriteLocalAppAssetRequest {
            frame: Some(write_local_app_asset_request::Frame::BodyChunk(body_chunk)),
        }
    }));
    let response = RuntimeAppServiceClient::new(channel)
        .write_local_app_asset(stream)
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    if response.reason_code != ACTION_EXECUTED {
        return Err(untrusted());
    }
    validate_asset_record(response.asset)
}

pub(super) async fn read_local_app_asset(
    channel: Channel,
    request: LocalAppAssetReadRequest,
) -> Result<LocalAppAssetReadResult, LocalAppOperationError> {
    validate_asset_path(&request.relative_path)?;
    if request.offset.is_some_and(|value| value < 0)
        || request.length.is_some_and(|value| value <= 0)
    {
        return Err(LocalAppOperationError::new(
            LocalAppReasonCode::InvalidRange,
            false,
        ));
    }
    let mut source = RuntimeAppServiceClient::new(channel)
        .read_local_app_asset(ReadLocalAppAssetRequest {
            relative_path: request.relative_path,
            offset: request.offset,
            length: request.length,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    let first = source
        .message()
        .await
        .map_err(local_app_error_from_status)?
        .ok_or_else(untrusted)?;
    let Some(read_local_app_asset_response::Frame::Metadata(metadata)) = first.frame else {
        return Err(untrusted());
    };
    let asset = validate_asset_record(metadata.asset)?;
    let range = validate_asset_range(metadata.range, asset.size_bytes)?;
    let expected = range.length;
    let (sender, body) = tokio::sync::mpsc::channel(2);
    tokio::spawn(async move {
        let mut observed = 0_i64;
        loop {
            let frame = match source.message().await {
                Ok(Some(frame)) => frame,
                Ok(None) => {
                    if observed != expected {
                        let _ = sender.send(Err(untrusted())).await;
                    }
                    return;
                }
                Err(error) => {
                    let _ = sender.send(Err(local_app_error_from_status(error))).await;
                    return;
                }
            };
            let Some(read_local_app_asset_response::Frame::BodyChunk(chunk)) = frame.frame else {
                let _ = sender.send(Err(untrusted())).await;
                return;
            };
            if chunk.is_empty() || chunk.len() > MAX_ASSET_CHUNK_BYTES {
                let _ = sender.send(Err(untrusted())).await;
                return;
            }
            let Ok(chunk_len) = i64::try_from(chunk.len()) else {
                let _ = sender.send(Err(untrusted())).await;
                return;
            };
            let Some(next) = observed.checked_add(chunk_len) else {
                let _ = sender.send(Err(untrusted())).await;
                return;
            };
            if next > expected {
                let _ = sender.send(Err(untrusted())).await;
                return;
            }
            observed = next;
            if sender.send(Ok(chunk)).await.is_err() {
                return;
            }
        }
    });
    Ok(LocalAppAssetReadResult { asset, range, body })
}

pub(super) async fn remove_local_app_asset(
    channel: Channel,
    request: LocalAppAssetRemoveRequest,
) -> Result<LocalAppAssetRemoveResult, LocalAppOperationError> {
    validate_asset_path(&request.relative_path)?;
    let response = RuntimeAppServiceClient::new(channel)
        .remove_local_app_asset(RemoveLocalAppAssetRequest {
            relative_path: request.relative_path,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    if response.reason_code != ACTION_EXECUTED {
        return Err(untrusted());
    }
    Ok(LocalAppAssetRemoveResult {
        removed: response.removed,
    })
}

pub(super) async fn move_local_app_asset(
    channel: Channel,
    request: LocalAppAssetMoveRequest,
) -> Result<LocalAppAssetRecord, LocalAppOperationError> {
    validate_asset_path(&request.from_relative_path)?;
    validate_asset_path(&request.to_relative_path)?;
    let response = RuntimeAppServiceClient::new(channel)
        .move_local_app_asset(MoveLocalAppAssetRequest {
            from_relative_path: request.from_relative_path,
            to_relative_path: request.to_relative_path,
            overwrite: request.overwrite,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    if response.reason_code != ACTION_EXECUTED {
        return Err(untrusted());
    }
    validate_asset_record(response.asset)
}

pub(super) async fn adopt_local_app_artifact(
    channel: Channel,
    request: LocalAppAssetAdoptRequest,
) -> Result<LocalAppAssetRecord, LocalAppOperationError> {
    validate_asset_path(&request.relative_path)?;
    if request.artifact_id.is_empty() || request.artifact_id.len() > 512 {
        return Err(invalid_payload());
    }
    let response = RuntimeAppServiceClient::new(channel)
        .adopt_local_app_artifact(AdoptLocalAppArtifactRequest {
            artifact_id: request.artifact_id,
            relative_path: request.relative_path,
            overwrite: request.overwrite,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    if response.reason_code != ACTION_EXECUTED {
        return Err(untrusted());
    }
    validate_asset_record(response.asset)
}

fn validate_asset_record(
    value: Option<ProtoAssetRecord>,
) -> Result<LocalAppAssetRecord, LocalAppOperationError> {
    let value = value.ok_or_else(untrusted)?;
    validate_asset_path(&value.relative_path).map_err(|_| untrusted())?;
    validate_media_type(&value.media_type).map_err(|_| untrusted())?;
    if value.size_bytes < 0 || value.size_bytes > MAX_SAFE_INTEGER || !valid_sha256(&value.sha256) {
        return Err(untrusted());
    }
    Ok(LocalAppAssetRecord {
        relative_path: value.relative_path,
        media_type: value.media_type,
        size_bytes: value.size_bytes,
        sha256: value.sha256,
        created_at: format_timestamp(value.created_at)?,
        updated_at: format_timestamp(value.updated_at)?,
    })
}

fn validate_asset_range(
    value: Option<ProtoAssetRange>,
    total_size: i64,
) -> Result<LocalAppAssetRange, LocalAppOperationError> {
    let value = value.ok_or_else(untrusted)?;
    if value.offset < 0
        || value.length < 0
        || value.total_size != total_size
        || value.offset > value.total_size
        || value.length > value.total_size - value.offset
    {
        return Err(untrusted());
    }
    Ok(LocalAppAssetRange {
        offset: value.offset,
        length: value.length,
        total_size: value.total_size,
    })
}

fn format_timestamp(
    value: Option<prost_types::Timestamp>,
) -> Result<String, LocalAppOperationError> {
    let value = value.ok_or_else(untrusted)?;
    if !(0..1_000_000_000).contains(&value.nanos) {
        return Err(untrusted());
    }
    OffsetDateTime::from_unix_timestamp(value.seconds)
        .and_then(|time| time.replace_nanosecond(value.nanos as u32))
        .map_err(|_| untrusted())?
        .format(&Rfc3339)
        .map_err(|_| untrusted())
}

fn valid_sha256(value: &str) -> bool {
    value.len() == 71
        && value.starts_with("sha256:")
        && value[7..]
            .bytes()
            .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
}

fn validate_media_type(value: &str) -> Result<(), LocalAppOperationError> {
    if value.len() > MAX_MEDIA_TYPE_BYTES
        || (!value.is_empty()
            && (value.trim() != value
                || !value.is_ascii()
                || value.matches('/').count() != 1
                || value
                    .bytes()
                    .any(|byte| byte.is_ascii_control() || byte == b' ')))
    {
        return Err(invalid_payload());
    }
    Ok(())
}

fn validate_asset_prefix(value: &str) -> Result<(), LocalAppOperationError> {
    if value.is_empty() {
        return Ok(());
    }
    validate_asset_path(value.strip_suffix('/').unwrap_or(value))
}

fn validate_asset_path(value: &str) -> Result<(), LocalAppOperationError> {
    let components = value.split('/').collect::<Vec<_>>();
    if value.is_empty()
        || value.trim() != value
        || value.len() > MAX_ASSET_RELATIVE_PATH_BYTES
        || value.nfc().ne(value.chars())
        || value.starts_with('/')
        || value.ends_with('/')
        || value.chars().any(|character| {
            matches!(
                character,
                '\\' | '\0' | '<' | '>' | ':' | '"' | '|' | '?' | '*'
            )
        })
        || components.len() > MAX_ASSET_PATH_COMPONENTS
    {
        return Err(LocalAppOperationError::new(
            LocalAppReasonCode::InvalidPath,
            false,
        ));
    }
    if components
        .into_iter()
        .any(|component| !valid_asset_component(component))
    {
        return Err(LocalAppOperationError::new(
            LocalAppReasonCode::InvalidPath,
            false,
        ));
    }
    Ok(())
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
        || value.len() > MAX_JSON_RELATIVE_PATH_BYTES
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

fn valid_asset_component(component: &str) -> bool {
    !component.is_empty()
        && component != "."
        && component != ".."
        && component.len() <= MAX_ASSET_COMPONENT_BYTES
        && !component.ends_with('.')
        && !component.ends_with(' ')
        && !windows_device_segment(component)
        && !component
            .chars()
            .any(|character| character < '\u{20}' || character == '\u{7f}')
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

    #[test]
    fn asset_paths_and_pages_match_the_runtime_contract() {
        let maximum_path = format!(
            "{}/{}/{}/{}/e",
            "a".repeat(255),
            "b".repeat(255),
            "c".repeat(255),
            "d".repeat(254),
        );
        assert_eq!(maximum_path.len(), MAX_ASSET_RELATIVE_PATH_BYTES);
        assert!(validate_asset_path("媒体/é.wav").is_ok());
        assert!(validate_asset_path(&maximum_path).is_ok());
        assert!(validate_asset_prefix("媒体/").is_ok());
        for value in [
            "媒体/e\u{301}.wav",
            &format!("{maximum_path}x"),
            "media//audio.wav",
            "media/audio.wav ",
        ] {
            assert_eq!(
                validate_asset_path(value).unwrap_err().reason_code(),
                LocalAppReasonCode::InvalidPath,
            );
        }
        assert_eq!(
            validate_asset_prefix("media//").unwrap_err().reason_code(),
            LocalAppReasonCode::InvalidPath,
        );
    }
}
