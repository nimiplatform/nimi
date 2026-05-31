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

function extractRuntimeProto() {
  const protoFiles = runtimeProtoFiles();
  const services = [];
  const messages = new Set();
  const enums = new Set();

  for (const file of protoFiles) {
    const source = stripProtoComments(readText(file));
    for (const match of source.matchAll(/\bmessage\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/g)) {
      messages.add(match[1]);
    }
    for (const match of source.matchAll(/\benum\s+([A-Za-z_][A-Za-z0-9_]*)\s*\{/g)) {
      enums.add(match[1]);
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
      messages: [...messages].sort(),
      enums: [...enums].sort(),
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

function parseOpenApiOperations(spec) {
  const operations = [];
  const paths = spec?.paths && typeof spec.paths === 'object' ? spec.paths : {};
  const verbs = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);
  for (const [route, routeItem] of Object.entries(paths)) {
    if (!routeItem || typeof routeItem !== 'object') continue;
    for (const [verb, operation] of Object.entries(routeItem)) {
      if (!verbs.has(verb) || !operation || typeof operation !== 'object') continue;
      const tags = Array.isArray(operation.tags) ? operation.tags.map(String) : [];
      operations.push({
        operation_id: String(operation.operationId || `${verb}_${route}`),
        method: verb.toUpperCase(),
        path: route,
        service: tags[0] || 'default',
        tags,
        request_schema_ref: operation.requestBody?.content?.['application/json']?.schema?.$ref || null,
        response_schema_refs: Object.entries(operation.responses || {})
          .map(([status, response]) => ({
            status,
            schema_ref: response?.content?.['application/json']?.schema?.$ref || null,
          }))
          .filter((entry) => entry.schema_ref),
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

  if (existsSync(source.abs_path)) {
    sourceState = 'openapi_loaded';
    const spec = YAML.parse(readFileSync(source.abs_path, 'utf8'));
    operations = parseOpenApiOperations(spec);
    modelNames = Object.keys(spec?.components?.schemas || {}).sort();
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
}

function writeConformanceFixtures(runtime, realm, errorCodes, exportsManifest) {
  const firstUnaryMethod = runtime.codec_maps.find((entry) => entry.kind === 'unary');
  const firstStreamMethod = runtime.codec_maps.find((entry) => entry.kind === 'server_stream');
  const firstRealmOperation = realm.operations.find((entry) => entry.operation_id);
  if (!firstUnaryMethod || !firstStreamMethod || !firstRealmOperation) {
    throw new Error('cannot build behavior fixtures without unary, stream, and realm operation samples');
  }
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
        kind: firstUnaryMethod.kind,
        request_body: { hello: 'runtime' },
        response_body: { ok: true, source: 'runtime-unary' },
      },
      runtime_stream: {
        method_id: firstStreamMethod.method_id,
        kind: firstStreamMethod.kind,
        request_body: { hello: 'stream' },
        events: [
          { index: 1, branch: 'delta' },
          { index: 2, branch: 'done' },
        ],
      },
      realm_operation: {
        operation_id: firstRealmOperation.operation_id,
        method: firstRealmOperation.method,
        path: firstRealmOperation.path,
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
  process.stderr.write(`[sdks:generation] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}
