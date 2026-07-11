use std::future::Future;
use std::pin::Pin;

use tonic::transport::Channel;

use crate::generated::runtime_artifact_service_client::RuntimeArtifactServiceClient;
use crate::generated::runtime_auth_service_client::RuntimeAuthServiceClient;
use crate::generated::{
    OpenDesktopLaunchedAppSessionRequest, ReadArtifactBytesRequest, ReadArtifactBytesResponse,
};
use crate::windows_peer_trust::VerifiedRuntimePeer;
use crate::windows_service_control::open_verified_runtime_channel;
use crate::{
    InstalledArtifactBytes, InstalledArtifactReadError, InstalledArtifactReadReasonCode,
    NimiInstalledAppCarrier, NimiInstalledAppSession, ProtectedCarrierError,
    ProtectedCarrierReasonCode,
};

const RUNTIME_INSTALLED_PIPE_NAME: &str = r"\\.\pipe\nimi-runtime-installed-v1";
const MAX_INLINE_ARTIFACT_BYTES: usize = 32 * 1024 * 1024;

#[derive(Clone, Copy, Debug, Default)]
pub struct WindowsInstalledAppCarrier;

struct WindowsInstalledAppSession {
    channel: Channel,
    _runtime_peer: VerifiedRuntimePeer,
    _session_id: [u8; 32],
    _session_proof: [u8; 32],
    _runtime_boot_epoch: [u8; 32],
}

impl NimiInstalledAppSession for WindowsInstalledAppSession {
    fn read_artifact_bytes(
        &self,
        artifact_id: String,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<InstalledArtifactBytes, InstalledArtifactReadError>>
                + Send
                + '_,
        >,
    > {
        Box::pin(read_installed_artifact_bytes(
            self.channel.clone(),
            artifact_id,
        ))
    }
}

impl NimiInstalledAppCarrier for WindowsInstalledAppCarrier {
    fn open_installed_app_session(
        &self,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<Box<dyn NimiInstalledAppSession>, ProtectedCarrierError>>
                + Send
                + '_,
        >,
    > {
        Box::pin(open_installed_app_session())
    }
}

async fn open_installed_app_session(
) -> Result<Box<dyn NimiInstalledAppSession>, ProtectedCarrierError> {
    let (channel, runtime_peer) =
        open_verified_runtime_channel(RUNTIME_INSTALLED_PIPE_NAME).await?;
    let response = RuntimeAuthServiceClient::new(channel.clone())
        .open_desktop_launched_app_session(OpenDesktopLaunchedAppSessionRequest {})
        .await
        .map_err(|_| untrusted())?
        .into_inner();
    let session_id: [u8; 32] = response
        .installed_session_id
        .try_into()
        .map_err(|_| untrusted())?;
    let session_proof: [u8; 32] = response
        .installed_session_proof
        .try_into()
        .map_err(|_| untrusted())?;
    let runtime_boot_epoch: [u8; 32] = response
        .runtime_boot_epoch
        .try_into()
        .map_err(|_| untrusted())?;
    if session_id == [0u8; 32]
        || session_proof == [0u8; 32]
        || runtime_boot_epoch == [0u8; 32]
        || response.app_id.trim().is_empty()
        || response.release_digest.len() != 32
        || response.account_generation == 0
        || response.expires_at.is_none()
    {
        return Err(untrusted());
    }
    Ok(Box::new(WindowsInstalledAppSession {
        channel,
        _runtime_peer: runtime_peer,
        _session_id: session_id,
        _session_proof: session_proof,
        _runtime_boot_epoch: runtime_boot_epoch,
    }))
}

async fn read_installed_artifact_bytes(
    channel: Channel,
    artifact_id: String,
) -> Result<InstalledArtifactBytes, InstalledArtifactReadError> {
    let normalized = artifact_id.trim();
    if normalized.is_empty() || normalized != artifact_id {
        return Err(InstalledArtifactReadError::new(
            InstalledArtifactReadReasonCode::InvalidInput,
            false,
        ));
    }
    let response = RuntimeArtifactServiceClient::new(channel)
        .read_artifact_bytes(ReadArtifactBytesRequest { artifact_id })
        .await
        .map_err(map_installed_artifact_status)?
        .into_inner();
    validate_installed_artifact_response(response)
}

fn validate_installed_artifact_response(
    response: ReadArtifactBytesResponse,
) -> Result<InstalledArtifactBytes, InstalledArtifactReadError> {
    let mime_type = response.mime_type.trim();
    let observed_size = i64::try_from(response.bytes.len()).unwrap_or(i64::MAX);
    if response.bytes.len() > MAX_INLINE_ARTIFACT_BYTES
        || response.size_bytes < 0
        || response.size_bytes != observed_size
        || mime_type.is_empty()
        || mime_type != response.mime_type
        || !mime_type.contains('/')
    {
        return Err(InstalledArtifactReadError::new(
            InstalledArtifactReadReasonCode::RuntimeUntrusted,
            false,
        ));
    }
    Ok(InstalledArtifactBytes {
        bytes: response.bytes,
        mime_type: response.mime_type,
        size_bytes: response.size_bytes,
        mime_inferred: response.mime_inferred,
    })
}

fn map_installed_artifact_status(status: tonic::Status) -> InstalledArtifactReadError {
    let (reason_code, retryable) = match status.code() {
        tonic::Code::InvalidArgument => (InstalledArtifactReadReasonCode::InvalidInput, false),
        tonic::Code::PermissionDenied | tonic::Code::Unauthenticated => {
            (InstalledArtifactReadReasonCode::Forbidden, false)
        }
        tonic::Code::NotFound => (InstalledArtifactReadReasonCode::NotFound, false),
        tonic::Code::ResourceExhausted => (InstalledArtifactReadReasonCode::TooLarge, false),
        tonic::Code::Unavailable | tonic::Code::DeadlineExceeded | tonic::Code::Cancelled => {
            (InstalledArtifactReadReasonCode::RuntimeUnavailable, true)
        }
        _ => (InstalledArtifactReadReasonCode::RuntimeUntrusted, false),
    };
    InstalledArtifactReadError::new(reason_code, retryable)
}

fn untrusted() -> ProtectedCarrierError {
    ProtectedCarrierError::new(ProtectedCarrierReasonCode::RuntimeServiceUntrusted, false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::generated::ReadArtifactBytesResponse;

    #[test]
    fn installed_artifact_response_requires_exact_observed_size_and_mime() {
        let outcome = validate_installed_artifact_response(ReadArtifactBytesResponse {
            bytes: b"artifact".to_vec(),
            mime_type: "image/png".to_string(),
            size_bytes: 8,
            mime_inferred: false,
        })
        .expect("valid artifact response");
        assert_eq!(outcome.bytes, b"artifact");
        assert_eq!(outcome.mime_type, "image/png");
        assert_eq!(outcome.size_bytes, 8);
        assert!(!outcome.mime_inferred);

        for invalid in [
            ReadArtifactBytesResponse {
                bytes: b"artifact".to_vec(),
                mime_type: "image/png".to_string(),
                size_bytes: 7,
                mime_inferred: false,
            },
            ReadArtifactBytesResponse {
                bytes: b"artifact".to_vec(),
                mime_type: " ".to_string(),
                size_bytes: 8,
                mime_inferred: false,
            },
        ] {
            let error = validate_installed_artifact_response(invalid).unwrap_err();
            assert_eq!(
                error.reason_code(),
                InstalledArtifactReadReasonCode::RuntimeUntrusted
            );
        }
    }

    #[test]
    fn installed_artifact_status_mapping_is_typed_and_fail_closed() {
        for (code, expected, retryable) in [
            (
                tonic::Code::InvalidArgument,
                InstalledArtifactReadReasonCode::InvalidInput,
                false,
            ),
            (
                tonic::Code::PermissionDenied,
                InstalledArtifactReadReasonCode::Forbidden,
                false,
            ),
            (
                tonic::Code::NotFound,
                InstalledArtifactReadReasonCode::NotFound,
                false,
            ),
            (
                tonic::Code::ResourceExhausted,
                InstalledArtifactReadReasonCode::TooLarge,
                false,
            ),
            (
                tonic::Code::Unavailable,
                InstalledArtifactReadReasonCode::RuntimeUnavailable,
                true,
            ),
            (
                tonic::Code::Unknown,
                InstalledArtifactReadReasonCode::RuntimeUntrusted,
                false,
            ),
        ] {
            let error = map_installed_artifact_status(tonic::Status::new(code, "redacted"));
            assert_eq!(error.reason_code(), expected);
            assert_eq!(error.retryable(), retryable);
            assert!(!error.to_string().contains("redacted"));
        }
    }
}
