use super::*;
use crate::generated::{
    OpenLocalAppSessionResponse, WriteLocalAppStorageJsonRequest, WriteLocalAppStorageJsonResponse,
};
use hyper_util::rt::TokioIo;
use std::{
    convert::Infallible,
    sync::{atomic::AtomicUsize, Arc},
    task::{Context, Poll},
};
use tokio::sync::Notify;
use tokio_stream::wrappers::TcpListenerStream;
use tonic::{
    body::Body,
    codegen::http,
    server::{NamedService, UnaryService},
    Request, Response, Status,
};
use tower::{service_fn, Service};

#[derive(Default)]
struct RuntimeState {
    scope: AtomicUsize,
    writes: Mutex<Vec<(String, usize)>>,
    rebinds: AtomicUsize,
}

#[derive(Clone)]
struct RuntimeService<const AUTH: bool>(Arc<RuntimeState>);
impl<const AUTH: bool> NamedService for RuntimeService<AUTH> {
    const NAME: &'static str = if AUTH {
        "nimi.runtime.v1.RuntimeAuthService"
    } else {
        "nimi.runtime.v1.RuntimeAppService"
    };
}
impl<const AUTH: bool> Service<http::Request<Body>> for RuntimeService<AUTH> {
    type Response = http::Response<Body>;
    type Error = Infallible;
    type Future = Pin<Box<dyn Future<Output = Result<Self::Response, Self::Error>> + Send>>;
    fn poll_ready(&mut self, _: &mut Context<'_>) -> Poll<Result<(), Self::Error>> {
        Poll::Ready(Ok(()))
    }
    fn call(&mut self, request: http::Request<Body>) -> Self::Future {
        let state = self.0.clone();
        Box::pin(async move {
            if AUTH {
                assert_eq!(
                    request.uri().path(),
                    "/nimi.runtime.v1.RuntimeAuthService/RebindLocalAppSession"
                );
                let mut grpc = tonic::server::Grpc::new(tonic_prost::ProstCodec::default());
                Ok(grpc.unary(Rebind(state), request).await)
            } else {
                assert_eq!(
                    request.uri().path(),
                    "/nimi.runtime.v1.RuntimeAppService/WriteLocalAppStorageJson"
                );
                let mut grpc = tonic::server::Grpc::new(tonic_prost::ProstCodec::default());
                Ok(grpc.unary(Write(state), request).await)
            }
        })
    }
}
struct Write(Arc<RuntimeState>);
impl UnaryService<WriteLocalAppStorageJsonRequest> for Write {
    type Response = WriteLocalAppStorageJsonResponse;
    type Future = Pin<Box<dyn Future<Output = Result<Response<Self::Response>, Status>> + Send>>;
    fn call(&mut self, request: Request<WriteLocalAppStorageJsonRequest>) -> Self::Future {
        let state = self.0.clone();
        Box::pin(async move {
            let request = request.into_inner();
            state
                .writes
                .lock()
                .await
                .push((request.relative_path, state.scope.load(Ordering::Acquire)));
            Ok(Response::new(WriteLocalAppStorageJsonResponse {
                size_bytes: request.json_value.len() as i64,
                json_value: request.json_value,
                reason_code: ACTION_EXECUTED,
            }))
        })
    }
}
struct Rebind(Arc<RuntimeState>);
impl UnaryService<RebindLocalAppSessionRequest> for Rebind {
    type Response = OpenLocalAppSessionResponse;
    type Future = Pin<Box<dyn Future<Output = Result<Response<Self::Response>, Status>> + Send>>;
    fn call(&mut self, _: Request<RebindLocalAppSessionRequest>) -> Self::Future {
        let state = self.0.clone();
        Box::pin(async move {
            state.rebinds.fetch_add(1, Ordering::AcqRel);
            state.scope.store(1, Ordering::Release);
            Ok(Response::new(OpenLocalAppSessionResponse {
                state: LOCAL_APP_SESSION_READY,
                reason_code: ACTION_EXECUTED,
                current_user: None,
                current_user_reason_code: CURRENT_USER_DISPLAY_UNAVAILABLE,
            }))
        })
    }
}

fn view(channel: Channel) -> PlatformLocalAppSession {
    PlatformLocalAppSession {
        channel,
        operation_gate: RwLock::new(()),
        session_maintenance: Mutex::new(()),
        session_bound: AtomicBool::new(true),
        account_required: AtomicBool::new(false),
        retired: AtomicBool::new(false),
        current_user: RwLock::new(unavailable_current_user()),
    }
}
fn write(name: &str) -> LocalAppStorageWriteRequest {
    LocalAppStorageWriteRequest {
        relative_path: name.into(),
        value: serde_json::json!({"content":"original-request"}),
    }
}

#[tokio::test(flavor = "current_thread")]
async fn rebind_drains_a_write_waiting_for_tonic_transport_and_old_views_never_write_in_new_scope()
{
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let state = Arc::new(RuntimeState::default());
    let stop = Arc::new(Notify::new());
    let stopping = stop.clone();
    let server_state = state.clone();
    let server = tokio::spawn(async move {
        tonic::transport::Server::builder()
            .add_service(RuntimeService::<true>(server_state.clone()))
            .add_service(RuntimeService::<false>(server_state))
            .serve_with_incoming_shutdown(TcpListenerStream::new(listener), stopping.notified())
            .await
            .unwrap();
    });
    let queued = Arc::new(Notify::new());
    let proceed = Arc::new(Notify::new());
    let entered = queued.clone();
    let release = proceed.clone();
    let channel = tonic::transport::Endpoint::from_static("http://127.0.0.1:1")
        .connect_with_connector_lazy(service_fn(move |_| {
            let entered = entered.clone();
            let release = release.clone();
            async move {
                entered.notify_one();
                release.notified().await;
                Ok::<_, std::io::Error>(TokioIo::new(
                    tokio::net::TcpStream::connect(address).await?,
                ))
            }
        }));
    let old = Arc::new(view(channel));
    let writing = old.clone();
    let queued_write =
        tokio::spawn(async move { writing.storage_write_json(write("queued.json")).await });
    tokio::time::timeout(Duration::from_secs(2), queued.notified())
        .await
        .unwrap();
    tokio::time::timeout(Duration::from_secs(2), async {
        loop {
            if old.operation_gate.try_write().is_err() {
                break;
            }
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    let delayed = old.storage_write_json(write("late-old.json"));
    let rebinding = old.clone();
    let rebound = tokio::spawn(async move { rebinding.rebind_session().await });
    tokio::time::timeout(Duration::from_secs(2), async {
        while !old.retired.load(Ordering::Acquire) {
            tokio::task::yield_now().await;
        }
    })
    .await
    .unwrap();
    assert!(
        !rebound.is_finished(),
        "exclusive rebind must wait for the queued old unary"
    );
    assert_eq!(state.rebinds.load(Ordering::Acquire), 0);
    proceed.notify_one();
    tokio::time::timeout(Duration::from_secs(2), queued_write)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    let fresh = tokio::time::timeout(Duration::from_secs(2), rebound)
        .await
        .unwrap()
        .unwrap()
        .unwrap();
    // A deferred old view (as used by native asset-write spawn) cannot acquire B.
    let late_old = delayed.await.unwrap_err();
    assert_eq!(
        late_old.reason_code(),
        LocalAppReasonCode::RuntimeUnauthenticated
    );
    fresh
        .session
        .storage_write_json(write("fresh.json"))
        .await
        .unwrap();
    assert_eq!(
        *state.writes.lock().await,
        vec![("queued.json".into(), 0), ("fresh.json".into(), 1)]
    );
    assert_eq!(state.rebinds.load(Ordering::Acquire), 1);
    stop.notify_one();
    server.await.unwrap();
}
