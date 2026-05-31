#!/usr/bin/env node

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');
const checkMode = process.argv.includes('--check');
const generatedBy = 'sdks/generators/generate.mjs';
const languages = ['typescript', 'python', 'go', 'rust'];

function relPath(abs) {
  return path.relative(repoRoot, abs).replaceAll(path.sep, '/');
}

function readText(rel) {
  return readFileSync(path.join(repoRoot, rel), 'utf8');
}

function readYaml(rel) {
  return YAML.parse(readText(rel));
}

function writeJson(rel, value) {
  const abs = path.join(repoRoot, rel);
  const rendered = `${JSON.stringify(value, null, 2)}\n`;
  if (checkMode) {
    if (!existsSync(abs)) {
      throw new Error(`missing generated artifact: ${rel}`);
    }
    const current = readFileSync(abs, 'utf8');
    if (current !== rendered) {
      throw new Error(`generated artifact drift: ${rel}`);
    }
    return;
  }
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, rendered, 'utf8');
}

function writeText(rel, rendered) {
  const abs = path.join(repoRoot, rel);
  const content = rendered.endsWith('\n') ? rendered : `${rendered}\n`;
  if (checkMode) {
    if (!existsSync(abs)) {
      throw new Error(`missing generated artifact: ${rel}`);
    }
    const current = readFileSync(abs, 'utf8');
    if (current !== content) {
      throw new Error(`generated artifact drift: ${rel}`);
    }
    return;
  }
  mkdirSync(path.dirname(abs), { recursive: true });
  writeFileSync(abs, content, 'utf8');
}

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
  return String(type).replace(/^\./, '').replace(/^runtime\.v1\./, '');
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

function extractRuntimeProto() {
  const protoFiles = runtimeProtoFiles();
  const services = [];
  const messages = new Map();
  const enums = new Map();

  for (const file of protoFiles) {
    const source = stripProtoComments(readText(file));
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
        methods.push({
          name: methodName,
          method_id: `/runtime.v1.${serviceName}/${methodName}`,
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
      source_rule: 'S-SURFACE-019',
      notes: [
        'Runtime core method truth is derived from Runtime proto.',
        'The current sdk/ runtime-method-groups table is intentionally not used.',
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

function configuredRealmOpenApiSource() {
  const configRel = 'config/realm-openapi-source.json';
  const config = JSON.parse(readText(configRel));
  if (process.env.NIMI_REALM_OPENAPI_PATH) {
    return {
      source_label: 'env:NIMI_REALM_OPENAPI_PATH',
      abs_path: path.resolve(process.env.NIMI_REALM_OPENAPI_PATH),
      config,
      config_rel: configRel,
    };
  }
  return {
    source_label: config.source_path,
    abs_path: path.resolve(path.dirname(path.join(repoRoot, configRel)), config.source_path),
    config,
    config_rel: configRel,
  };
}

function openApiRefName(ref) {
  return typeof ref === 'string' ? ref.split('/').pop() : null;
}

function parseOpenApiSchema(schema) {
  if (!schema || typeof schema !== 'object') {
    return { kind: 'unknown' };
  }
  if (schema.$ref) {
    return { kind: 'ref', ref: schema.$ref, ref_name: openApiRefName(schema.$ref) };
  }
  if (schema.enum) {
    return { kind: 'enum', values: schema.enum.map(String) };
  }
  if (schema.type === 'array') {
    return { kind: 'array', items: parseOpenApiSchema(schema.items) };
  }
  if (schema.type === 'object' || schema.properties || schema.additionalProperties) {
    const required = new Set(Array.isArray(schema.required) ? schema.required.map(String) : []);
    return {
      kind: 'object',
      properties: Object.entries(schema.properties || {}).map(([name, property]) => ({
        name,
        required: required.has(name),
        schema: parseOpenApiSchema(property),
      })),
      additional_properties: schema.additionalProperties ? parseOpenApiSchema(schema.additionalProperties) : null,
    };
  }
  if (schema.oneOf || schema.anyOf || schema.allOf) {
    const variants = schema.oneOf || schema.anyOf || schema.allOf;
    return { kind: 'union', variants: variants.map(parseOpenApiSchema) };
  }
  return {
    kind: 'scalar',
    type: schema.type || 'unknown',
    format: schema.format || null,
  };
}

function parseOpenApiOperations(spec) {
  const operations = [];
  const paths = spec?.paths && typeof spec.paths === 'object' ? spec.paths : {};
  const verbs = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);
  for (const [route, routeItem] of Object.entries(paths)) {
    if (!routeItem || typeof routeItem !== 'object') continue;
    for (const [verb, operation] of Object.entries(routeItem)) {
      if (!verbs.has(verb) || !operation || typeof operation !== 'object') continue;
      const tags = Array.isArray(operation.tags) ? operation.tags.map(String) : [];
      const parameters = [
        ...(Array.isArray(routeItem.parameters) ? routeItem.parameters : []),
        ...(Array.isArray(operation.parameters) ? operation.parameters : []),
      ].filter((parameter) => parameter && typeof parameter === 'object').map((parameter) => ({
        name: String(parameter.name),
        in: String(parameter.in),
        required: Boolean(parameter.required),
        schema: parseOpenApiSchema(parameter.schema),
      }));
      const requestSchema = operation.requestBody?.content?.['application/json']?.schema || null;
      const responseSchemas = Object.entries(operation.responses || {})
        .map(([status, response]) => ({
          status,
          schema: parseOpenApiSchema(response?.content?.['application/json']?.schema),
          schema_ref: response?.content?.['application/json']?.schema?.$ref || null,
        }))
        .filter((entry) => entry.schema_ref || entry.schema.kind !== 'unknown');
      operations.push({
        operation_id: String(operation.operationId || `${verb}_${route}`),
        method: verb.toUpperCase(),
        path: route,
        service: tags[0] || 'default',
        tags,
        parameters,
        path_parameters: parameters.filter((parameter) => parameter.in === 'path'),
        query_parameters: parameters.filter((parameter) => parameter.in === 'query'),
        header_parameters: parameters.filter((parameter) => parameter.in === 'header'),
        request_schema: parseOpenApiSchema(requestSchema),
        request_schema_ref: operation.requestBody?.content?.['application/json']?.schema?.$ref || null,
        response_schemas: responseSchemas,
        response_schema_refs: responseSchemas.filter((entry) => entry.schema_ref).map(({ status, schema_ref }) => ({ status, schema_ref })),
      });
    }
  }
  return operations.sort((a, b) => a.operation_id.localeCompare(b.operation_id));
}

function extractRealmCore() {
  const source = configuredRealmOpenApiSource();
  const sourcePaths = [source.config_rel];
  let sourceState = 'openapi_missing';
  let operations = [];
  let modelNames = [];
  let modelSchemas = [];

  if (existsSync(source.abs_path)) {
    sourceState = 'openapi_loaded';
    const spec = YAML.parse(readFileSync(source.abs_path, 'utf8'));
    operations = parseOpenApiOperations(spec);
    const schemas = spec?.components?.schemas || {};
    modelNames = Object.keys(schemas).sort();
    modelSchemas = modelNames.map((name) => ({
      name,
      schema: parseOpenApiSchema(schemas[name]),
    }));
  } else {
    const ruleCatalog = readYaml('.nimi/spec/realm/kernel/tables/rule-catalog.yaml');
    const alignmentMap = readYaml('.nimi/spec/realm/kernel/tables/open-spec-alignment-map.yaml');
    sourcePaths.push(
      '.nimi/spec/realm/kernel/tables/rule-catalog.yaml',
      '.nimi/spec/realm/kernel/tables/open-spec-alignment-map.yaml',
    );
    const alignedRules = new Set(
      (alignmentMap?.mappings || [])
        .filter((entry) => entry?.external_type === 'kernel_rule')
        .map((entry) => String(entry.external_id)),
    );
    operations = (ruleCatalog?.entries || [])
      .filter((ruleId) => alignedRules.has(String(ruleId)))
      .sort()
      .map((ruleId) => ({
        operation_id: String(ruleId),
        method: 'SPEC',
        path: null,
        service: String(ruleId).split('-').slice(0, 2).join('-'),
        tags: ['realm-spec-fallback'],
        request_schema_ref: null,
        response_schema_refs: [],
      }));
    modelNames = [];
  }

  const services = new Map();
  for (const operation of operations) {
    if (!services.has(operation.service)) {
      services.set(operation.service, []);
    }
    services.get(operation.service).push(operation.operation_id);
  }

  return {
    contract: 'nimi.sdks.realm-core-manifest.v1',
    generated_by: generatedBy,
    source_kind: sourceState === 'openapi_loaded' ? 'realm_openapi' : 'realm_spec_fallback',
    source_state: sourceState,
    source_label: source.source_label,
    source_paths: sourcePaths,
    authority_refs: source.config.authority_refs || ['.nimi/spec/sdk/kernel/realm-contract.md'],
    provenance: {
      source_rule: 'S-SURFACE-019',
      notes: [
        'Realm core operation truth is derived from Realm OpenAPI when available.',
        'Admitted Realm spec tables are used only when the configured OpenAPI file is unavailable in this worktree.',
      ],
    },
    operations,
    operation_maps: operations.map((operation) => ({
      operation_id: operation.operation_id,
      service: operation.service,
      method: operation.method,
      path: operation.path,
    })),
    service_registry: [...services.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([name, operation_ids]) => ({ name, operation_ids: operation_ids.sort() })),
    model_maps: modelNames.map((name) => ({ name })),
    model_schemas: modelSchemas,
    property_enums: [],
  };
}

function extractErrorCodes() {
  const table = readYaml('.nimi/spec/sdk/kernel/tables/sdk-error-codes.yaml');
  return {
    contract: 'nimi.sdks.error-codes-manifest.v1',
    generated_by: generatedBy,
    source_kind: 'sdk_spec_table',
    source_paths: ['.nimi/spec/sdk/kernel/tables/sdk-error-codes.yaml'],
    provenance: {
      source_rule: 'S-SURFACE-019',
    },
    values: table.values || [],
    codes: table.codes || [],
  };
}

function buildExportManifest(runtime, realm, errorCodes) {
  return {
    contract: 'nimi.sdks.export-manifest.v1',
    generated_by: generatedBy,
    source_kind: 'sdks_generator_projection',
    source_paths: [
      ...runtime.source_paths,
      ...realm.source_paths,
      ...errorCodes.source_paths,
      '.nimi/spec/sdk/kernel/surface-contract.md',
    ],
    provenance: {
      source_rule: 'S-SURFACE-019',
    },
    languages,
    core_families: ['runtime', 'realm', 'types'],
    excluded_derivative_surfaces: [
      'ai-provider',
      'world',
      'app',
      'permission',
      'ai-config',
      'runtime-route',
      'local-environment',
      'external-framework-adapters',
    ],
    no_forwarding_shims: true,
  };
}

function writeSharedArtifacts(runtime, realm, errorCodes, exportsManifest) {
  writeJson('sdks/generators/shared/generated/runtime-core.manifest.json', runtime);
  writeJson('sdks/generators/shared/generated/realm-core.manifest.json', realm);
  writeJson('sdks/generators/shared/generated/error-codes.manifest.json', errorCodes);
  writeJson('sdks/generators/shared/generated/export-manifest.json', exportsManifest);
}

function languageGeneratedDir(language) {
  if (language === 'go') return 'sdks/go/coregenerated';
  return `sdks/${language}/${language === 'typescript' ? 'core-generated' : 'core_generated'}`;
}

function writeLanguageArtifacts(runtime, realm, errorCodes, exportsManifest) {
  for (const language of languages) {
    const dir = languageGeneratedDir(language);
    writeJson(`${dir}/runtime-core.manifest.json`, {
      ...runtime,
      language,
      generated_projection: 'language-core-generated',
    });
    writeJson(`${dir}/realm-core.manifest.json`, {
      ...realm,
      language,
      generated_projection: 'language-core-generated',
    });
    writeJson(`${dir}/error-codes.manifest.json`, {
      ...errorCodes,
      language,
      generated_projection: 'language-core-generated',
    });
    writeJson(`${dir}/export-manifest.json`, {
      ...exportsManifest,
      language,
      generated_projection: 'language-core-generated',
    });
  }
  writeTypescriptClients(runtime, realm);
  writePythonClients(runtime, realm);
  writeGoClients(runtime, realm);
  writeRustClients(runtime, realm);
  writeTypedClients(runtime, realm);
}

function writeConformanceFixtures(runtime, realm, errorCodes, exportsManifest) {
  const firstUnaryMethod = runtime.codec_maps.find((entry) => entry.kind === 'unary');
  const firstStreamMethod = runtime.codec_maps.find((entry) => entry.kind === 'server_stream');
  const firstRealmOperation = realm.operations.find((entry) => entry.operation_id);
  if (!firstUnaryMethod || !firstStreamMethod || !firstRealmOperation) {
    throw new Error('cannot build behavior fixtures without unary, stream, and realm operation samples');
  }
  const typedNames = typedFixtureNames(firstUnaryMethod, firstStreamMethod, firstRealmOperation);
  writeJson('sdks/conformance/fixtures/core-fixtures.manifest.json', {
    contract: 'nimi.sdks.core-conformance-fixtures.v1',
    generated_by: generatedBy,
    source_kind: 'generated_core_manifests',
    source_paths: [
      'sdks/generators/shared/generated/runtime-core.manifest.json',
      'sdks/generators/shared/generated/realm-core.manifest.json',
      'sdks/generators/shared/generated/error-codes.manifest.json',
      'sdks/generators/shared/generated/export-manifest.json',
    ],
    languages,
    fixture_groups: [
      {
        name: 'runtime_method_presence',
        count: runtime.method_ids.length,
      },
      {
        name: 'realm_operation_presence',
        count: realm.operations.length,
        source_state: realm.source_state,
      },
      {
        name: 'request_response_codecs',
        count: runtime.codec_maps.length,
      },
      {
        name: 'stream_event_branch_preservation',
        count: runtime.codec_maps.filter((entry) => entry.kind.includes('stream')).length,
      },
      {
        name: 'error_reason_code_projection',
        count: errorCodes.values.length,
      },
      {
        name: 'export_manifest',
        count: exportsManifest.core_families.length,
      },
    ],
  });
  writeJson('sdks/conformance/fixtures/behavior-fixtures.json', {
    contract: 'nimi.sdks.behavior-fixtures.v1',
    generated_by: generatedBy,
    source_kind: 'generated_core_manifests',
    source_paths: [
      'sdks/generators/shared/generated/runtime-core.manifest.json',
      'sdks/generators/shared/generated/realm-core.manifest.json',
    ],
    cases: {
      runtime_unary: {
        method_id: firstUnaryMethod.method_id,
        method: firstUnaryMethod.method,
        typed_names: typedNames.runtime_unary,
        request_type: firstUnaryMethod.request_type,
        response_type: firstUnaryMethod.response_type,
        kind: firstUnaryMethod.kind,
        request_body: { hello: 'runtime' },
        response_body: { ok: true, source: 'runtime-unary' },
      },
      runtime_stream: {
        method_id: firstStreamMethod.method_id,
        method: firstStreamMethod.method,
        typed_names: typedNames.runtime_stream,
        request_type: firstStreamMethod.request_type,
        response_type: firstStreamMethod.response_type,
        kind: firstStreamMethod.kind,
        request_body: { hello: 'stream' },
        events: [
          { index: 1, branch: 'delta' },
          { index: 2, branch: 'done' },
        ],
      },
      realm_operation: {
        operation_id: firstRealmOperation.operation_id,
        typed_names: typedNames.realm_operation,
        request_type: realmOperationRequestType(firstRealmOperation.operation_id),
        response_type: realmOperationResponseType(firstRealmOperation.operation_id),
        method: firstRealmOperation.method,
        path: firstRealmOperation.path,
        path_params: { intentId: 'intent-conformance' },
        query: { include: 'projection' },
        headers: { 'x-nimi-realm': 'conformance' },
        request_body: { hello: 'realm' },
        response_body: { ok: true, source: 'realm-operation' },
      },
      metadata: {
        auth: { authorization: 'Bearer conformance' },
        caller: { 'x-nimi-caller': 'sdks-conformance' },
      },
      timeout_ms: 1234,
      cancellation: {
        reason_code: 'OPERATION_ABORTED',
      },
      structured_error: {
        reason_code: 'SDK_RUNTIME_METHOD_UNAVAILABLE',
        message: 'typed conformance error',
        details: { fixture: 'typed-core' },
        request_body: { force_error: 'structured' },
      },
    },
  });
  writeJson('sdks/conformance/manifests/phase1-languages.json', {
    contract: 'nimi.sdks.phase1-languages.v1',
    generated_by: generatedBy,
    source_kind: 'sdk_spec_rule',
    source_paths: ['.nimi/spec/sdk/kernel/surface-contract.md'],
    source_rule: 'S-SURFACE-019',
    languages,
    required_roots: languages.map((language) => `sdks/${language}`),
  });
}

function quote(value) {
  return JSON.stringify(value);
}

function words(value) {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
}

function pascalCase(value) {
  return words(value)
    .map((word) => `${word[0].toUpperCase()}${word.slice(1)}`)
    .join('');
}

function lowerCamelCase(value) {
  const pascal = pascalCase(value);
  return `${pascal[0].toLowerCase()}${pascal.slice(1)}`;
}

function snakeCase(value) {
  return words(value)
    .map((word) => word.toLowerCase())
    .join('_');
}

const pythonKeywords = new Set(['False', 'None', 'True', 'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del', 'elif', 'else', 'except', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is', 'lambda', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'try', 'while', 'with', 'yield']);
const rustKeywords = new Set(['as', 'break', 'const', 'continue', 'crate', 'else', 'enum', 'extern', 'false', 'fn', 'for', 'if', 'impl', 'in', 'let', 'loop', 'match', 'mod', 'move', 'mut', 'pub', 'ref', 'return', 'self', 'Self', 'static', 'struct', 'super', 'trait', 'true', 'type', 'unsafe', 'use', 'where', 'while', 'async', 'await', 'dyn']);

function pyFieldName(name) {
  return pythonKeywords.has(name) ? `${name}_` : name;
}

function rustFieldName(name) {
  return rustKeywords.has(name) ? `r#${name}` : name;
}

function tsPropertyName(name) {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name) ? name : JSON.stringify(name);
}

function uniqueRuntimeMessageTypes(runtime) {
  const types = new Set(runtime.schema_types.messages || []);
  for (const method of runtime.codec_maps) {
    types.add(method.request_type);
    types.add(method.response_type);
  }
  return [...types].sort();
}

function runtimeMessageSchemas(runtime) {
  const byName = new Map((runtime.schema_types.message_schemas || []).map((schema) => [schema.name, schema]));
  return uniqueRuntimeMessageTypes(runtime).map((name) => byName.get(name) || { name, fields: [] });
}

function runtimeEnumSchemas(runtime) {
  return runtime.schema_types.enum_schemas || [];
}

const protoScalars = new Set([
  'string',
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
  'bytes',
  'google.protobuf.Timestamp',
  'google.protobuf.Struct',
  'google.protobuf.Duration',
  'google.protobuf.FieldMask',
]);

function protoTypeKind(type, runtime) {
  if (protoScalars.has(type)) return 'scalar';
  if ((runtime.schema_types.enums || []).includes(type)) return 'enum';
  return 'message';
}

function openApiSuccessSchema(operation) {
  return (operation.response_schemas || []).find((entry) => String(entry.status).startsWith('2'))?.schema
    || operation.response_schemas?.[0]?.schema
    || { kind: 'unknown' };
}

function tsProtoType(field, runtime) {
  const inner = (type) => {
    if (type === 'string' || type === 'google.protobuf.Timestamp' || type === 'google.protobuf.Duration' || type === 'google.protobuf.FieldMask') return 'string';
    if (type === 'google.protobuf.Struct') return 'Record<string, string | number | boolean | null>';
    if (type === 'bool') return 'boolean';
    if (type === 'bytes') return 'Uint8Array';
    if (['int32', 'int64', 'uint32', 'uint64', 'sint32', 'sint64', 'fixed32', 'fixed64', 'sfixed32', 'sfixed64', 'float', 'double'].includes(type)) return 'number';
    return type;
  };
  if (field.type === 'map') return `Readonly<Record<${inner(field.map_key_type)}, ${inner(field.map_value_type)}>>`;
  const base = inner(field.type);
  return field.repeated ? `readonly ${base}[]` : base;
}

function pyProtoType(field, runtime) {
  const inner = (type) => {
    if (type === 'string' || type === 'google.protobuf.Timestamp' || type === 'google.protobuf.Duration' || type === 'google.protobuf.FieldMask') return 'str';
    if (type === 'google.protobuf.Struct') return 'Mapping[str, object]';
    if (type === 'bool') return 'bool';
    if (type === 'bytes') return 'bytes';
    if (['int32', 'int64', 'uint32', 'uint64', 'sint32', 'sint64', 'fixed32', 'fixed64', 'sfixed32', 'sfixed64'].includes(type)) return 'int';
    if (['float', 'double'].includes(type)) return 'float';
    return type;
  };
  if (field.type === 'map') return `Mapping[${inner(field.map_key_type)}, ${inner(field.map_value_type)}]`;
  const base = inner(field.type);
  return field.repeated ? `tuple[${base}, ...]` : base;
}

function goProtoType(field, runtime) {
  const inner = (type, repeated = false) => {
    if (type === 'string' || type === 'google.protobuf.Timestamp' || type === 'google.protobuf.Duration' || type === 'google.protobuf.FieldMask') return 'string';
    if (type === 'google.protobuf.Struct') return 'map[string]any';
    if (type === 'bool') return 'bool';
    if (type === 'bytes') return '[]byte';
    if (type === 'int32' || type === 'sint32' || type === 'sfixed32') return 'int32';
    if (type === 'uint32' || type === 'fixed32') return 'uint32';
    if (type === 'int64' || type === 'sint64' || type === 'sfixed64') return 'int64';
    if (type === 'uint64' || type === 'fixed64') return 'uint64';
    if (type === 'float') return 'float32';
    if (type === 'double') return 'float64';
    return protoTypeKind(type, runtime) === 'message' && !repeated ? `*${type}` : type;
  };
  if (field.type === 'map') return `map[${inner(field.map_key_type, true)}]${inner(field.map_value_type, true)}`;
  const base = inner(field.type, field.repeated);
  return field.repeated ? `[]${base}` : base;
}

function rustProtoType(field, runtime) {
  const inner = (type, nested = false) => {
    if (type === 'string' || type === 'google.protobuf.Timestamp' || type === 'google.protobuf.Duration' || type === 'google.protobuf.FieldMask') return 'String';
    if (type === 'google.protobuf.Struct') return 'BTreeMap<String, String>';
    if (type === 'bool') return 'bool';
    if (type === 'bytes') return 'Vec<u8>';
    if (type === 'int32' || type === 'sint32' || type === 'sfixed32') return 'i32';
    if (type === 'uint32' || type === 'fixed32') return 'u32';
    if (type === 'int64' || type === 'sint64' || type === 'sfixed64') return 'i64';
    if (type === 'uint64' || type === 'fixed64') return 'u64';
    if (type === 'float') return 'f32';
    if (type === 'double') return 'f64';
    return protoTypeKind(type, runtime) === 'message' && nested ? `Box<${type}>` : type;
  };
  if (field.type === 'map') return `BTreeMap<${inner(field.map_key_type)}, ${inner(field.map_value_type, true)}>`;
  const base = inner(field.type, true);
  if (field.repeated) return `Vec<${base}>`;
  return `Option<${base}>`;
}

function tsOpenApiType(schema) {
  if (!schema || schema.kind === 'unknown') return 'Record<string, never>';
  if (schema.kind === 'ref') return schema.ref_name;
  if (schema.kind === 'enum') return schema.values.map(quote).join(' | ') || 'string';
  if (schema.kind === 'array') return `readonly (${tsOpenApiType(schema.items)})[]`;
  if (schema.kind === 'object') return 'Record<string, unknown>';
  if (schema.kind === 'union') return schema.variants.map(tsOpenApiType).join(' | ') || 'unknown';
  if (schema.type === 'string' || schema.format === 'date-time') return 'string';
  if (schema.type === 'boolean') return 'boolean';
  if (schema.type === 'integer' || schema.type === 'number') return 'number';
  return 'unknown';
}

function pyOpenApiType(schema) {
  if (!schema || schema.kind === 'unknown') return 'None';
  if (schema.kind === 'ref') return schema.ref_name;
  if (schema.kind === 'enum') return `Literal[${schema.values.map(quote).join(', ')}]`;
  if (schema.kind === 'array') return `tuple[${pyOpenApiType(schema.items)}, ...]`;
  if (schema.kind === 'object') return 'Mapping[str, object]';
  if (schema.kind === 'union') return schema.variants.map(pyOpenApiType).join(' | ') || 'object';
  if (schema.type === 'string' || schema.format === 'date-time') return 'str';
  if (schema.type === 'boolean') return 'bool';
  if (schema.type === 'integer') return 'int';
  if (schema.type === 'number') return 'float';
  return 'object';
}

function goOpenApiType(schema) {
  if (!schema || schema.kind === 'unknown') return 'struct{}';
  if (schema.kind === 'ref') return schema.ref_name;
  if (schema.kind === 'enum') return 'string';
  if (schema.kind === 'array') return `[]${goOpenApiType(schema.items)}`;
  if (schema.kind === 'object') return 'map[string]any';
  if (schema.kind === 'union') return 'any';
  if (schema.type === 'string' || schema.format === 'date-time') return 'string';
  if (schema.type === 'boolean') return 'bool';
  if (schema.type === 'integer') return 'int64';
  if (schema.type === 'number') return 'float64';
  return 'any';
}

function goOpenApiFieldType(schema) {
  return schema?.kind === 'ref' ? `*${schema.ref_name}` : goOpenApiType(schema);
}

function goZeroExpr(type) {
  if (type === 'string') return '""';
  if (type === 'bool') return 'false';
  if (['int64', 'float64', 'any'].includes(type)) return 'nil';
  if (type.startsWith('[]')) return `${type}{}`;
  if (type.startsWith('map[')) return `${type}{}`;
  return `${type}{}`;
}

function rustOpenApiType(schema) {
  if (!schema || schema.kind === 'unknown') return '()';
  if (schema.kind === 'ref') return schema.ref_name;
  if (schema.kind === 'enum') return 'String';
  if (schema.kind === 'array') return `Vec<${rustOpenApiType(schema.items)}>`;
  if (schema.kind === 'object') return 'BTreeMap<String, String>';
  if (schema.kind === 'union') return 'String';
  if (schema.type === 'string' || schema.format === 'date-time') return 'String';
  if (schema.type === 'boolean') return 'bool';
  if (schema.type === 'integer') return 'i64';
  if (schema.type === 'number') return 'f64';
  return 'String';
}

function rustOpenApiFieldType(schema) {
  return schema?.kind === 'ref' ? `Box<${schema.ref_name}>` : rustOpenApiType(schema);
}

function rustDefaultExpr(type) {
  if (type === '()') return '<()>::default()';
  if (type.startsWith('Vec<')) return `${type.replace('Vec<', 'Vec::<')}::default()`;
  if (type.startsWith('BTreeMap<')) return `${type.replace('BTreeMap<', 'BTreeMap::<')}::default()`;
  return `${type}::default()`;
}

function realmOperationTypeBase(operationId) {
  return `Realm${pascalCase(operationId)}Operation`;
}

function realmOperationRequestType(operationId) {
  return `${realmOperationTypeBase(operationId)}Request`;
}

function realmOperationResponseType(operationId) {
  return `${realmOperationTypeBase(operationId)}Response`;
}

function typedFixtureNames(runtimeMethod, streamMethod, realmOperation) {
  return {
    runtime_unary: {
      typescript: lowerCamelCase(runtimeMethod.method),
      python: snakeCase(runtimeMethod.method),
      go: pascalCase(runtimeMethod.method),
      rust: snakeCase(runtimeMethod.method),
    },
    runtime_stream: {
      typescript: lowerCamelCase(streamMethod.method),
      python: snakeCase(streamMethod.method),
      go: pascalCase(streamMethod.method),
      rust: snakeCase(streamMethod.method),
    },
    realm_operation: {
      typescript: lowerCamelCase(realmOperation.operation_id),
      python: snakeCase(realmOperation.operation_id),
      go: pascalCase(realmOperation.operation_id),
      rust: snakeCase(realmOperation.operation_id),
    },
  };
}

function writeTypescriptClients(runtime, realm) {
  const runtimeMethods = runtime.codec_maps.map((entry) => ({
    methodId: entry.method_id,
    service: entry.service,
    method: entry.method,
    kind: entry.kind,
    requestType: entry.request_type,
    responseType: entry.response_type,
  }));
  const realmOperations = realm.operation_maps.map((entry) => ({
    operationId: entry.operation_id,
    service: entry.service,
    method: entry.method,
    path: entry.path,
  }));
  writeText('sdks/typescript/core-generated/runtime-client.ts', `// @generated by ${generatedBy}
// DO NOT EDIT MANUALLY.

import { CoreClient } from '../core-client';
import type { CoreMetadata, CoreMethodKind } from '../types';

export interface RuntimeMethodDescriptor {
  readonly methodId: string;
  readonly service: string;
  readonly method: string;
  readonly kind: CoreMethodKind;
  readonly requestType: string;
  readonly responseType: string;
}

export const RUNTIME_METHODS: readonly RuntimeMethodDescriptor[] = ${JSON.stringify(runtimeMethods, null, 2)} as const;

export const RUNTIME_METHOD_BY_ID: ReadonlyMap<string, RuntimeMethodDescriptor> = new Map(
  RUNTIME_METHODS.map((method) => [method.methodId, method]),
);

export interface RuntimeCallOptions {
  readonly metadata?: CoreMetadata;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export class RuntimeGeneratedClient {
  constructor(private readonly core: CoreClient) {}

  describe(methodId: string): RuntimeMethodDescriptor {
    const descriptor = RUNTIME_METHOD_BY_ID.get(methodId);
    if (!descriptor) {
      throw Object.assign(new Error(\`unknown Runtime method: \${methodId}\`), {
        code: 'SDK_RUNTIME_METHOD_UNAVAILABLE',
      });
    }
    return descriptor;
  }

  async call<Response = unknown, Body = unknown>(methodId: string, body: Body, options: RuntimeCallOptions = {}): Promise<Response> {
    const descriptor = this.describe(methodId);
    if (descriptor.kind !== 'unary') {
      throw Object.assign(new Error(\`Runtime method is not unary: \${methodId}\`), {
        code: 'SDK_RUNTIME_METHOD_UNAVAILABLE',
      });
    }
    return this.core.unary<Response, Body>({
      methodId,
      body,
      metadata: options.metadata,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
    });
  }

  stream<Response = unknown, Body = unknown>(methodId: string, body: Body, options: RuntimeCallOptions = {}): AsyncIterable<Response> {
    const descriptor = this.describe(methodId);
    if (!descriptor.kind.includes('stream')) {
      throw Object.assign(new Error(\`Runtime method is not streaming: \${methodId}\`), {
        code: 'SDK_RUNTIME_METHOD_UNAVAILABLE',
      });
    }
    return this.core.serverStream<Response, Body>({
      methodId,
      body,
      metadata: options.metadata,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
    });
  }

  unsafeRaw() {
    return this.core.unsafeRaw();
  }
}
`);
  writeText('sdks/typescript/core-generated/realm-client.ts', `// @generated by ${generatedBy}
// DO NOT EDIT MANUALLY.

import { CoreClient } from '../core-client';
import type { CoreMetadata } from '../types';

export interface RealmOperationDescriptor {
  readonly operationId: string;
  readonly service: string;
  readonly method: string;
  readonly path: string | null;
}

export const REALM_OPERATIONS: readonly RealmOperationDescriptor[] = ${JSON.stringify(realmOperations, null, 2)} as const;

export const REALM_OPERATION_BY_ID: ReadonlyMap<string, RealmOperationDescriptor> = new Map(
  REALM_OPERATIONS.map((operation) => [operation.operationId, operation]),
);

export interface RealmCallOptions {
  readonly metadata?: CoreMetadata;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export class RealmGeneratedClient {
  constructor(private readonly core: CoreClient) {}

  describe(operationId: string): RealmOperationDescriptor {
    const descriptor = REALM_OPERATION_BY_ID.get(operationId);
    if (!descriptor) {
      throw Object.assign(new Error(\`unknown Realm operation: \${operationId}\`), {
        code: 'SDK_REALM_CONFIG_INVALID',
      });
    }
    return descriptor;
  }

  async operation<Response = unknown, Body = unknown>(operationId: string, body: Body, options: RealmCallOptions = {}): Promise<Response> {
    this.describe(operationId);
    return this.core.unary<Response, Body>({
      methodId: operationId,
      body,
      metadata: options.metadata,
      timeoutMs: options.timeoutMs,
      signal: options.signal,
    });
  }

  unsafeRaw() {
    return this.core.unsafeRaw();
  }
}
`);
}

function toPythonLiteral(value) {
  return JSON.stringify(value, null, 2)
    .replace(/\btrue\b/g, 'True')
    .replace(/\bfalse\b/g, 'False')
    .replace(/\bnull\b/g, 'None');
}

function writePythonClients(runtime, realm) {
  const runtimeMethods = runtime.codec_maps.map((entry) => ({
    method_id: entry.method_id,
    service: entry.service,
    method: entry.method,
    kind: entry.kind,
    request_type: entry.request_type,
    response_type: entry.response_type,
  }));
  const realmOperations = realm.operation_maps.map((entry) => ({
    operation_id: entry.operation_id,
    service: entry.service,
    method: entry.method,
    path: entry.path,
  }));
  writeText('sdks/python/core_generated/runtime_client.py', `# @generated by ${generatedBy}
# DO NOT EDIT MANUALLY.

from typing import Any

from sdks.python.core_client import CoreClient
from sdks.python.types import CoreStreamRequest, CoreUnaryRequest

RUNTIME_METHODS = ${toPythonLiteral(runtimeMethods)}
RUNTIME_METHOD_BY_ID = {method["method_id"]: method for method in RUNTIME_METHODS}


class RuntimeGeneratedClient:
    def __init__(self, core: CoreClient) -> None:
        self._core = core

    def describe(self, method_id: str) -> dict[str, Any]:
        try:
            return RUNTIME_METHOD_BY_ID[method_id]
        except KeyError as exc:
            error = RuntimeError(f"unknown Runtime method: {method_id}")
            setattr(error, "code", "SDK_RUNTIME_METHOD_UNAVAILABLE")
            raise error from exc

    async def call(self, method_id: str, body: Any, *, metadata: dict[str, str] | None = None, timeout_ms: int | None = None) -> Any:
        descriptor = self.describe(method_id)
        if descriptor["kind"] != "unary":
            error = RuntimeError(f"Runtime method is not unary: {method_id}")
            setattr(error, "code", "SDK_RUNTIME_METHOD_UNAVAILABLE")
            raise error
        return await self._core.unary(CoreUnaryRequest(method_id=method_id, body=body, metadata=metadata, timeout_ms=timeout_ms))

    def stream(self, method_id: str, body: Any, *, metadata: dict[str, str] | None = None, timeout_ms: int | None = None):
        descriptor = self.describe(method_id)
        if "stream" not in descriptor["kind"]:
            error = RuntimeError(f"Runtime method is not streaming: {method_id}")
            setattr(error, "code", "SDK_RUNTIME_METHOD_UNAVAILABLE")
            raise error
        return self._core.server_stream(CoreStreamRequest(method_id=method_id, body=body, metadata=metadata, timeout_ms=timeout_ms))

    def unsafe_raw(self):
        return self._core.unsafe_raw()
`);
  writeText('sdks/python/core_generated/realm_client.py', `# @generated by ${generatedBy}
# DO NOT EDIT MANUALLY.

from typing import Any

from sdks.python.core_client import CoreClient
from sdks.python.types import CoreUnaryRequest

REALM_OPERATIONS = ${toPythonLiteral(realmOperations)}
REALM_OPERATION_BY_ID = {operation["operation_id"]: operation for operation in REALM_OPERATIONS}


class RealmGeneratedClient:
    def __init__(self, core: CoreClient) -> None:
        self._core = core

    def describe(self, operation_id: str) -> dict[str, Any]:
        try:
            return REALM_OPERATION_BY_ID[operation_id]
        except KeyError as exc:
            error = RuntimeError(f"unknown Realm operation: {operation_id}")
            setattr(error, "code", "SDK_REALM_CONFIG_INVALID")
            raise error from exc

    async def operation(self, operation_id: str, body: Any, *, metadata: dict[str, str] | None = None, timeout_ms: int | None = None) -> Any:
        self.describe(operation_id)
        return await self._core.unary(CoreUnaryRequest(method_id=operation_id, body=body, metadata=metadata, timeout_ms=timeout_ms))

    def unsafe_raw(self):
        return self._core.unsafe_raw()
`);
}

function writeGoClients(runtime, realm) {
  const runtimeMethods = runtime.codec_maps.map((entry) => ({
    MethodID: entry.method_id,
    Service: entry.service,
    Method: entry.method,
    Kind: entry.kind,
    RequestType: entry.request_type,
    ResponseType: entry.response_type,
  }));
  const realmOperations = realm.operation_maps.map((entry) => ({
    OperationID: entry.operation_id,
    Service: entry.service,
    Method: entry.method,
    Path: entry.path,
  }));
  const goRuntimeMethods = runtimeMethods.map((item) => `	{MethodID: ${quote(item.MethodID)}, Service: ${quote(item.Service)}, Method: ${quote(item.Method)}, Kind: ${quote(item.Kind)}, RequestType: ${quote(item.RequestType)}, ResponseType: ${quote(item.ResponseType)}},`).join('\n');
  const goRealmOperations = realmOperations.map((item) => `	{OperationID: ${quote(item.OperationID)}, Service: ${quote(item.Service)}, Method: ${quote(item.Method)}, Path: ${quote(item.Path ?? '')}},`).join('\n');
  writeText('sdks/go/coregenerated/runtime_client.go', `// Code generated by ${generatedBy}; DO NOT EDIT.

package coregenerated

import (
	"context"
	"fmt"
	"strings"

	"github.com/nimiplatform/nimi/sdks/go/coreclient"
	sdkstypes "github.com/nimiplatform/nimi/sdks/go/types"
)

type RuntimeMethodDescriptor struct {
	MethodID     string
	Service      string
	Method       string
	Kind         string
	RequestType  string
	ResponseType string
}

var RuntimeMethods = []RuntimeMethodDescriptor{
${goRuntimeMethods}
}

var RuntimeMethodByID = func() map[string]RuntimeMethodDescriptor {
	out := map[string]RuntimeMethodDescriptor{}
	for _, method := range RuntimeMethods {
		out[method.MethodID] = method
	}
	return out
}()

type RuntimeGeneratedClient struct {
	core coreclient.Client
}

func NewRuntimeGeneratedClient(core coreclient.Client) RuntimeGeneratedClient {
	return RuntimeGeneratedClient{core: core}
}

func (c RuntimeGeneratedClient) Describe(methodID string) (RuntimeMethodDescriptor, error) {
	descriptor, ok := RuntimeMethodByID[methodID]
	if !ok {
		return RuntimeMethodDescriptor{}, fmt.Errorf("SDK_RUNTIME_METHOD_UNAVAILABLE: unknown Runtime method %s", methodID)
	}
	return descriptor, nil
}

func (c RuntimeGeneratedClient) Call(ctx context.Context, methodID string, body []byte, metadata sdkstypes.CoreMetadata, timeoutMS int64) ([]byte, error) {
	descriptor, err := c.Describe(methodID)
	if err != nil {
		return nil, err
	}
	if descriptor.Kind != "unary" {
		return nil, fmt.Errorf("SDK_RUNTIME_METHOD_UNAVAILABLE: Runtime method is not unary %s", methodID)
	}
	return c.core.Unary(ctx, sdkstypes.CoreUnaryRequest{Context: ctx, MethodID: methodID, Metadata: metadata, Body: body, TimeoutMS: timeoutMS})
}

func (c RuntimeGeneratedClient) Stream(ctx context.Context, methodID string, body []byte, metadata sdkstypes.CoreMetadata, timeoutMS int64) (coreclient.StreamReader, error) {
	descriptor, err := c.Describe(methodID)
	if err != nil {
		return nil, err
	}
	if !strings.Contains(descriptor.Kind, "stream") {
		return nil, fmt.Errorf("SDK_RUNTIME_METHOD_UNAVAILABLE: Runtime method is not streaming %s", methodID)
	}
	return c.core.ServerStream(ctx, sdkstypes.CoreStreamRequest{Context: ctx, MethodID: methodID, Metadata: metadata, Body: body, TimeoutMS: timeoutMS})
}

func (c RuntimeGeneratedClient) UnsafeRaw() coreclient.Transport {
	return c.core.UnsafeRaw()
}
`);
  writeText('sdks/go/coregenerated/realm_client.go', `// Code generated by ${generatedBy}; DO NOT EDIT.

package coregenerated

import (
	"context"
	"fmt"

	"github.com/nimiplatform/nimi/sdks/go/coreclient"
	sdkstypes "github.com/nimiplatform/nimi/sdks/go/types"
)

type RealmOperationDescriptor struct {
	OperationID string
	Service     string
	Method      string
	Path        string
}

var RealmOperations = []RealmOperationDescriptor{
${goRealmOperations}
}

var RealmOperationByID = func() map[string]RealmOperationDescriptor {
	out := map[string]RealmOperationDescriptor{}
	for _, operation := range RealmOperations {
		out[operation.OperationID] = operation
	}
	return out
}()

type RealmGeneratedClient struct {
	core coreclient.Client
}

func NewRealmGeneratedClient(core coreclient.Client) RealmGeneratedClient {
	return RealmGeneratedClient{core: core}
}

func (c RealmGeneratedClient) Describe(operationID string) (RealmOperationDescriptor, error) {
	descriptor, ok := RealmOperationByID[operationID]
	if !ok {
		return RealmOperationDescriptor{}, fmt.Errorf("SDK_REALM_CONFIG_INVALID: unknown Realm operation %s", operationID)
	}
	return descriptor, nil
}

func (c RealmGeneratedClient) Operation(ctx context.Context, operationID string, body []byte, metadata sdkstypes.CoreMetadata, timeoutMS int64) ([]byte, error) {
	if _, err := c.Describe(operationID); err != nil {
		return nil, err
	}
	return c.core.Unary(ctx, sdkstypes.CoreUnaryRequest{Context: ctx, MethodID: operationID, Metadata: metadata, Body: body, TimeoutMS: timeoutMS})
}

func (c RealmGeneratedClient) UnsafeRaw() coreclient.Transport {
	return c.core.UnsafeRaw()
}
`);
}

function rustArrayOfDescriptors(items, fields) {
  return items.map((item) => {
    const entries = fields.map(([field, valueFn]) => `        ${field}: ${valueFn(item)},`).join('\n');
    return `    ${fields[0][0].startsWith('method') ? 'RuntimeMethodDescriptor' : 'RealmOperationDescriptor'} {\n${entries}\n    },`;
  }).join('\n');
}

function rustStr(value) {
  return `${quote(value)}`;
}

function rustOptStr(value) {
  return value == null ? 'None' : `Some(${quote(value)})`;
}

function writeRustClients(runtime, realm) {
  const runtimeMethods = runtime.codec_maps.map((entry) => ({
    method_id: entry.method_id,
    service: entry.service,
    method: entry.method,
    kind: entry.kind,
    request_type: entry.request_type,
    response_type: entry.response_type,
  }));
  const realmOperations = realm.operation_maps.map((entry) => ({
    operation_id: entry.operation_id,
    service: entry.service,
    method: entry.method,
    path: entry.path,
  }));
  writeText('sdks/rust/core_generated/mod.rs', `// @generated by ${generatedBy}
// DO NOT EDIT MANUALLY.

pub mod realm_client;
pub mod runtime_client;
pub mod typed_clients;
`);
  writeText('sdks/rust/core_generated/runtime_client.rs', `// @generated by ${generatedBy}
// DO NOT EDIT MANUALLY.

use crate::core_client::{CoreClient, CoreTransport};
use crate::types::{CoreMetadata, CoreStreamRequest, CoreUnaryRequest};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RuntimeMethodDescriptor {
    pub method_id: &'static str,
    pub service: &'static str,
    pub method: &'static str,
    pub kind: &'static str,
    pub request_type: &'static str,
    pub response_type: &'static str,
}

pub static RUNTIME_METHODS: &[RuntimeMethodDescriptor] = &[
${rustArrayOfDescriptors(runtimeMethods, [
  ['method_id', (item) => rustStr(item.method_id)],
  ['service', (item) => rustStr(item.service)],
  ['method', (item) => rustStr(item.method)],
  ['kind', (item) => rustStr(item.kind)],
  ['request_type', (item) => rustStr(item.request_type)],
  ['response_type', (item) => rustStr(item.response_type)],
])}
];

pub struct RuntimeGeneratedClient<T, A>
where
    T: CoreTransport,
    A: Fn() -> CoreMetadata,
{
    core: CoreClient<T, A>,
}

impl<T, A> RuntimeGeneratedClient<T, A>
where
    T: CoreTransport,
    A: Fn() -> CoreMetadata,
{
    pub fn new(core: CoreClient<T, A>) -> Self {
        Self { core }
    }

    pub fn describe(&self, method_id: &str) -> Result<&'static RuntimeMethodDescriptor, String> {
        RUNTIME_METHODS
            .iter()
            .find(|method| method.method_id == method_id)
            .ok_or_else(|| format!("SDK_RUNTIME_METHOD_UNAVAILABLE: unknown Runtime method {method_id}"))
    }

    pub fn call(&self, method_id: &str, body: Vec<u8>, metadata: CoreMetadata, timeout: Option<std::time::Duration>) -> Result<Vec<u8>, T::Error> {
        let descriptor = match self.describe(method_id) {
            Ok(descriptor) => descriptor,
            Err(message) => panic!("{}", message),
        };
        if descriptor.kind != "unary" {
            panic!("SDK_RUNTIME_METHOD_UNAVAILABLE: Runtime method is not unary {}", method_id);
        }
        self.core.unary(CoreUnaryRequest {
            method_id: method_id.to_string(),
            metadata,
            body,
            timeout,
        })
    }

    pub fn stream(&self, method_id: &str, body: Vec<u8>, metadata: CoreMetadata, timeout: Option<std::time::Duration>) -> Result<T::Stream, T::Error> {
        let descriptor = match self.describe(method_id) {
            Ok(descriptor) => descriptor,
            Err(message) => panic!("{}", message),
        };
        if !descriptor.kind.contains("stream") {
            panic!("SDK_RUNTIME_METHOD_UNAVAILABLE: Runtime method is not streaming {}", method_id);
        }
        self.core.server_stream(CoreStreamRequest {
            method_id: method_id.to_string(),
            metadata,
            body,
            timeout,
        })
    }

    pub fn unsafe_raw(&self) -> &T {
        self.core.unsafe_raw()
    }
}
`);
  writeText('sdks/rust/core_generated/realm_client.rs', `// @generated by ${generatedBy}
// DO NOT EDIT MANUALLY.

use crate::core_client::{CoreClient, CoreTransport};
use crate::types::{CoreMetadata, CoreUnaryRequest};

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RealmOperationDescriptor {
    pub operation_id: &'static str,
    pub service: &'static str,
    pub method: &'static str,
    pub path: Option<&'static str>,
}

pub static REALM_OPERATIONS: &[RealmOperationDescriptor] = &[
${realmOperations.map((item) => `    RealmOperationDescriptor {\n        operation_id: ${rustStr(item.operation_id)},\n        service: ${rustStr(item.service)},\n        method: ${rustStr(item.method)},\n        path: ${rustOptStr(item.path)},\n    },`).join('\n')}
];

pub struct RealmGeneratedClient<T, A>
where
    T: CoreTransport,
    A: Fn() -> CoreMetadata,
{
    core: CoreClient<T, A>,
}

impl<T, A> RealmGeneratedClient<T, A>
where
    T: CoreTransport,
    A: Fn() -> CoreMetadata,
{
    pub fn new(core: CoreClient<T, A>) -> Self {
        Self { core }
    }

    pub fn describe(&self, operation_id: &str) -> Result<&'static RealmOperationDescriptor, String> {
        REALM_OPERATIONS
            .iter()
            .find(|operation| operation.operation_id == operation_id)
            .ok_or_else(|| format!("SDK_REALM_CONFIG_INVALID: unknown Realm operation {operation_id}"))
    }

    pub fn operation(&self, operation_id: &str, body: Vec<u8>, metadata: CoreMetadata, timeout: Option<std::time::Duration>) -> Result<Vec<u8>, T::Error> {
        if let Err(message) = self.describe(operation_id) {
            panic!("{}", message);
        }
        self.core.unary(CoreUnaryRequest {
            method_id: operation_id.to_string(),
            metadata,
            body,
            timeout,
        })
    }

    pub fn unsafe_raw(&self) -> &T {
        self.core.unsafe_raw()
    }
}
`);
}

function writeTypedClients(runtime, realm) {
  writeTypescriptTypedClients(runtime, realm);
  writePythonTypedClients(runtime, realm);
  writeGoTypedClients(runtime, realm);
  writeRustTypedClients(runtime, realm);
}

function writeTypescriptTypedClients(runtime, realm) {
  const runtimeEnums = runtimeEnumSchemas(runtime)
    .map((schema) => `export type ${schema.name} = ${schema.values.length ? schema.values.map(quote).join(' | ') : 'string'};`)
    .join('\n');
  const runtimeTypes = runtimeMessageSchemas(runtime)
    .map((schema) => {
      const fields = schema.fields.map((field) => `  readonly ${tsPropertyName(field.name)}?: ${tsProtoType(field, runtime)};`).join('\n');
      return `export interface ${schema.name} {\n${fields}\n}`;
    })
    .join('\n');
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
    });
  }`;
  }).join('\n\n');
  writeText('sdks/typescript/core-generated/runtime-typed-client.ts', `// @generated by ${generatedBy}
// DO NOT EDIT MANUALLY.

import { CoreClient } from '../core-client';
import type { CoreMetadata } from '../types';

export interface RuntimeTypedCallOptions {
  readonly metadata?: CoreMetadata;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

${runtimeEnums}

${runtimeTypes}

export class RuntimeTypedClient {
  constructor(private readonly core: CoreClient) {}

${runtimeMethods}
}
`);
  writeText('sdks/typescript/core-generated/realm-typed-client.ts', `// @generated by ${generatedBy}
// DO NOT EDIT MANUALLY.

import { CoreClient } from '../core-client';
import type { CoreMetadata } from '../types';
export interface RealmTypedCallOptions {
  readonly metadata?: CoreMetadata;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

${realmModels}

${realmTypes}

export class RealmTypedClient {
  constructor(private readonly core: CoreClient) {}

${realmMethods}
}
`);
}

function writePythonTypedClients(runtime, realm) {
  const runtimeEnums = runtimeEnumSchemas(runtime)
    .map((schema) => `${schema.name} = Literal[${schema.values.length ? schema.values.map(quote).join(', ') : '"__unspecified__"'}]`)
    .join('\n');
  const runtimeTypes = runtimeMessageSchemas(runtime)
    .map((schema) => {
      const fields = schema.fields.map((field) => {
        const type = pyProtoType(field, runtime);
        if (field.type === 'map') return `    ${pyFieldName(field.name)}: ${type} = field(default_factory=dict)`;
        if (field.repeated) return `    ${pyFieldName(field.name)}: ${type} = field(default_factory=tuple)`;
        return `    ${pyFieldName(field.name)}: ${type} | None = None`;
      }).join('\n') || '    pass';
      return `@dataclass(frozen=True)
class ${schema.name}:
${fields}`;
    })
    .join('\n\n');
  const runtimeMethods = runtime.codec_maps.map((method) => {
    const name = snakeCase(method.method);
    if (method.kind === 'unary') {
      return `    async def ${name}(self, request: ${method.request_type}, *, metadata: Mapping[str, str] | None = None, timeout_ms: int | None = None) -> ${method.response_type}:
        raw: object = await self._core.unary(CoreUnaryRequest(method_id=${quote(method.method_id)}, body=_model_body(request), metadata=metadata, timeout_ms=timeout_ms))
        return _decode_model(${method.response_type}, raw)`;
    }
    if (method.kind === 'server_stream') {
      return `    def ${name}(self, request: ${method.request_type}, *, metadata: Mapping[str, str] | None = None, timeout_ms: int | None = None) -> AsyncIterator[${method.response_type}]:
        return self._stream(${quote(method.method_id)}, _model_body(request), ${method.response_type}, metadata=metadata, timeout_ms=timeout_ms)`;
    }
    return `    async def ${name}(self, request: ${method.request_type}, *, metadata: Mapping[str, str] | None = None, timeout_ms: int | None = None) -> ${method.response_type}:
        raise RuntimeError(${quote(`SDK_RUNTIME_METHOD_UNAVAILABLE: Runtime method kind is not supported by the unary/server-stream core transport: ${method.method_id}`)})`;
  }).join('\n\n');
  const realmModels = (realm.model_schemas || []).map((model) => {
    if (model.schema.kind !== 'object') return `${model.name} = ${pyOpenApiType(model.schema)}`;
    const fields = model.schema.properties.map((property) => {
      const type = pyOpenApiType(property.schema);
      if (property.schema.kind === 'array') return `    ${pyFieldName(property.name)}: ${type} = field(default_factory=tuple)`;
      if (property.schema.kind === 'object') return `    ${pyFieldName(property.name)}: ${type} = field(default_factory=dict)`;
      return `    ${pyFieldName(property.name)}: ${type} | None = None`;
    }).join('\n') || '    pass';
    return `@dataclass(frozen=True)
class ${model.name}:
${fields}`;
  }).join('\n\n');
  const realmTypes = realm.operations.map((operation) => {
    const base = realmOperationTypeBase(operation.operation_id);
    const pathFields = (operation.path_parameters || []).map((parameter) => `    ${pyFieldName(parameter.name)}: ${pyOpenApiType(parameter.schema)}${parameter.required ? '' : ' | None = None'}`).join('\n') || '    pass';
    const queryFields = (operation.query_parameters || []).map((parameter) => `    ${pyFieldName(parameter.name)}: ${pyOpenApiType(parameter.schema)} | None = None`).join('\n') || '    pass';
    const headerFields = (operation.header_parameters || []).map((parameter) => `    ${snakeCase(parameter.name)}: ${pyOpenApiType(parameter.schema)} | None = None`).join('\n') || '    pass';
    return `@dataclass(frozen=True)
class ${base}Path:
${pathFields}


@dataclass(frozen=True)
class ${base}Query:
${queryFields}


@dataclass(frozen=True)
class ${base}Headers:
${headerFields}


@dataclass(frozen=True)
class ${base}Request:
    path: ${base}Path
    query: ${base}Query | None = None
    headers: ${base}Headers | None = None
    body: ${pyOpenApiType(operation.request_schema)} | None = None`;
  }).join('\n\n');
  const realmMethods = realm.operations.map((operation) => {
    const base = realmOperationTypeBase(operation.operation_id);
    return `    async def ${snakeCase(operation.operation_id)}(self, request: ${base}Request, *, metadata: Mapping[str, str] | None = None, timeout_ms: int | None = None) -> ${base}Response:
        envelope: dict[str, object] = {
            "path": _model_body(request.path),
            "query": _model_body(request.query),
            "headers": _model_body(request.headers),
            "body": _model_body(request.body),
        }
        raw: object = await self._core.unary(CoreUnaryRequest(method_id=${quote(operation.operation_id)}, body=envelope, metadata=metadata, timeout_ms=timeout_ms))
        return _decode_model(${pyOpenApiType(openApiSuccessSchema(operation))}, raw)`;
  }).join('\n\n');
  writeText('sdks/python/core_generated/runtime_typed_client.py', `# @generated by ${generatedBy}
# DO NOT EDIT MANUALLY.

from __future__ import annotations
from collections.abc import AsyncIterator, Mapping
from dataclasses import asdict, dataclass, field, fields, is_dataclass
from typing import Literal, TypeVar

from sdks.python.core_client import CoreClient
from sdks.python.types import CoreStreamRequest, CoreUnaryRequest

_T = TypeVar("_T")


def _model_body(value: object) -> object:
    if value is None:
        return {}
    if is_dataclass(value):
        return asdict(value)
    if isinstance(value, Mapping):
        return dict(value)
    return value


def _decode_model(model_type: type[_T], value: object) -> _T:
    if not is_dataclass(model_type):
        return value  # type: ignore[return-value]
    source = dict(value) if isinstance(value, Mapping) else {}
    names = {field.name for field in fields(model_type)}
    return model_type(**{key: val for key, val in source.items() if key in names})


${runtimeEnums}

${runtimeTypes}


class RuntimeTypedClient:
    def __init__(self, core: CoreClient) -> None:
        self._core = core

    async def _stream(self, method_id: str, body: object, response_type: type[_T], *, metadata: Mapping[str, str] | None = None, timeout_ms: int | None = None) -> AsyncIterator[_T]:
        async for event in self._core.server_stream(CoreStreamRequest(method_id=method_id, body=body, metadata=metadata, timeout_ms=timeout_ms)):
            yield _decode_model(response_type, event)

${runtimeMethods}
`);
  writeText('sdks/python/core_generated/realm_typed_client.py', `# @generated by ${generatedBy}
# DO NOT EDIT MANUALLY.

from __future__ import annotations
from collections.abc import Mapping
from dataclasses import asdict, dataclass, field, fields, is_dataclass
from typing import Literal

from sdks.python.core_client import CoreClient
from sdks.python.types import CoreUnaryRequest


def _model_body(value: object) -> object:
    if value is None:
        return {}
    if is_dataclass(value):
        return asdict(value)
    if isinstance(value, Mapping):
        return dict(value)
    return value


def _decode_model(model_type, value: object):
    if not is_dataclass(model_type):
        return value
    source = dict(value) if isinstance(value, Mapping) else {}
    names = {field.name for field in fields(model_type)}
    return model_type(**{key: val for key, val in source.items() if key in names})


${realmModels}

${realmTypes}


class RealmTypedClient:
    def __init__(self, core: CoreClient) -> None:
        self._core = core

${realmMethods}
`);
}

function writeGoTypedClients(runtime, realm) {
  const runtimeEnums = runtimeEnumSchemas(runtime)
    .map((schema) => `type ${schema.name} string\n\nconst (\n${schema.values.map((value) => `	${pascalCase(value)} ${schema.name} = ${quote(value)}`).join('\n')}\n)`)
    .join('\n\n');
  const runtimeTypes = runtimeMessageSchemas(runtime)
    .map((schema) => {
      const fields = schema.fields.map((field) => `	${pascalCase(field.name)} ${goProtoType(field, runtime)} \`json:"${field.name},omitempty"\``).join('\n');
      return `type ${schema.name} struct {\n${fields}\n}`;
    })
    .join('\n\n');
  const runtimeMethods = runtime.codec_maps.map((method) => {
    if (method.kind === 'unary') {
      return `func (c RuntimeTypedClient) ${pascalCase(method.method)}(ctx context.Context, request ${method.request_type}, metadata sdkstypes.CoreMetadata, timeoutMS int64) (${method.response_type}, error) {
	raw, err := c.callTyped(ctx, ${quote(method.method_id)}, request, metadata, timeoutMS)
	if err != nil {
		return ${method.response_type}{}, err
	}
	return decodeTypedResponse[${method.response_type}](raw)
}`;
    }
    if (method.kind === 'server_stream') {
      return `func (c RuntimeTypedClient) ${pascalCase(method.method)}(ctx context.Context, request ${method.request_type}, metadata sdkstypes.CoreMetadata, timeoutMS int64) (*RuntimeTypedStream[${method.response_type}], error) {
	reader, err := c.streamTyped(ctx, ${quote(method.method_id)}, request, metadata, timeoutMS)
	if err != nil {
		return nil, err
	}
	return &RuntimeTypedStream[${method.response_type}]{reader: reader}, nil
}`;
    }
    return `func (c RuntimeTypedClient) ${pascalCase(method.method)}(context.Context, ${method.request_type}, sdkstypes.CoreMetadata, int64) (${method.response_type}, error) {
	return ${method.response_type}{}, fmt.Errorf("SDK_RUNTIME_METHOD_UNAVAILABLE: Runtime method kind is not supported by the unary/server-stream core transport: ${method.method_id}")
}`;
  }).join('\n\n');
  const realmModels = (realm.model_schemas || []).map((model) => {
    if (model.schema.kind !== 'object') return `type ${model.name} ${goOpenApiType(model.schema)}`;
    const fields = model.schema.properties.map((property) => `	${pascalCase(property.name)} ${goOpenApiFieldType(property.schema)} \`json:"${property.name},omitempty"\``).join('\n');
    return `type ${model.name} struct {\n${fields}\n}`;
  }).join('\n\n');
  const realmTypes = realm.operations.map((operation) => {
    const base = realmOperationTypeBase(operation.operation_id);
    const pathFields = (operation.path_parameters || []).map((parameter) => `	${pascalCase(parameter.name)} ${goOpenApiType(parameter.schema)} \`json:"${parameter.name},omitempty"\``).join('\n');
    const queryFields = (operation.query_parameters || []).map((parameter) => `	${pascalCase(parameter.name)} ${goOpenApiType(parameter.schema)} \`json:"${parameter.name},omitempty"\``).join('\n');
    const headerFields = (operation.header_parameters || []).map((parameter) => `	${pascalCase(parameter.name)} ${goOpenApiType(parameter.schema)} \`json:"${parameter.name},omitempty"\``).join('\n');
    return `type ${base}Path struct {\n${pathFields}\n}

type ${base}Query struct {\n${queryFields}\n}

type ${base}Headers struct {\n${headerFields}\n}

type ${base}Request struct {
	Path    ${base}Path \`json:"path,omitempty"\`
	Query   ${base}Query \`json:"query,omitempty"\`
	Headers ${base}Headers \`json:"headers,omitempty"\`
	Body    ${goOpenApiType(operation.request_schema)} \`json:"body,omitempty"\`
}`;
  }).join('\n\n');
  const realmMethods = realm.operations.map((operation) => {
    const base = realmOperationTypeBase(operation.operation_id);
    const responseType = goOpenApiType(openApiSuccessSchema(operation));
    return `func (c RealmTypedClient) ${pascalCase(operation.operation_id)}(ctx context.Context, request ${base}Request, metadata sdkstypes.CoreMetadata, timeoutMS int64) (${responseType}, error) {
	raw, err := c.operationTyped(ctx, ${quote(operation.operation_id)}, request, metadata, timeoutMS)
	if err != nil {
		return ${goZeroExpr(responseType)}, err
	}
	return decodeTypedResponse[${responseType}](raw)
}`;
  }).join('\n\n');
  writeText('sdks/go/coregenerated/typed_clients.go', `// Code generated by ${generatedBy}; DO NOT EDIT.

package coregenerated

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/nimiplatform/nimi/sdks/go/coreclient"
	sdkstypes "github.com/nimiplatform/nimi/sdks/go/types"
)

${runtimeEnums}

${runtimeTypes}

type RuntimeTypedClient struct {
	core coreclient.Client
}

func NewRuntimeTypedClient(core coreclient.Client) RuntimeTypedClient {
	return RuntimeTypedClient{core: core}
}

func (c RuntimeTypedClient) callTyped(ctx context.Context, methodID string, request any, metadata sdkstypes.CoreMetadata, timeoutMS int64) ([]byte, error) {
	encoded, err := json.Marshal(request)
	if err != nil {
		return nil, err
	}
	return c.core.Unary(ctx, sdkstypes.CoreUnaryRequest{Context: ctx, MethodID: methodID, Metadata: metadata, Body: encoded, TimeoutMS: timeoutMS})
}

func (c RuntimeTypedClient) streamTyped(ctx context.Context, methodID string, request any, metadata sdkstypes.CoreMetadata, timeoutMS int64) (coreclient.StreamReader, error) {
	encoded, err := json.Marshal(request)
	if err != nil {
		return nil, err
	}
	return c.core.ServerStream(ctx, sdkstypes.CoreStreamRequest{Context: ctx, MethodID: methodID, Metadata: metadata, Body: encoded, TimeoutMS: timeoutMS})
}

type RuntimeTypedStream[T any] struct {
	reader coreclient.StreamReader
}

func (s *RuntimeTypedStream[T]) Recv(ctx context.Context) (T, error) {
	raw, err := s.reader.Recv(ctx)
	if err != nil {
		var zero T
		return zero, err
	}
	return decodeTypedResponse[T](raw)
}

func (s *RuntimeTypedStream[T]) Close() error {
	return s.reader.Close()
}

func decodeTypedResponse[T any](raw []byte) (T, error) {
	var out T
	if err := json.Unmarshal(raw, &out); err != nil {
		return out, err
	}
	return out, nil
}

${runtimeMethods}

${realmModels}

${realmTypes}

type RealmTypedClient struct {
	core coreclient.Client
}

func NewRealmTypedClient(core coreclient.Client) RealmTypedClient {
	return RealmTypedClient{core: core}
}

func (c RealmTypedClient) operationTyped(ctx context.Context, operationID string, request any, metadata sdkstypes.CoreMetadata, timeoutMS int64) ([]byte, error) {
	encoded, err := json.Marshal(request)
	if err != nil {
		return nil, err
	}
	return c.core.Unary(ctx, sdkstypes.CoreUnaryRequest{Context: ctx, MethodID: operationID, Metadata: metadata, Body: encoded, TimeoutMS: timeoutMS})
}

${realmMethods}
`);
}

function writeRustTypedClients(runtime, realm) {
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

function main() {
  const runtime = extractRuntimeProto();
  const realm = extractRealmCore();
  const errorCodes = extractErrorCodes();
  const exportsManifest = buildExportManifest(runtime, realm, errorCodes);

  writeSharedArtifacts(runtime, realm, errorCodes, exportsManifest);
  writeLanguageArtifacts(runtime, realm, errorCodes, exportsManifest);
  writeConformanceFixtures(runtime, realm, errorCodes, exportsManifest);

  const action = checkMode ? 'checked' : 'generated';
  process.stdout.write(`${action} sdks core manifests: runtime=${runtime.method_ids.length} methods, realm=${realm.operations.length} operations (${realm.source_state})\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`[sdks:generation] ${error instanceof Error ? (error.stack || error.message) : String(error)}\n`);
  process.exit(1);
}
