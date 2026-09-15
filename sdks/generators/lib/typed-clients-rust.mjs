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
        }`);
        }
      } else if (parameter.required) {
        lines.push(`        if request.${container}.${field}.is_none() {
            return Err(RealmTypedClientError::RequestEncode {
                operation_id: ${quote(operation.operation_id)},
                field: ${quote(key)},
            });
        }`);
      }
    }
  }
  return lines;
}

function rustRealmScalarDecoder(schema, property, operationId) {
  const lookup = `object.get(${quote(property.name)})`;
  const decodeError = `RealmTypedClientError::ResponseDecode {
                operation_id: ${quote(operationId)},
                field: ${quote(property.name)},
            }`;
  const extract = schema.kind === 'enum' || schema.type === 'string'
    ? 'value.as_str().map(String::from)'
    : schema.type === 'boolean'
      ? 'value.as_bool()'
      : schema.type === 'integer'
        ? 'value.as_i64()'
        : 'value.as_f64()';
  if (schema.nullable === true) {
    const missingValue = property.required ? `return Err(${decodeError})` : 'None';
    return `match ${lookup} {
                Some(value) if value.is_null() => None,
                Some(value) => Some(${extract}.ok_or(${decodeError})?),
                None => ${missingValue},
            }`;
  }
  if (property.required) {
    return `${lookup}.and_then(|value| ${extract}).ok_or(${decodeError})?`;
  }
  return `match ${lookup} {
                Some(value) if value.is_null() => Default::default(),
                Some(value) => ${extract}.ok_or(${decodeError})?,
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
      const isCodecEnum = runtimeCodecEnumTypes.has(schema.name);
      const variants = schema.values.map((value) => (isCodecEnum
        ? `    #[serde(rename = ${quote(value)})]\n    ${pascalCase(value)},`
        : `    ${pascalCase(value)},`)).join('\n') || '    Unspecified,';
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
      return `#[derive(Clone, Debug, Eq, PartialEq${isCodecEnum ? ', serde::Serialize' : ''})]
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
      const isCodec = runtimeCodecTypes.has(schema.name);
      const fields = schema.fields.map((field) => {
        const serde = isCodec
          ? `    #[serde(rename = ${quote(field.name)}${field.repeated ? ', skip_serializing_if = "Vec::is_empty"' : ', skip_serializing_if = "Option::is_none"'})]\n`
          : '';
        return `${serde}    pub ${rustFieldName(field.name)}: ${rustProtoType(field, runtime)},`;
      }).join('\n');
      const structSource = `#[derive(Clone, Debug, Default, PartialEq${isCodec ? ', serde::Serialize' : ''})]
pub struct ${schema.name} {
${fields}
}`;
      if (!isCodec) return structSource;
      const decoderEntries = schema.fields.map((field) => {
        const name = rustFieldName(field.name);
        const lookup = `object.get("${field.name}")`;
        const decodeError = `Self::decode_error("${field.name}")`;
        if (field.repeated && field.type === 'string') return `        out.${name} = match ${lookup} {
            Some(value) if value.is_null() => Vec::new(),
            Some(value) => {
                let items = value.as_array().ok_or_else(|| ${decodeError})?;
                let mut decoded = Vec::with_capacity(items.len());
                for item in items {
                    decoded.push(item.as_str().map(String::from).ok_or_else(|| ${decodeError})?);
                }
                decoded
            }
            None => Vec::new(),
        };`;
        if (field.repeated || field.type === 'map') return '';
        const scalarDecode = (extract) => `        out.${name} = match ${lookup} {
            Some(value) if value.is_null() => None,
            ${extract}
            None => None,
        };`;
        if (field.type === 'string' || field.type === 'google.protobuf.Timestamp' || field.type === 'google.protobuf.Duration') return scalarDecode(`Some(value) => Some(value.as_str().map(String::from).ok_or_else(|| ${decodeError})?),`);
        if (field.type === 'bool') return scalarDecode(`Some(value) => Some(value.as_bool().ok_or_else(|| ${decodeError})?),`);
        if (['int32', 'sint32', 'sfixed32'].includes(field.type)) return scalarDecode(`Some(value) => {
                let raw = value.as_i64().ok_or_else(|| ${decodeError})?;
                Some(i32::try_from(raw).map_err(|_| ${decodeError})?)
            }`);
        if (['uint32', 'fixed32'].includes(field.type)) return scalarDecode(`Some(value) => {
                let raw = value.as_u64().ok_or_else(|| ${decodeError})?;
                Some(u32::try_from(raw).map_err(|_| ${decodeError})?)
            }`);
        if (['int64', 'sint64', 'sfixed64'].includes(field.type)) return scalarDecode(`Some(value) => Some(value.as_i64().ok_or_else(|| ${decodeError})?),`);
        if (['uint64', 'fixed64'].includes(field.type)) return scalarDecode(`Some(value) => Some(value.as_u64().ok_or_else(|| ${decodeError})?),`);
        if (field.type === 'float') return scalarDecode(`Some(value) => Some(value.as_f64().ok_or_else(|| ${decodeError})? as f32),`);
        if (field.type === 'double') return scalarDecode(`Some(value) => Some(value.as_f64().ok_or_else(|| ${decodeError})?),`);
        const kind = protoTypeKind(field.type, runtime);
        if (kind === 'enum') return scalarDecode(`Some(value) => {
                let raw = value.as_str().ok_or_else(|| ${decodeError})?;
                Some(${field.type}::from_transport(raw).ok_or_else(|| ${decodeError})?)
            }`);
        if (kind === 'message' && field.type === 'AccountCaller') return scalarDecode(`Some(value) => {
                let nested = value.as_object().ok_or_else(|| ${decodeError})?;
                Some(Box::new(AccountCaller::from_json_object(nested)?))
            }`);
        return '';
      }).map((code, index) => ({ field: schema.fields[index], code }));
      const decodedFields = new Set(decoderEntries.filter((entry) => entry.code).map((entry) => entry.field.name));
      const decoders = decoderEntries.map((entry) => entry.code).filter(Boolean).join('\n');
      const unsupportedFields = schema.fields
        .filter((field) => (field.repeated && field.type !== 'string') || field.type === 'map' || !decodedFields.has(field.name))
        .map((field) => field.name);
      if (unsupportedFields.length > 0) {
        throw new Error(
          `unsupported admitted Rust Runtime response fields: ${schema.name}.${unsupportedFields.join(',')}`,
        );
      }
      const fromTransportImpl = decoders
        ? `    pub fn from_transport(raw: &[u8]) -> Result<Self, RuntimeResponseDecodeError> {
        let object = json_object(raw, Self::decode_error("<body>"))?;
        Self::from_json_object(&object)
    }

    fn from_json_object(object: &serde_json::Map<String, serde_json::Value>) -> Result<Self, RuntimeResponseDecodeError> {
        let mut out = Self::default();
${decoders}
        Ok(out)
    }`
        : `    pub fn from_transport(raw: &[u8]) -> Result<Self, RuntimeResponseDecodeError> {
        json_object(raw, Self::decode_error("<body>"))?;
        Ok(Self::default())
    }`;
      return `${structSource}

impl ${schema.name} {
    pub fn to_transport(&self) -> Vec<u8> {
        serde_json::to_vec(self).expect("typed client JSON serialization cannot fail")
    }

    fn decode_error(field: &'static str) -> RuntimeResponseDecodeError {
        RuntimeResponseDecodeError { type_name: ${quote(schema.name)}, field }
    }

${fromTransportImpl}
}`;
    })
    .join('\n\n');
  const runtimeMethods = runtimeAdmissions.map((method) => {
    const name = snakeCase(method.method);
    if (method.kind === 'unary') {
      return `    pub fn ${name}(&self, request: ${method.request_type}, metadata: CoreMetadata, timeout: Option<std::time::Duration>) -> Result<${method.response_type}, RuntimeTypedClientError<T::Error>> {
        let raw = self.core.unary(CoreUnaryRequest {
            method_id: ${quote(method.method_id)}.to_string(),
            metadata,
            body: request.to_transport(),
            timeout,
        }).map_err(RuntimeTypedClientError::Transport)?;
        ${method.response_type}::from_transport(&raw).map_err(|error| RuntimeTypedClientError::ResponseDecode {
            method_id: ${quote(method.method_id)},
            type_name: error.type_name,
            field: error.field,
        })
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
    const pathFields = (operation.path_parameters || []).map((parameter) => `    #[serde(rename = ${quote(parameter.name)})]\n    pub ${rustFieldName(snakeCase(parameter.name))}: ${rustOpenApiType(parameter.schema)},`).join('\n');
    const queryFields = (operation.query_parameters || []).map((parameter) => `    #[serde(rename = ${quote(parameter.name)}, skip_serializing_if = "Option::is_none")]\n    pub ${rustFieldName(snakeCase(parameter.name))}: Option<${rustOpenApiType(parameter.schema)}>,`).join('\n');
    const headerFields = (operation.header_parameters || []).map((parameter) => `    #[serde(rename = ${quote(parameter.name)}, skip_serializing_if = "Option::is_none")]\n    pub ${rustFieldName(snakeCase(parameter.name))}: Option<${rustOpenApiType(parameter.schema)}>,`).join('\n');
    return `#[derive(Clone, Debug, Default, PartialEq, serde::Serialize)]
pub struct ${base}Path {\n${pathFields}\n}

#[derive(Clone, Debug, Default, PartialEq, serde::Serialize)]
pub struct ${base}Query {\n${queryFields}\n}

#[derive(Clone, Debug, Default, PartialEq, serde::Serialize)]
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
    const validations = requestEncoders.length > 0 ? `${requestEncoders.join('\n')}\n` : '';
    return `    pub fn ${snakeCase(operation.operation_id)}(&self, request: ${base}Request, metadata: CoreMetadata, timeout: Option<std::time::Duration>) -> Result<${responseType}, RealmTypedClientError<T::Error>> {
${validations}        let body = serde_json::to_vec(&serde_json::json!({
            "path": request.path,
            "query": request.query,
            "headers": request.headers,
            "body": serde_json::json!({}),
        })).expect("Realm typed request JSON serialization cannot fail");
        let raw = self.core.unary(CoreUnaryRequest {
            method_id: ${quote(operation.operation_id)}.to_string(),
            metadata,
            body,
            timeout,
        }).map_err(RealmTypedClientError::Transport)?;
        let object = json_object(&raw, RealmTypedClientError::ResponseDecode {
            operation_id: ${quote(operation.operation_id)},
            field: "<body>",
        })?;
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

fn json_object<E>(raw: &[u8], error: E) -> Result<serde_json::Map<String, serde_json::Value>, E> {
    match serde_json::from_slice::<serde_json::Value>(raw) {
        Ok(serde_json::Value::Object(object)) => Ok(object),
        _ => Err(error),
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct RuntimeResponseDecodeError {
    pub type_name: &'static str,
    pub field: &'static str,
}

#[derive(Debug, PartialEq)]
pub enum RuntimeTypedClientError<E> {
    Transport(E),
    ResponseDecode {
        method_id: &'static str,
        type_name: &'static str,
        field: &'static str,
    },
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
    R: TryFrom<Vec<u8>, Error = RuntimeResponseDecodeError>,
{
    pub fn recv(&mut self) -> Option<Result<R, RuntimeResponseDecodeError>> {
        self.inner.recv_typed_payload().map(R::try_from)
    }
}

${runtimeResponseTypes.map((name) => `impl TryFrom<Vec<u8>> for ${name} {
    type Error = RuntimeResponseDecodeError;

    fn try_from(body: Vec<u8>) -> Result<Self, Self::Error> {
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
