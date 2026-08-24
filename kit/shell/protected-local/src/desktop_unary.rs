use crate::first_party_profiles_generated::{
    BUNDLED_AVATAR_APP_ID, BUNDLED_AVATAR_NATIVE_PROFILE_MARKER,
    DESKTOP_ACCOUNT_PRODUCT_NATIVE_PROFILE_MARKER, DESKTOP_MACHINE_PRODUCT_NATIVE_PROFILE_MARKER,
};
use std::{collections::BTreeMap, time::Duration};

#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct DesktopUnaryError {
    reason_code: String,
    retryable: bool,
    reason_metadata: BTreeMap<String, String>,
}

impl DesktopUnaryError {
    fn new(reason_code: impl Into<String>, retryable: bool) -> Self {
        Self {
            reason_code: reason_code.into(),
            retryable,
            reason_metadata: BTreeMap::new(),
        }
    }

    fn with_reason_metadata(mut self, reason_metadata: BTreeMap<String, String>) -> Self {
        self.reason_metadata = reason_metadata;
        self
    }

    pub(crate) fn reason_code(&self) -> &str {
        self.reason_code.as_str()
    }

    pub(crate) const fn retryable(&self) -> bool {
        self.retryable
    }

    pub(crate) const fn reason_metadata(&self) -> &BTreeMap<String, String> {
        &self.reason_metadata
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum DesktopFirstPartyProfile {
    Machine,
    Account,
}

impl DesktopFirstPartyProfile {
    pub(crate) const fn marker(self) -> &'static str {
        match self {
            Self::Machine => DESKTOP_MACHINE_PRODUCT_NATIVE_PROFILE_MARKER,
            Self::Account => DESKTOP_ACCOUNT_PRODUCT_NATIVE_PROFILE_MARKER,
        }
    }
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
pub(crate) async fn invoke_first_party(
    channel: tonic::transport::Channel,
    profile: DesktopFirstPartyProfile,
    method_id: &'static str,
    request_bytes: Vec<u8>,
    timeout: Option<Duration>,
) -> Result<Vec<u8>, DesktopUnaryError> {
    invoke_inner(
        channel,
        method_id,
        request_bytes,
        timeout,
        Some(profile.marker()),
        false,
    )
    .await
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
pub(crate) async fn invoke_bundled_avatar(
    channel: tonic::transport::Channel,
    method_id: &'static str,
    request_bytes: Vec<u8>,
    timeout: Option<Duration>,
) -> Result<Vec<u8>, DesktopUnaryError> {
    invoke_inner(channel, method_id, request_bytes, timeout, None, true).await
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
async fn invoke_inner(
    channel: tonic::transport::Channel,
    method_id: &'static str,
    request_bytes: Vec<u8>,
    timeout: Option<Duration>,
    first_party_profile_marker: Option<&'static str>,
    bundled_avatar: bool,
) -> Result<Vec<u8>, DesktopUnaryError> {
    use prost::bytes::{Buf, BufMut};
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

    let mut grpc = crate::grpc_limits::runtime_raw_client(channel);
    grpc.ready()
        .await
        .map_err(|_| DesktopUnaryError::new("runtime-service-unavailable", true))?;
    let mut tonic_request = tonic::Request::new(request_bytes);
    if let Some(profile_marker) = first_party_profile_marker {
        tonic_request.metadata_mut().insert(
            "x-nimi-protected-first-party-profile",
            tonic::metadata::MetadataValue::from_static(profile_marker),
        );
        tonic_request.metadata_mut().insert(
            "x-nimi-app-id",
            tonic::metadata::MetadataValue::from_static("nimi.desktop"),
        );
    } else if bundled_avatar {
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
            let reason = if bundled_avatar {
                crate::grpc_status::bundled_avatar_runtime_reason(&status)
            } else {
                crate::grpc_status::runtime_reason(&status)
            };
            match reason {
                Some(reason) => DesktopUnaryError::new(reason, retryable),
                None => match status.code() {
                    tonic::Code::Unavailable
                    | tonic::Code::DeadlineExceeded
                    | tonic::Code::Cancelled => {
                        DesktopUnaryError::new("runtime-service-unavailable", retryable)
                    }
                    _ => DesktopUnaryError::new(
                        crate::grpc_status::RUNTIME_SERVICE_ERROR_UNCLASSIFIED,
                        retryable,
                    )
                    .with_reason_metadata(
                        crate::grpc_status::unclassified_status_metadata(&status),
                    ),
                },
            }
        })?;
    Ok(response.into_inner())
}
