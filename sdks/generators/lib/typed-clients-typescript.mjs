import { generatedBy, readText, writeText } from './context.mjs';
import {
  lowerCamelCase,
  openApiSuccessSchema,
  quote,
  realmOperationTypeBase,
  runtimeEnumSchemas,
  runtimeMessageSchemas,
  tsOpenApiType,
  tsPropertyName,
} from './types.mjs';

function runtimeSchemaSources(runtime) {
  const sources = new Map();
  for (const schema of runtime.schema_types.message_schemas || []) {
    sources.set(schema.name, schema.source_file);
  }
  for (const schema of runtime.schema_types.enum_schemas || []) {
    sources.set(schema.name, schema.source_file);
  }
  return sources;
}

function tsRuntimeProtobufImportPath(sourceFile) {
  return `./runtime-protobuf/${String(sourceFile).replace(/^proto\//, '').replace(/\.proto$/, '')}`;
}

function tsIdentifier(value) {
  const identifier = String(value || '').replace(/[^A-Za-z0-9_$]/g, '_');
  if (/^[A-Za-z_$]/.test(identifier)) {
    return identifier;
  }
  return `_${identifier}`;
}

function tsRealmEnumValueConstantName(schemaName) {
  return `${tsIdentifier(schemaName)}Values`;
}

function tsRealmEnumValueObjectName(schemaName) {
  return `${tsIdentifier(schemaName)}Value`;
}

function tsEnumMemberKey(value, index, used) {
  const words = String(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  let base = words.join('_').toUpperCase();
  if (!base) {
    base = `VALUE_${index + 1}`;
  }
  if (!/^[A-Z_$]/.test(base)) {
    base = `VALUE_${base}`;
  }
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base}_${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

function groupRuntimeTypesByImport(runtime, typeNames, importPathForSource = tsRuntimeProtobufImportPath) {
  const sources = runtimeSchemaSources(runtime);
  const grouped = new Map();
  for (const typeName of [...new Set(typeNames)].sort()) {
    const sourceFile = sources.get(typeName);
    if (!sourceFile) {
      throw new Error(`Runtime proto schema source missing for TypeScript type: ${typeName}`);
    }
    const importPath = importPathForSource(sourceFile);
    const values = grouped.get(importPath) || [];
    values.push(typeName);
    grouped.set(importPath, values);
  }
  return [...grouped.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function tsRuntimePublicWireImportPath(sourceFile) {
  return `../../core-generated/runtime-protobuf/${String(sourceFile).replace(/^proto\//, '').replace(/\.proto$/, '')}`;
}

function upperSnakeCase(value) {
  return String(value || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();
}

function runtimeEnumMemberName(schema, entries, protoValueName) {
  const protobufTsPrefix = `${upperSnakeCase(schema.name)}_`;
  const stripsTypePrefix = entries.length > 0
    && entries.every((entry) => String(entry.name).startsWith(protobufTsPrefix));
  const stripped = stripsTypePrefix
    ? String(protoValueName).slice(protobufTsPrefix.length)
    : String(protoValueName);
  return tsIdentifier(stripped || protoValueName);
}

function runtimeEnumValueEntries(schema) {
  const source = readText(schema.source_file);
  const match = source.match(new RegExp(`\\benum\\s+${schema.name}\\s*\\{([\\s\\S]*?)\\}`));
  if (!match) {
    throw new Error(`Runtime proto enum block missing for ${schema.name} in ${schema.source_file}`);
  }
  return [...match[1].matchAll(/\b([A-Z][A-Z0-9_]*)\s*=\s*(\d+)\s*;/g)]
    .map((entry) => ({ name: entry[1], number: Number(entry[2]) }));
}

function renderRuntimeWireEnum(schema) {
  const entries = runtimeEnumValueEntries(schema);
  const used = new Set();
  const members = entries.map((entry) => {
    const memberName = runtimeEnumMemberName(schema, entries, entry.name);
    if (used.has(memberName)) {
      throw new Error(`Runtime proto enum ${schema.name} has duplicate TypeScript member ${memberName}`);
    }
    used.add(memberName);
    return `  ${memberName} = ${entry.number},`;
  }).join('\n');
  return `export enum ${schema.name} {\n${members}\n}`;
}

function renderRuntimeWireTypeExports(runtime) {
  return groupRuntimeTypesByImport(
    runtime,
    runtimeMessageSchemas(runtime).map((schema) => schema.name),
    tsRuntimePublicWireImportPath,
  )
    .map(([importPath, names]) => `export type { ${names.join(', ')} } from ${quote(importPath)};`)
    .join('\n');
}

function renderRuntimeWireEnums(runtime) {
  return runtimeEnumSchemas(runtime)
    .map(renderRuntimeWireEnum)
    .join('\n\n');
}

export function writeTypescriptTypedClients(runtime, realm) {
  const runtimeMethodTypeNames = runtime.codec_maps.flatMap((method) => [method.request_type, method.response_type]);
  const runtimeTypeImports = groupRuntimeTypesByImport(runtime, runtimeMethodTypeNames)
    .map(([importPath, names]) => `import type { ${names.join(', ')} } from ${quote(importPath)};`)
    .join('\n');
  const runtimeTypeExports = groupRuntimeTypesByImport(runtime, runtimeMessageSchemas(runtime).map((schema) => schema.name))
    .map(([importPath, names]) => `export type { ${names.join(', ')} } from ${quote(importPath)};`)
    .join('\n');
  const runtimeEnumExports = groupRuntimeTypesByImport(runtime, runtimeEnumSchemas(runtime).map((schema) => schema.name))
    .map(([importPath, names]) => `export { ${names.join(', ')} } from ${quote(importPath)};`)
    .join('\n');
  const runtimeWireImports = groupRuntimeTypesByImport(runtime, runtimeMethodTypeNames)
    .map(([importPath, names]) => `import { ${names.join(', ')} } from ${quote(importPath)};`)
    .join('\n');
  const runtimeWireEntries = runtime.codec_maps.map((method) => {
    return `  ${quote(method.method_id)}: createRuntimeWireCodec<${method.request_type}, ${method.response_type}>(${quote(method.method_id)}, ${quote(method.kind)}, ${quote(method.request_type)}, ${quote(method.response_type)}, ${method.request_type}, ${method.response_type})`;
  }).join(',\n');
  const runtimeMethods = runtime.codec_maps.map((method) => {
    const name = lowerCamelCase(method.method);
    const descriptorId = quote(method.method_id);
    if (method.kind === 'unary') {
      return `  async ${name}(request: ${method.request_type}, options: RuntimeTypedCallOptions = {}): Promise<${method.response_type}> {
    return this.core.unary<${method.response_type}, ${method.request_type}>({
      methodId: ${descriptorId},
      body: request,
      metadata: options.metadata,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
      responseMetadataObserver: options.responseMetadataObserver,
    });
  }`;
    }
    if (method.kind === 'server_stream') {
      return `  ${name}(request: ${method.request_type}, options: RuntimeTypedCallOptions = {}): AsyncIterable<${method.response_type}> {
    return this.core.serverStream<${method.response_type}, ${method.request_type}>({
      methodId: ${descriptorId},
      body: request,
      metadata: options.metadata,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
      responseMetadataObserver: options.responseMetadataObserver,
    });
  }`;
    }
    return `  async ${name}(_request: ${method.request_type}, _options: RuntimeTypedCallOptions = {}): Promise<${method.response_type}> {
    throw Object.assign(new Error(${quote(`Runtime method kind is not supported by the unary/server-stream core transport: ${method.method_id}`)}), {
      code: 'SDK_RUNTIME_METHOD_UNAVAILABLE',
    });
  }`;
  }).join('\n\n');
  const realmModels = (realm.model_schemas || []).map((model) => {
    if (model.schema.kind !== 'object') {
      return `export type ${model.name} = ${tsOpenApiType(model.schema)};`;
    }
    const fields = model.schema.properties.map((property) => `  readonly ${tsPropertyName(property.name)}${property.required ? '' : '?'}: ${tsOpenApiType(property.schema)};`).join('\n');
    return `export interface ${model.name} {\n${fields}\n}`;
  }).join('\n');
  const realmEnumValueConstants = (realm.model_schemas || [])
    .filter((model) => model.schema.kind === 'enum' && Array.isArray(model.schema.values))
    .map((model) => {
      const values = model.schema.values.map((value) => `  ${quote(value)},`).join('\n');
      const usedMemberNames = new Set();
      const valueObject = model.schema.values
        .map((value, index) => `  ${tsEnumMemberKey(value, index, usedMemberNames)}: ${quote(value)},`)
        .join('\n');
      return `export const ${tsRealmEnumValueConstantName(model.name)} = [\n${values}\n] as const satisfies readonly ${model.name}[];

export const ${tsRealmEnumValueObjectName(model.name)} = {
${valueObject}
} as const satisfies Record<string, ${model.name}>;`;
    })
    .join('\n\n');
  const realmModelMapFields = (realm.model_schemas || [])
    .map((model) => `  readonly ${quote(model.name)}: ${model.name};`)
    .join('\n');
  const realmTypes = realm.operations.map((operation) => {
    const base = realmOperationTypeBase(operation.operation_id);
    const pathFields = (operation.path_parameters || []).map((parameter) => `    readonly ${tsPropertyName(parameter.name)}${parameter.required ? '' : '?'}: ${tsOpenApiType(parameter.schema)};`).join('\n');
    const queryFields = (operation.query_parameters || []).map((parameter) => `    readonly ${tsPropertyName(parameter.name)}${parameter.required ? '' : '?'}: ${tsOpenApiType(parameter.schema)};`).join('\n');
    const headerFields = (operation.header_parameters || []).map((parameter) => `    readonly ${JSON.stringify(parameter.name)}${parameter.required ? '' : '?'}: ${tsOpenApiType(parameter.schema)};`).join('\n');
    return `export interface ${base}Request {
  readonly path: {
${pathFields}
  };
  readonly query?: {
${queryFields}
  };
  readonly headers?: {
${headerFields}
  };
  readonly body${operation.request_schema.kind === 'unknown' ? '?' : ''}: ${tsOpenApiType(operation.request_schema)};
}
export type ${base}Response = ${tsOpenApiType(openApiSuccessSchema(operation))};`;
  }).join('\n');
  const realmMethods = realm.operations.map((operation) => {
    const base = realmOperationTypeBase(operation.operation_id);
    return `  async ${lowerCamelCase(operation.operation_id)}(request: ${base}Request, options: RealmTypedCallOptions = {}): Promise<${base}Response> {
    return this.core.unary<${base}Response, ${base}Request>({
      methodId: ${quote(operation.operation_id)},
      body: request,
      metadata: options.metadata,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
      responseMetadataObserver: options.responseMetadataObserver,
    });
  }`;
  }).join('\n\n');
  writeText('sdks/typescript/core-generated/runtime-typed-client.ts', `// @generated by ${generatedBy}
// DO NOT EDIT MANUALLY.

import { CoreClient } from '../core-client';
import type { CoreMetadata, CoreResponseMetadataObserver } from '../types';
${runtimeTypeImports}

export interface RuntimeTypedCallOptions {
  readonly metadata?: CoreMetadata;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly responseMetadataObserver?: CoreResponseMetadataObserver;
}

${runtimeTypeExports}

${runtimeEnumExports}

export class RuntimeTypedClient {
  constructor(private readonly core: CoreClient) {}

${runtimeMethods}
}
`);
  writeText('sdks/typescript/core-generated/runtime-wire-codecs.ts', `// @generated by ${generatedBy}
// DO NOT EDIT MANUALLY.

${runtimeWireImports}

export type RuntimeWireMethodKind = 'unary' | 'server_stream' | 'client_stream' | 'bidi_stream';

export interface RuntimeWireCodec<Request = unknown, Response = unknown> {
  readonly methodId: string;
  readonly kind: RuntimeWireMethodKind;
  readonly requestTypeName: string;
  readonly responseTypeName: string;
  encodeRequest(request: Request): Uint8Array;
  decodeResponse(bytes: Uint8Array): Response;
}

type RuntimeBinaryType<T> = {
  create(value?: Partial<T>): T;
  toBinary(message: T): Uint8Array;
  fromBinary(bytes: Uint8Array): T;
};

export class RuntimeWireCodecMissingError extends Error {
  readonly code = 'SDK_RUNTIME_CODEC_MISSING';

  constructor(methodId: string) {
    super(\`missing generated Runtime wire codec for \${methodId}\`);
    this.name = 'RuntimeWireCodecMissingError';
  }
}

function createRuntimeWireCodec<Request extends object, Response extends object>(
  methodId: string,
  kind: RuntimeWireMethodKind,
  requestTypeName: string,
  responseTypeName: string,
  requestType: RuntimeBinaryType<Request>,
  responseType: RuntimeBinaryType<Response>,
): RuntimeWireCodec<Request, Response> {
  return {
    methodId,
    kind,
    requestTypeName,
    responseTypeName,
    encodeRequest(request: Request): Uint8Array {
      return requestType.toBinary(requestType.create(request));
    },
    decodeResponse(bytes: Uint8Array): Response {
      return responseType.fromBinary(bytes);
    },
  };
}

export const RUNTIME_WIRE_CODECS = {
${runtimeWireEntries}
} as const;

export type RuntimeWireMethodId = keyof typeof RUNTIME_WIRE_CODECS;

export function hasRuntimeWireCodec(methodId: string): methodId is RuntimeWireMethodId {
  return Object.prototype.hasOwnProperty.call(RUNTIME_WIRE_CODECS, methodId);
}

export function getRuntimeWireCodec(methodId: string): RuntimeWireCodec {
  if (!hasRuntimeWireCodec(methodId)) {
    throw new RuntimeWireCodecMissingError(methodId);
  }
  return RUNTIME_WIRE_CODECS[methodId];
}
`);
  writeText('sdks/typescript/runtime/wire-types/index.ts', `// @generated by ${generatedBy}
// DO NOT EDIT MANUALLY.

${renderRuntimeWireTypeExports(runtime)}

${renderRuntimeWireEnums(runtime)}
`);
  writeText('sdks/typescript/core-generated/realm-typed-client.ts', `// @generated by ${generatedBy}
// DO NOT EDIT MANUALLY.

import { CoreClient } from '../core-client';
import type { CoreMetadata, CoreResponseMetadataObserver } from '../types';
export interface RealmTypedCallOptions {
  readonly metadata?: CoreMetadata;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
  readonly responseMetadataObserver?: CoreResponseMetadataObserver;
}

${realmModels}

${realmEnumValueConstants}

export interface RealmTypedModelMap {
${realmModelMapFields}
}

export type RealmTypedModelName = keyof RealmTypedModelMap & string;
export type RealmTypedModel<Name extends RealmTypedModelName> = RealmTypedModelMap[Name];

${realmTypes}

export class RealmTypedClient {
  constructor(private readonly core: CoreClient) {}

${realmMethods}
}
`);
}
