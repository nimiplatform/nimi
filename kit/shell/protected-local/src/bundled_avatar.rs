use crate::{
    bundled_avatar_profile_generated::{
        bundled_avatar_method_profile, BundledAvatarMethodKind,
    },
    desktop_unary,
};
use std::time::Duration;
use tokio::sync::mpsc;
use tonic::transport::Channel;

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BundledAvatarRuntimeError {
    reason_code: String,
    retryable: bool,
}

impl BundledAvatarRuntimeError {
    pub(crate) fn new(reason_code: impl Into<String>, retryable: bool) -> Self {
        Self { reason_code: reason_code.into(), retryable }
    }

    pub fn reason_code(&self) -> &str { self.reason_code.as_str() }
    pub const fn retryable(&self) -> bool { self.retryable }
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BundledAvatarRuntimeRequest {
    pub method_id: String,
    pub request_bytes: Vec<u8>,
    pub timeout: Option<Duration>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct BundledAvatarRuntimeResponse {
    pub response_bytes: Vec<u8>,
}

pub type BundledAvatarRuntimeStreamReceiver =
    mpsc::Receiver<Result<Vec<u8>, BundledAvatarRuntimeError>>;

pub(crate) async fn invoke(
    channel: Channel,
    request: BundledAvatarRuntimeRequest,
) -> Result<BundledAvatarRuntimeResponse, BundledAvatarRuntimeError> {
    let Some(profile) = bundled_avatar_method_profile(request.method_id.trim()) else {
        return Err(BundledAvatarRuntimeError::new("runtime-service-untrusted", false));
    };
    if profile.kind != BundledAvatarMethodKind::Unary || !timeout_allowed(request.timeout) {
        return Err(BundledAvatarRuntimeError::new("runtime-service-untrusted", false));
    }
    let response_bytes = desktop_unary::invoke_bundled_avatar(
        channel,
        profile.method_id,
        request.request_bytes,
        request.timeout,
    )
    .await
    .map_err(|error| BundledAvatarRuntimeError::new(error.reason_code(), error.retryable()))?;
    Ok(BundledAvatarRuntimeResponse { response_bytes })
}

pub(crate) async fn open_stream(
    channel: Channel,
    request: BundledAvatarRuntimeRequest,
) -> Result<BundledAvatarRuntimeStreamReceiver, BundledAvatarRuntimeError> {
    let Some(profile) = bundled_avatar_method_profile(request.method_id.trim()) else {
        return Err(BundledAvatarRuntimeError::new("runtime-service-untrusted", false));
    };
    if profile.kind != BundledAvatarMethodKind::ServerStream || !timeout_allowed(request.timeout) {
        return Err(BundledAvatarRuntimeError::new("runtime-service-untrusted", false));
    }
    crate::desktop_stream::open_bundled_avatar(
        channel,
        profile.method_id,
        request.request_bytes,
        request.timeout,
    )
    .await
}

fn timeout_allowed(timeout: Option<Duration>) -> bool {
    timeout.is_none_or(|value| !value.is_zero() && value <= Duration::from_secs(300))
}
