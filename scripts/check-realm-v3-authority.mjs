#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');

const files = {
  materialization: '.nimi/spec/runtime/kernel/runtime-local-agent-materialization-contract.md',
  context: '.nimi/spec/runtime/kernel/runtime-agent-context-composition-contract.md',
  service: '.nimi/spec/runtime/kernel/runtime-agent-service-contract.md',
  rpcMethods: '.nimi/spec/runtime/kernel/tables/rpc-methods.yaml',
  rpcMigration: '.nimi/spec/runtime/kernel/tables/rpc-migration-map/methods-agent-cognition.yaml',
  authPosture: '.nimi/spec/runtime/kernel/tables/runtime-rpc-auth-posture/agent-ai-cognition.yaml',
  broker: '.nimi/spec/runtime/kernel/tables/realm-broker-operations.yaml',
  accountSession: '.nimi/spec/runtime/kernel/account-session-contract.md',
  accountPermissions: '.nimi/spec/runtime/kernel/tables/account-rpc-permission-matrix.yaml',
  sdkIndex: '.nimi/spec/sdks/kernel/index.md',
  sdkRealmCore: '.nimi/spec/sdks/kernel/realm-core-contract.md',
  sdkRealmApi: '.nimi/spec/sdks/kernel/realm-api-consumer-contract.md',
  sdkRuntime: '.nimi/spec/sdks/kernel/runtime-contract.md',
  sdkRuntimeMethods: '.nimi/spec/sdks/kernel/tables/runtime-method-groups.yaml',
  desktopExplore: '.nimi/spec/desktop/kernel/explore-surface-contract.md',
  desktopActions: '.nimi/spec/desktop/kernel/tables/realm-source-materialization-actions.yaml',
  platformPermission: '.nimi/spec/platform/kernel/app-permission-contract.md',
  platformAppRegistry: '.nimi/spec/platform/kernel/tables/nimi-app-registry.yaml',
  platformPermissionEvidence: '.nimi/spec/platform/kernel/tables/rule-evidence.rules-app-permission.yaml',
  realmPointer: '.nimi/spec/realm/external-realm.md',
  sentinel: 'config/realm-v3/protected-sentinel.json',
};

const forbiddenLegacyTokens = [
  'realm.source-materialization-packet/v2',
  'BundleTransportManifestV1',
  'SourceMaterializationPacket',
  'RealmPersona',
  'realmPersona',
  'sourceContentHash',
];
const forbiddenPublicMethods = [
  'CreateSourceMaterializationChallenge',
  'BeginSourceMaterializationUpload',
  'PutSourceMaterializationChunk',
  'CommitSourceMaterialization',
  'AbortSourceMaterializationUpload',
];
const exactBrokerOperations = [
  'WorldCoreController_discoverPersonaCharacters',
  'WorldCoreController_getPersonaCharacter',
  'WorldCoreController_getWorldCharacter',
  'WorldCoreController_getWorldEntity',
  'WorldCoreController_listPersonaCharacters',
  'WorldCoreController_listWorldRelationships',
  'WorldPublicController_getWorld',
  'WorldPublicController_getWorldDetailWithCharacters',
  'WorldPublicController_listWorlds',
].sort();
const exactLimits = new Map([
  ['maxSegmentBytes', '8388608'],
  ['maxSegmentComponentCount', '256'],
  ['maxSegmentChunks', '4096'],
  ['maxChunkBytes', '262144'],
  ['maxSetSegments', '64'],
  ['maxSetBytes', '134217728'],
  ['maxSetComponentCount', '16384'],
  ['maxSetChunks', '65536'],
]);
const exactLanes = [
  'runtime_policy',
  'output_contract',
  'source_identity',
  'source_behavior',
  'world_context',
  'relationship_context',
  'source_knowledge',
  'canonical_memory',
  'conversation_history',
  'capability_context',
  'current_user_turn',
];
const exactDesktopStates = [
  'grant_denied',
  'grant_pending',
  'grant_required',
  'local_agent_ambiguous',
  'local_agent_available',
  'materialization_available',
  'materialization_error',
  'materializing',
  'runtime_unavailable',
].sort();

function fail(message) {
  throw new Error(`Realm v3 authority failed: ${message}`);
}

function read(relative, overrides) {
  if (Object.hasOwn(overrides, relative)) return overrides[relative];
  return fs.readFileSync(path.join(repoRoot, relative), 'utf8');
}

function requireText(source, token, owner) {
  if (!source.includes(token)) fail(`${owner} is missing ${token}`);
}

function forbidText(source, token, owner) {
  if (source.includes(token)) fail(`${owner} retains forbidden ${token}`);
}

function listFiles(root) {
  const entries = fs.readdirSync(root, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name));
  return entries.flatMap((entry) => {
    const target = path.join(root, entry.name);
    return entry.isDirectory() ? listFiles(target) : [target];
  });
}

function check(overrides = {}) {
  const materialization = read(files.materialization, overrides);
  for (const token of [
    'MaterializeRealmSource',
    'CharacterSourceRefV3',
    '`worldCharacter`',
    '`personaCharacter`',
    'realm.source-materialization-packet/v3',
    'MaterializationClosureSetManifestV3',
    'current-purpose RS256 JWKS',
    'LocalAgentSourceSnapshotV2',
    'nimi.runtime.realm-source-provenance/v3',
    'source_materialization_data_reset_required',
    'realm-character-v3',
    'Proof-covered presentation/resource/asset references become eligible only',
    'Runtime-owned bounded presentation and voice lifecycle resolution',
    'presentation fallback only after admission',
    'cannot enter SnapshotV2 or its hashes',
  ]) requireText(materialization, token, files.materialization);
  for (const [name, value] of exactLimits) {
    const matches = [...materialization.matchAll(new RegExp(`\\b${name}\\s*<=\\s*${value}\\b`, 'gu'))];
    if (matches.length !== 1) fail(`${files.materialization} must define ${name}=${value} exactly once`);
  }
  requireText(materialization, 'one atomic LocalAgent + SnapshotV2 + provenance + safe-result commit', files.materialization);
  requireText(materialization, 'no raw packet/proof/challenge/nonce/TTL/audience', files.materialization);
  requireText(materialization, 'no automatic\nupgrade, interpretation, alias, dual read/write, or on-read migration', files.materialization);
  for (const token of [
    '`scopeFamily=realm_source`',
    '`scopeName=realm_source.snapshot.consume`',
    '`qualifier=null` and `qualifierKey=""`',
    '`POST /api/human/me/permission-grants`',
    '`POST /api/human/me/permission-grants/by-id/{grantId}/grant`',
    '`POST /api/realm/core/source-materialization-packets`',
    '`accessGrantId`',
    '`realm_source.snapshot.bind` is non-authorizing',
    '`agent.identity.project` is a separate Runtime-local permission',
    'it has no Agent or\nLocalAgent ontology',
    'no LocalAgent exists before the verified atomic commit',
  ]) requireText(materialization, token, files.materialization);

  const platformPermission = read(files.platformPermission, overrides);
  for (const token of [
    'P-PERM-014',
    '`permission_scope_ref` remains exclusively Platform/Runtime-local authority',
    '`realm_permission_request_refs`',
    'scopeFamily: realm_source',
    'scopeName: realm_source.snapshot.consume',
    'authorizingState: GRANTED',
    '`realm_source.snapshot.bind` is not current positive Realm\nauthority',
    '`agent.identity.project` remains a Runtime-local scope',
  ]) requireText(platformPermission, token, files.platformPermission);

  const appRegistry = parseYaml(read(files.platformAppRegistry, overrides));
  const registryFields = appRegistry?.app_schema?.fields ?? [];
  if (!registryFields.includes('permission_scope_ref')
    || !registryFields.includes('realm_permission_request_refs')) {
    fail(`${files.platformAppRegistry} does not separate local and Realm permission fields`);
  }
  if (appRegistry?.field_owners?.permission_scope_ref?.owner !== 'platform_runtime_local_permission'
    || appRegistry?.field_owners?.realm_permission_request_refs?.owner !== 'external_realm_permission_grant'
    || appRegistry?.field_owners?.realm_permission_request_refs?.local_grant_projection !== 'forbidden') {
    fail(`${files.platformAppRegistry} permission field ownership is not closed`);
  }
  for (const app of appRegistry?.apps ?? []) {
    const localScopes = Array.isArray(app.permission_scope_ref) ? app.permission_scope_ref : [];
    if (localScopes.some((scope) => scope?.scopeFamily === 'realm' || scope?.scopeFamily === 'realm_source')) {
      fail(`${files.platformAppRegistry} ${app.app_id} mixes Realm-owned scopes into permission_scope_ref`);
    }
    const realmRequests = app.realm_permission_request_refs ?? [];
    if (!Array.isArray(realmRequests)) {
      fail(`${files.platformAppRegistry} ${app.app_id} Realm request projection is not an array`);
    }
    if (app.app_id !== 'nimi.avatar' && realmRequests.length !== 0) {
      fail(`${files.platformAppRegistry} ${app.app_id} has a non-admitted Realm request projection`);
    }
  }
  const avatar = (appRegistry?.apps ?? []).find((app) => app.app_id === 'nimi.avatar');
  const exactRealmRequest = [{
    appId: 'nimi.avatar',
    scopeFamily: 'realm_source',
    scopeName: 'realm_source.snapshot.consume',
    qualifier: null,
    qualifierKey: '',
    authorizingState: 'GRANTED',
  }];
  if (JSON.stringify(avatar?.realm_permission_request_refs) !== JSON.stringify(exactRealmRequest)) {
    fail(`${files.platformAppRegistry} Avatar Realm request selector is not exact`);
  }
  const permissionEvidence = parseYaml(read(files.platformPermissionEvidence, overrides));
  if (!(permissionEvidence?.entries ?? []).includes('P-PERM-014')
    || !(permissionEvidence?.rules ?? []).some((entry) => entry.rule_id === 'P-PERM-014'
      && (entry.test_files ?? []).includes('scripts/check-realm-v3-authority.mjs'))) {
    fail(`${files.platformPermissionEvidence} does not map P-PERM-014 to the focused gate`);
  }
  const realmPointer = read(files.realmPointer, overrides);
  for (const token of [
    'Realm request projection is kept separate from Platform/Runtime-local',
    '`agent.identity.project` scope cannot be\nsent to or interpreted by Realm',
    'Runtime creates no LocalAgent until the Realm\nPacket has been strictly verified and atomically materialized',
  ]) requireText(realmPointer, token, files.realmPointer);

  const context = read(files.context, overrides);
  const lanes = [...context.matchAll(/^\d+\. `([^`]+)`$/gmu)].map((match) => match[1]).slice(0, 11);
  if (JSON.stringify(lanes) !== JSON.stringify(exactLanes)) {
    fail(`${files.context} eleven-lane order drift: ${JSON.stringify(lanes)}`);
  }
  for (const token of [
    'Runtime-authored system authority',
    'Capabilities and tools derive from Runtime',
    'Canonical memory and committed transcript remain distinct',
    'Runtime must not serialize arbitrary source JSON',
    '`profile.narrative` summary/archetype/traits',
    'optional `profile.capabilities` to `source_behavior`',
    '`profile.interactionProfile.dialogueExemplars`',
    'typed `character` and `user` labels/roles',
    'distinct typed\n`source_knowledge` narrative/milestone items',
    'Presentation fallback is a post-admission Runtime projection step',
    'Runtime-owned presentation/voice lifecycle',
  ]) requireText(context, token, files.context);

  const publicAuthorityFiles = [
    files.service,
    files.rpcMethods,
    files.rpcMigration,
    files.authPosture,
    files.sdkRuntimeMethods,
  ];
  for (const relative of publicAuthorityFiles) {
    const source = read(relative, overrides);
    requireText(source, 'MaterializeRealmSource', relative);
    for (const method of forbiddenPublicMethods) forbidText(source, method, relative);
  }

  const broker = parseYaml(read(files.broker, overrides));
  const brokerOperations = (broker.operations ?? []).map((entry) => entry.operation_id).sort();
  if (JSON.stringify(brokerOperations) !== JSON.stringify(exactBrokerOperations)) {
    fail(`${files.broker} exact current operation set drift`);
  }
  if ((broker.operations ?? []).some((entry) => entry.http_method === 'POST'
    || /materialization.*packet/iu.test(String(entry.operation_id)))) {
    fail(`${files.broker} admits packet issuance`);
  }
  if (broker.generic_proxy !== 'forbidden'
    || broker.unlisted_operation_disposition !== 'deny_broker_operation_not_admitted') {
    fail(`${files.broker} generic/unlisted fail-closed posture drift`);
  }

  const actions = parseYaml(read(files.desktopActions, overrides));
  const actionStates = (actions.states ?? []).map((entry) => entry.state).sort();
  if (JSON.stringify(actionStates) !== JSON.stringify(exactDesktopStates)) {
    fail(`${files.desktopActions} state set drift`);
  }
  for (const state of actions.states ?? []) {
    if (JSON.stringify(state.source_kinds) !== JSON.stringify(['worldCharacter', 'personaCharacter'])) {
      fail(`${files.desktopActions} ${state.state} source kinds are not exact CharacterSourceRefV3 kinds`);
    }
  }
  const available = actions.states.find((entry) => entry.state === 'materialization_available');
  if (available?.runtime_operation !== 'MaterializeRealmSource'
    || JSON.stringify(available?.request_fields) !== JSON.stringify(['sourceRef', 'requestId'])) {
    fail(`${files.desktopActions} materialization intent is not the high-level Runtime operation`);
  }

  for (const relative of [
    files.sdkIndex,
    files.sdkRealmCore,
    files.sdkRealmApi,
    files.sdkRuntime,
    files.desktopExplore,
  ]) {
    const source = read(relative, overrides);
    requireText(source, 'CharacterSourceRefV3', relative);
    requireText(source, 'MaterializeRealmSource', relative);
  }

  const accountSession = read(files.accountSession, overrides);
  for (const token of [
    'verified protected\nDesktop control origin',
    '`desktop_account_host` role',
    'host-bound caller',
    'current authenticated account',
    'Runtime alone selects the configured canonical Realm base',
    'holds and refreshes\nthe Realm bearer',
    'MaterializeRealmSource',
  ]) requireText(accountSession, token, files.accountSession);

  const permissions = parseYaml(read(files.accountPermissions, overrides));
  const realmRows = (permissions.selected_operation_dependencies ?? [])
    .filter((entry) => entry.method_id === '/nimi.runtime.v1.RuntimeAccountService/InvokeRealmUnary');
  if (realmRows.length !== exactBrokerOperations.length
    || JSON.stringify(realmRows.map((entry) => entry.operation_id).sort()) !== JSON.stringify(exactBrokerOperations)) {
    fail(`${files.accountPermissions} exact selected Realm operation set drift`);
  }
  const invariantKeys = [
    'caller_class',
    'runtime_caller_mode',
    'decision',
    'requirements',
    'grant_requirement',
    'caller_selected_realm_base',
    'authority_owner',
    'source_rule',
  ];
  for (const row of realmRows) {
    if (row.operation_id === 'WorldCoreController_createSourceMaterializationPacket') {
      fail(`${files.accountPermissions} retains broker packet issuance`);
    }
    for (const key of invariantKeys) if (row[key] === undefined) fail(`${files.accountPermissions} ${row.operation_id} is missing ${key}`);
    if (row.caller_class !== 'desktop_account_and_local_app_control'
      || row.runtime_caller_mode !== 'ACCOUNT_CALLER_MODE_DESKTOP_SHELL'
      || row.decision !== 'allow_when'
      || row.grant_requirement !== 'none'
      || row.caller_selected_realm_base !== 'forbidden'
      || row.authority_owner !== 'RuntimeAccountService'
      || row.source_rule !== 'K-ACCSVC-023'
      || JSON.stringify(row.requirements) !== JSON.stringify([
        'protected_desktop_control_origin',
        'desktop_account_host_origin',
        'host_bound_desktop_caller_envelope',
        'current_authenticated_account',
        'runtime_realm_bearer_custody',
        'exact_broker_operation_policy',
      ])) {
      fail(`${files.accountPermissions} ${row.operation_id} protected security semantics drift`);
    }
  }

  const sentinel = JSON.parse(read(files.sentinel, overrides));
  const migrations = sentinel.authorizedAuthorityMigrations ?? [];
  if (migrations.length !== 2
    || migrations.some((entry) => entry.authorizationState !== 'NC0_PASS_N1_AUTHORIZED')
    || migrations.some((entry) => !Array.isArray(entry.requiredUnchangedSemantics)
      || entry.requiredUnchangedSemantics.length !== 9)) {
    fail(`${files.sentinel} exact protected-authority authorization drift`);
  }

  const specRoot = path.join(repoRoot, '.nimi/spec');
  for (const absolute of listFiles(specRoot)) {
    const relative = path.relative(repoRoot, absolute);
    const source = read(relative, overrides);
    for (const token of [...forbiddenLegacyTokens, ...forbiddenPublicMethods]) {
      forbidText(source, token, relative);
    }
  }

  return {
    schemaVersion: 'nimi.realm-v3-authority-result/v1',
    verdict: 'PASS',
    sourceKinds: ['worldCharacter', 'personaCharacter'],
    packetSchema: 'realm.source-materialization-packet/v3',
    limits: Object.fromEntries(exactLimits),
    publicMaterializationOperations: ['MaterializeRealmSource'],
    brokerOperations: exactBrokerOperations,
    snapshotSchema: 'LocalAgentSourceSnapshotV2',
    provenanceEpoch: 'v3',
    lanes: exactLanes,
    desktopStates: exactDesktopStates,
    legacyAuthorityMatches: 0,
    publicLowLevelUploadMethods: 0,
    protectedAuthorityMigrations: 2,
    realmGrantSelector: exactRealmRequest[0],
    localIdentityScope: 'agent.identity.project',
    permissionOwnerSplit: true,
  };
}

try {
  const result = check();
  if (process.argv.slice(2).includes('--negative-self-test')) {
    const original = read(files.rpcMethods, {});
    const mutations = [];
    let rejectedReason = '';
    try {
      check({
        [files.rpcMethods]: `${original}\n# mutation\nmethod: ${forbiddenPublicMethods[0]}\n`,
      });
    } catch (error) {
      rejectedReason = error instanceof Error ? error.message : String(error);
    }
    if (!rejectedReason.includes(forbiddenPublicMethods[0])) {
      fail('negative legacy public-RPC mutation was not rejected by the owner gate');
    }
    mutations.push({
      mutation: `append ${forbiddenPublicMethods[0]} to ${files.rpcMethods}`,
      rejected: true,
      rejectedReason,
    });

    const contextSource = read(files.context, {});
    const compilerBoundary = 'optional `profile.capabilities` to `source_behavior`';
    rejectedReason = '';
    try {
      check({
        [files.context]: contextSource.replace(compilerBoundary, 'optional profile capabilities'),
      });
    } catch (error) {
      rejectedReason = error instanceof Error ? error.message : String(error);
    }
    if (!rejectedReason.includes(compilerBoundary)) {
      fail('negative compiler authority mutation was not rejected by the owner gate');
    }
    mutations.push({
      mutation: `remove exact descriptive-capability lane boundary from ${files.context}`,
      rejected: true,
      rejectedReason,
    });

    const materializationSource = read(files.materialization, {});
    rejectedReason = '';
    try {
      check({
        [files.materialization]: materializationSource.replace(
          '`scopeName=realm_source.snapshot.consume`',
          '`scopeName=agent.identity.project`',
        ),
      });
    } catch (error) {
      rejectedReason = error instanceof Error ? error.message : String(error);
    }
    if (!rejectedReason.includes('realm_source.snapshot.consume')) {
      fail('negative Realm/local selector mutation was not rejected by the owner gate');
    }
    mutations.push({
      mutation: `replace Realm source scope with Runtime-local agent scope in ${files.materialization}`,
      rejected: true,
      rejectedReason,
    });

    const registrySource = read(files.platformAppRegistry, {});
    rejectedReason = '';
    try {
      check({
        [files.platformAppRegistry]: registrySource.replace(
          '        scopeFamily: memory\n        scopeName: memory.read.bounded',
          '        scopeFamily: realm_source\n        scopeName: realm_source.snapshot.consume',
        ),
      });
    } catch (error) {
      rejectedReason = error instanceof Error ? error.message : String(error);
    }
    if (!rejectedReason.includes('mixes Realm-owned scopes')) {
      fail('negative mixed-owner app-registry mutation was not rejected by the owner gate');
    }
    mutations.push({
      mutation: `place a Realm-owned scope in permission_scope_ref in ${files.platformAppRegistry}`,
      rejected: true,
      rejectedReason,
    });

    result.negativeSelfTest = {
      verdict: 'PASS',
      mutations,
    };
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`[check:realm-v3:authority] ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
