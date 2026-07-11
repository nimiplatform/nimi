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

function resolveRealmSchema(schema, modelByName) {
  let current = schema;
  const visited = new Set();
  while (current?.kind === 'ref') {
    if (visited.has(current.ref_name)) throw new Error(`cyclic Realm model ref: ${current.ref_name}`);
    visited.add(current.ref_name);
    current = modelByName.get(current.ref_name);
    if (!current) throw new Error(`missing Realm model ref: ${schema.ref_name}`);
  }
  return current;
}

function realmSchemaAtPath(schema, segments, modelByName) {
  let current = schema;
  for (const segment of segments) {
    current = resolveRealmSchema(current, modelByName);
    if (current?.kind !== 'object') return null;
    current = (current.properties || []).find((property) => property.name === segment)?.schema;
    if (!current) return null;
  }
  return resolveRealmSchema(current, modelByName);
}

function renderRustRealmUnion(model, modelByName) {
  const variants = model.schema.variants || [];
  if (variants.length < 2 || variants.some((variant) => variant.kind !== 'ref')) {
    throw new Error(`Realm union ${model.name} must contain named variants`);
  }
  const rendered = variants.map((variant) => ({
    name: pascalCase(String(variant.ref_name).replace(/Dto$/u, '')),
    typeName: variant.ref_name,
    discriminatorValue: (() => {
      const path = String(model.schema.discriminator || 'kind').split('.').filter(Boolean);
      const discriminator = realmSchemaAtPath(modelByName.get(variant.ref_name), path, modelByName);
      if (discriminator?.kind !== 'enum' || discriminator.values?.length !== 1) {
        throw new Error(`Realm union ${model.name} variant ${variant.ref_name} has no closed discriminator`);
      }
      return discriminator.values[0];
    })(),
  }));
  if (new Set(rendered.map((variant) => variant.name)).size !== rendered.length) {
    throw new Error(`Realm union ${model.name} has duplicate Rust variant names`);
  }
  const first = rendered[0];
  return `#[derive(Clone, Debug, PartialEq)]
pub enum ${model.name} {
${rendered.map((variant) => `    ${variant.name}(Box<${variant.typeName}>),`).join('\n')}
}

impl Default for ${model.name} {
    fn default() -> Self {
        Self::${first.name}(Box::new(${first.typeName}::default()))
    }
}

impl ${model.name} {
    pub fn try_from_discriminator(value: &str) -> Result<Self, String> {
        match value {
${rendered.map((variant) => `            ${quote(variant.discriminatorValue)} => Ok(Self::${variant.name}(Box::new(${variant.typeName}::default()))),`).join('\n')}
            _ => Err(format!("SDK_REALM_RESPONSE_DECODE_FAILED: unknown ${model.name} discriminator {}", value)),
        }
    }
}`;
}

export function writeRustTypedClients(runtime, realm) {
  const realmModelByName = new Map((realm.model_schemas || []).map((model) => [model.name, model.schema]));
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
        if (field.repeated && field.type === 'string') return `        for value in &self.${rustFieldName(field.name)} { pairs.push(format!("${field.name}={}", value)); }`;
        if (field.repeated || field.type === 'map') return `        if !self.${rustFieldName(field.name)}.is_empty() { panic!("SDK_RUNTIME_REQUEST_ENCODE_FAILED: generated Rust typed client cannot encode ${field.name}"); }`;
        const kind = protoTypeKind(field.type, runtime);
        if (field.type === 'string' || field.type === 'google.protobuf.Timestamp' || field.type === 'google.protobuf.Duration') return `        if let Some(value) = &self.${rustFieldName(field.name)} { pairs.push(format!("${field.name}={}", value)); }`;
        if (['bool', 'int32', 'int64', 'uint32', 'uint64', 'sint32', 'sint64', 'fixed32', 'fixed64', 'sfixed32', 'sfixed64', 'float', 'double'].includes(field.type)) return `        if let Some(value) = &self.${rustFieldName(field.name)} { pairs.push(format!("${field.name}={}", value)); }`;
        if (kind === 'enum') return `        if let Some(value) = &self.${rustFieldName(field.name)} { pairs.push(format!("${field.name}={:?}", value)); }`;
        return `        if self.${rustFieldName(field.name)}.is_some() { panic!("SDK_RUNTIME_REQUEST_ENCODE_FAILED: generated Rust typed client cannot encode ${field.name}"); }`;
      }).filter(Boolean).join('\n');
      const decoderEntries = schema.fields.map((field) => {
        if (field.repeated && field.type === 'string') return `        out.${rustFieldName(field.name)} = parse_repeated_string(raw, "${field.name}");`;
        if (field.repeated || field.type === 'map') return '';
        if (field.type === 'string' || field.type === 'google.protobuf.Timestamp' || field.type === 'google.protobuf.Duration') return `        out.${rustFieldName(field.name)} = pairs.get("${field.name}").cloned();`;
        if (field.type === 'bool') return `        out.${rustFieldName(field.name)} = pairs.get("${field.name}").and_then(|value| value.parse().ok());`;
        if (['int32', 'int64', 'uint32', 'uint64', 'sint32', 'sint64', 'fixed32', 'fixed64', 'sfixed32', 'sfixed64', 'float', 'double'].includes(field.type)) return `        out.${rustFieldName(field.name)} = pairs.get("${field.name}").and_then(|value| value.parse().ok());`;
        return '';
      }).map((code, index) => ({ field: schema.fields[index], code }));
      const decodedFields = new Set(decoderEntries.filter((entry) => entry.code).map((entry) => entry.field.name));
      const decoders = decoderEntries.map((entry) => entry.code).filter(Boolean).join('\n');
      const toTransportBody = encoders
        ? `        let mut pairs: Vec<String> = Vec::new();
${encoders}
        pairs.join(";").into_bytes()`
        : '        Vec::new()';
      const unsupportedFields = schema.fields
        .filter((field) => (field.repeated && field.type !== 'string') || field.type === 'map' || !decodedFields.has(field.name))
        .map((field) => field.name);
      const unsupportedGuard = unsupportedFields.length
        ? `        for key in [${unsupportedFields.map((name) => quote(name)).join(', ')}] {
            if pairs.contains_key(key) {
                panic!("SDK_RUNTIME_RESPONSE_DECODE_FAILED: generated Rust typed client cannot decode {}", key);
            }
        }
`
        : '';
      const companionParticipationResponseTypes = new Set([
        'GetCompanionParticipationProjectionResponse',
        'RequestCompanionParticipationResponse',
        'CancelCompanionParticipationResponse',
        'OpenCompanionParticipationReplayResponse',
      ]);
      const fromTransportBody = companionParticipationResponseTypes.has(schema.name)
        ? `        if raw.is_empty() {
            panic!("SDK_RUNTIME_RESPONSE_DECODE_FAILED: companion participation projection is missing");
        }
        panic!("SDK_RUNTIME_RESPONSE_DECODE_FAILED: companion participation projection requires an admitted strict response decoder");`
        : decoders || unsupportedGuard
        ? `        let pairs = parse_pairs(raw);
        let mut out = Self::default();
${unsupportedGuard}${!decoders ? '        if !pairs.is_empty() {\n            panic!("SDK_RUNTIME_RESPONSE_DECODE_FAILED: generated Rust typed client has no decoder for response fields");\n        }\n' : ''}
${decoders}
        out`
        : `        if !raw.is_empty() {
            panic!("SDK_RUNTIME_RESPONSE_DECODE_FAILED: generated Rust typed client received undecodable response payload");
        }
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
    if (model.schema.kind === 'union') return renderRustRealmUnion(model, realmModelByName);
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
    return `    pub fn ${snakeCase(operation.operation_id)}(&self, _request: ${base}Request, _metadata: CoreMetadata, _timeout: Option<std::time::Duration>) -> Result<${responseType}, T::Error> {
        panic!("SDK_REALM_RESPONSE_DECODE_FAILED: generated Rust Realm typed client has no admitted response decoder for ${operation.operation_id}");
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

fn parse_repeated_string(raw: &[u8], target_key: &str) -> Vec<String> {
    let text = String::from_utf8_lossy(raw);
    let mut out = Vec::new();
    for pair in text.split(';') {
        if pair.is_empty() {
            continue;
        }
        if let Some((key, value)) = pair.split_once('=') {
            if key != target_key {
                continue;
            }
            for item in value.split(',') {
                let trimmed = item.trim();
                if !trimmed.is_empty() {
                    out.push(trimmed.to_string());
                }
            }
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
