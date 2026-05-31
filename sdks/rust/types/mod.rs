use std::collections::BTreeMap;
use std::time::Duration;

pub type CoreMetadata = BTreeMap<String, String>;

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum CoreMethodKind {
    Unary,
    ServerStream,
    ClientStream,
    BidiStream,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CoreUnaryRequest {
    pub method_id: String,
    pub metadata: CoreMetadata,
    pub body: Vec<u8>,
    pub timeout: Option<Duration>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CoreStreamRequest {
    pub method_id: String,
    pub metadata: CoreMetadata,
    pub body: Vec<u8>,
    pub timeout: Option<Duration>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct CoreErrorShape {
    pub code: String,
    pub message: String,
    pub details: Option<Vec<u8>>,
}

