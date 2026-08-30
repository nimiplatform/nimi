import { readdirSync } from 'node:fs';
import path from 'node:path';
import { generatedBy, readText, repoRoot } from './context.mjs';

// These RPCs exist only for verified native Host mechanics. TypeScript keeps
// the raw core-generated transport for the explicit runtime/host entrypoint;
// languages without a native Host consumer receive a hard-cut projection.
export const HOST_PRIVATE_RUNTIME_METHOD_IDS = Object.freeze([
  '/nimi.runtime.v1.RuntimeAgentService/ResolveLocalAppAvatarHostTarget',
  '/nimi.runtime.v1.RuntimeAgentService/RevalidateLocalAppAvatarHostTarget',
]);
export const HOST_PRIVATE_RUNTIME_MESSAGE_NAMES = Object.freeze([
  'ResolveLocalAppAvatarHostTargetRequest',
  'ResolveLocalAppAvatarHostTargetResponse',
  'RevalidateLocalAppAvatarHostTargetRequest',
  'RevalidateLocalAppAvatarHostTargetResponse',
]);

const hostPrivateRuntimeMethodIds = new Set(HOST_PRIVATE_RUNTIME_METHOD_IDS);
const hostPrivateRuntimeMessageNames = new Set(HOST_PRIVATE_RUNTIME_MESSAGE_NAMES);

function runtimeProtoFiles() {
  const dir = path.join(repoRoot, 'proto/runtime/v1');
  return readdirSync(dir)
    .filter((name) => name.endsWith('.proto'))
    .sort()
    .map((name) => `proto/runtime/v1/${name}`);
}

function stripProtoComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|\s)\/\/.*$/gm, '$1');
}

function normalizeProtoType(type) {
  return String(type)
    .replace(/^\./, '')
    .replace(/^nimi\.runtime\.v1\./, '')
    .replace(/^runtime\.v1\./, '');
}

function extractProtoPackage(source, file) {
  const protoPackage = source.match(/^\s*package\s+([A-Za-z_][A-Za-z0-9_.]*)\s*;/m)?.[1];
  if (!protoPackage) {
    throw new Error(`Runtime proto file is missing package declaration: ${file}`);
  }
  return protoPackage;
}

function collectNamedBlocks(source, keyword) {
  const blocks = [];
  const re = new RegExp(`\\b${keyword}\\s+([A-Za-z_][A-Za-z0-9_]*)\\s*\\{`, 'g');
  let match;
  while ((match = re.exec(source))) {
    const name = match[1];
    const open = source.indexOf('{', match.index);
    let depth = 0;
    let end = open;
    for (; end < source.length; end += 1) {
      if (source[end] === '{') depth += 1;
      if (source[end] === '}') {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    blocks.push({ name, body: source.slice(open + 1, end) });
    re.lastIndex = end + 1;
  }
  return blocks;
}

function parseProtoFields(body) {
  const fields = [];
  const fieldSource = body
    .replace(/\boneof\s+[A-Za-z_][A-Za-z0-9_]*\s*\{([\s\S]*?)\}/g, '$1')
    .replace(/\bmessage\s+[A-Za-z_][A-Za-z0-9_]*\s*\{[\s\S]*?\}/g, '')
    .replace(/\benum\s+[A-Za-z_][A-Za-z0-9_]*\s*\{[\s\S]*?\}/g, '');
  const statements = fieldSource.split(';');
  for (const rawStatement of statements) {
    const statement = rawStatement.replace(/\[[\s\S]*?\]/g, '').trim();
    if (!statement) continue;
    const mapMatch = statement.match(/^map\s*<\s*([A-Za-z_][A-Za-z0-9_.]*)\s*,\s*([A-Za-z_][A-Za-z0-9_.]*)\s*>\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(\d+)/);
    if (mapMatch) {
      fields.push({
        name: mapMatch[3],
        type: 'map',
        map_key_type: normalizeProtoType(mapMatch[1]),
        map_value_type: normalizeProtoType(mapMatch[2]),
        repeated: false,
        number: Number(mapMatch[4]),
      });
      continue;
    }
    const fieldMatch = statement.match(/^(optional\s+)?(repeated\s+)?([A-Za-z_][A-Za-z0-9_.]*)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(\d+)/);
    if (!fieldMatch) continue;
    fields.push({
      name: fieldMatch[4],
      type: normalizeProtoType(fieldMatch[3]),
      repeated: Boolean(fieldMatch[2]),
      optional: Boolean(fieldMatch[1]),
      number: Number(fieldMatch[5]),
    });
  }
  return fields.sort((a, b) => a.number - b.number);
}

function parseProtoEnumValues(body) {
  return [...body.matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*\d+/gm)].map((match) => match[1]);
}

export function extractRuntimeProto() {
  const protoFiles = runtimeProtoFiles();
  const services = [];
  const messages = new Map();
  const enums = new Map();

  for (const file of protoFiles) {
    const source = stripProtoComments(readText(file));
    const protoPackage = extractProtoPackage(source, file);
    for (const block of collectNamedBlocks(source, 'message')) {
      messages.set(block.name, {
        name: block.name,
        fields: parseProtoFields(block.body),
        source_file: file,
      });
    }
    for (const block of collectNamedBlocks(source, 'enum')) {
      enums.set(block.name, {
        name: block.name,
        values: parseProtoEnumValues(block.body),
        source_file: file,
      });
    }
    for (const serviceMatch of source.matchAll(/\bservice\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{([\s\S]*?)^\}/gm)) {
      const serviceName = serviceMatch[1];
      const body = serviceMatch[2];
      const methods = [];
      for (const rpcMatch of body.matchAll(/\brpc\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*(stream\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\)\s*returns\s*\(\s*(stream\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*\)/g)) {
        const methodName = rpcMatch[1];
        const requestStream = Boolean(rpcMatch[2]);
        const requestType = rpcMatch[3];
        const responseStream = Boolean(rpcMatch[4]);
        const responseType = rpcMatch[5];
        const kind = requestStream && responseStream
          ? 'bidi_stream'
          : requestStream
            ? 'client_stream'
            : responseStream
              ? 'server_stream'
              : 'unary';
        const methodId = `/${protoPackage}.${serviceName}/${methodName}`;
        methods.push({
          name: methodName,
          method_id: methodId,
          kind,
          request_type: requestType,
          response_type: responseType,
          request_stream: requestStream,
          response_stream: responseStream,
        });
      }
      services.push({
        name: serviceName,
        source_file: file,
        methods,
      });
    }
  }

  const codecMaps = services.flatMap((service) => service.methods.map((method) => ({
    method_id: method.method_id,
    service: service.name,
    method: method.name,
    kind: method.kind,
    request_type: method.request_type,
    response_type: method.response_type,
  })));

  return {
    contract: 'nimi.sdks.runtime-core-manifest.v1',
    generated_by: generatedBy,
    source_kind: 'runtime_proto',
    source_paths: protoFiles,
    provenance: {
      notes: [
        'Runtime core descriptors are derived from Runtime proto.',
        'Generated core descriptors preserve proto coverage; typed public facades admit only their explicit SDK owner surface and fail closed for unsupported method kinds.',
      ],
    },
    services,
    method_ids: codecMaps.map(({ method_id }) => method_id).sort(),
    codec_maps: codecMaps.sort((a, b) => a.method_id.localeCompare(b.method_id)),
    contract_maps: codecMaps.sort((a, b) => a.method_id.localeCompare(b.method_id)),
    schema_types: {
      messages: [...messages.keys()].sort(),
      enums: [...enums.keys()].sort(),
      message_schemas: [...messages.values()].sort((a, b) => a.name.localeCompare(b.name)),
      enum_schemas: [...enums.values()].sort((a, b) => a.name.localeCompare(b.name)),
    },
  };
}

export function projectRuntimeForNonHostPublicSdks(runtime) {
  const services = runtime.services.map((service) => ({
    ...service,
    methods: service.methods.filter((method) => !hostPrivateRuntimeMethodIds.has(method.method_id)),
  }));
  const filterCodecRows = (rows) => rows.filter(
    (row) => !hostPrivateRuntimeMethodIds.has(row.method_id),
  );
  const messages = runtime.schema_types.messages.filter(
    (name) => !hostPrivateRuntimeMessageNames.has(name),
  );
  const messageSchemas = runtime.schema_types.message_schemas.filter(
    (schema) => !hostPrivateRuntimeMessageNames.has(schema.name),
  );
  return {
    ...runtime,
    provenance: {
      ...runtime.provenance,
      notes: [
        ...(runtime.provenance?.notes ?? []),
        'Host-private Avatar target RPCs and messages are excluded from non-Host public SDK languages.',
      ],
    },
    services,
    method_ids: runtime.method_ids.filter((methodId) => !hostPrivateRuntimeMethodIds.has(methodId)),
    codec_maps: filterCodecRows(runtime.codec_maps),
    contract_maps: filterCodecRows(runtime.contract_maps),
    schema_types: {
      ...runtime.schema_types,
      messages,
      message_schemas: messageSchemas,
    },
  };
}
