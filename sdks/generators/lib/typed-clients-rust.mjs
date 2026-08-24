import { generatedBy, writeText } from './context.mjs';
import {
  openApiSuccessSchema,
  pascalCase,
  protoTypeKind,
  quote,
  realmOperationTypeBase,
  rustFieldName,
  rustOpenApiFieldType,
  rustOpenApiType,
  rustProtoType,
  runtimeEnumSchemas,
  runtimeMessageSchemas,
  snakeCase,
} from './types.mjs';

const RUST_RUNTIME_SCALAR_TYPES = new Set([
  'string',
  'google.protobuf.Timestamp',
  'google.protobuf.Duration',
  'bool',
  'int32',
  'int64',
  'uint32',
  'uint64',
  'sint32',
  'sint64',
  'fixed32',
  'fixed64',
  'sfixed32',
  'sfixed64',
  'float',
  'double',
]);

function isRustRuntimeRequestFieldSupported(field, runtime) {
  if (field.type === 'map') return false;
  if (field.repeated) return field.type === 'string';
  const kind = protoTypeKind(field.type, runtime);
  return RUST_RUNTIME_SCALAR_TYPES.has(field.type)
    || kind === 'enum'
    || (kind === 'message' && field.type === 'AccountCaller');
}

function isRustRuntimeResponseFieldSupported(field, runtime) {
  if (field.type === 'map') return false;
  if (field.repeated) return field.type === 'string';
  return RUST_RUNTIME_SCALAR_TYPES.has(field.type) || protoTypeKind(field.type, runtime) === 'enum';
}

function collectRustRuntimeMethodAdmissions(runtime) {
  const schemas = new Map(runtimeMessageSchemas(runtime).map((schema) => [schema.name, schema]));
  return runtime.codec_maps.filter((method) => {
    if (method.kind !== 'unary' && method.kind !== 'server_stream') return false;
    const request = schemas.get(method.request_type);
    const response = schemas.get(method.response_type);
    return Boolean(
      request
      && response
      && request.fields.every((field) => isRustRuntimeRequestFieldSupported(field, runtime))
      && response.fields.every((field) => isRustRuntimeResponseFieldSupported(field, runtime)),
    );
  });
}

export function rustRuntimeTypedAdmittedMethodIds(runtime) {
  return collectRustRuntimeMethodAdmissions(runtime).map((method) => method.method_id);
}

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

function isSupportedRustRealmScalar(schema) {
  if (!schema) return false;
  if (schema.kind === 'enum') return true;
  return schema.kind === 'scalar'
    && ['string', 'boolean', 'integer', 'number'].includes(schema.type);
}

function isSupportedRustRealmRequestScalar(schema) {
  return schema?.nullable !== true && isSupportedRustRealmScalar(schema);
}

export function renderRustRealmRequestEncoders(operation) {
  if (operation.request_schema?.kind !== 'unknown') return null;
  const lines = [];
  for (const [container, parameters] of [
    ['path', operation.path_parameters || []],
    ['query', operation.query_parameters || []],
    ['headers', operation.header_parameters || []],
  ]) {
    for (const parameter of parameters) {
      if (!isSupportedRustRealmRequestScalar(parameter.schema)) return null;
      const field = rustFieldName(snakeCase(parameter.name));
      const key = `${container}.${parameter.name}`;
      if (container === 'path') {
        if (
          parameter.schema?.kind === 'scalar'
          && parameter.schema.type === 'string'
        ) {
          lines.push(`        if request.${container}.${field}.is_empty() {
            return Err(RealmTypedClientError::RequestEncode {
                operation_id: ${quote(operation.operation_id)},
                field: ${quote(key)},
            });
        }
        pairs.push(format!("${key}={}", request.${container}.${field}));`);
        } else {
          lines.push(`        pairs.push(format!("${key}={}", request.${container}.${field}));`);
        }
      } else if (parameter.required) {
        lines.push(`        let value = request.${container}.${field}.as_ref().ok_or(RealmTypedClientError::RequestEncode {
            operation_id: ${quote(operation.operation_id)},
            field: ${quote(key)},
        })?;
        pairs.push(format!("${key}={}", value));`);
      } else {
        lines.push(`        if let Some(value) = &request.${container}.${field} {
            pairs.push(format!("${key}={}", value));
        }`);
      }
    }
  }
  return lines;
}

function rustRealmScalarDecoder(schema, property, operationId) {
  const lookup = `pairs.get(${quote(property.name)})`;
  const decodeError = `RealmTypedClientError::ResponseDecode {
                operation_id: ${quote(operationId)},
                field: ${quote(property.name)},
            }`;
  const presentValue = schema.kind === 'enum' || schema.type === 'string'
    ? 'value.clone()'
    : `value.parse().map_err(|_| ${decodeError})?`;
  if (schema.nullable === true) {
    const missingValue = property.required ? `return Err(${decodeError})` : 'None';
    return `match ${lookup} {
                Some(value) if value == "null" => None,
                Some(value) => Some(${presentValue}),
                None => ${missingValue},
            }`;
  }
  if (schema.kind === 'enum' || schema.type === 'string') {
    return property.required
      ? `${lookup}.cloned().ok_or(${decodeError})?`
      : `${lookup}.cloned().unwrap_or_default()`;
  }
  return property.required
    ? `${lookup}.and_then(|value| value.parse().ok()).ok_or(${decodeError})?`
    : `match ${lookup} {
                Some(value) => value.parse().map_err(|_| ${decodeError})?,
                None => Default::default(),
            }`;
}

function renderRustRealmResponseDecoder(operation, modelByName) {
  const responseSchema = openApiSuccessSchema(operation);
  if (responseSchema?.kind !== 'ref') return null;
  const model = resolveRealmSchema(responseSchema, modelByName);
  if (model?.kind !== 'object' || !model.properties?.length) return null;
  if (model.properties.some((property) => !isSupportedRustRealmScalar(property.schema))) return null;
  return {
    typeName: responseSchema.ref_name,
    fields: model.properties.map((property) => (
      `            ${rustFieldName(snakeCase(property.name))}: ${rustRealmScalarDecoder(property.schema, property, operation.operation_id)},`
    )).join('\n'),
  };
}

function collectRustRealmOperationAdmissions(realm) {
  const modelByName = new Map(
    (realm.model_schemas || []).map((model) => [model.name, model.schema]),
  );
  return realm.operations.flatMap((operation) => {
    const requestEncoders = renderRustRealmRequestEncoders(operation);
    const responseDecoder = renderRustRealmResponseDecoder(operation, modelByName);
    return requestEncoders && responseDecoder
      ? [{ operation, requestEncoders, responseDecoder }]
      : [];
  });
}

export function rustRealmTypedAdmittedOperationIds(realm) {
  return collectRustRealmOperationAdmissions(realm).map(
    ({ operation }) => operation.operation_id,
  );
}

export function writeRustTypedClients(runtime, realm) {
  const realmModelByName = new Map((realm.model_schemas || []).map((model) => [model.name, model.schema]));
  const realmAdmissions = collectRustRealmOperationAdmissions(realm);
  const runtimeSchemas = runtimeMessageSchemas(runtime);
  const runtimeAdmissions = collectRustRuntimeMethodAdmissions(runtime);
  const runtimeResponseTypes = [...new Set(runtimeAdmissions.map((method) => method.response_type))];
  const runtimeCodecTypes = new Set([
    ...runtimeAdmissions.flatMap((method) => [method.request_type, method.response_type]),
    'AccountCaller',
  ]);
  const runtimeCodecEnumTypes = new Set(
    runtimeSchemas
      .filter((schema) => runtimeCodecTypes.has(schema.name))
      .flatMap((schema) =>
        schema.fields
          .filter((field) => protoTypeKind(field.type, runtime) === 'enum')
          .map((field) => field.type),
      ),
  );
  const runtimeEnums = runtimeEnumSchemas(runtime)
    .map((schema) => {
      const variants = schema.values.map((value) => `    ${pascalCase(value)},`).join('\n') || '    Unspecified,';
      const defaultVariant = schema.values[0] ? pascalCase(schema.values[0]) : 'Unspecified';
      const decoders = schema.values.flatMap((value) => {
        const variant = pascalCase(value);
        return [...new Set([value, variant])].map(
          (candidate) => `            ${quote(candidate)} => Some(Self::${variant}),`,
        );
      }).join('\n');
      const decoderImpl = runtimeCodecEnumTypes.has(schema.name)
        ? `

impl ${schema.name} {
    fn from_transport(value: &str) -> Option<Self> {
        match value {
${decoders}
            _ => None,
        }
    }
}`
        : '';
      return `#[derive(Clone, Debug, Eq, PartialEq)]
pub enum ${schema.name} {
${variants}
}

impl Default for ${schema.name} {
    fn default() -> Self {
        Self::${defaultVariant}
    }
}${decoderImpl}`;
    })
    .join('\n\n');
  const runtimeTypes = runtimeSchemas
    .map((schema) => {
      const fields = schema.fields.map((field) => `    pub ${rustFieldName(field.name)}: ${rustProtoType(field, runtime)},`).join('\n');
      const structSource = `#[derive(Clone, Debug, Default, PartialEq)]
pub struct ${schema.name} {
${fields}
}`;
      if (!runtimeCodecTypes.has(schema.name)) return structSource;
      const encoders = schema.fields.map((field) => {
        if (field.repeated && field.type === 'string') return `        for value in &self.${rustFieldName(field.name)} { pairs.push(format!("${field.name}={}", value)); }`;
        if (field.repeated || field.type === 'map') {
          throw new Error(`unsupported admitted Rust Runtime request field: ${schema.name}.${field.name}`);
        }
        const kind = protoTypeKind(field.type, runtime);
        if (field.type === 'string' || field.type === 'google.protobuf.Timestamp' || field.type === 'google.protobuf.Duration') return `        if let Some(value) = &self.${rustFieldName(field.name)} { pairs.push(format!("${field.name}={}", value)); }`;
        if (['bool', 'int32', 'int64', 'uint32', 'uint64', 'sint32', 'sint64', 'fixed32', 'fixed64', 'sfixed32', 'sfixed64', 'float', 'double'].includes(field.type)) return `        if let Some(value) = &self.${rustFieldName(field.name)} { pairs.push(format!("${field.name}={}", value)); }`;
        if (kind === 'enum') return `        if let Some(value) = &self.${rustFieldName(field.name)} { pairs.push(format!("${field.name}={:?}", value)); }`;
        if (kind === 'message' && field.type === 'AccountCaller') return `        if let Some(value) = &self.${rustFieldName(field.name)} { push_nested_pairs(&mut pairs, "${field.name}", &value.to_transport()); }`;
        throw new Error(`unsupported admitted Rust Runtime request field: ${schema.name}.${field.name}`);
      }).filter(Boolean).join('\n');
      const decoderEntries = schema.fields.map((field) => {
        if (field.repeated && field.type === 'string') return `        out.${rustFieldName(field.name)} = parse_repeated_string(raw, "${field.name}");`;
        if (field.repeated || field.type === 'map') return '';
        if (field.type === 'string' || field.type === 'google.protobuf.Timestamp' || field.type === 'google.protobuf.Duration') return `        out.${rustFieldName(field.name)} = pairs.get("${field.name}").cloned();`;
        if (field.type === 'bool') return `        out.${rustFieldName(field.name)} = pairs.get("${field.name}").and_then(|value| value.parse().ok());`;
        if (['int32', 'int64', 'uint32', 'uint64', 'sint32', 'sint64', 'fixed32', 'fixed64', 'sfixed32', 'sfixed64', 'float', 'double'].includes(field.type)) return `        out.${rustFieldName(field.name)} = pairs.get("${field.name}").and_then(|value| value.parse().ok());`;
        const kind = protoTypeKind(field.type, runtime);
        if (kind === 'enum') return `        out.${rustFieldName(field.name)} = pairs.get("${field.name}").and_then(|value| ${field.type}::from_transport(value));`;
        if (kind === 'message' && field.type === 'AccountCaller') return `        out.${rustFieldName(field.name)} = extract_nested_pairs(raw, "${field.name}").map(|value| Box::new(AccountCaller::from_transport(&value)));`;
        return '';
      }).map((code, index) => ({ field: schema.fields[index], code }));
      const decodedFields = new Set(decoderEntries.filter((entry) => entry.code).map((entry) => entry.field.name));
      const decoders = decoderEntries.map((entry) => entry.code).filter(Boolean).join('\n');
      const encoderMutatesPairs = encoders.includes('pairs.push') || encoders.includes('push_nested_pairs');
      const toTransportBody = encoders
        ? `        let ${encoderMutatesPairs ? 'mut ' : ''}pairs: Vec<String> = Vec::new();
${encoders}
        pairs.join(";").into_bytes()`
        : '        Vec::new()';
      const unsupportedFields = schema.fields
        .filter((field) => (field.repeated && field.type !== 'string') || field.type === 'map' || !decodedFields.has(field.name))
        .map((field) => field.name);
      if (unsupportedFields.length > 0) {
        throw new Error(
          `unsupported admitted Rust Runtime response fields: ${schema.name}.${unsupportedFields.join(',')}`,
        );
      }
      const decoderUsesPairs = decoders.includes('pairs.');
      const fromTransportBody = decoders
        ? `${decoderUsesPairs ? '        let pairs = parse_pairs(raw);\n' : ''}        let mut out = Self::default();
${decoders}
        out`
        : '        Self::default()';
      return `${structSource}

impl ${schema.name} {
    pub fn to_transport(&self) -> Vec<u8> {
${toTransportBody}
    }

    pub fn from_transport(${decoders ? 'raw' : '_raw'}: &[u8]) -> Self {
${fromTransportBody}
    }
}`;
    })
    .join('\n\n');
  const runtimeMethods = runtimeAdmissions.map((method) => {
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
    throw new Error(`unsupported admitted Rust Runtime method kind: ${method.kind}`);
  }).join('\n\n');
  const realmModels = (realm.model_schemas || []).map((model) => {
    if (model.schema.kind === 'union') return renderRustRealmUnion(model, realmModelByName);
    if (model.schema.kind !== 'object') return `pub type ${model.name} = ${rustOpenApiType(model.schema)};`;
    const fields = model.schema.properties.map((property) => `    pub ${rustFieldName(snakeCase(property.name))}: ${rustOpenApiFieldType(property.schema)},`).join('\n');
    return `#[derive(Clone, Debug, Default, PartialEq)]
pub struct ${model.name} {\n${fields}\n}`;
  }).join('\n\n');
  const realmTypes = realmAdmissions.map(({ operation }) => {
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
  const realmMethods = realmAdmissions.map(({ operation, requestEncoders, responseDecoder }) => {
    const base = realmOperationTypeBase(operation.operation_id);
    const responseType = rustOpenApiType(openApiSuccessSchema(operation));
    const pairsDeclaration = requestEncoders.length > 0 ? 'let mut pairs' : 'let pairs';
    const requestName = requestEncoders.length > 0 ? 'request' : '_request';
    return `    pub fn ${snakeCase(operation.operation_id)}(&self, ${requestName}: ${base}Request, metadata: CoreMetadata, timeout: Option<std::time::Duration>) -> Result<${responseType}, RealmTypedClientError<T::Error>> {
        ${pairsDeclaration}: Vec<String> = Vec::new();
${requestEncoders.join('\n')}
        let raw = self.core.unary(CoreUnaryRequest {
            method_id: ${quote(operation.operation_id)}.to_string(),
            metadata,
            body: pairs.join(";").into_bytes(),
            timeout,
        }).map_err(RealmTypedClientError::Transport)?;
        let pairs = parse_pairs(&raw);
        Ok(${responseDecoder.typeName} {
${responseDecoder.fields}
        })
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

fn push_nested_pairs(out: &mut Vec<String>, field_name: &str, raw: &[u8]) {
    let text = String::from_utf8_lossy(raw);
    for pair in text.split(';') {
        if !pair.is_empty() {
            out.push(format!("{}.{}", field_name, pair));
        }
    }
}

fn extract_nested_pairs(raw: &[u8], field_name: &str) -> Option<Vec<u8>> {
    let prefix = format!("{}.", field_name);
    let text = String::from_utf8_lossy(raw);
    let pairs: Vec<String> = text
        .split(';')
        .filter_map(|pair| pair.strip_prefix(&prefix).map(str::to_string))
        .collect();
    if pairs.is_empty() {
        None
    } else {
        Some(pairs.join(";").into_bytes())
    }
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

${runtimeResponseTypes.map((name) => `impl From<Vec<u8>> for ${name} {
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

#[derive(Debug, PartialEq)]
pub enum RealmTypedClientError<E> {
    Transport(E),
    RequestEncode {
        operation_id: &'static str,
        field: &'static str,
    },
    ResponseDecode {
        operation_id: &'static str,
        field: &'static str,
    },
}

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
