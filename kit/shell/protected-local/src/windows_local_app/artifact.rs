use tonic::transport::Channel;

use crate::generated::runtime_artifact_service_client::RuntimeArtifactServiceClient;
use crate::generated::{ReadArtifactBytesRequest, ReadArtifactBytesResponse};
use crate::grpc_status::local_app_error_from_status;
use crate::{LocalAppArtifactBytes, LocalAppArtifactReadRequest, LocalAppOperationError};

use super::{require_text, untrusted};

const MAX_INLINE_ARTIFACT_BYTES: usize = 32 * 1024 * 1024;

pub(super) async fn read_local_app_artifact(
    channel: Channel,
    request: LocalAppArtifactReadRequest,
) -> Result<LocalAppArtifactBytes, LocalAppOperationError> {
    require_text(&request.artifact_id)?;
    let response = RuntimeArtifactServiceClient::new(channel)
        .read_artifact_bytes(ReadArtifactBytesRequest {
            artifact_id: request.artifact_id,
        })
        .await
        .map_err(local_app_error_from_status)?
        .into_inner();
    validate_artifact_response(response)
}

fn validate_artifact_response(
    response: ReadArtifactBytesResponse,
) -> Result<LocalAppArtifactBytes, LocalAppOperationError> {
    let observed_size = i64::try_from(response.bytes.len()).map_err(|_| untrusted())?;
    if response.bytes.len() > MAX_INLINE_ARTIFACT_BYTES
        || response.size_bytes < 0
        || response.size_bytes != observed_size
        || response.mime_type.is_empty()
        || response.mime_type.trim() != response.mime_type
        || !response.mime_type.contains('/')
    {
        return Err(untrusted());
    }
    Ok(LocalAppArtifactBytes {
        bytes: response.bytes,
        mime_type: response.mime_type,
        size_bytes: response.size_bytes,
        mime_inferred: response.mime_inferred,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::LocalAppReasonCode;

    #[test]
    fn artifact_response_requires_exact_size_and_mime() {
        let value = validate_artifact_response(ReadArtifactBytesResponse {
            bytes: b"artifact".to_vec(),
            mime_type: "text/plain".to_string(),
            size_bytes: 8,
            mime_inferred: false,
        })
        .expect("valid artifact");
        assert_eq!(value.bytes, b"artifact");

        let error = validate_artifact_response(ReadArtifactBytesResponse {
            bytes: b"artifact".to_vec(),
            mime_type: "text/plain".to_string(),
            size_bytes: 7,
            mime_inferred: false,
        })
        .expect_err("mismatched size");
        assert_eq!(
            error.reason_code(),
            LocalAppReasonCode::RuntimeServiceUntrusted
        );
    }
}
