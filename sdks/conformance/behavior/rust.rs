use std::cell::RefCell;
use std::collections::BTreeMap;
use std::time::Duration;

use crate::core_client::CoreTransport;
use crate::core_generated::realm_client::RealmGeneratedClient;
use crate::core_generated::runtime_client::RuntimeGeneratedClient;
use crate::core_generated::typed_clients::{
    AccountCaller, BeginLoginRequest, CoreTypedStream, LocalAgentProvisionIntentAckDto,
    RealmAckMyLocalAgentProvisionIntentOperationPath, RealmAckMyLocalAgentProvisionIntentOperationRequest,
    RealmTypedClient, RuntimeTypedClient, SubscribeAccountSessionEventsRequest,
};
use crate::types::{CoreMetadata, CoreStreamRequest, CoreUnaryRequest};

#[derive(Clone)]
struct FakeStream {
    events: Vec<Vec<u8>>,
    index: usize,
}

impl FakeStream {
    fn recv(&mut self) -> Option<Vec<u8>> {
        if self.index >= self.events.len() {
            return None;
        }
        let event = self.events[self.index].clone();
        self.index += 1;
        Some(event)
    }
}

impl CoreTypedStream for FakeStream {
    fn recv_typed_payload(&mut self) -> Option<Vec<u8>> {
        self.recv()
    }
}

#[derive(Default)]
struct FakeTransport {
    unary_calls: RefCell<Vec<CoreUnaryRequest>>,
    stream_calls: RefCell<Vec<CoreStreamRequest>>,
}

impl CoreTransport for FakeTransport {
    type Stream = FakeStream;
    type Error = String;

    fn unary(&self, request: CoreUnaryRequest) -> Result<Vec<u8>, Self::Error> {
        self.unary_calls.borrow_mut().push(request.clone());
        if String::from_utf8_lossy(&request.body).contains("redirect_uri=force-error") {
            return Err("SDK_RUNTIME_METHOD_UNAVAILABLE: typed conformance error: fixture=typed-core".to_string());
        }
        if std::env::var("SDKS_CONFORMANCE_PROFILE").ok().as_deref() == Some("typed-core") {
            if request.method_id.contains("BeginLogin") {
                return Ok(b"accepted=true;login_attempt_id=login-conformance;callback_origin=https://app.example".to_vec());
            }
            if request.method_id == "ackMyLocalAgentProvisionIntent" {
                return Ok(b"source=realm-operation;ok=true".to_vec());
            }
        }
        Ok(format!("response:{}", request.method_id).into_bytes())
    }

    fn server_stream(&self, request: CoreStreamRequest) -> Result<Self::Stream, Self::Error> {
        self.stream_calls.borrow_mut().push(request);
        if std::env::var("SDKS_CONFORMANCE_PROFILE").ok().as_deref() == Some("typed-core") {
            return Ok(FakeStream {
                events: vec![
                    b"event_id=event-1;sequence=1".to_vec(),
                    b"event_id=event-2;sequence=2".to_vec(),
                ],
                index: 0,
            });
        }
        Ok(FakeStream {
            events: vec![b"event:1".to_vec(), b"event:2".to_vec()],
            index: 0,
        })
    }
}

fn auth_metadata() -> CoreMetadata {
    let mut metadata = BTreeMap::new();
    metadata.insert("x-nimi-access-token-id".to_string(), "conformance-token-id".to_string());
    metadata
}

#[test]
fn generated_clients_use_fake_transport() {
    if std::env::var("SDKS_CONFORMANCE_PROFILE").ok().as_deref() == Some("typed-core") {
        let runtime_core = crate::core_client::CoreClient::new(FakeTransport::default(), Some(auth_metadata));
        let runtime = RuntimeTypedClient::new(runtime_core);
        let mut metadata = BTreeMap::new();
        metadata.insert("x-nimi-caller".to_string(), "sdks-conformance".to_string());
        let nested_request_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _ = runtime.begin_login(
                BeginLoginRequest {
                    caller: Some(Box::new(AccountCaller {
                        app_id: Some("app-conformance".to_string()),
                        mode: Some(Default::default()),
                        scopes: vec!["account.login".to_string()],
                        ..Default::default()
                    })),
                    ..Default::default()
                },
                BTreeMap::new(),
                None,
            );
        }));
        assert!(nested_request_result.is_err());

        let response = runtime
            .begin_login(
                BeginLoginRequest {
                    redirect_uri: Some("https://app.example/callback".to_string()),
                    callback_origin: Some("https://app.example".to_string()),
                    ttl_seconds: Some(60),
                    ..Default::default()
                },
                metadata,
                Some(Duration::from_millis(1234)),
            )
            .expect("typed runtime call");
        assert_eq!(response.accepted, Some(true));
        assert_eq!(response.login_attempt_id.as_deref(), Some("login-conformance"));

        let stream_core = crate::core_client::CoreClient::new(FakeTransport::default(), Some(auth_metadata));
        let runtime_stream = RuntimeTypedClient::new(stream_core);
        let mut stream = runtime_stream
            .subscribe_account_session_events(
                SubscribeAccountSessionEventsRequest {
                    after_sequence: Some(0),
                    ..Default::default()
                },
                BTreeMap::new(),
                None,
            )
            .expect("typed runtime stream");
        let first = stream.recv().expect("first typed event");
        assert_eq!(first.event_id.as_deref(), Some("event-1"));
        let second = stream.recv().expect("second typed event");
        assert_eq!(second.event_id.as_deref(), Some("event-2"));
        assert!(stream.recv().is_none());

        let realm_core = crate::core_client::CoreClient::new(FakeTransport::default(), Some(auth_metadata));
        let realm = RealmTypedClient::new(realm_core);
        let realm_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            realm
            .ack_my_local_agent_provision_intent(
                RealmAckMyLocalAgentProvisionIntentOperationRequest {
                    path: RealmAckMyLocalAgentProvisionIntentOperationPath { intent_id: "intent-conformance".to_string() },
                    body: LocalAgentProvisionIntentAckDto { outcome: "established".to_string(), detail: "ok".to_string() },
                    ..Default::default()
                },
                BTreeMap::new(),
                None,
            )
        }));
        assert!(realm_result.is_err());
        let error = runtime
            .begin_login(BeginLoginRequest { redirect_uri: Some("force-error".to_string()), ..Default::default() }, BTreeMap::new(), None)
            .expect_err("typed structured error");
        assert!(error.contains("SDK_RUNTIME_METHOD_UNAVAILABLE"));
        assert!(error.contains("typed conformance error"));
        assert!(error.contains("fixture=typed-core"));
        return;
    }

    let runtime_method = crate::core_generated::runtime_client::RUNTIME_METHODS
        .iter()
        .find(|method| method.kind == "unary")
        .expect("unary method");
    let stream_method = crate::core_generated::runtime_client::RUNTIME_METHODS
        .iter()
        .find(|method| method.kind == "server_stream")
        .expect("stream method");
    let realm_operation = crate::core_generated::realm_client::REALM_OPERATIONS
        .first()
        .expect("realm operation");

    let runtime_core = crate::core_client::CoreClient::new(FakeTransport::default(), Some(auth_metadata));
    let runtime = RuntimeGeneratedClient::new(runtime_core);
    let mut metadata = BTreeMap::new();
    metadata.insert("x-nimi-caller".to_string(), "sdks-conformance".to_string());
    let response = runtime
        .call(
            runtime_method.method_id,
            b"runtime-body".to_vec(),
            metadata,
            Some(Duration::from_millis(1234)),
        )
        .expect("runtime call");
    assert!(String::from_utf8(response).expect("utf8").contains(runtime_method.method_id));

    let stream_core = crate::core_client::CoreClient::new(FakeTransport::default(), Some(auth_metadata));
    let runtime_stream = RuntimeGeneratedClient::new(stream_core);
    let mut stream = runtime_stream
        .stream(stream_method.method_id, b"stream-body".to_vec(), BTreeMap::new(), None)
        .expect("runtime stream");
    assert_eq!(stream.recv(), Some(b"event:1".to_vec()));
    assert_eq!(stream.recv(), Some(b"event:2".to_vec()));
    assert_eq!(stream.recv(), None);

    let realm_core = crate::core_client::CoreClient::new(FakeTransport::default(), Some(auth_metadata));
    let realm = RealmGeneratedClient::new(realm_core);
    let realm_response = realm
        .operation(realm_operation.operation_id, b"realm-body".to_vec(), BTreeMap::new(), None)
        .expect("realm operation");
    assert!(String::from_utf8(realm_response).expect("utf8").contains(realm_operation.operation_id));
}
