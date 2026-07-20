use std::time::Duration;
use crate::bundled_avatar_profile_generated::{
    BUNDLED_AVATAR_APP_ID, BUNDLED_AVATAR_NATIVE_PROFILE_MARKER,
};

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct DesktopUnaryError {
    reason_code: String,
    retryable: bool,
}

impl DesktopUnaryError {
    fn new(reason_code: impl Into<String>, retryable: bool) -> Self {
        Self {
            reason_code: reason_code.into(),
            retryable,
        }
    }

    pub(crate) fn reason_code(&self) -> &str {
        self.reason_code.as_str()
    }

    pub(crate) const fn retryable(&self) -> bool {
        self.retryable
    }
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
pub(crate) async fn invoke(
    channel: tonic::transport::Channel,
    method_id: &'static str,
    request_bytes: Vec<u8>,
    timeout: Option<Duration>,
) -> Result<Vec<u8>, DesktopUnaryError> {
    invoke_inner(channel, method_id, request_bytes, timeout, false).await
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
pub(crate) async fn invoke_bundled_avatar(
    channel: tonic::transport::Channel,
    method_id: &'static str,
    request_bytes: Vec<u8>,
    timeout: Option<Duration>,
) -> Result<Vec<u8>, DesktopUnaryError> {
    invoke_inner(channel, method_id, request_bytes, timeout, true).await
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
async fn invoke_inner(
    channel: tonic::transport::Channel,
    method_id: &'static str,
    request_bytes: Vec<u8>,
    timeout: Option<Duration>,
    bundled_avatar: bool,
) -> Result<Vec<u8>, DesktopUnaryError> {
    use prost::bytes::{Buf, BufMut};
    use tonic::client::Grpc;
    use tonic::codec::{Codec, DecodeBuf, Decoder, EncodeBuf, Encoder};
    use tonic::Status;

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

        fn decode(
            &mut self,
            source: &mut DecodeBuf<'_>,
        ) -> Result<Option<Self::Item>, Self::Error> {
            let mut value = vec![0_u8; source.remaining()];
            source.copy_to_slice(value.as_mut_slice());
            Ok(Some(value))
        }
    }

    let mut grpc = Grpc::new(channel).max_decoding_message_size(32 * 1024 * 1024);
    grpc.ready()
        .await
        .map_err(|_| DesktopUnaryError::new("runtime-service-unavailable", true))?;
    let mut tonic_request = tonic::Request::new(request_bytes);
    if bundled_avatar {
        tonic_request.metadata_mut().insert(
            "x-nimi-protected-bundled-profile",
            tonic::metadata::MetadataValue::from_static(BUNDLED_AVATAR_NATIVE_PROFILE_MARKER),
        );
        tonic_request.metadata_mut().insert(
            "x-nimi-app-id",
            tonic::metadata::MetadataValue::from_static(BUNDLED_AVATAR_APP_ID),
        );
    }
    if let Some(timeout) = timeout {
        tonic_request.set_timeout(timeout);
    }
    let response = grpc
        .unary(
            tonic_request,
            tonic::codegen::http::uri::PathAndQuery::from_static(method_id),
            RawBytesCodec,
        )
        .await
        .map_err(|status| {
            let retryable = matches!(
                status.code(),
                tonic::Code::Unavailable
                    | tonic::Code::DeadlineExceeded
                    | tonic::Code::Cancelled
                    | tonic::Code::ResourceExhausted
            );
            let reason =
                crate::grpc_status::runtime_reason(&status).unwrap_or_else(|| {
                    match status.code() {
                        tonic::Code::Unavailable
                        | tonic::Code::DeadlineExceeded
                        | tonic::Code::Cancelled => "runtime-service-unavailable".to_string(),
                        _ => "runtime-service-untrusted".to_string(),
                    }
                });
            DesktopUnaryError::new(reason, retryable)
        })?;
    Ok(response.into_inner())
}
