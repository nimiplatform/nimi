use std::collections::BTreeMap;
use std::time::Duration;

use crate::core_client::CoreTransport;
use crate::core_generated::typed_clients::{
    AccountCaller, BeginLoginRequest, CoreTypedStream, RealmCheckHandleOperationHeaders,
    RealmCheckHandleOperationPath, RealmCheckHandleOperationQuery,
    RealmCheckHandleOperationRequest, RealmGetMutualFriendsCountOperationRequest,
    RealmGetMyTiersOperationRequest, RealmTypedClient, RealmTypedClientError, RuntimeTypedClient,
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
                message: "transport failure".to_string(),
                details: Some(b"fixture=typed-core".to_vec()),
            });
        }
        if request.method_id == "checkHandle" {
            assert_eq!(
                request
                    .metadata
                    .get("x-nimi-access-token-id")
                    .map(String::as_str),
                Some("conformance-token-id")
            );
            assert_eq!(
                request.metadata.get("x-nimi-caller").map(String::as_str),
                Some("sdks-conformance")
            );
            if body == "query.handle=realm-malformed" {
                return Ok(b"available=not-a-boolean;message=malformed".to_vec());
            }
            assert_eq!(request.timeout, Some(Duration::from_millis(1234)));
            assert_eq!(body, "query.handle=realm-conformance");
            return Ok(b"available=true;message=available".to_vec());
        }
        if request.method_id == "getMyTiers" {
            return Ok(match request.metadata.get("x-nullable-case").map(String::as_str) {
                Some("missing") => b"assetTier=1;influenceTier=2;interactionTier=3;userId=user-nullable;vitalityScore=4".to_vec(),
                Some("wrong-scalar") => b"assetTier=not-a-number;influenceTier=2;interactionTier=3;lastUpdatedAt=null;userId=user-nullable;vitalityScore=4".to_vec(),
                _ => b"assetTier=1;influenceTier=2;interactionTier=3;lastUpdatedAt=null;userId=user-nullable;vitalityScore=4".to_vec(),
            });
        }
        assert_eq!(
            request.method_id,
            "/nimi.runtime.v1.RuntimeAccountService/BeginLogin"
        );
        assert_eq!(
            request
                .metadata
                .get("x-nimi-access-token-id")
                .map(String::as_str),
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
    let runtime_core = crate::core_client::CoreClient::new(FakeTransport, Some(auth_metadata));
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

    let realm_core = crate::core_client::CoreClient::new(FakeTransport, Some(auth_metadata));
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

    let missing_query = realm
        .check_handle(
            RealmCheckHandleOperationRequest::default(),
            BTreeMap::new(),
            None,
        )
        .expect_err("missing required Realm query must be typed");
    assert!(matches!(
        missing_query,
        RealmTypedClientError::RequestEncode {
            operation_id: "checkHandle",
            field: "query.handle",
        }
    ));

    let empty_path = realm
        .get_mutual_friends_count(
            RealmGetMutualFriendsCountOperationRequest::default(),
            BTreeMap::new(),
            None,
        )
        .expect_err("empty required Realm path must be typed");
    assert!(matches!(
        empty_path,
        RealmTypedClientError::RequestEncode {
            operation_id: "getMutualFriendsCount",
            field: "path.id",
        }
    ));

    let mut malformed_metadata = BTreeMap::new();
    malformed_metadata.insert("x-nimi-caller".to_string(), "sdks-conformance".to_string());
    let malformed_response = realm
        .check_handle(
            RealmCheckHandleOperationRequest {
                path: RealmCheckHandleOperationPath::default(),
                query: RealmCheckHandleOperationQuery {
                    handle: Some("realm-malformed".to_string()),
                },
                headers: RealmCheckHandleOperationHeaders::default(),
                body: (),
            },
            malformed_metadata,
            None,
        )
        .expect_err("malformed Realm response must be typed");
    assert!(matches!(
        malformed_response,
        RealmTypedClientError::ResponseDecode {
            operation_id: "checkHandle",
            field: "available",
        }
    ));

    let tiers = realm
        .get_my_tiers(
            RealmGetMyTiersOperationRequest::default(),
            BTreeMap::new(),
            None,
        )
        .expect("required nullable Realm null");
    assert_eq!(tiers.last_updated_at, None);

    let mut missing_nullable_metadata = BTreeMap::new();
    missing_nullable_metadata.insert("x-nullable-case".to_string(), "missing".to_string());
    let missing_nullable = realm
        .get_my_tiers(
            RealmGetMyTiersOperationRequest::default(),
            missing_nullable_metadata,
            None,
        )
        .expect_err("missing required nullable Realm field must fail");
    assert!(matches!(
        missing_nullable,
        RealmTypedClientError::ResponseDecode {
            operation_id: "getMyTiers",
            field: "lastUpdatedAt",
        }
    ));

    let mut wrong_scalar_metadata = BTreeMap::new();
    wrong_scalar_metadata.insert("x-nullable-case".to_string(), "wrong-scalar".to_string());
    let wrong_scalar = realm
        .get_my_tiers(
            RealmGetMyTiersOperationRequest::default(),
            wrong_scalar_metadata,
            None,
        )
        .expect_err("wrong Realm scalar must fail");
    assert!(matches!(
        wrong_scalar,
        RealmTypedClientError::ResponseDecode {
            operation_id: "getMyTiers",
            field: "assetTier",
        }
    ));

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
    assert_eq!(
        error.details.as_deref(),
        Some(b"fixture=typed-core".as_slice())
    );
}
