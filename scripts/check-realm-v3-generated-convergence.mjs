#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';

import { extractRealmCore } from '../sdks/generators/lib/realm-openapi.mjs';
import {
  ACCESS_POLICY_SELECTOR,
  ACCESS_POLICY_VERSION,
  ADMISSION_SCHEMA_VERSION,
  LOCK_SCHEMA_VERSION,
  RUNTIME_GRANT_ACQUISITION,
  assertAccessPolicyAdmission,
  canonicalJson,
  compareUtf16CodeUnits,
} from './generate-realm-contract-lock.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const admissionPath = path.join(repoRoot, 'config', 'realm-v3', 'current-producer-admission.json');
const lockPath = path.join(repoRoot, 'config', 'realm-contract-lock.yaml');
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
    ['getMyAppPermissionGrant', 'GET', '/api/human/me/permission-grants/by-id/{grantId}'],
    ['listMyAppPermissionGrants', 'GET', '/api/human/me/permission-grants'],
    ['requestMyAppPermissionGrant', 'POST', '/api/human/me/permission-grants'],
    ['grantMyAppPermissionGrant', 'POST', '/api/human/me/permission-grants/by-id/{grantId}/grant'],
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
}

function assertGrantPolicyModels(modelByName, operationById, admission) {
  assertExactStrings(
    modelByName.get('AppPermissionScopeFamily')?.values,
    [ACCESS_POLICY_SELECTOR.scopeFamily],
    'Realm permission scope family enum',
  );
  assertExactStrings(
    modelByName.get('AppPermissionScopeName')?.values,
    [ACCESS_POLICY_SELECTOR.scopeName],
    'Realm permission scope name enum',
  );
  assertExactStrings(
    modelByName.get('AppPermissionGrantState')?.values,
    ['PENDING', 'GRANTED', 'DENIED', 'EXPIRED', 'REVOKED', 'SUPERSEDED'],
    'Realm permission grant states',
  );
  const request = modelByName.get('AppPermissionGrantRequestDto');
  const grant = modelByName.get('AppPermissionGrantGrantDto');
  const packet = modelByName.get('CreateSourceMaterializationPacketV3Dto');
  assert(request?.kind === 'object'
    && property(request, 'appId')?.required === true
    && property(request, 'scopeFamily')?.required === true
    && property(request, 'scopeName')?.required === true
    && property(request, 'qualifier')?.required === false,
  'Realm permission request DTO does not encode canonical qualifier omission');
  assert(grant?.kind === 'object'
    && property(grant, 'expectedVersion')?.required === true
    && property(grant, 'expectedVersion')?.schema?.minimum === 1,
  'Realm explicit grant DTO does not require expectedVersion');
  assert(packet?.kind === 'object'
    && property(packet, admission.accessPolicy.lifecycle.packet.grantIdField)?.required === true,
  'Realm packet request does not require accessGrantId');

  const requestOperation = operationById.get(admission.accessPolicy.lifecycle.request.operationId);
  const grantOperation = operationById.get(admission.accessPolicy.lifecycle.grant.operationId);
  const packetOperation = operationById.get(admission.accessPolicy.lifecycle.packet.operationId);
  assert(requestOperation?.request_schema_ref === '#/components/schemas/AppPermissionGrantRequestDto',
    'Realm permission request operation schema drift');
  assert(grantOperation?.request_schema_ref === '#/components/schemas/AppPermissionGrantGrantDto'
    && grantOperation?.path_parameters?.some((parameter) => parameter.name === 'grantId' && parameter.required === true),
  'Realm explicit grant operation schema/path parameter drift');
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
  assertGrantPolicyModels(modelByName, operationById, admission);

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
  for (const [language, relativePath] of Object.entries(languageManifestPaths)) {
    const manifest = readJson(relativePath);
    assert(manifest.language === language, `${language} generated manifest language drift`);
    assert(manifest.generated_projection === 'language-core-generated', `${language} projection marker drift`);
    assertExactStrings(withoutLanguageProjection(manifest), shared, `${language} Realm manifest parity`);
  }
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
    ['local scope as Realm selector', (realm) => {
      realm.model_schemas.find((model) => model.name === 'AppPermissionScopeName').schema.values = ['agent.identity.project'];
    }],
    ['grant without CAS', (realm) => {
      const grant = realm.model_schemas.find((model) => model.name === 'AppPermissionGrantGrantDto').schema;
      property(grant, 'expectedVersion').required = false;
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
  assert(lock?.schema_version === LOCK_SCHEMA_VERSION, 'current lock schema is not v3');
  assert(lock?.openapi?.document_sha256 === admission.openapi.sha256, 'lock/OpenAPI admission digest drift');
  assertExactStrings(lock?.schema_versions, admission.schemaVersions, 'lock schema versions');
  assert(lock?.access_policy?.version === ACCESS_POLICY_VERSION, 'lock access-policy version drift');
  assert(lock?.access_policy?.digest === admission.accessPolicy.digest, 'lock access-policy digest drift');
  assertExactStrings(lock?.access_policy?.selector, admission.accessPolicy.selector, 'lock Realm grant selector');
  assertExactStrings(lock?.access_policy?.lifecycle, admission.accessPolicy.lifecycle, 'lock Realm grant lifecycle');
  assertExactStrings(
    lock?.access_policy?.runtime_acquisition,
    RUNTIME_GRANT_ACQUISITION,
    'lock Runtime grant acquisition',
  );
  assertExactStrings(
    lock?.access_policy?.non_authorizing_scope_names,
    admission.accessPolicy.nonAuthorizingScopeNames,
    'lock non-authorizing scopes',
  );

  const sourceRealm = extractRealmCore();
  assertSourceRealm(sourceRealm, admission);
  const negativeMutationCount = runNegativeMutations(sourceRealm, admission);
  if (!sourceOnly) assertGeneratedParity(sourceRealm);
  process.stdout.write(
    `Realm v3 generated convergence passed: mode=${sourceOnly ? 'source-only' : 'full'} operations=${sourceRealm.operations.length} models=${sourceRealm.model_schemas.length} languages=${sourceOnly ? 'deferred' : '4/4'} negative_mutations=${negativeMutationCount}/${negativeMutationCount}\n`,
  );
}

try {
  main();
} catch (error) {
  process.stderr.write(`[check:realm-v3:generated-convergence] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
