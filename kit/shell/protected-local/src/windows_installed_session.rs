use std::future::Future;
use std::pin::Pin;

use tonic::transport::Channel;

use crate::generated::runtime_auth_service_client::RuntimeAuthServiceClient;
use crate::generated::OpenDesktopLaunchedAppSessionRequest;
use crate::windows_peer_trust::VerifiedRuntimePeer;
use crate::windows_service_control::open_verified_runtime_channel;
use crate::{
    NimiInstalledAppCarrier, NimiInstalledAppSession, ProtectedCarrierError,
    ProtectedCarrierReasonCode,
};

const RUNTIME_INSTALLED_PIPE_NAME: &str = r"\\.\pipe\nimi-runtime-installed-v1";

#[derive(Clone, Copy, Debug, Default)]
pub struct WindowsInstalledAppCarrier;

struct WindowsInstalledAppSession {
    _channel: Channel,
    _runtime_peer: VerifiedRuntimePeer,
    _session_id: [u8; 32],
    _session_proof: [u8; 32],
    _runtime_boot_epoch: [u8; 32],
}

impl NimiInstalledAppSession for WindowsInstalledAppSession {}

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
        _channel: channel,
        _runtime_peer: runtime_peer,
        _session_id: session_id,
        _session_proof: session_proof,
        _runtime_boot_epoch: runtime_boot_epoch,
    }))
}

fn untrusted() -> ProtectedCarrierError {
    ProtectedCarrierError::new(ProtectedCarrierReasonCode::RuntimeServiceUntrusted, false)
}
