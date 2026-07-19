#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

import { extractRealmCore } from '../sdks/generators/lib/realm-openapi.mjs';
import { projectRealmForPublicSdks } from '../sdks/generators/lib/runtime-realm-carrier.mjs';
import {
  ACCESS_POLICY_AUTHORITY_CLASS,
  ACCESS_POLICY_VERSION,
  ADMISSION_SCHEMA_VERSION,
  AUTHORIZATION_INPUTS,
  FORBIDDEN_INPUTS,
  LOCK_SCHEMA_VERSION,
  RETIRED_ENDPOINTS,
  RETIRED_IDENTIFIERS,
  assertAccessPolicyAdmission,
  canonicalJson,
  compareUtf16CodeUnits,
} from './generate-realm-contract-lock.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const admissionPath = path.join(repoRoot, 'config', 'realm-v3', 'current-producer-admission.json');
const lockPath = path.join(repoRoot, 'config', 'realm-contract-lock.yaml');
const privateOperationTablePath = path.join(
  repoRoot,
  '.nimi',
  'spec',
  'sdks',
  'kernel',
  'tables',
  'realm-private-operation-carriers.yaml',
);
const sourceOnly = process.argv.includes('--source-only');
const languageManifestPaths = {
  typescript: 'sdks/typescript/core-generated/realm-core.manifest.json',
  python: 'sdks/python/core_generated/realm-core.manifest.json',
  go: 'sdks/go/coregenerated/realm-core.manifest.json',
  rust: 'sdks/rust/core_generated/realm-core.manifest.json',
};

function fail(message) {
  throw new Error(`Realm v3 generated convergence failed: ${message}`);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(repoRoot, relativePath), 'utf8'));
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function snakeCase(value) {
  return String(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase())
    .join('_');
}

function lowerCamelCase(value) {
  const words = String(value)
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  return words.map((word, index) => {
    const normalized = `${word[0].toUpperCase()}${word.slice(1)}`;
    return index === 0 ? `${normalized[0].toLowerCase()}${normalized.slice(1)}` : normalized;
  }).join('');
}

function operationInventory(realm) {
  return realm.operations
    .map((operation) => ({
      operationId: operation.operation_id,
      method: operation.method.toLowerCase(),
      path: operation.path,
    }))
    .sort((left, right) => compareUtf16CodeUnits(left.operationId, right.operationId));
}

function property(schema, name) {
  return (schema?.properties || []).find((entry) => entry.name === name);
}

function assertExactStrings(actual, expected, label) {
  assert(JSON.stringify(actual) === JSON.stringify(expected), `${label} mismatch`);
}

function assertCurrentOperations(realm, admission) {
  const inventory = operationInventory(realm);
  assert(inventory.length === admission.openapi.operationCount, 'operation count drift');
  assert(
    sha256(canonicalJson(inventory)) === admission.openapi.operationInventorySha256,
    'operation inventory digest drift',
  );
  const operationById = new Map(realm.operations.map((operation) => [operation.operation_id, operation]));
  const expected = [
    ['WorldCoreController_createPersonaCharacter', 'POST', '/api/realm/core/persona-characters'],
    ['WorldCoreController_deletePersonaCharacter', 'DELETE', '/api/realm/core/persona-characters/by-id/{personaCharacterId}'],
    ['WorldCoreController_discoverPersonaCharacters', 'GET', '/api/realm/core/persona-characters/discovery'],
    ['WorldCoreController_getPersonaCharacter', 'GET', '/api/realm/core/persona-characters/by-id/{personaCharacterId}'],
    ['WorldCoreController_listPersonaCharacters', 'GET', '/api/realm/core/persona-characters'],
    ['WorldCoreController_replacePersonaCharacter', 'PUT', '/api/realm/core/persona-characters/by-id/{personaCharacterId}'],
    ['WorldCoreController_deleteWorldCharacter', 'DELETE', '/api/realm/core/world-characters/by-id/{characterId}'],
    ['WorldCoreController_discoverWorldCharacters', 'GET', '/api/realm/core/world-characters/discovery'],
    ['WorldCoreController_getWorldCharacter', 'GET', '/api/realm/core/world-characters/by-id/{characterId}'],
    ['WorldCoreController_replaceWorldCharacter', 'PUT', '/api/realm/core/world-characters/by-id/{characterId}'],
    ['EconomyController_getSourceOrigin', 'POST', '/api/economy/revenue-share/source-origin'],
    ['EconomyController_previewRevenueDistribution', 'POST', '/api/economy/revenue-share/preview'],
  ];
  for (const [operationId, method, operationPath] of expected) {
    const operation = operationById.get(operationId);
    assert(
      operation?.method === method && operation?.path === operationPath,
      `${operationId} method/path drift`,
    );
  }
  const retiredPersonaToken = ['Realm', 'Persona'].join('');
  assert(
    realm.operations.every((operation) => !operation.operation_id.includes(retiredPersonaToken)),
    'retired persona operation remains generated',
  );
  for (const operation of realm.operations) {
    assert(
      !operation.operation_id.includes('AppPermissionGrant')
        && !RETIRED_ENDPOINTS.some(
          (retired) => operation.path === retired || operation.path.startsWith(`${retired}/`),
        ),
      `retired Realm permission operation remains generated: ${operation.operation_id}`,
    );
  }
}

function assertFirstPartyMaterializationPolicy(modelByName, operationById, admission) {
  for (const name of modelByName.keys()) {
    assert(
      !name.startsWith('AppPermissionGrant') && !name.startsWith('AppPermissionScope'),
      `retired Realm permission model remains generated: ${name}`,
    );
  }
  const packet = modelByName.get('CreateSourceMaterializationPacketV3Dto');
  assert(packet?.kind === 'object' && packet.closed === true, 'Realm packet request is not closed');
  for (const forbidden of ['appId', 'scopeFamily', 'scopeName', 'accessGrantId']) {
    assert(!property(packet, forbidden), `Realm packet request retains ${forbidden}`);
  }
  const packetOperation = operationById.get(admission.accessPolicy.packetOperation.operationId);
  assert(packetOperation?.request_schema_ref === '#/components/schemas/CreateSourceMaterializationPacketV3Dto',
    'Realm packet operation schema drift');
}

function assertSourceRefModels(modelByName, admission) {
  const union = modelByName.get(admission.sourceRef.schema);
  assert(union?.kind === 'union', 'CharacterSourceRefV3 must be a generated union');
  assert(union.discriminator === admission.sourceRef.discriminator, 'sourceRef discriminator drift');
  assertExactStrings(
    (union.variants || []).map((variant) => variant.ref_name),
    admission.sourceRef.kinds.map((kind) => admission.sourceRef.branches[kind]),
    'sourceRef branch order',
  );
  assertExactStrings(
    union.discriminator_mapping,
    Object.fromEntries(Object.entries(admission.sourceRef.branches)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([kind, name]) => [kind, `#/components/schemas/${name}`])),
    'sourceRef discriminator mapping',
  );
  for (const kind of admission.sourceRef.kinds) {
    const branch = modelByName.get(admission.sourceRef.branches[kind]);
    assert(branch?.kind === 'object' && branch.closed === true, `${kind} sourceRef branch is not closed`);
    assertExactStrings(branch.required_properties, admission.sourceRef.requiredFields[kind], `${kind} required fields`);
    assertExactStrings((branch.properties || []).map((entry) => entry.name).sort(), [...admission.sourceRef.requiredFields[kind]].sort(), `${kind} exact fields`);
    assertExactStrings(property(branch, 'kind')?.schema?.values, [kind], `${kind} discriminator enum`);
  }
}

function assertPublishedLimits(modelByName, admission) {
  const limits = modelByName.get('SourceMaterializationPublishedLimitsDto');
  assert(limits?.kind === 'object' && limits.closed === true, 'published limits schema is not closed');
  const fields = Object.keys(admission.publishedLimits);
  assertExactStrings([...limits.required_properties].sort(), [...fields].sort(), 'published limits fields');
  for (const [field, maximum] of Object.entries(admission.publishedLimits)) {
    const schema = property(limits, field)?.schema;
    assert(
      schema?.kind === 'scalar'
        && schema.type === 'number'
        && schema.minimum === 1
        && schema.maximum === maximum,
      `published limit ${field} drift`,
    );
  }
}

function assertMaterializationClosure(realm, admission) {
  const modelByName = new Map(realm.model_schemas.map((model) => [model.name, model.schema]));
  const operationById = new Map(realm.operations.map((operation) => [operation.operation_id, operation]));
  for (const name of admission.openapi.componentSchemaNames) {
    assert(modelByName.has(name), `materialization schema closure is missing ${name}`);
  }
  for (const name of [
    'CreateSourceMaterializationPacketV3Dto',
    'SourceMaterializationPacketV3Dto',
    'MaterializationClosureSetManifestV3Dto',
    'SourceMaterializationSegmentV3Dto',
  ]) {
    const schema = modelByName.get(name);
    assert(schema?.kind === 'object' && schema.closed === true, `${name} is not closed`);
  }
  assertSourceRefModels(modelByName, admission);
  assertPublishedLimits(modelByName, admission);
  assertFirstPartyMaterializationPolicy(modelByName, operationById, admission);

  const schemaText = JSON.stringify(realm.model_schemas);
  for (const schemaVersion of Object.values(admission.schemaVersions)) {
    assert(schemaText.includes(schemaVersion), `generated schemas omit ${schemaVersion}`);
  }
  const retiredSchemaVersions = [
    ['realm.source-materialization-packet', 'v2'].join('/'),
    ['realm.materialization-context', 'v1'].join('/'),
    ['realm.materialization-coverage', 'v1'].join('/'),
    ['realm.materialization-bundle-manifest', 'v1'].join('/'),
  ];
  for (const schemaVersion of retiredSchemaVersions) {
    assert(!schemaText.includes(schemaVersion), `generated materialization closure retains ${schemaVersion}`);
  }
  const retiredModel = ['SourceMaterializationPacket', 'V2Dto'].join('');
  assert(!modelByName.has(retiredModel), 'generated materialization closure retains packet v2 model');
}

function assertSourceRealm(realm, admission) {
  assert(realm.source_kind === 'realm_openapi' && realm.source_state === 'openapi_loaded', 'Realm source is not the admitted OpenAPI');
  assertCurrentOperations(realm, admission);
  assertMaterializationClosure(realm, admission);
}

function withoutLanguageProjection(manifest) {
  const { language: _language, generated_projection: _projection, ...shared } = manifest;
  return shared;
}

function assertGeneratedParity(sourceRealm) {
  const sharedPath = 'sdks/generators/shared/generated/realm-core.manifest.json';
  const shared = readJson(sharedPath);
  assertExactStrings(shared, sourceRealm, 'shared generated Realm manifest');
  const publicSdkRealm = projectRealmForPublicSdks(sourceRealm);
  for (const [language, relativePath] of Object.entries(languageManifestPaths)) {
    const manifest = readJson(relativePath);
    assert(manifest.language === language, `${language} generated manifest language drift`);
    assert(manifest.generated_projection === 'language-core-generated', `${language} projection marker drift`);
    assertExactStrings(withoutLanguageProjection(manifest), publicSdkRealm, `${language} public Realm manifest parity`);
  }
}

function assertPrivateOperationProjection(sourceRealm) {
  const table = YAML.parse(fs.readFileSync(privateOperationTablePath, 'utf8'));
  const rows = Array.isArray(table?.operations) ? table.operations : [];
  assert(rows.length > 0, 'private Realm operation carrier table is empty');
  assertExactStrings(table.surfaces, rows.map((row) => row.operation_id), 'private operation surface order');
  const operationById = new Map(sourceRealm.operations.map((operation) => [operation.operation_id, operation]));
  const generatedSdkSurfaces = {
    typescript: {
      descriptor: fs.readFileSync(path.join(repoRoot, 'sdks', 'typescript', 'core-generated', 'realm-client.ts'), 'utf8'),
      typed: fs.readFileSync(path.join(repoRoot, 'sdks', 'typescript', 'core-generated', 'realm-typed-client.ts'), 'utf8'),
    },
    python: {
      descriptor: fs.readFileSync(path.join(repoRoot, 'sdks', 'python', 'core_generated', 'realm_client.py'), 'utf8'),
      typed: fs.readFileSync(path.join(repoRoot, 'sdks', 'python', 'core_generated', 'realm_typed_client.py'), 'utf8'),
    },
    go: {
      descriptor: fs.readFileSync(path.join(repoRoot, 'sdks', 'go', 'coregenerated', 'realm_client.go'), 'utf8'),
      typed: fs.readFileSync(path.join(repoRoot, 'sdks', 'go', 'coregenerated', 'typed_clients.go'), 'utf8'),
    },
    rust: {
      descriptor: fs.readFileSync(path.join(repoRoot, 'sdks', 'rust', 'core_generated', 'realm_client.rs'), 'utf8'),
      typed: fs.readFileSync(path.join(repoRoot, 'sdks', 'rust', 'core_generated', 'typed_clients.rs'), 'utf8'),
    },
  };
  const runtimeCarrier = fs.readFileSync(
    path.join(repoRoot, 'runtime', 'gen', 'realm', 'v1', 'source_materialization_openapi.go'),
    'utf8',
  );
  const runtimeAccountConsumer = fs.readFileSync(
    path.join(repoRoot, 'runtime', 'internal', 'services', 'account', 'realm_source_materialization.go'),
    'utf8',
  );
  const runtimePacketConsumer = fs.readFileSync(
    path.join(repoRoot, 'runtime', 'internal', 'services', 'runtimeagent', 'source_materialization_v3_stream.go'),
    'utf8',
  );
  const runtimeJwksConsumer = fs.readFileSync(
    path.join(repoRoot, 'runtime', 'internal', 'services', 'runtimeagent', 'source_materialization_v3_verifier.go'),
    'utf8',
  );
  for (const row of rows) {
    const operation = operationById.get(row.operation_id);
    assert(operation?.method === row.method && operation?.path === row.path,
      `private operation method/path drift: ${row.operation_id}`);
    assert(row.projection === 'runtime_private_generated_carrier' && row.public_sdk_method === 'forbidden',
      `private operation exposure drift: ${row.operation_id}`);
    assert(runtimeCarrier.includes(JSON.stringify(row.operation_id))
      && runtimeCarrier.includes(JSON.stringify(row.method))
      && runtimeCarrier.includes(JSON.stringify(row.path)),
    `Runtime private carrier omits ${row.operation_id}`);
    const methodPatterns = {
      typescript: `async ${lowerCamelCase(row.operation_id)}(`,
      python: `async def ${snakeCase(row.operation_id)}(`,
      go: `func (c RealmTypedClient) ${row.operation_id.replace(/(^|_)([A-Za-z0-9])/g, (_match, _prefix, char) => char.toUpperCase())}(`,
      rust: `pub fn ${snakeCase(row.operation_id)}(`,
    };
    for (const [language, surfaces] of Object.entries(generatedSdkSurfaces)) {
      assert(!surfaces.descriptor.includes(JSON.stringify(row.operation_id)),
        `${language} descriptor publicly projects private operation ${row.operation_id}`);
      assert(!surfaces.typed.includes(methodPatterns[language]),
        `${language} typed client publicly projects private operation ${row.operation_id}`);
    }
  }
  assert(/MaterializationSchemaClosureSHA256\s+=\s+"[a-f0-9]{64}"/.test(runtimeCarrier),
    'Runtime private carrier omits generated materialization closure digest');
  assert(runtimeCarrier.includes('ValidateMaterializationResponseObjectFields')
    && runtimeCarrier.includes('materializationResponseClosedObjectFields'),
  'Runtime private carrier omits generated response field-closure enforcement');
  assert(runtimeAccountConsumer.includes('WorldCoreControllerCreateSourceMaterializationPacketOperation')
    && runtimeAccountConsumer.includes('GetSourceMaterializationJwksOperation')
    && !runtimeAccountConsumer.includes('WorldCoreControllerCreateSourceMaterializationPacketPath')
    && !runtimeAccountConsumer.includes('GetSourceMaterializationJwksPath')
    && !runtimeAccountConsumer.includes('WorldCoreControllerCreateSourceMaterializationPacketMethod')
    && !runtimeAccountConsumer.includes('GetSourceMaterializationJwksMethod'),
  'Runtime account consumer must use generated opaque operation descriptors instead of path/method constants');
  assert(runtimePacketConsumer.includes('ValidateMaterializationResponseObjectFields')
    && runtimePacketConsumer.includes('WorldCoreControllerCreateSourceMaterializationPacketOperationID'),
  'Runtime Packet stream decoder does not consume generated response closure metadata');
  assert(runtimeJwksConsumer.includes('ValidateMaterializationResponseObjectFields')
    && runtimeJwksConsumer.includes('GetSourceMaterializationJwksOperationID'),
  'Runtime JWKS decoder does not consume generated response closure metadata');
  for (const [language, surfaces] of Object.entries(generatedSdkSurfaces)) {
    assert(surfaces.typed.includes('CreateSourceMaterializationPacketV3Dto')
      && surfaces.typed.includes('SourceMaterializationPacketV3Dto'),
    `${language} generated DTO shape projection is incomplete`);
  }
  return rows.length;
}

function assertMutationRejected(sourceRealm, admission, label, mutate) {
  const candidate = structuredClone(sourceRealm);
  mutate(candidate);
  try {
    assertSourceRealm(candidate, admission);
  } catch {
    return;
  }
  fail(`negative mutation was accepted: ${label}`);
}

function runNegativeMutations(sourceRealm, admission) {
  const mutations = [
    ['old operation', (realm) => {
      realm.operations.push({
        operation_id: ['WorldCoreController', 'listRealm', 'Personas'].join('_'),
        method: 'GET',
        path: '/api/realm/core/legacy-personas',
      });
    }],
    ['mixed discriminator branch', (realm) => {
      const union = realm.model_schemas.find((model) => model.name === admission.sourceRef.schema).schema;
      union.variants.reverse();
    }],
    ['unknown source field', (realm) => {
      const branch = realm.model_schemas.find((model) => model.name === admission.sourceRef.branches.worldCharacter).schema;
      branch.properties.push({ name: 'fallback', required: false, schema: { kind: 'scalar', type: 'string' } });
    }],
    ['unknown source enum', (realm) => {
      const branch = realm.model_schemas.find((model) => model.name === admission.sourceRef.branches.personaCharacter).schema;
      property(branch, 'kind').schema.values.push('profile');
    }],
    ['missing source field', (realm) => {
      const branch = realm.model_schemas.find((model) => model.name === admission.sourceRef.branches.personaCharacter).schema;
      branch.required_properties = branch.required_properties.filter((field) => field !== 'ownerAccountId');
    }],
    ['limit ceiling drift', (realm) => {
      const limits = realm.model_schemas.find((model) => model.name === 'SourceMaterializationPublishedLimitsDto').schema;
      property(limits, 'maxSetBytes').schema.maximum += 1;
    }],
    ['retired permission model', (realm) => {
      realm.model_schemas.push({
        name: 'AppPermissionGrantDto',
        schema: { kind: 'object', closed: true, properties: [], required_properties: [] },
      });
    }],
    ['packet permission input', (realm) => {
      const packet = realm.model_schemas.find((model) => model.name === 'CreateSourceMaterializationPacketV3Dto').schema;
      packet.properties.push({
        name: 'accessGrantId',
        required: true,
        schema: { kind: 'scalar', type: 'string' },
      });
      packet.required_properties.push('accessGrantId');
    }],
  ];
  for (const [label, mutate] of mutations) {
    assertMutationRejected(sourceRealm, admission, label, mutate);
  }
  return mutations.length;
}

function main() {
  const admission = JSON.parse(fs.readFileSync(admissionPath, 'utf8'));
  const lock = YAML.parse(fs.readFileSync(lockPath, 'utf8'));
  assert(admission?.schemaVersion === ADMISSION_SCHEMA_VERSION, 'current producer admission schema drift');
  assertAccessPolicyAdmission(admission);
  assert(lock?.schema_version === LOCK_SCHEMA_VERSION, 'current lock schema is not v4');
  assert(lock?.openapi?.document_sha256 === admission.openapi.sha256, 'lock/OpenAPI admission digest drift');
  assertExactStrings(lock?.schema_versions, admission.schemaVersions, 'lock schema versions');
  assert(lock?.access_policy?.version === ACCESS_POLICY_VERSION, 'lock access-policy version drift');
  assert(lock?.access_policy?.digest === admission.accessPolicy.digest, 'lock access-policy digest drift');
  assert(
    lock?.access_policy?.authority_class === ACCESS_POLICY_AUTHORITY_CLASS,
    'lock authority class drift',
  );
  assert(
    lock?.access_policy?.third_party_app_permission_required === false
      && lock?.access_policy?.permission_catalog === 'empty',
    'lock app-permission posture drift',
  );
  assertExactStrings(
    lock?.access_policy?.packet_operation,
    admission.accessPolicy.packetOperation,
    'lock first-party packet operation',
  );
  assertExactStrings(
    lock?.access_policy?.authorization_inputs,
    AUTHORIZATION_INPUTS,
    'lock authorization inputs',
  );
  assertExactStrings(
    lock?.access_policy?.forbidden_inputs,
    FORBIDDEN_INPUTS,
    'lock forbidden inputs',
  );
  assertExactStrings(
    lock?.access_policy?.retired_identifiers,
    RETIRED_IDENTIFIERS,
    'lock retired identifiers',
  );
  assertExactStrings(
    lock?.access_policy?.retired_endpoints,
    RETIRED_ENDPOINTS,
    'lock retired endpoints',
  );
  assert(lock?.producer_admission?.tracked_only === true, 'lock producer admission is not tracked-only');

  const sourceRealm = extractRealmCore();
  assertSourceRealm(sourceRealm, admission);
  const negativeMutationCount = runNegativeMutations(sourceRealm, admission);
  let privateOperationCount = 0;
  if (!sourceOnly) {
    assertGeneratedParity(sourceRealm);
    privateOperationCount = assertPrivateOperationProjection(sourceRealm);
  }
  process.stdout.write(
    `Realm v3 generated convergence passed: mode=${sourceOnly ? 'source-only' : 'full'} operations=${sourceRealm.operations.length} models=${sourceRealm.model_schemas.length} shape_languages=${sourceOnly ? 'deferred' : '4/4'} runtime_private_carriers=${sourceOnly ? 'deferred' : `${privateOperationCount}/${privateOperationCount}`} public_sdk_private_operations=${sourceOnly ? 'deferred' : `0/${privateOperationCount}`} public_sdk_languages=${sourceOnly ? 'deferred' : '4/4'} negative_mutations=${negativeMutationCount}/${negativeMutationCount}\n`,
  );
}

try {
  main();
} catch (error) {
  process.stderr.write(`[check:realm-v3:generated-convergence] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
