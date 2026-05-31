use crate::types::{CoreMetadata, CoreStreamRequest, CoreUnaryRequest};

pub trait CoreTransport {
    type Stream;
    type Error;

    fn unary(&self, request: CoreUnaryRequest) -> Result<Vec<u8>, Self::Error>;
    fn server_stream(&self, request: CoreStreamRequest) -> Result<Self::Stream, Self::Error>;
}

pub struct CoreClient<T, A>
where
    T: CoreTransport,
    A: Fn() -> CoreMetadata,
{
    transport: T,
    auth_metadata: Option<A>,
}

impl<T, A> CoreClient<T, A>
where
    T: CoreTransport,
    A: Fn() -> CoreMetadata,
{
    pub fn new(transport: T, auth_metadata: Option<A>) -> Self {
        Self {
            transport,
            auth_metadata,
        }
    }

    pub fn unary(&self, mut request: CoreUnaryRequest) -> Result<Vec<u8>, T::Error> {
        request.metadata = self.metadata(request.metadata);
        self.transport.unary(request)
    }

    pub fn server_stream(&self, mut request: CoreStreamRequest) -> Result<T::Stream, T::Error> {
        request.metadata = self.metadata(request.metadata);
        self.transport.server_stream(request)
    }

    pub fn unsafe_raw(&self) -> &T {
        &self.transport
    }

    fn metadata(&self, metadata: CoreMetadata) -> CoreMetadata {
        let mut merged = match &self.auth_metadata {
            Some(provider) => provider(),
            None => CoreMetadata::new(),
        };
        for (key, value) in metadata {
            merged.insert(key, value);
        }
        merged
    }
}

