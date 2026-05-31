use crate::core_client::{CoreClient, CoreTransport};
use crate::types::{CoreStreamRequest, CoreUnaryRequest};

pub struct RuntimeCore<T, A>
where
    T: CoreTransport,
    A: Fn() -> crate::types::CoreMetadata,
{
    client: CoreClient<T, A>,
}

impl<T, A> RuntimeCore<T, A>
where
    T: CoreTransport,
    A: Fn() -> crate::types::CoreMetadata,
{
    pub fn new(client: CoreClient<T, A>) -> Self {
        Self { client }
    }

    pub fn unary(&self, request: CoreUnaryRequest) -> Result<Vec<u8>, T::Error> {
        self.client.unary(request)
    }

    pub fn server_stream(&self, request: CoreStreamRequest) -> Result<T::Stream, T::Error> {
        self.client.server_stream(request)
    }
}

