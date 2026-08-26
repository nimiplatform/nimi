use std::time::Duration;
use tonic::client::Grpc;
use tonic::transport::{Channel, Endpoint};

use crate::generated::runtime_account_service_client::RuntimeAccountServiceClient;
use crate::generated::runtime_agent_service_client::RuntimeAgentServiceClient;
use crate::generated::runtime_ai_realtime_service_client::RuntimeAiRealtimeServiceClient;
use crate::generated::runtime_ai_service_client::RuntimeAiServiceClient;
use crate::generated::runtime_app_service_client::RuntimeAppServiceClient;
use crate::generated::runtime_auth_service_client::RuntimeAuthServiceClient;
use crate::generated::runtime_development_service_client::RuntimeDevelopmentServiceClient;
use crate::generated::runtime_realm_realtime_service_client::RuntimeRealmRealtimeServiceClient;
use crate::generated::runtime_service_control_service_client::RuntimeServiceControlServiceClient;

pub const RUNTIME_MAX_INLINE_PAYLOAD_BYTES: usize = 32 * 1024 * 1024;
pub const RUNTIME_GRPC_MESSAGE_HEADROOM_BYTES: usize = 1024 * 1024;
pub const RUNTIME_GRPC_MAX_MESSAGE_BYTES: usize =
    RUNTIME_MAX_INLINE_PAYLOAD_BYTES + RUNTIME_GRPC_MESSAGE_HEADROOM_BYTES;

// @nimi-authority: rule.nimi.desktop.shell-runtime.r011
pub(crate) fn protected_runtime_endpoint() -> Endpoint {
    Endpoint::from_static("http://[::]:50051")
        .http2_keep_alive_interval(Duration::from_secs(10))
        .keep_alive_timeout(Duration::from_secs(5))
        .keep_alive_while_idle(true)
}

pub fn runtime_raw_client(channel: Channel) -> Grpc<Channel> {
    Grpc::new(channel)
        .max_encoding_message_size(RUNTIME_GRPC_MAX_MESSAGE_BYTES)
        .max_decoding_message_size(RUNTIME_GRPC_MAX_MESSAGE_BYTES)
}

macro_rules! limited_runtime_client {
    ($function:ident, $client:ident) => {
        pub(crate) fn $function(channel: Channel) -> $client<Channel> {
            $client::new(channel)
                .max_encoding_message_size(RUNTIME_GRPC_MAX_MESSAGE_BYTES)
                .max_decoding_message_size(RUNTIME_GRPC_MAX_MESSAGE_BYTES)
        }
    };
}

limited_runtime_client!(runtime_account_client, RuntimeAccountServiceClient);
limited_runtime_client!(runtime_agent_client, RuntimeAgentServiceClient);
limited_runtime_client!(runtime_ai_client, RuntimeAiServiceClient);
limited_runtime_client!(runtime_ai_realtime_client, RuntimeAiRealtimeServiceClient);
limited_runtime_client!(runtime_app_client, RuntimeAppServiceClient);
limited_runtime_client!(runtime_auth_client, RuntimeAuthServiceClient);
limited_runtime_client!(runtime_development_client, RuntimeDevelopmentServiceClient);
limited_runtime_client!(
    runtime_realm_realtime_client,
    RuntimeRealmRealtimeServiceClient
);
limited_runtime_client!(
    runtime_service_control_client,
    RuntimeServiceControlServiceClient
);

#[cfg(test)]
mod tests {
    use prost::Message;
    use tokio::net::TcpListener;
    use tokio_stream::wrappers::TcpListenerStream;
    use tonic::transport::{Endpoint, Server};

    use super::{
        runtime_raw_client, RUNTIME_GRPC_MAX_MESSAGE_BYTES, RUNTIME_MAX_INLINE_PAYLOAD_BYTES,
    };

    mod probe {
        tonic::include_proto!("nimi.carrier.test");
    }

    #[derive(Default)]
    struct EchoCarrier;

    #[tonic::async_trait]
    impl probe::carrier_probe_server::CarrierProbe for EchoCarrier {
        async fn echo(
            &self,
            request: tonic::Request<probe::CarrierPayload>,
        ) -> Result<tonic::Response<probe::CarrierPayload>, tonic::Status> {
            Ok(tonic::Response::new(request.into_inner()))
        }
    }

    #[tokio::test]
    async fn exact_inline_payload_round_trips_with_real_tonic_envelope() {
        let listener = TcpListener::bind("127.0.0.1:0")
            .await
            .expect("bind carrier probe");
        let address = listener.local_addr().expect("carrier probe address");
        let (shutdown_tx, shutdown_rx) = tokio::sync::oneshot::channel::<()>();
        let service = probe::carrier_probe_server::CarrierProbeServer::new(EchoCarrier)
            .max_encoding_message_size(RUNTIME_GRPC_MAX_MESSAGE_BYTES)
            .max_decoding_message_size(RUNTIME_GRPC_MAX_MESSAGE_BYTES);
        let server = tokio::spawn(async move {
            Server::builder()
                .add_service(service)
                .serve_with_incoming_shutdown(TcpListenerStream::new(listener), async move {
                    let _ = shutdown_rx.await;
                })
                .await
        });

        let channel = Endpoint::from_shared(format!("http://{address}"))
            .expect("carrier endpoint")
            .connect()
            .await
            .expect("connect carrier probe");
        let mut grpc = runtime_raw_client(channel);
        grpc.ready().await.expect("carrier ready");
        let request = probe::CarrierPayload {
            payload: vec![0x5a; RUNTIME_MAX_INLINE_PAYLOAD_BYTES],
        };
        assert!(request.encoded_len() > RUNTIME_MAX_INLINE_PAYLOAD_BYTES);
        assert!(request.encoded_len() < RUNTIME_GRPC_MAX_MESSAGE_BYTES);
        let response: tonic::Response<probe::CarrierPayload> = grpc
            .unary(
                tonic::Request::new(request),
                tonic::codegen::http::uri::PathAndQuery::from_static(
                    "/nimi.carrier.test.CarrierProbe/Echo",
                ),
                tonic_prost::ProstCodec::default(),
            )
            .await
            .expect("32 MiB payload plus protobuf and gRPC envelope must cross the carrier");
        assert_eq!(
            response.into_inner().payload.len(),
            RUNTIME_MAX_INLINE_PAYLOAD_BYTES
        );

        let _ = shutdown_tx.send(());
        server
            .await
            .expect("join carrier probe")
            .expect("serve carrier probe");
    }
}
