use std::time::Duration;

use prost::bytes::{Buf, BufMut};
use tonic::codec::{Codec, DecodeBuf, Decoder, EncodeBuf, Encoder};
use tonic::{transport::Channel, Status};

use crate::desktop_unary::DesktopFirstPartyProfile;
use crate::first_party_profiles_generated::{
    BUNDLED_AVATAR_APP_ID, BUNDLED_AVATAR_NATIVE_PROFILE_MARKER,
};
use crate::{BundledAvatarRuntimeError, DesktopFirstPartyProductError};

#[derive(Debug, Default, Clone, Copy)]
struct RawBytesCodec;
#[derive(Debug, Default, Clone, Copy)]
struct RawBytesEncoder;
#[derive(Debug, Default, Clone, Copy)]
struct RawBytesDecoder;

impl Codec for RawBytesCodec {
    type Encode = Vec<u8>;
    type Decode = Vec<u8>;
    type Encoder = RawBytesEncoder;
    type Decoder = RawBytesDecoder;

    fn encoder(&mut self) -> Self::Encoder {
        RawBytesEncoder
    }

    fn decoder(&mut self) -> Self::Decoder {
        RawBytesDecoder
    }
}

impl Encoder for RawBytesEncoder {
    type Item = Vec<u8>;
    type Error = Status;

    fn encode(
        &mut self,
        item: Self::Item,
        destination: &mut EncodeBuf<'_>,
    ) -> Result<(), Self::Error> {
        destination.put_slice(item.as_slice());
        Ok(())
    }
}

impl Decoder for RawBytesDecoder {
    type Item = Vec<u8>;
    type Error = Status;

    fn decode(&mut self, source: &mut DecodeBuf<'_>) -> Result<Option<Self::Item>, Self::Error> {
        let mut value = vec![0_u8; source.remaining()];
        source.copy_to_slice(value.as_mut_slice());
        Ok(Some(value))
    }
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
pub(crate) async fn invoke_first_party(
    channel: Channel,
    profile: DesktopFirstPartyProfile,
    method_id: &'static str,
    request_frames: Vec<Vec<u8>>,
    timeout: Option<Duration>,
) -> Result<Vec<u8>, DesktopFirstPartyProductError> {
    let response = invoke(
        channel,
        method_id,
        request_frames,
        timeout,
        "x-nimi-protected-first-party-profile",
        profile.marker(),
        "nimi.desktop",
    )
    .await
    .map_err(map_first_party_status)?;
    Ok(response)
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
pub(crate) async fn invoke_bundled_avatar(
    channel: Channel,
    method_id: &'static str,
    request_frames: Vec<Vec<u8>>,
    timeout: Option<Duration>,
) -> Result<Vec<u8>, BundledAvatarRuntimeError> {
    invoke(
        channel,
        method_id,
        request_frames,
        timeout,
        "x-nimi-protected-bundled-profile",
        BUNDLED_AVATAR_NATIVE_PROFILE_MARKER,
        BUNDLED_AVATAR_APP_ID,
    )
    .await
    .map_err(map_bundled_avatar_status)
}

async fn invoke(
    channel: Channel,
    method_id: &'static str,
    request_frames: Vec<Vec<u8>>,
    timeout: Option<Duration>,
    profile_header: &'static str,
    profile_marker: &'static str,
    app_id: &'static str,
) -> Result<Vec<u8>, Status> {
    let mut grpc = crate::grpc_limits::runtime_raw_client(channel);
    grpc.ready()
        .await
        .map_err(|error| Status::unavailable(error.to_string()))?;
    let mut request = tonic::Request::new(tokio_stream::iter(request_frames));
    request.metadata_mut().insert(
        profile_header,
        tonic::metadata::MetadataValue::from_static(profile_marker),
    );
    request.metadata_mut().insert(
        "x-nimi-app-id",
        tonic::metadata::MetadataValue::from_static(app_id),
    );
    if let Some(timeout) = timeout {
        request.set_timeout(timeout);
    }
    let response = grpc
        .client_streaming(
            request,
            tonic::codegen::http::uri::PathAndQuery::from_static(method_id),
            RawBytesCodec,
        )
        .await?;
    Ok(response.into_inner())
}

fn map_first_party_status(status: Status) -> DesktopFirstPartyProductError {
    let retryable = retryable(&status);
    match crate::grpc_status::runtime_reason(&status) {
        Some(reason) => DesktopFirstPartyProductError::new(reason, retryable),
        None => unclassified_first_party(status, retryable),
    }
}

fn map_bundled_avatar_status(status: Status) -> BundledAvatarRuntimeError {
    let retryable = retryable(&status);
    match crate::grpc_status::bundled_avatar_runtime_reason(&status) {
        Some(reason) => BundledAvatarRuntimeError::new(reason, retryable),
        None => match status.code() {
            tonic::Code::Unavailable | tonic::Code::DeadlineExceeded | tonic::Code::Cancelled => {
                BundledAvatarRuntimeError::new("runtime-service-unavailable", retryable)
            }
            _ => BundledAvatarRuntimeError::new(
                crate::grpc_status::RUNTIME_SERVICE_ERROR_UNCLASSIFIED,
                retryable,
            )
            .with_reason_metadata(crate::grpc_status::unclassified_status_metadata(&status)),
        },
    }
}

fn unclassified_first_party(status: Status, retryable: bool) -> DesktopFirstPartyProductError {
    match status.code() {
        tonic::Code::Unavailable | tonic::Code::DeadlineExceeded | tonic::Code::Cancelled => {
            DesktopFirstPartyProductError::new("runtime-service-unavailable", retryable)
        }
        _ => DesktopFirstPartyProductError::new(
            crate::grpc_status::RUNTIME_SERVICE_ERROR_UNCLASSIFIED,
            retryable,
        )
        .with_reason_metadata(crate::grpc_status::unclassified_status_metadata(&status)),
    }
}

fn retryable(status: &Status) -> bool {
    matches!(
        status.code(),
        tonic::Code::Unavailable
            | tonic::Code::DeadlineExceeded
            | tonic::Code::Cancelled
            | tonic::Code::ResourceExhausted
    )
}
