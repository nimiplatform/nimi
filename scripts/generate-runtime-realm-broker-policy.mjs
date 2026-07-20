import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { parse } from 'yaml';

const root = process.cwd();
const policyPath = resolve(root, '.nimi/spec/runtime/kernel/tables/realm-broker-operations.yaml');
const openAPIPath = resolve(root, 'config/realm-openapi/api-nimi.yaml');
const outputPath = resolve(root, 'runtime/internal/services/account/realm_broker_policy_generated.go');
const sdkOutputPath = resolve(root, 'sdks/typescript/core/app/runtime-account-realm-source-readiness.generated.ts');
const checkOnly = process.argv.includes('--check');

const requiredFields = [
  'operation_id',
  'http_method',
  'path_template',
  'request_schema_ref',
  'response_schema_ref',
  'authorization_profile',
  'allowed_runtime_caller_modes',
  'protected_transport_ref',
  'realm_base_policy',
  'response_max_bytes',
  'credential_response_policy',
  'consumer_refs',
  'source_rule',
];

const invokeRealmUnaryMethodID = '/nimi.runtime.v1.RuntimeAccountService/InvokeRealmUnary';
const desktopCallerMode = 'ACCOUNT_CALLER_MODE_DESKTOP_SHELL';
const bundledAvatarCallerMode = 'ACCOUNT_CALLER_MODE_DESKTOP_LAUNCHED_AVATAR';
const desktopSourceReadinessAuthorizationProfile = 'protected_desktop_source_readiness';
const bundledAvatarSourceReadinessAuthorizationProfile = 'protected_bundled_avatar_source_readiness';
const bundledAvatarRealmOperationID = 'WorldCoreController_listPersonaCharacters';

function fail(message) {
  throw new Error(`realm broker policy generation failed: ${message}`);
}

function quoted(value) {
  return JSON.stringify(String(value));
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
        const schemaKind = String(parameter?.schema?.type ?? '').trim();
        if (!['string', 'number', 'integer', 'boolean'].includes(schemaKind)) {
          fail(`${operationID} parameter ${name} has unsupported schema type ${schemaKind || '<missing>'}`);
        }
        return { name, location, required: parameter.required === true, schemaKind };
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
    const bundledAvatarOperation = operation.operation_id === bundledAvatarRealmOperationID;
    const expectedAuthorizationProfile = bundledAvatarOperation
      ? bundledAvatarSourceReadinessAuthorizationProfile
      : desktopSourceReadinessAuthorizationProfile;
    if (operation.authorization_profile !== expectedAuthorizationProfile) {
      fail(`${operation.operation_id} has unsupported authorization_profile ${operation.authorization_profile}`);
    }
    if (operation.protected_transport_ref !== invokeRealmUnaryMethodID) {
      fail(`${operation.operation_id} must use the protected InvokeRealmUnary transport`);
    }
    if (!Number.isInteger(operation.response_max_bytes) || operation.response_max_bytes <= 0) {
      fail(`${operation.operation_id} response_max_bytes must be a positive integer`);
    }
    const callerModes = operation.allowed_runtime_caller_modes;
    const expectedCallerModes = bundledAvatarOperation
      ? [desktopCallerMode, bundledAvatarCallerMode]
      : [desktopCallerMode];
    if (!Array.isArray(callerModes) || callerModes.length !== expectedCallerModes.length
      || expectedCallerModes.some((mode, index) => callerModes[index] !== mode)) {
      fail(`${operation.operation_id} has an invalid protected caller-mode set`);
    }
    const consumerRefs = operation.consumer_refs;
    if (!Array.isArray(consumerRefs) || consumerRefs.length === 0 || consumerRefs.some((ref) => !String(ref || '').trim())) {
      fail(`${operation.operation_id} must declare non-empty consumer_refs`);
    }
    const projected = operation.__openapi;
    const pathParameters = projected.parameters.filter((parameter) => parameter.location === 'path');
    const queryParameters = projected.parameters.filter((parameter) => parameter.location === 'query');
    return `\t${quoted(operation.operation_id)}: {\n` +
      `\t\tmethod: ${quoted(operation.http_method)},\n` +
      `\t\tpath: ${quoted(operation.path_template)},\n` +
      `\t\tallowedCallerModes: map[runtimev1.AccountCallerMode]struct{}{\n` +
      callerModes.map((mode) => `\t\t\truntimev1.AccountCallerMode_${mode}: {},`).join('\n') + '\n' +
      `\t\t},\n` +
      `\t\tauthorizationProfile: ${quoted(operation.authorization_profile)},\n` +
      `\t\tpathParameterKinds: map[string]realmUnaryParameterKind{${pathParameters.map((parameter) => `${quoted(parameter.name)}: realmUnaryParameter${parameter.schemaKind[0].toUpperCase()}${parameter.schemaKind.slice(1)}`).join(', ')}},\n` +
      `\t\trequiredPathParameters: map[string]struct{}{${pathParameters.filter((parameter) => parameter.required).map((parameter) => `${quoted(parameter.name)}: {}`).join(', ')}},\n` +
      `\t\tqueryParameterKinds: map[string]realmUnaryParameterKind{${queryParameters.map((parameter) => `${quoted(parameter.name)}: realmUnaryParameter${parameter.schemaKind[0].toUpperCase()}${parameter.schemaKind.slice(1)}`).join(', ')}},\n` +
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

function renderSDKPolicy(operations) {
  const rows = operations.map((operation) => `  ${quoted(operation.operation_id)},`).join('\n');
  return `// Code generated by scripts/generate-runtime-realm-broker-policy.mjs; DO NOT EDIT.\n\n` +
    `export const NIMI_DESKTOP_SOURCE_READINESS_REALM_OPERATION_IDS = [\n${rows}\n] as const;\n\n` +
    `export type NimiDesktopSourceReadinessRealmOperationID =\n` +
    `  typeof NIMI_DESKTOP_SOURCE_READINESS_REALM_OPERATION_IDS[number];\n\n` +
    `const NIMI_DESKTOP_SOURCE_READINESS_REALM_OPERATION_ID_SET: ReadonlySet<string> =\n` +
    `  new Set(NIMI_DESKTOP_SOURCE_READINESS_REALM_OPERATION_IDS);\n\n` +
    `export function isNimiDesktopSourceReadinessRealmOperationID(\n` +
    `  value: string,\n` +
    `): value is NimiDesktopSourceReadinessRealmOperationID {\n` +
    `  return NIMI_DESKTOP_SOURCE_READINESS_REALM_OPERATION_ID_SET.has(value.trim());\n` +
    `}\n\n` +
    `export const NIMI_BUNDLED_AVATAR_REALM_OPERATION_ID = ${quoted(bundledAvatarRealmOperationID)} as const;\n`;
}

const [policyText, openAPIText] = await Promise.all([
  readFile(policyPath, 'utf8'),
  readFile(openAPIPath, 'utf8'),
]);
const policy = parse(policyText, { merge: true });
const openAPI = parse(openAPIText);
if (policy?.source_rule !== 'K-ACCSVC-023') fail('policy source_rule must be K-ACCSVC-023');
if (policy?.authority_status !== 'admitted_exact_protected_source_readiness_operations') {
  fail('authority_status must admit only exact protected source-readiness operations');
}
if (policy?.production_consumption !== 'admitted_exact_rows_only') {
  fail('production_consumption must be admitted_exact_rows_only');
}
if (policy?.generic_proxy !== 'forbidden') fail('generic_proxy must remain forbidden');
if (policy?.unlisted_operation_disposition !== 'deny_broker_operation_not_admitted') {
  fail('unlisted operations must fail as BROKER_OPERATION_NOT_ADMITTED');
}
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
const surfaces = policy?.surfaces;
if (!Array.isArray(surfaces) || surfaces.length !== seen.size) {
  fail('surfaces must enumerate every admitted operation exactly once');
}
const surfaceSet = new Set(surfaces.map((surface) => String(surface || '').trim()));
if (surfaceSet.size !== seen.size || [...seen].some((operationID) => !surfaceSet.has(operationID))) {
  fail('surfaces and operations must contain the same exact operation ids');
}
for (const forbidden of policy?.explicitly_not_admitted ?? []) {
  if (seen.has(forbidden.operation_id)) fail(`${forbidden.operation_id} is both admitted and explicitly forbidden`);
}

const rendered = execFileSync('gofmt', { input: renderPolicy(operations), encoding: 'utf8' });
const renderedSDK = renderSDKPolicy(operations);
if (checkOnly) {
  const existing = await readFile(outputPath, 'utf8').catch(() => '');
  if (existing !== rendered) fail('generated Go policy is stale; run pnpm generate:runtime-realm-broker-policy');
  const existingSDK = await readFile(sdkOutputPath, 'utf8').catch(() => '');
  if (existingSDK !== renderedSDK) fail('generated SDK source-readiness policy is stale; run pnpm generate:runtime-realm-broker-policy');
  process.stdout.write(`runtime and SDK Realm broker policies are current (${operations.length} operations)\n`);
} else {
  await Promise.all([
    writeFile(outputPath, rendered, 'utf8'),
    writeFile(sdkOutputPath, renderedSDK, 'utf8'),
  ]);
  process.stdout.write(`generated Runtime and SDK Realm broker policies (${operations.length} operations)\n`);
}
