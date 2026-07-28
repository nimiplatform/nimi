use std::collections::BTreeMap;
use std::time::Duration;

use crate::core_client::CoreTransport;
use crate::core_generated::typed_clients::{
    AccountCaller, BeginLoginRequest, CoreTypedStream, RealmCheckHandleOperationHeaders,
    RealmCheckHandleOperationPath, RealmCheckHandleOperationQuery,
    RealmCheckHandleOperationRequest, RealmTypedClient, RuntimeTypedClient,
    SubscribeAccountSessionEventsRequest,
};
use crate::types::{CoreErrorShape, CoreMetadata, CoreStreamRequest, CoreUnaryRequest};

#[derive(Clone)]
struct FakeStream {
    events: Vec<Vec<u8>>,
    index: usize,
}

impl CoreTypedStream for FakeStream {
    fn recv_typed_payload(&mut self) -> Option<Vec<u8>> {
        if self.index >= self.events.len() {
            return None;
        }
        let event = self.events[self.index].clone();
        self.index += 1;
        Some(event)
    }
}

#[derive(Default)]
struct FakeTransport;

impl CoreTransport for FakeTransport {
    type Stream = FakeStream;
    type Error = CoreErrorShape;

    fn unary(&self, request: CoreUnaryRequest) -> Result<Vec<u8>, Self::Error> {
        let body = String::from_utf8_lossy(&request.body);
        if body.contains("redirect_uri=force-error") {
            return Err(CoreErrorShape {
                code: "SDK_RUNTIME_METHOD_UNAVAILABLE".to_string(),
                message: "typed conformance error".to_string(),
                details: Some(b"fixture=typed-core".to_vec()),
            });
        }
        if request.method_id == "checkHandle" {
            assert_eq!(
                request.metadata.get("x-nimi-access-token-id").map(String::as_str),
                Some("conformance-token-id")
            );
            assert_eq!(
                request.metadata.get("x-nimi-caller").map(String::as_str),
                Some("sdks-conformance")
            );
            assert_eq!(request.timeout, Some(Duration::from_millis(1234)));
            assert_eq!(body, "query.handle=realm-conformance");
            return Ok(b"available=true;message=available".to_vec());
        }
        assert_eq!(
            request.method_id,
            "/nimi.runtime.v1.RuntimeAccountService/BeginLogin"
        );
        assert_eq!(
            request.metadata.get("x-nimi-access-token-id").map(String::as_str),
            Some("conformance-token-id")
        );
        assert_eq!(
            request.metadata.get("x-nimi-caller").map(String::as_str),
            Some("sdks-conformance")
        );
        assert_eq!(request.timeout, Some(Duration::from_millis(1234)));
        assert!(body.contains("caller.app_id=app-conformance"));
        assert!(body.contains("caller.scopes=account.login"));
        assert!(body.contains("redirect_uri=https://app.example/callback"));
        Ok(
            b"accepted=true;login_attempt_id=login-conformance;callback_origin=https://app.example"
                .to_vec(),
        )
    }

    fn server_stream(&self, request: CoreStreamRequest) -> Result<Self::Stream, Self::Error> {
        let body = String::from_utf8_lossy(&request.body);
        assert_eq!(
            request.method_id,
            "/nimi.runtime.v1.RuntimeAccountService/SubscribeAccountSessionEvents"
        );
        assert!(body.contains("caller.app_id=app-conformance"));
        assert!(body.contains("after_sequence=0"));
        Ok(FakeStream {
            events: vec![
                b"event_id=event-1;sequence=1".to_vec(),
                b"event_id=event-2;sequence=2".to_vec(),
            ],
            index: 0,
        })
    }
}

fn auth_metadata() -> CoreMetadata {
    let mut metadata = BTreeMap::new();
    metadata.insert(
        "x-nimi-access-token-id".to_string(),
        "conformance-token-id".to_string(),
    );
    metadata
}

fn account_caller() -> AccountCaller {
    AccountCaller {
        app_id: Some("app-conformance".to_string()),
        mode: Some(Default::default()),
        scopes: vec!["account.login".to_string()],
        ..Default::default()
    }
}

#[test]
fn typed_runtime_clients_preserve_requests_and_transport_behavior() {
    let runtime_core =
        crate::core_client::CoreClient::new(FakeTransport, Some(auth_metadata));
    let runtime = RuntimeTypedClient::new(runtime_core);
    let mut metadata = BTreeMap::new();
    metadata.insert("x-nimi-caller".to_string(), "sdks-conformance".to_string());
    let response = runtime
        .begin_login(
            BeginLoginRequest {
                caller: Some(Box::new(account_caller())),
                redirect_uri: Some("https://app.example/callback".to_string()),
                callback_origin: Some("https://app.example".to_string()),
                requested_scopes: vec!["openid".to_string(), "profile".to_string()],
                ttl_seconds: Some(60),
            },
            metadata,
            Some(Duration::from_millis(1234)),
        )
        .expect("typed runtime call");
    assert_eq!(response.accepted, Some(true));
    assert_eq!(
        response.login_attempt_id.as_deref(),
        Some("login-conformance")
    );

    let stream_core =
        crate::core_client::CoreClient::new(FakeTransport, Some(auth_metadata));
    let runtime_stream = RuntimeTypedClient::new(stream_core);
    let mut stream = runtime_stream
        .subscribe_account_session_events(
            SubscribeAccountSessionEventsRequest {
                caller: Some(Box::new(account_caller())),
                after_sequence: Some(0),
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

    let realm_core =
        crate::core_client::CoreClient::new(FakeTransport, Some(auth_metadata));
    let realm = RealmTypedClient::new(realm_core);
    let mut realm_metadata = BTreeMap::new();
    realm_metadata.insert("x-nimi-caller".to_string(), "sdks-conformance".to_string());
    let realm_response = realm
        .check_handle(
            RealmCheckHandleOperationRequest {
                path: RealmCheckHandleOperationPath::default(),
                query: RealmCheckHandleOperationQuery {
                    handle: Some("realm-conformance".to_string()),
                },
                headers: RealmCheckHandleOperationHeaders::default(),
                body: (),
            },
            realm_metadata,
            Some(Duration::from_millis(1234)),
        )
        .expect("typed Realm call");
    assert!(realm_response.available);
    assert_eq!(realm_response.message, "available");

    let error = runtime
        .begin_login(
            BeginLoginRequest {
                redirect_uri: Some("force-error".to_string()),
                ..Default::default()
            },
            BTreeMap::new(),
            None,
        )
        .expect_err("typed structured error");
    assert_eq!(error.code, "SDK_RUNTIME_METHOD_UNAVAILABLE");
    assert_eq!(error.details.as_deref(), Some(b"fixture=typed-core".as_slice()));
}
