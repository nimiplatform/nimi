use std::cell::RefCell;
use std::collections::BTreeMap;
use std::time::Duration;

use crate::core_client::CoreTransport;
use crate::core_generated::realm_client::RealmGeneratedClient;
use crate::core_generated::runtime_client::RuntimeGeneratedClient;
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
        Ok(format!("response:{}", request.method_id).into_bytes())
    }

    fn server_stream(&self, request: CoreStreamRequest) -> Result<Self::Stream, Self::Error> {
        self.stream_calls.borrow_mut().push(request);
        Ok(FakeStream {
            events: vec![b"event:1".to_vec(), b"event:2".to_vec()],
            index: 0,
        })
    }
}

fn auth_metadata() -> CoreMetadata {
    let mut metadata = BTreeMap::new();
    metadata.insert("authorization".to_string(), "Bearer conformance".to_string());
    metadata
}

#[test]
fn generated_clients_use_fake_transport() {
    let runtime_method = crate::core_generated::runtime_client::RUNTIME_METHODS
        .iter()
        .find(|method| method.kind == "unary")
        .expect("unary method");
    let stream_method = crate::core_generated::runtime_client::RUNTIME_METHODS
        .iter()
        .find(|method| method.kind.contains("stream"))
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

