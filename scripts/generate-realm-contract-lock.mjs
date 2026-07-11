#!/usr/bin/env node

import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

export const REALM_REPOSITORY = 'https://github.com/nimiplatform/nimi-realm.git';
export const REALM_OPENAPI_SOURCE_PATH = 'nimi-backend/api-nimi.yaml';
export const NIMI_OPENAPI_SYNCED_PATH = 'config/realm-openapi/api-nimi.yaml';
export const MATERIALIZATION_OPERATION_ID = 'WorldCoreController_createSourceMaterializationPacket';
export const MATERIALIZATION_OPERATION_PATH = '/api/realm/core/source-materialization-packets';
export const MATERIALIZATION_OPERATION_METHOD = 'post';
export const FRAGMENT_SCHEMA_VERSION = 'nimi.realm-openapi-source-materialization-fragment/v1';
export const PACKET_SCHEMA_VERSION = 'realm.source-materialization-packet/v2';
export const MATERIALIZATION_CONTEXT_SCHEMA_VERSION = 'realm.materialization-context/v1';
export const COVERAGE_MANIFEST_SCHEMA_VERSION = 'realm.materialization-coverage/v1';
export const BUNDLE_MANIFEST_SCHEMA_VERSION = 'realm.materialization-bundle-manifest/v1';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const lockPath = path.join(repoRoot, 'config', 'realm-contract-lock.yaml');

function parseRealmRoot(argv) {
  const index = argv.indexOf('--realm-root');
  if (index < 0 || !String(argv[index + 1] || '').trim()) {
    throw new Error('usage: pnpm generate:realm-contract-lock --realm-root <realm-checkout>');
  }
  return path.resolve(argv[index + 1]);
}

export function git(realmRoot, args) {
  return execFileSync('git', ['-C', realmRoot, ...args], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function normalizeRepositoryUrl(value) {
  const normalized = String(value || '').trim();
  if (normalized.startsWith('git@github.com:')) {
    return `https://github.com/${normalized.slice('git@github.com:'.length)}`;
  }
  if (normalized.startsWith('ssh://git@github.com/')) {
    return `https://github.com/${normalized.slice('ssh://git@github.com/'.length)}`;
  }
  return normalized;
}

export function assertRealmRepository(realmRoot) {
  const repository = normalizeRepositoryUrl(git(realmRoot, ['remote', 'get-url', 'origin']));
  if (repository !== REALM_REPOSITORY) {
    throw new Error(`Realm repository mismatch: expected ${REALM_REPOSITORY}, got ${repository || '<missing>'}`);
  }
}

export function compareUtf16CodeUnits(leftInput, rightInput) {
  const left = String(leftInput);
  const right = String(rightInput);
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const difference = left.charCodeAt(index) - right.charCodeAt(index);
    if (difference !== 0) return difference;
  }
  return left.length - right.length;
}

function sortJson(value) {
  if (Array.isArray(value)) {
    return value.map(sortJson);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }
  return Object.fromEntries(
    Object.keys(value)
      .sort(compareUtf16CodeUnits)
      .map((key) => [key, sortJson(value[key])]),
  );
}

export function canonicalJson(value) {
  return JSON.stringify(sortJson(value));
}

export function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function schemaRefName(value) {
  const prefix = '#/components/schemas/';
  return typeof value === 'string' && value.startsWith(prefix) ? value.slice(prefix.length) : null;
}

function collectSchemaRefs(value, output) {
  if (Array.isArray(value)) {
    for (const item of value) collectSchemaRefs(item, output);
    return;
  }
  if (!value || typeof value !== 'object') return;
  const refName = schemaRefName(value.$ref);
  if (refName) output.add(refName);
  for (const nested of Object.values(value)) collectSchemaRefs(nested, output);
}

export function extractSourceMaterializationFragment(openapiText) {
  const document = YAML.parse(openapiText);
  const operation = document?.paths?.[MATERIALIZATION_OPERATION_PATH]?.[MATERIALIZATION_OPERATION_METHOD];
  if (!operation || operation.operationId !== MATERIALIZATION_OPERATION_ID) {
    throw new Error(`Realm OpenAPI missing ${MATERIALIZATION_OPERATION_METHOD.toUpperCase()} ${MATERIALIZATION_OPERATION_PATH} (${MATERIALIZATION_OPERATION_ID})`);
  }

  const allSchemas = document?.components?.schemas;
  if (!allSchemas || typeof allSchemas !== 'object' || Array.isArray(allSchemas)) {
    throw new Error('Realm OpenAPI components.schemas is missing');
  }

  const pending = new Set();
  collectSchemaRefs(operation, pending);
  const selected = {};
  while (pending.size > 0) {
    const [name] = [...pending].sort(compareUtf16CodeUnits);
    pending.delete(name);
    if (Object.prototype.hasOwnProperty.call(selected, name)) continue;
    const schema = allSchemas[name];
    if (!schema) throw new Error(`Realm OpenAPI materialization fragment has unresolved schema ref: ${name}`);
    selected[name] = schema;
    const nested = new Set();
    collectSchemaRefs(schema, nested);
    for (const ref of nested) {
      if (!Object.prototype.hasOwnProperty.call(selected, ref)) pending.add(ref);
    }
  }

  const fragment = {
    fragment_schema_version: FRAGMENT_SCHEMA_VERSION,
    operation_id: MATERIALIZATION_OPERATION_ID,
    operation_path: MATERIALIZATION_OPERATION_PATH,
    operation_method: MATERIALIZATION_OPERATION_METHOD,
    operation,
    component_schemas: selected,
  };
  const canonical = canonicalJson(fragment);
  return {
    fragment,
    canonical,
    sha256: sha256Hex(canonical),
    componentSchemaNames: Object.keys(selected).sort(compareUtf16CodeUnits),
  };
}

export function renderLock(input) {
  return {
    schema_version: 'nimi.realm-contract-lock/v1',
    generated_by: 'scripts/generate-realm-contract-lock.mjs',
    realm: {
      repository: REALM_REPOSITORY,
      commit: input.realmCommit,
    },
    openapi: {
      source_path: REALM_OPENAPI_SOURCE_PATH,
      synced_path: NIMI_OPENAPI_SYNCED_PATH,
      document_sha256: sha256Hex(input.openapiText),
      fragment_schema_version: FRAGMENT_SCHEMA_VERSION,
      fragment_selector: {
        operation_id: MATERIALIZATION_OPERATION_ID,
        path: MATERIALIZATION_OPERATION_PATH,
        method: MATERIALIZATION_OPERATION_METHOD,
      },
      fragment_sha256: input.fragment.sha256,
      component_schema_count: input.fragment.componentSchemaNames.length,
    },
    schema_versions: {
      packet: PACKET_SCHEMA_VERSION,
      materialization_context: MATERIALIZATION_CONTEXT_SCHEMA_VERSION,
      coverage_manifest: COVERAGE_MANIFEST_SCHEMA_VERSION,
      bundle_transport_manifest: BUNDLE_MANIFEST_SCHEMA_VERSION,
    },
  };
}

function generate(realmRoot) {
  assertRealmRepository(realmRoot);
  const realmCommit = git(realmRoot, ['rev-parse', 'HEAD']);
  if (!/^[a-f0-9]{40}$/.test(realmCommit)) {
    throw new Error(`Realm HEAD is not an immutable full commit SHA: ${realmCommit}`);
  }
  const committedOpenapi = git(realmRoot, ['show', `${realmCommit}:${REALM_OPENAPI_SOURCE_PATH}`]);
  const workingOpenapiPath = path.join(realmRoot, REALM_OPENAPI_SOURCE_PATH);
  const workingOpenapi = fs.readFileSync(workingOpenapiPath, 'utf8').trimEnd();
  if (workingOpenapi !== committedOpenapi) {
    throw new Error(`${REALM_OPENAPI_SOURCE_PATH} differs from Realm commit ${realmCommit}`);
  }
  const openapiText = `${committedOpenapi}\n`;
  const fragment = extractSourceMaterializationFragment(openapiText);
  const lock = renderLock({ realmCommit, openapiText, fragment });
  fs.mkdirSync(path.dirname(lockPath), { recursive: true });
  fs.writeFileSync(lockPath, YAML.stringify(lock), 'utf8');
  process.stdout.write(
    `generated ${path.relative(repoRoot, lockPath)}: realm=${realmCommit} fragment=${fragment.sha256}\n`,
  );
}

const isEntrypoint = process.argv[1]
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isEntrypoint) {
  try {
    generate(parseRealmRoot(process.argv.slice(2)));
  } catch (error) {
    process.stderr.write(`[generate:realm-contract-lock] ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
