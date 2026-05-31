use crate::core_client::{CoreClient, CoreTransport};
use crate::types::{CoreMetadata, CoreUnaryRequest};

pub struct RealmOperationRequest {
    pub operation_id: String,
    pub metadata: CoreMetadata,
    pub body: Vec<u8>,
}

pub struct RealmCore<T, A>
where
    T: CoreTransport,
    A: Fn() -> CoreMetadata,
{
    client: CoreClient<T, A>,
}

impl<T, A> RealmCore<T, A>
where
    T: CoreTransport,
    A: Fn() -> CoreMetadata,
{
    pub fn new(client: CoreClient<T, A>) -> Self {
        Self { client }
    }

    pub fn operation(&self, request: RealmOperationRequest) -> Result<Vec<u8>, T::Error> {
        self.client.unary(CoreUnaryRequest {
            method_id: request.operation_id,
            metadata: request.metadata,
            body: request.body,
            timeout: None,
        })
    }
}

