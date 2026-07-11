use std::future::Future;
use std::pin::Pin;
use std::time::{SystemTime, UNIX_EPOCH};

use tokio::sync::Mutex;
use tonic::transport::Channel;

use crate::generated::runtime_artifact_service_client::RuntimeArtifactServiceClient;
use crate::generated::runtime_auth_service_client::RuntimeAuthServiceClient;
use crate::generated::runtime_development_service_client::RuntimeDevelopmentServiceClient;
use crate::generated::{
    GetLocalDevelopmentSessionStatusRequest, OpenDesktopLaunchedAppSessionRequest,
    OpenLocalDevelopmentAppSessionRequest, OpenLocalDevelopmentAppSessionResponse,
    ReadArtifactBytesRequest, ReadArtifactBytesResponse,
};
use crate::grpc_status::{host_error_from_status, production_open_not_applicable};
use crate::windows_peer_trust::VerifiedRuntimePeer;
use crate::windows_service_control::open_verified_runtime_channel;
use crate::{
    AppHostArtifactBytes, AppHostArtifactReadError, AppHostArtifactReadReasonCode,
    AppHostBootstrapState, AppHostBootstrapStatus, AppHostTrustClass, NimiAppHostCarrier,
    NimiAppHostSession, NimiHostError, NimiHostErrorReasonCode,
};

const RUNTIME_APP_HOST_PIPE_NAME: &str = r"\\.\pipe\nimi-runtime-installed-v1";
const MAX_INLINE_ARTIFACT_BYTES: usize = 32 * 1024 * 1024;
const DEVELOPMENT_RENEWAL_WINDOW_MS: i64 = 30_000;
const ACTION_EXECUTED: i32 = 1;

#[derive(Clone, Copy, Debug, Default)]
pub struct WindowsAppHostCarrier;

enum AppHostSessionKind {
    ProductionInstalled {
        bootstrap: AppHostBootstrapStatus,
        _session_id: [u8; 32],
        _session_proof: [u8; 32],
        _runtime_boot_epoch: [u8; 32],
    },
    LocalDevelopment {
        bootstrap: Mutex<AppHostBootstrapStatus>,
        _runtime_boot_epoch: [u8; 32],
    },
}

struct WindowsAppHostSession {
    channel: Channel,
    _runtime_peer: VerifiedRuntimePeer,
    kind: AppHostSessionKind,
}

impl NimiAppHostSession for WindowsAppHostSession {
    fn bootstrap_status(
        &self,
    ) -> Pin<Box<dyn Future<Output = Result<AppHostBootstrapStatus, NimiHostError>> + Send + '_>>
    {
        Box::pin(self.current_bootstrap_status())
    }

    fn read_artifact_bytes(
        &self,
        artifact_id: String,
    ) -> Pin<
        Box<
            dyn Future<Output = Result<AppHostArtifactBytes, AppHostArtifactReadError>> + Send + '_,
        >,
    > {
        Box::pin(async move {
            self.current_bootstrap_status()
                .await
                .map_err(map_host_error_to_artifact_error)?;
            read_app_host_artifact_bytes(self.channel.clone(), artifact_id).await
        })
    }
}

impl WindowsAppHostSession {
    async fn current_bootstrap_status(&self) -> Result<AppHostBootstrapStatus, NimiHostError> {
        match &self.kind {
            AppHostSessionKind::ProductionInstalled { bootstrap, .. } => Ok(bootstrap.clone()),
            AppHostSessionKind::LocalDevelopment { bootstrap, .. } => {
                let mut current = bootstrap.lock().await;
                let status = RuntimeDevelopmentServiceClient::new(self.channel.clone())
                    .get_local_development_session_status(
                        GetLocalDevelopmentSessionStatusRequest {},
                    )
                    .await
                    .map_err(host_error_from_status)?
                    .into_inner();
                if status.reason_code != ACTION_EXECUTED
                    || status.state != 1
                    || status.app_id != current.app_id
                {
                    return Err(untrusted());
                }
                let expires_at_unix_ms = required_timestamp_ms(status.expires_at)?;
                if expires_at_unix_ms
                    <= now_unix_ms()?.saturating_add(DEVELOPMENT_RENEWAL_WINDOW_MS)
                {
                    let renewed = open_local_development_session(self.channel.clone()).await?;
                    if renewed.app_id != current.app_id {
                        return Err(untrusted());
                    }
                    *current = renewed;
                } else {
                    current.expires_at_unix_ms = expires_at_unix_ms;
                }
                Ok(current.clone())
            }
        }
    }
}

impl NimiAppHostCarrier for WindowsAppHostCarrier {
    fn open_app_host_session(
        &self,
    ) -> Pin<Box<dyn Future<Output = Result<Box<dyn NimiAppHostSession>, NimiHostError>> + Send + '_>>
    {
        Box::pin(open_app_host_session())
    }
}

async fn open_app_host_session() -> Result<Box<dyn NimiAppHostSession>, NimiHostError> {
    let (channel, runtime_peer) = open_verified_runtime_channel(RUNTIME_APP_HOST_PIPE_NAME)
        .await
        .map_err(NimiHostError::from)?;
    let production = RuntimeAuthServiceClient::new(channel.clone())
        .open_desktop_launched_app_session(OpenDesktopLaunchedAppSessionRequest {})
        .await;
    let kind = match production {
        Ok(response) => {
            let response = response.into_inner();
            let session_id = required_identifier(response.installed_session_id)?;
            let session_proof = required_identifier(response.installed_session_proof)?;
            let runtime_boot_epoch = required_identifier(response.runtime_boot_epoch)?;
            if response.release_digest.len() != 32 || response.account_generation == 0 {
                return Err(untrusted());
            }
            let bootstrap = AppHostBootstrapStatus {
                state: AppHostBootstrapState::Ready,
                trust_class: AppHostTrustClass::ProductionInstalled,
                app_id: required_text(response.app_id)?,
                bootstrap_artifact_id: None,
                expires_at_unix_ms: required_timestamp_ms(response.expires_at)?,
            };
            AppHostSessionKind::ProductionInstalled {
                bootstrap,
                _session_id: session_id,
                _session_proof: session_proof,
                _runtime_boot_epoch: runtime_boot_epoch,
            }
        }
        Err(status) if production_open_not_applicable(&status) => {
            let (bootstrap, runtime_boot_epoch) =
                open_local_development_session_with_epoch(channel.clone()).await?;
            AppHostSessionKind::LocalDevelopment {
                bootstrap: Mutex::new(bootstrap),
                _runtime_boot_epoch: runtime_boot_epoch,
            }
        }
        Err(status) => return Err(host_error_from_status(status)),
    };
    Ok(Box::new(WindowsAppHostSession {
        channel,
        _runtime_peer: runtime_peer,
        kind,
    }))
}

async fn open_local_development_session(
    channel: Channel,
) -> Result<AppHostBootstrapStatus, NimiHostError> {
    open_local_development_session_with_epoch(channel)
        .await
        .map(|(bootstrap, _)| bootstrap)
}

async fn open_local_development_session_with_epoch(
    channel: Channel,
) -> Result<(AppHostBootstrapStatus, [u8; 32]), NimiHostError> {
    let response = RuntimeDevelopmentServiceClient::new(channel)
        .open_local_development_app_session(OpenLocalDevelopmentAppSessionRequest {})
        .await
        .map_err(host_error_from_status)?
        .into_inner();
    project_local_development_bootstrap(response)
}

fn project_local_development_bootstrap(
    response: OpenLocalDevelopmentAppSessionResponse,
) -> Result<(AppHostBootstrapStatus, [u8; 32]), NimiHostError> {
    if response.reason_code != ACTION_EXECUTED
        || response.state != 1
        || response.account_generation == 0
    {
        return Err(untrusted());
    }
    let runtime_boot_epoch = required_identifier(response.runtime_boot_epoch)?;
    let bootstrap_artifact_id = required_text(response.bootstrap_artifact_id)?;
    Ok((
        AppHostBootstrapStatus {
            state: AppHostBootstrapState::Ready,
            trust_class: AppHostTrustClass::LocalDevelopment,
            app_id: required_text(response.app_id)?,
            bootstrap_artifact_id: Some(bootstrap_artifact_id),
            expires_at_unix_ms: required_timestamp_ms(response.expires_at)?,
        },
        runtime_boot_epoch,
    ))
}

async fn read_app_host_artifact_bytes(
    channel: Channel,
    artifact_id: String,
) -> Result<AppHostArtifactBytes, AppHostArtifactReadError> {
    let normalized = artifact_id.trim();
    if normalized.is_empty() || normalized != artifact_id {
        return Err(AppHostArtifactReadError::new(
            AppHostArtifactReadReasonCode::InvalidInput,
            false,
        ));
    }
    let response = RuntimeArtifactServiceClient::new(channel)
        .read_artifact_bytes(ReadArtifactBytesRequest { artifact_id })
        .await
        .map_err(map_app_host_artifact_status)?
        .into_inner();
    validate_app_host_artifact_response(response)
}

fn validate_app_host_artifact_response(
    response: ReadArtifactBytesResponse,
) -> Result<AppHostArtifactBytes, AppHostArtifactReadError> {
    let mime_type = response.mime_type.trim();
    let observed_size = i64::try_from(response.bytes.len()).unwrap_or(i64::MAX);
    if response.bytes.len() > MAX_INLINE_ARTIFACT_BYTES
        || response.size_bytes < 0
        || response.size_bytes != observed_size
        || mime_type.is_empty()
        || mime_type != response.mime_type
        || !mime_type.contains('/')
    {
        return Err(AppHostArtifactReadError::new(
            AppHostArtifactReadReasonCode::RuntimeUntrusted,
            false,
        ));
    }
    Ok(AppHostArtifactBytes {
        bytes: response.bytes,
        mime_type: response.mime_type,
        size_bytes: response.size_bytes,
        mime_inferred: response.mime_inferred,
    })
}

fn map_app_host_artifact_status(status: tonic::Status) -> AppHostArtifactReadError {
    let (reason_code, retryable) = match status.code() {
        tonic::Code::InvalidArgument => (AppHostArtifactReadReasonCode::InvalidInput, false),
        tonic::Code::PermissionDenied | tonic::Code::Unauthenticated => {
            (AppHostArtifactReadReasonCode::Forbidden, false)
        }
        tonic::Code::NotFound => (AppHostArtifactReadReasonCode::NotFound, false),
        tonic::Code::ResourceExhausted => (AppHostArtifactReadReasonCode::TooLarge, false),
        tonic::Code::Unavailable | tonic::Code::DeadlineExceeded | tonic::Code::Cancelled => {
            (AppHostArtifactReadReasonCode::RuntimeUnavailable, true)
        }
        _ => (AppHostArtifactReadReasonCode::RuntimeUntrusted, false),
    };
    AppHostArtifactReadError::new(reason_code, retryable)
}

fn map_host_error_to_artifact_error(error: NimiHostError) -> AppHostArtifactReadError {
    let (reason, retryable) = match error.reason_code() {
        NimiHostErrorReasonCode::RuntimeServiceUnavailable => {
            (AppHostArtifactReadReasonCode::RuntimeUnavailable, true)
        }
        NimiHostErrorReasonCode::RuntimeServiceUntrusted => {
            (AppHostArtifactReadReasonCode::RuntimeUntrusted, false)
        }
        _ => (AppHostArtifactReadReasonCode::Forbidden, error.retryable()),
    };
    AppHostArtifactReadError::new(reason, retryable)
}

fn required_identifier(value: Vec<u8>) -> Result<[u8; 32], NimiHostError> {
    let value: [u8; 32] = value.try_into().map_err(|_| untrusted())?;
    (value != [0u8; 32]).then_some(value).ok_or_else(untrusted)
}

fn required_text(value: String) -> Result<String, NimiHostError> {
    if value.is_empty() || value.trim() != value {
        return Err(untrusted());
    }
    Ok(value)
}

fn required_timestamp_ms(value: Option<prost_types::Timestamp>) -> Result<i64, NimiHostError> {
    let value = value.ok_or_else(untrusted)?;
    if value.seconds <= 0 || !(0..1_000_000_000).contains(&value.nanos) {
        return Err(untrusted());
    }
    value
        .seconds
        .checked_mul(1_000)
        .and_then(|millis| millis.checked_add(i64::from(value.nanos / 1_000_000)))
        .ok_or_else(untrusted)
}

fn now_unix_ms() -> Result<i64, NimiHostError> {
    let duration = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|_| untrusted())?;
    i64::try_from(duration.as_millis()).map_err(|_| untrusted())
}

fn untrusted() -> NimiHostError {
    NimiHostError::new(NimiHostErrorReasonCode::RuntimeServiceUntrusted, false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn app_host_artifact_response_requires_exact_observed_size_and_mime() {
        let outcome = validate_app_host_artifact_response(ReadArtifactBytesResponse {
            bytes: b"artifact".to_vec(),
            mime_type: "image/png".to_string(),
            size_bytes: 8,
            mime_inferred: false,
        })
        .expect("valid artifact response");
        assert_eq!(outcome.bytes, b"artifact");
        assert_eq!(outcome.mime_type, "image/png");

        let error = validate_app_host_artifact_response(ReadArtifactBytesResponse {
            bytes: b"artifact".to_vec(),
            mime_type: "image/png".to_string(),
            size_bytes: 7,
            mime_inferred: false,
        })
        .unwrap_err();
        assert_eq!(
            error.reason_code(),
            AppHostArtifactReadReasonCode::RuntimeUntrusted
        );
    }

    #[test]
    fn app_host_artifact_status_mapping_is_typed_and_fail_closed() {
        for (code, expected, retryable) in [
            (
                tonic::Code::InvalidArgument,
                AppHostArtifactReadReasonCode::InvalidInput,
                false,
            ),
            (
                tonic::Code::PermissionDenied,
                AppHostArtifactReadReasonCode::Forbidden,
                false,
            ),
            (
                tonic::Code::Unavailable,
                AppHostArtifactReadReasonCode::RuntimeUnavailable,
                true,
            ),
            (
                tonic::Code::Unknown,
                AppHostArtifactReadReasonCode::RuntimeUntrusted,
                false,
            ),
        ] {
            let error = map_app_host_artifact_status(tonic::Status::new(code, "redacted"));
            assert_eq!(error.reason_code(), expected);
            assert_eq!(error.retryable(), retryable);
            assert!(!error.to_string().contains("redacted"));
        }
    }
}
