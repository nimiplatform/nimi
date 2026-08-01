use tonic::transport::Channel;

use crate::generated::runtime_artifact_service_client::RuntimeArtifactServiceClient;
use crate::generated::{PutArtifactRequest, ReadArtifactBytesRequest};
use crate::grpc_status::local_app_error_from_status;
use crate::{
    LocalAppArtifactPutRequest, LocalAppArtifactPutResult, LocalAppArtifactReadRequest,
    LocalAppArtifactReadResult, LocalAppOperationError, LocalAppReasonCode,
};

use super::{invalid_payload, require_text, untrusted};

const MAX_ARTIFACT_BYTES: usize = 4 * 1024 * 1024;
const MAX_DISPLAY_NAME_BYTES: usize = 512;
const MAX_READ_ARTIFACT_BYTES: usize = 32 * 1024 * 1024;

pub(super) async fn put_artifact(
    channel: Channel,
    request: LocalAppArtifactPutRequest,
) -> Result<LocalAppArtifactPutResult, LocalAppOperationError> {
    if !admitted_image_mime(&request.mime_type) {
        return Err(invalid_payload());
    }
    if request.display_name.trim() != request.display_name
        || request.display_name.len() > MAX_DISPLAY_NAME_BYTES
    {
        return Err(invalid_payload());
    }
    if request.data.is_empty() {
        return Err(invalid_payload());
    }
    if request.data.len() > MAX_ARTIFACT_BYTES {
        return Err(LocalAppOperationError::new(
            LocalAppReasonCode::ResourceExhausted,
            false,
        ));
    }
    let response = RuntimeArtifactServiceClient::new(channel)
        .put_artifact(PutArtifactRequest {
            mime_type: request.mime_type,
            display_name: request.display_name,
            data: request.data,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    require_runtime_text(&response.artifact_id)?;
    Ok(LocalAppArtifactPutResult {
        artifact_id: response.artifact_id,
    })
}

fn require_runtime_text(value: &str) -> Result<(), LocalAppOperationError> {
    if value.is_empty() || value.trim() != value {
        Err(untrusted())
    } else {
        Ok(())
    }
}

pub(super) async fn read_artifact_bytes(
    channel: Channel,
    request: LocalAppArtifactReadRequest,
) -> Result<LocalAppArtifactReadResult, LocalAppOperationError> {
    require_text(&request.artifact_id)?;
    let response = RuntimeArtifactServiceClient::new(channel)
        .read_artifact_bytes(ReadArtifactBytesRequest {
            artifact_id: request.artifact_id,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    require_runtime_text(&response.mime_type)?;
    let byte_len = i64::try_from(response.bytes.len()).map_err(|_| untrusted())?;
    if response.bytes.is_empty()
        || response.bytes.len() > MAX_READ_ARTIFACT_BYTES
        || response.size_bytes != byte_len
    {
        return Err(untrusted());
    }
    Ok(LocalAppArtifactReadResult {
        bytes: response.bytes,
        mime_type: response.mime_type,
    })
}

fn admitted_image_mime(mime_type: &str) -> bool {
    matches!(
        mime_type,
        "image/png" | "image/jpeg" | "image/webp" | "image/gif"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn artifact_mime_whitelist_is_closed() {
        for mime in ["image/png", "image/jpeg", "image/webp", "image/gif"] {
            assert!(admitted_image_mime(mime));
        }
        for mime in ["image/svg+xml", "application/octet-stream", "IMAGE/PNG", " image/png"] {
            assert!(!admitted_image_mime(mime));
        }
    }
}
