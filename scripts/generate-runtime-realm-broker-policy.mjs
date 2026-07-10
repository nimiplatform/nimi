import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { parse } from 'yaml';

const root = process.cwd();
const policyPath = resolve(root, '.nimi/spec/runtime/kernel/tables/realm-broker-operations.yaml');
const openAPIPath = resolve(root, 'config/realm-openapi/api-nimi.yaml');
const outputPath = resolve(root, 'runtime/internal/services/account/realm_broker_policy_generated.go');
const checkOnly = process.argv.includes('--check');

const requiredFields = [
  'operation_id',
  'http_method',
  'path_template',
  'request_schema_ref',
  'response_schema_ref',
  'allowed_sdk_app_modes',
  'allowed_runtime_caller_modes',
  'required_app_capabilities',
  'required_runtime_scopes',
  'realm_base_policy',
  'response_max_bytes',
  'credential_response_policy',
  'source_rule',
];

function fail(message) {
  throw new Error(`realm broker policy generation failed: ${message}`);
}

function quoted(value) {
  return JSON.stringify(String(value));
}

function canonicalCapability(candidate) {
  if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
    fail('required_app_capabilities.any_of entries must be objects');
  }
  const scopeName = String(candidate.scope_name ?? '').trim();
  const qualifier = String(candidate.qualifier ?? '').trim();
  const runtimeScope = String(candidate.runtime_scope ?? '').trim();
  if (runtimeScope && (scopeName || qualifier)) {
    fail('a capability alternative cannot mix runtime_scope with scope_name/qualifier');
  }
  if (runtimeScope) return runtimeScope;
  if (!scopeName) fail('a capability alternative requires scope_name or runtime_scope');
  return qualifier ? `${scopeName}#${qualifier}` : scopeName;
}

function readOpenAPIOperations(document) {
  const operations = new Map();
  for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
    for (const method of ['get', 'post', 'put', 'patch', 'delete', 'head', 'options']) {
      const operation = pathItem?.[method];
      const operationID = String(operation?.operationId ?? '').trim();
      if (!operationID) continue;
      if (operations.has(operationID)) fail(`duplicate Realm OpenAPI operationId ${operationID}`);
      const parameters = [...(pathItem?.parameters ?? []), ...(operation?.parameters ?? [])];
      const normalizedParameters = parameters.map((parameter) => {
        if (parameter?.$ref) fail(`${operationID} uses unresolved parameter ref ${parameter.$ref}`);
        const name = String(parameter?.name ?? '').trim();
        const location = String(parameter?.in ?? '').trim();
        if (!name || !['path', 'query'].includes(location)) {
          fail(`${operationID} has unsupported or incomplete parameter metadata`);
        }
        return { name, location, required: parameter.required === true };
      });
      operations.set(operationID, {
        method: method.toUpperCase(),
        path,
        parameters: normalizedParameters,
        requestBodyAllowed: operation?.requestBody !== undefined,
        requestBodyRequired: operation?.requestBody?.required === true,
      });
    }
  }
  return operations;
}

function renderPolicy(operations) {
  const rows = operations.map((operation) => {
    for (const field of requiredFields) {
      if (operation[field] === undefined || operation[field] === null || operation[field] === '') {
        fail(`${operation.operation_id ?? '<unknown>'} is missing required field ${field}`);
      }
    }
    if (operation.realm_base_policy !== 'runtime-configured-canonical-exact') {
      fail(`${operation.operation_id} has unsupported realm_base_policy ${operation.realm_base_policy}`);
    }
    if (operation.credential_response_policy !== 'forbidden') {
      fail(`${operation.operation_id} must forbid credential responses`);
    }
    if (!Number.isInteger(operation.response_max_bytes) || operation.response_max_bytes <= 0) {
      fail(`${operation.operation_id} response_max_bytes must be a positive integer`);
    }
    const callerModes = operation.allowed_runtime_caller_modes;
    if (!Array.isArray(callerModes) || callerModes.length === 0) {
      fail(`${operation.operation_id} must admit at least one Runtime caller mode`);
    }
    const sdkModes = operation.allowed_sdk_app_modes;
    if (!Array.isArray(sdkModes) || sdkModes.length === 0) {
      fail(`${operation.operation_id} must admit at least one SDK app mode`);
    }
    const requiredRuntimeScopes = operation.required_runtime_scopes;
    if (!Array.isArray(requiredRuntimeScopes) || requiredRuntimeScopes.length === 0) {
      fail(`${operation.operation_id} must declare required_runtime_scopes`);
    }
    const alternatives = operation.required_app_capabilities?.any_of;
    if (!Array.isArray(alternatives) || alternatives.length === 0) {
      fail(`${operation.operation_id} must declare required_app_capabilities.any_of`);
    }
    const capabilities = alternatives.map(canonicalCapability);
    const projected = operation.__openapi;
    const pathParameters = projected.parameters.filter((parameter) => parameter.location === 'path');
    const queryParameters = projected.parameters.filter((parameter) => parameter.location === 'query');
    return `\t${quoted(operation.operation_id)}: {\n` +
      `\t\tmethod: ${quoted(operation.http_method)},\n` +
      `\t\tpath: ${quoted(operation.path_template)},\n` +
      `\t\tallowedCallerModes: map[runtimev1.AccountCallerMode]struct{}{\n` +
      callerModes.map((mode) => `\t\t\truntimev1.AccountCallerMode_${mode}: {},`).join('\n') + '\n' +
      `\t\t},\n` +
      `\t\tallowedSDKAppModes: []string{${sdkModes.map(quoted).join(', ')}},\n` +
      `\t\trequiredAppCapabilities: []string{${capabilities.map(quoted).join(', ')}},\n` +
      `\t\trequiredRuntimeScopes: []string{${requiredRuntimeScopes.map(quoted).join(', ')}},\n` +
      `\t\tallowedPathParameters: map[string]struct{}{${pathParameters.map((parameter) => `${quoted(parameter.name)}: {}`).join(', ')}},\n` +
      `\t\trequiredPathParameters: map[string]struct{}{${pathParameters.filter((parameter) => parameter.required).map((parameter) => `${quoted(parameter.name)}: {}`).join(', ')}},\n` +
      `\t\tallowedQueryParameters: map[string]struct{}{${queryParameters.map((parameter) => `${quoted(parameter.name)}: {}`).join(', ')}},\n` +
      `\t\trequestBodyAllowed: ${projected.requestBodyAllowed},\n` +
      `\t\trequestBodyRequired: ${projected.requestBodyRequired},\n` +
      `\t\tresponseMaxBytes: ${operation.response_max_bytes},\n` +
      `\t},`;
  });
  return `// Code generated by scripts/generate-runtime-realm-broker-policy.mjs; DO NOT EDIT.\n\n` +
    `package account\n\n` +
    `import runtimev1 "github.com/nimiplatform/nimi/runtime/gen/runtime/v1"\n\n` +
    `var realmBrokerOperations = map[string]realmUnaryOperation{\n${rows.join('\n')}\n}\n`;
}

const [policyText, openAPIText] = await Promise.all([
  readFile(policyPath, 'utf8'),
  readFile(openAPIPath, 'utf8'),
]);
const policy = parse(policyText, { merge: true });
const openAPI = parse(openAPIText);
if (policy?.source_rule !== 'K-ACCSVC-023') fail('policy source_rule must be K-ACCSVC-023');
const operations = policy?.operations;
if (!Array.isArray(operations) || operations.length === 0) fail('operations must be a non-empty sequence');
const openAPIOperations = readOpenAPIOperations(openAPI);
const seen = new Set();
for (const operation of operations) {
  const operationID = String(operation?.operation_id ?? '').trim();
  if (!operationID) fail('operation_id is required');
  if (seen.has(operationID)) fail(`duplicate policy operation ${operationID}`);
  seen.add(operationID);
  const projected = openAPIOperations.get(operationID);
  if (!projected) fail(`${operationID} is missing from Realm OpenAPI`);
  if (projected.method !== operation.http_method || projected.path !== operation.path_template) {
    fail(`${operationID} method/path drift: policy=${operation.http_method} ${operation.path_template}, openapi=${projected.method} ${projected.path}`);
  }
  operation.__openapi = projected;
}
for (const forbidden of policy?.explicitly_not_admitted ?? []) {
  if (seen.has(forbidden.operation_id)) fail(`${forbidden.operation_id} is both admitted and explicitly forbidden`);
}

const rendered = execFileSync('gofmt', { input: renderPolicy(operations), encoding: 'utf8' });
if (checkOnly) {
  const existing = await readFile(outputPath, 'utf8').catch(() => '');
  if (existing !== rendered) fail('generated Go policy is stale; run pnpm generate:runtime-realm-broker-policy');
  process.stdout.write(`runtime realm broker policy is current (${operations.length} operations)\n`);
} else {
  await writeFile(outputPath, rendered, 'utf8');
  process.stdout.write(`generated ${outputPath} (${operations.length} operations)\n`);
}
