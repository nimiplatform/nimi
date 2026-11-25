use std::time::Duration;

use prost::bytes::{Buf, BufMut};
use tokio::sync::mpsc;
use tonic::codec::{Codec, DecodeBuf, Decoder, EncodeBuf, Encoder};
use tonic::transport::Channel;
use tonic::Status;

use crate::grpc_status::local_app_error_from_status;
use crate::{
    LocalAppAgentSessionRequest, LocalAppAgentSessionStreamReceiver, LocalAppOperationError,
    LocalAppReasonCode,
};

// @nimi-authority: rule.nimi.runtime.agent-participation.p-agp-011
const BODY_STEP_METHOD_ID: &str = "/nimi.runtime.v1.AgentSessionService/StreamLocalAgentBodyStep";
const BODY_STEP_MAX_REQUEST_BYTES: usize = 2 * 1024 * 1024;
const BODY_STEP_MAX_TIMEOUT: Duration = Duration::from_secs(600);
const DEFAULT_UNARY_MAX_TIMEOUT: Duration = Duration::from_secs(300);

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

pub(crate) fn admitted_unary_method(method_id: &str) -> Option<&'static str> {
    match method_id.trim() {
        "/nimi.runtime.v1.AgentSessionService/RouteAndSubmitInput" => {
            Some("/nimi.runtime.v1.AgentSessionService/RouteAndSubmitInput")
        }
        "/nimi.runtime.v1.AgentSessionService/SplitOrRedirectInput" => {
            Some("/nimi.runtime.v1.AgentSessionService/SplitOrRedirectInput")
        }
        "/nimi.runtime.v1.AgentSessionService/GetSession" => {
            Some("/nimi.runtime.v1.AgentSessionService/GetSession")
        }
        "/nimi.runtime.v1.AgentSessionService/ListSessions" => {
            Some("/nimi.runtime.v1.AgentSessionService/ListSessions")
        }
        "/nimi.runtime.v1.AgentSessionService/UpdateSession" => {
            Some("/nimi.runtime.v1.AgentSessionService/UpdateSession")
        }
        "/nimi.runtime.v1.AgentSessionService/DeleteSession" => {
            Some("/nimi.runtime.v1.AgentSessionService/DeleteSession")
        }
        "/nimi.runtime.v1.AgentSessionService/StopBrainSessionTurn" => {
            Some("/nimi.runtime.v1.AgentSessionService/StopBrainSessionTurn")
        }
        "/nimi.runtime.v1.AgentSessionService/RegisterBodyCarrier" => {
            Some("/nimi.runtime.v1.AgentSessionService/RegisterBodyCarrier")
        }
        "/nimi.runtime.v1.AgentSessionService/HeartbeatBodyCarrier" => {
            Some("/nimi.runtime.v1.AgentSessionService/HeartbeatBodyCarrier")
        }
        "/nimi.runtime.v1.AgentSessionService/UnregisterBodyCarrier" => {
            Some("/nimi.runtime.v1.AgentSessionService/UnregisterBodyCarrier")
        }
        "/nimi.runtime.v1.AgentSessionService/AckBodyOutbox" => {
            Some("/nimi.runtime.v1.AgentSessionService/AckBodyOutbox")
        }
        "/nimi.runtime.v1.AgentSessionService/AuthorizeBodySideEffect" => {
            Some("/nimi.runtime.v1.AgentSessionService/AuthorizeBodySideEffect")
        }
        "/nimi.runtime.v1.AgentSessionService/ReportBodySessionProjection" => {
            Some("/nimi.runtime.v1.AgentSessionService/ReportBodySessionProjection")
        }
        "/nimi.runtime.v1.AgentSessionService/CreateAlarm" => {
            Some("/nimi.runtime.v1.AgentSessionService/CreateAlarm")
        }
        "/nimi.runtime.v1.AgentSessionService/ListAlarms" => {
            Some("/nimi.runtime.v1.AgentSessionService/ListAlarms")
        }
        "/nimi.runtime.v1.AgentSessionService/UpdateAlarm" => {
            Some("/nimi.runtime.v1.AgentSessionService/UpdateAlarm")
        }
        "/nimi.runtime.v1.AgentSessionService/DeleteAlarm" => {
            Some("/nimi.runtime.v1.AgentSessionService/DeleteAlarm")
        }
        _ => None,
    }
}

pub(crate) fn admitted_stream_method(method_id: &str) -> Option<&'static str> {
    match method_id.trim() {
        "/nimi.runtime.v1.AgentSessionService/WatchSessionOverview" => {
            Some("/nimi.runtime.v1.AgentSessionService/WatchSessionOverview")
        }
        "/nimi.runtime.v1.AgentSessionService/SubscribeBrainSessionEvents" => {
            Some("/nimi.runtime.v1.AgentSessionService/SubscribeBrainSessionEvents")
        }
        "/nimi.runtime.v1.AgentSessionService/SubscribeBodyOutbox" => {
            Some("/nimi.runtime.v1.AgentSessionService/SubscribeBodyOutbox")
        }
        "/nimi.runtime.v1.AgentSessionService/StreamLocalAgentBodyStep" => {
            Some("/nimi.runtime.v1.AgentSessionService/StreamLocalAgentBodyStep")
        }
        _ => None,
    }
}

pub(crate) async fn invoke_unary(
    channel: Channel,
    request: LocalAppAgentSessionRequest,
) -> Result<Vec<u8>, LocalAppOperationError> {
    let Some(method) = admitted_unary_method(&request.method_id) else {
        return Err(LocalAppOperationError::new(
            LocalAppReasonCode::OperationUnsupported,
            false,
        ));
    };
    if request
        .timeout
        .is_some_and(|value| value.is_zero() || value > DEFAULT_UNARY_MAX_TIMEOUT)
    {
        return Err(LocalAppOperationError::new(
            LocalAppReasonCode::InvalidInput,
            false,
        ));
    }
    let mut grpc = crate::grpc_limits::runtime_raw_client(channel);
    grpc.ready().await.map_err(|_| {
        LocalAppOperationError::new(LocalAppReasonCode::RuntimeServiceUnavailable, true)
    })?;
    let mut tonic_request = tonic::Request::new(request.request_bytes);
    if let Some(timeout) = request.timeout {
        tonic_request.set_timeout(timeout);
    }
    let response = grpc
        .unary(
            tonic_request,
            tonic::codegen::http::uri::PathAndQuery::from_static(method),
            RawBytesCodec,
        )
        .await
        .map_err(local_app_error_from_status)?;
    Ok(response.into_inner())
}

pub(crate) async fn open_stream(
    channel: Channel,
    request: LocalAppAgentSessionRequest,
) -> Result<LocalAppAgentSessionStreamReceiver, LocalAppOperationError> {
    let Some(method) = admitted_stream_method(&request.method_id) else {
        return Err(LocalAppOperationError::new(
            LocalAppReasonCode::OperationUnsupported,
            false,
        ));
    };
    if method == BODY_STEP_METHOD_ID {
        if request.request_bytes.len() > BODY_STEP_MAX_REQUEST_BYTES {
            return Err(LocalAppOperationError::new(
                LocalAppReasonCode::RequestTooLarge,
                false,
            ));
        }
        if request
            .timeout
            .is_some_and(|value| value.is_zero() || value > BODY_STEP_MAX_TIMEOUT)
        {
            return Err(LocalAppOperationError::new(
                LocalAppReasonCode::InvalidInput,
                false,
            ));
        }
    } else if request.timeout.is_some_and(|value| value.is_zero()) {
        // Long-lived AgentSessionService streams (WatchSessionOverview, SubscribeBodyOutbox,
        // SubscribeBrainSessionEvents) are exempt from the 300s stream cap.
        return Err(LocalAppOperationError::new(
            LocalAppReasonCode::InvalidInput,
            false,
        ));
    }

    let mut grpc = crate::grpc_limits::runtime_raw_client(channel);
    grpc.ready().await.map_err(|_| {
        LocalAppOperationError::new(LocalAppReasonCode::RuntimeServiceUnavailable, true)
    })?;
    let mut tonic_request = tonic::Request::new(request.request_bytes);
    if let Some(timeout) = request
        .timeout
        .or_else(|| (method == BODY_STEP_METHOD_ID).then_some(BODY_STEP_MAX_TIMEOUT))
    {
        tonic_request.set_timeout(timeout);
    }
    let response = grpc
        .server_streaming(
            tonic_request,
            tonic::codegen::http::uri::PathAndQuery::from_static(method),
            RawBytesCodec,
        )
        .await
        .map_err(local_app_error_from_status)?;
    let mut stream = response.into_inner();
    let (sender, receiver) = mpsc::channel(32);
    tokio::spawn(async move {
        loop {
            let message = tokio::select! {
                biased;
                _ = sender.closed() => break,
                message = stream.message() => message,
            };
            match message {
                Ok(Some(bytes)) => {
                    if sender.send(Ok(bytes)).await.is_err() {
                        break;
                    }
                }
                Ok(None) => break,
                Err(status) => {
                    let _ = sender.send(Err(local_app_error_from_status(status))).await;
                    break;
                }
            }
        }
    });
    Ok(receiver)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn agent_session_allowlist_covers_exact_21_methods_and_rejects_unknowns() {
        for unary in [
            "/nimi.runtime.v1.AgentSessionService/RouteAndSubmitInput",
            "/nimi.runtime.v1.AgentSessionService/SplitOrRedirectInput",
            "/nimi.runtime.v1.AgentSessionService/GetSession",
            "/nimi.runtime.v1.AgentSessionService/ListSessions",
            "/nimi.runtime.v1.AgentSessionService/UpdateSession",
            "/nimi.runtime.v1.AgentSessionService/DeleteSession",
            "/nimi.runtime.v1.AgentSessionService/StopBrainSessionTurn",
            "/nimi.runtime.v1.AgentSessionService/RegisterBodyCarrier",
            "/nimi.runtime.v1.AgentSessionService/HeartbeatBodyCarrier",
            "/nimi.runtime.v1.AgentSessionService/UnregisterBodyCarrier",
            "/nimi.runtime.v1.AgentSessionService/AckBodyOutbox",
            "/nimi.runtime.v1.AgentSessionService/AuthorizeBodySideEffect",
            "/nimi.runtime.v1.AgentSessionService/ReportBodySessionProjection",
            "/nimi.runtime.v1.AgentSessionService/CreateAlarm",
            "/nimi.runtime.v1.AgentSessionService/ListAlarms",
            "/nimi.runtime.v1.AgentSessionService/UpdateAlarm",
            "/nimi.runtime.v1.AgentSessionService/DeleteAlarm",
        ] {
            assert_eq!(admitted_unary_method(unary), Some(unary));
            assert!(admitted_stream_method(unary).is_none());
        }
        for stream in [
            "/nimi.runtime.v1.AgentSessionService/WatchSessionOverview",
            "/nimi.runtime.v1.AgentSessionService/SubscribeBrainSessionEvents",
            "/nimi.runtime.v1.AgentSessionService/SubscribeBodyOutbox",
            "/nimi.runtime.v1.AgentSessionService/StreamLocalAgentBodyStep",
        ] {
            assert_eq!(admitted_stream_method(stream), Some(stream));
            assert!(admitted_unary_method(stream).is_none());
        }
        assert!(admitted_unary_method("/nimi.runtime.v1.AgentSessionService/Unknown").is_none());
        assert!(
            admitted_stream_method("/nimi.runtime.v1.RuntimeAuthService/OpenSession").is_none()
        );
    }
}
