use crate::{
    first_party_profiles_generated::{BUNDLED_AVATAR_APP_ID, BUNDLED_AVATAR_NATIVE_PROFILE_MARKER},
    BundledAvatarRuntimeError,
};
use std::time::Duration;
use tokio::sync::mpsc;

#[cfg(any(target_os = "windows", target_os = "macos"))]
pub(crate) async fn open_first_party(
    channel: tonic::transport::Channel,
    profile: crate::desktop_unary::DesktopFirstPartyProfile,
    method_id: &'static str,
    request_bytes: Vec<u8>,
    timeout: Option<Duration>,
) -> Result<
    mpsc::Receiver<Result<Vec<u8>, crate::DesktopFirstPartyProductError>>,
    crate::DesktopFirstPartyProductError,
> {
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
    grpc.ready().await.map_err(|_| {
        crate::DesktopFirstPartyProductError::new("runtime-service-unavailable", true)
    })?;
    let mut request = tonic::Request::new(request_bytes);
    request.metadata_mut().insert(
        "x-nimi-protected-first-party-profile",
        tonic::metadata::MetadataValue::from_static(profile.marker()),
    );
    request.metadata_mut().insert(
        "x-nimi-app-id",
        tonic::metadata::MetadataValue::from_static("nimi.desktop"),
    );
    if let Some(timeout) = timeout {
        request.set_timeout(timeout);
    }
    let response = grpc
        .server_streaming(
            request,
            tonic::codegen::http::uri::PathAndQuery::from_static(method_id),
            RawBytesCodec,
        )
        .await
        .map_err(map_first_party_status)?;
    let mut stream = response.into_inner();
    let (sender, receiver) = mpsc::channel(32);
    tokio::spawn(async move {
        loop {
            match stream.message().await {
                Ok(Some(bytes)) => {
                    if sender.send(Ok(bytes)).await.is_err() {
                        break;
                    }
                }
                Ok(None) => break,
                Err(status) => {
                    let _ = sender.send(Err(map_first_party_status(status))).await;
                    break;
                }
            }
        }
    });
    Ok(receiver)
}

fn map_first_party_status(status: tonic::Status) -> crate::DesktopFirstPartyProductError {
    let retryable = matches!(
        status.code(),
        tonic::Code::Unavailable
            | tonic::Code::DeadlineExceeded
            | tonic::Code::Cancelled
            | tonic::Code::ResourceExhausted
    );
    match crate::grpc_status::runtime_reason(&status) {
        Some(reason) => crate::DesktopFirstPartyProductError::new(reason, retryable),
        None => match status.code() {
            tonic::Code::Unavailable | tonic::Code::DeadlineExceeded | tonic::Code::Cancelled => {
                crate::DesktopFirstPartyProductError::new("runtime-service-unavailable", retryable)
            }
            _ => crate::DesktopFirstPartyProductError::new(
                crate::grpc_status::RUNTIME_SERVICE_ERROR_UNCLASSIFIED,
                retryable,
            )
            .with_reason_metadata(crate::grpc_status::unclassified_status_metadata(&status)),
        },
    }
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
pub(crate) async fn open_bundled_avatar(
    channel: tonic::transport::Channel,
    method_id: &'static str,
    request_bytes: Vec<u8>,
    timeout: Option<Duration>,
) -> Result<mpsc::Receiver<Result<Vec<u8>, BundledAvatarRuntimeError>>, BundledAvatarRuntimeError> {
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
        .map_err(|_| BundledAvatarRuntimeError::new("runtime-service-unavailable", true))?;
    let mut request = tonic::Request::new(request_bytes);
    request.metadata_mut().insert(
        "x-nimi-protected-bundled-profile",
        tonic::metadata::MetadataValue::from_static(BUNDLED_AVATAR_NATIVE_PROFILE_MARKER),
    );
    request.metadata_mut().insert(
        "x-nimi-app-id",
        tonic::metadata::MetadataValue::from_static(BUNDLED_AVATAR_APP_ID),
    );
    if let Some(timeout) = timeout {
        request.set_timeout(timeout);
    }
    let response = grpc
        .server_streaming(
            request,
            tonic::codegen::http::uri::PathAndQuery::from_static(method_id),
            RawBytesCodec,
        )
        .await
        .map_err(map_status)?;
    let mut stream = response.into_inner();
    let (sender, receiver) = mpsc::channel(32);
    tokio::spawn(async move {
        loop {
            match stream.message().await {
                Ok(Some(bytes)) => {
                    if sender.send(Ok(bytes)).await.is_err() {
                        break;
                    }
                }
                Ok(None) => break,
                Err(status) => {
                    let _ = sender.send(Err(map_status(status))).await;
                    break;
                }
            }
        }
    });
    Ok(receiver)
}

fn map_status(status: tonic::Status) -> BundledAvatarRuntimeError {
    let retryable = matches!(
        status.code(),
        tonic::Code::Unavailable
            | tonic::Code::DeadlineExceeded
            | tonic::Code::Cancelled
            | tonic::Code::ResourceExhausted
    );
    match crate::grpc_status::runtime_reason(&status) {
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bare_first_party_stream_status_is_unclassified_with_raw_code() {
        let error = map_first_party_status(tonic::Status::internal("private runtime detail"));
        assert_eq!(
            error.reason_code(),
            crate::grpc_status::RUNTIME_SERVICE_ERROR_UNCLASSIFIED
        );
        assert_eq!(
            error
                .reason_metadata()
                .get("grpc_status_code")
                .map(String::as_str),
            Some("13")
        );
        assert!(!error
            .reason_metadata()
            .values()
            .any(|value| value.contains("private")));
    }

    #[test]
    fn explicit_runtime_reason_is_not_reclassified() {
        let status = tonic::Status::unavailable("transport unavailable");
        let error = map_first_party_status(status);
        assert_eq!(error.reason_code(), "runtime-service-unavailable");
        assert!(error.reason_metadata().is_empty());
    }
}
