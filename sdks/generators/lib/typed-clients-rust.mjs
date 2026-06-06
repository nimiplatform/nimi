import { generatedBy, writeText } from './context.mjs';
import {
  openApiSuccessSchema,
  pascalCase,
  protoTypeKind,
  quote,
  realmOperationTypeBase,
  rustDefaultExpr,
  rustFieldName,
  rustOpenApiFieldType,
  rustOpenApiType,
  rustProtoType,
  runtimeEnumSchemas,
  runtimeMessageSchemas,
  snakeCase,
  uniqueRuntimeMessageTypes,
} from './types.mjs';

export function writeRustTypedClients(runtime, realm) {
  const runtimeEnums = runtimeEnumSchemas(runtime)
    .map((schema) => {
      const variants = schema.values.map((value) => `    ${pascalCase(value)},`).join('\n') || '    Unspecified,';
      const defaultVariant = schema.values[0] ? pascalCase(schema.values[0]) : 'Unspecified';
      return `#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ${schema.name} {
${variants}
}

impl Default for ${schema.name} {
    fn default() -> Self {
        Self::${defaultVariant}
    }
}`;
    })
    .join('\n\n');
  const runtimeTypes = runtimeMessageSchemas(runtime)
    .map((schema) => {
      const fields = schema.fields.map((field) => `    pub ${rustFieldName(field.name)}: ${rustProtoType(field, runtime)},`).join('\n');
      const encoders = schema.fields.map((field) => {
        if (field.repeated || field.type === 'map') return '';
        const kind = protoTypeKind(field.type, runtime);
        if (field.type === 'string' || field.type === 'google.protobuf.Timestamp' || field.type === 'google.protobuf.Duration') return `        if let Some(value) = &self.${rustFieldName(field.name)} { pairs.push(format!("${field.name}={}", value)); }`;
        if (['bool', 'int32', 'int64', 'uint32', 'uint64', 'sint32', 'sint64', 'fixed32', 'fixed64', 'sfixed32', 'sfixed64', 'float', 'double'].includes(field.type)) return `        if let Some(value) = &self.${rustFieldName(field.name)} { pairs.push(format!("${field.name}={}", value)); }`;
        if (kind === 'enum') return `        if let Some(value) = &self.${rustFieldName(field.name)} { pairs.push(format!("${field.name}={:?}", value)); }`;
        return '';
      }).filter(Boolean).join('\n');
      const decoders = schema.fields.map((field) => {
        if (field.repeated || field.type === 'map') return '';
        if (field.type === 'string' || field.type === 'google.protobuf.Timestamp' || field.type === 'google.protobuf.Duration') return `        out.${rustFieldName(field.name)} = pairs.get("${field.name}").cloned();`;
        if (field.type === 'bool') return `        out.${rustFieldName(field.name)} = pairs.get("${field.name}").and_then(|value| value.parse().ok());`;
        if (['int32', 'int64', 'uint32', 'uint64', 'sint32', 'sint64', 'fixed32', 'fixed64', 'sfixed32', 'sfixed64', 'float', 'double'].includes(field.type)) return `        out.${rustFieldName(field.name)} = pairs.get("${field.name}").and_then(|value| value.parse().ok());`;
        return '';
      }).filter(Boolean).join('\n');
      const toTransportBody = encoders
        ? `        let mut pairs: Vec<String> = Vec::new();
${encoders}
        pairs.join(";").into_bytes()`
        : '        Vec::new()';
      const fromTransportBody = decoders
        ? `        let pairs = parse_pairs(raw);
        let mut out = Self::default();
${decoders}
        out`
        : `        let _ = raw;
        Self::default()`;
      return `#[derive(Clone, Debug, Default, PartialEq)]
pub struct ${schema.name} {
${fields}
}

impl ${schema.name} {
    pub fn to_transport(&self) -> Vec<u8> {
${toTransportBody}
    }

    pub fn from_transport(raw: &[u8]) -> Self {
${fromTransportBody}
    }
}`;
    })
    .join('\n\n');
  const runtimeMethods = runtime.codec_maps.map((method) => {
    const name = snakeCase(method.method);
    if (method.kind === 'unary') {
      return `    pub fn ${name}(&self, request: ${method.request_type}, metadata: CoreMetadata, timeout: Option<std::time::Duration>) -> Result<${method.response_type}, T::Error> {
        let raw = self.core.unary(CoreUnaryRequest {
            method_id: ${quote(method.method_id)}.to_string(),
            metadata,
            body: request.to_transport(),
            timeout,
        })?;
        Ok(${method.response_type}::from_transport(&raw))
    }`;
    }
    if (method.kind === 'server_stream') {
      return `    pub fn ${name}(&self, request: ${method.request_type}, metadata: CoreMetadata, timeout: Option<std::time::Duration>) -> Result<RuntimeTypedStream<T::Stream, ${method.response_type}>, T::Error>
    where
        T::Stream: CoreTypedStream,
    {
        let inner = self.core.server_stream(CoreStreamRequest {
            method_id: ${quote(method.method_id)}.to_string(),
            metadata,
            body: request.to_transport(),
            timeout,
        })?;
        Ok(RuntimeTypedStream { inner, _response: std::marker::PhantomData })
    }`;
    }
    return `    pub fn ${name}(&self, _request: ${method.request_type}, _metadata: CoreMetadata, _timeout: Option<std::time::Duration>) -> Result<${method.response_type}, T::Error> {
        panic!("SDK_RUNTIME_METHOD_UNAVAILABLE: Runtime method kind is not supported by the unary/server-stream core transport: ${method.method_id}");
    }`;
  }).join('\n\n');
  const realmModels = (realm.model_schemas || []).map((model) => {
    if (model.schema.kind !== 'object') return `pub type ${model.name} = ${rustOpenApiType(model.schema)};`;
    const fields = model.schema.properties.map((property) => `    pub ${rustFieldName(snakeCase(property.name))}: ${rustOpenApiFieldType(property.schema)},`).join('\n');
    return `#[derive(Clone, Debug, Default, PartialEq)]
pub struct ${model.name} {\n${fields}\n}`;
  }).join('\n\n');
  const realmTypes = realm.operations.map((operation) => {
    const base = realmOperationTypeBase(operation.operation_id);
    const pathFields = (operation.path_parameters || []).map((parameter) => `    pub ${rustFieldName(snakeCase(parameter.name))}: ${rustOpenApiType(parameter.schema)},`).join('\n');
    const queryFields = (operation.query_parameters || []).map((parameter) => `    pub ${rustFieldName(snakeCase(parameter.name))}: Option<${rustOpenApiType(parameter.schema)}>,`).join('\n');
    const headerFields = (operation.header_parameters || []).map((parameter) => `    pub ${rustFieldName(snakeCase(parameter.name))}: Option<${rustOpenApiType(parameter.schema)}>,`).join('\n');
    return `#[derive(Clone, Debug, Default, PartialEq)]
pub struct ${base}Path {\n${pathFields}\n}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct ${base}Query {\n${queryFields}\n}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct ${base}Headers {\n${headerFields}\n}

#[derive(Clone, Debug, Default, PartialEq)]
pub struct ${base}Request {
    pub path: ${base}Path,
    pub query: ${base}Query,
    pub headers: ${base}Headers,
    pub body: ${rustOpenApiType(operation.request_schema)},
}`;
  }).join('\n\n');
  const realmMethods = realm.operations.map((operation) => {
    const base = realmOperationTypeBase(operation.operation_id);
    const responseType = rustOpenApiType(openApiSuccessSchema(operation));
    return `    pub fn ${snakeCase(operation.operation_id)}(&self, request: ${base}Request, metadata: CoreMetadata, timeout: Option<std::time::Duration>) -> Result<${responseType}, T::Error> {
        let raw = self.core.unary(CoreUnaryRequest {
            method_id: ${quote(operation.operation_id)}.to_string(),
            metadata,
            body: format!("{:?}", request).into_bytes(),
            timeout,
        })?;
        let _ = raw;
        Ok(${rustDefaultExpr(responseType)})
    }`;
  }).join('\n\n');
  writeText('sdks/rust/core_generated/typed_clients.rs', `// @generated by ${generatedBy}
// DO NOT EDIT MANUALLY.

use std::collections::BTreeMap;

use crate::core_client::{CoreClient, CoreTransport};
use crate::types::{CoreMetadata, CoreStreamRequest, CoreUnaryRequest};

fn parse_pairs(raw: &[u8]) -> BTreeMap<String, String> {
    let text = String::from_utf8_lossy(raw);
    let mut out = BTreeMap::new();
    for pair in text.split(';') {
        if pair.is_empty() {
            continue;
        }
        if let Some((key, value)) = pair.split_once('=') {
            out.insert(key.to_string(), value.to_string());
        }
    }
    out
}

${runtimeEnums}

${runtimeTypes}

pub trait CoreTypedStream {
    fn recv_typed_payload(&mut self) -> Option<Vec<u8>>;
}

pub struct RuntimeTypedStream<S, R>
where
    S: CoreTypedStream,
{
    inner: S,
    _response: std::marker::PhantomData<R>,
}

impl<S, R> RuntimeTypedStream<S, R>
where
    S: CoreTypedStream,
    R: From<Vec<u8>>,
{
    pub fn recv(&mut self) -> Option<R> {
        self.inner.recv_typed_payload().map(R::from)
    }
}

${uniqueRuntimeMessageTypes(runtime).map((name) => `impl From<Vec<u8>> for ${name} {
    fn from(body: Vec<u8>) -> Self {
        Self::from_transport(&body)
    }
}`).join('\n\n')}

pub struct RuntimeTypedClient<T, A>
where
    T: CoreTransport,
    A: Fn() -> CoreMetadata,
{
    core: CoreClient<T, A>,
}

impl<T, A> RuntimeTypedClient<T, A>
where
    T: CoreTransport,
    A: Fn() -> CoreMetadata,
{
    pub fn new(core: CoreClient<T, A>) -> Self {
        Self { core }
    }

${runtimeMethods}
}

${realmModels}

${realmTypes}

pub struct RealmTypedClient<T, A>
where
    T: CoreTransport,
    A: Fn() -> CoreMetadata,
{
    core: CoreClient<T, A>,
}

impl<T, A> RealmTypedClient<T, A>
where
    T: CoreTransport,
    A: Fn() -> CoreMetadata,
{
    pub fn new(core: CoreClient<T, A>) -> Self {
        Self { core }
    }

${realmMethods}
}
`);
}
