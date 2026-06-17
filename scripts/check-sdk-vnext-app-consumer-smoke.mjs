#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { withSdkDistLock } from './lib/sdk-dist-lock.mjs';

const PNPM_BIN = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const vnextRoot = path.join(repoRoot, 'sdks', 'typescript');
let tempRoot = '';

function cleanup() {
  if (tempRoot) {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function run(label, command, args, options = {}) {
  process.stdout.write(`[check-sdk-vnext-app-consumer-smoke] ${label}\n`);
  const result = spawnSync(command, args, {
    cwd: repoRoot,
    env: process.env,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit code ${String(result.status ?? 1)}`);
  }
}

function writeConsumerFiles() {
  tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-sdk-vnext-app-consumer-'));
  const packageDir = path.join(tempRoot, 'node_modules', '@nimiplatform');
  mkdirSync(packageDir, { recursive: true });
  symlinkSync(vnextRoot, path.join(packageDir, 'sdk'), 'dir');

  writeFileSync(path.join(tempRoot, 'package.json'), JSON.stringify({
    private: true,
    type: 'module',
  }, null, 2));

  writeFileSync(path.join(tempRoot, 'consumer.mjs'), `
import assert from 'node:assert/strict';
import {
  createNimiAIConfigStore,
  createNimiAIHostSurface,
  createNimiAISnapshotRecord,
  createNimiAISnapshotStore,
} from '@nimiplatform/sdk/ai';
import {
  NimiAppClient,
  PermissionClient,
  createAppScopeRef,
  createNimiAppClient,
  createPermissionClient,
  createScopeCatalogModule,
  isAdmittedNimiFirstRunLocalBaseline,
  selectNimiAppFactoryAIProfileForFirstRun,
} from '@nimiplatform/sdk/app';

const row = {
  appId: 'nimi.example-app',
  appKind: 'nimi-app',
  displayName: 'Example App',
  trustTier: 'nimi-first-party',
  publisher: 'Nimi',
  aiProfileSelectionRef: 'local-standard',
  capabilitySet: ['text.generate'],
  releaseDescriptorRef: 'nimi.example-app.bundled',
  installStoragePolicyRef: 'nimi-data-app-roots',
  sourceRule: 'P-NAPP-004',
};
function entryFor(appId = row.appId) {
  const catalogRow = { ...row, appId };
  return {
    appId: catalogRow.appId,
    appKind: catalogRow.appKind,
    displayName: catalogRow.displayName,
    trustTier: catalogRow.trustTier,
    publisher: catalogRow.publisher,
    aiProfileSelectionRef: catalogRow.aiProfileSelectionRef,
    capabilitySet: catalogRow.capabilitySet,
    releaseDescriptorRef: catalogRow.releaseDescriptorRef,
    installStoragePolicyRef: catalogRow.installStoragePolicyRef,
    sources: {
      catalog: { status: 'present', value: catalogRow },
      account: { status: 'absent' },
      local: { status: 'absent' },
      packageReadiness: { status: 'absent' },
    },
    installState: 'not-installed',
    openReadiness: 'install-required',
    activeJobs: [],
    nextActions: [],
  };
}
const appClient = createNimiAppClient({
  async list() { return [entryFor()]; },
  async get(appId) { return entryFor(appId); },
  async status(appId) { return { appId, launchReadiness: 'ready' }; },
});
assert(appClient instanceof NimiAppClient);
assert.equal((await appClient.list())[0].appId, 'nimi.example-app');
assert.equal((await appClient.status('nimi.example-app')).launchReadiness, 'ready');
for (const retired of ['install', 'update', 'uninstall', 'launch', 'healthRepair', 'subscribe']) {
  assert.equal(typeof appClient[retired], 'undefined');
}

const scopeRef = createAppScopeRef({ appId: 'tester.app', surfaceId: 'settings' });
const launchScopeRef = createAppScopeRef({ appId: 'tester.app' });
const permissionScope = {
  appId: 'tester.app',
  scopeFamily: 'account',
  scopeName: 'account.read',
};
const grant = {
  scopeRef,
  grant: { grantId: 'grant-1', permissionScope },
  state: 'granted',
};
const permission = createPermissionClient({
  async list() { return [grant]; },
  async get() { return grant; },
  async request(inputScopeRef) {
    return { ...grant, scopeRef: inputScopeRef, state: 'pending' };
  },
  async revoke() { return { ...grant, state: 'revoked' }; },
  async status(inputScopeRef) { return { scopeRef: inputScopeRef, grants: [grant] }; },
  subscribe(inputScopeRef, callback) {
    callback({ scopeRef: inputScopeRef, grant });
    return () => {};
  },
});
assert(permission instanceof PermissionClient);
assert.equal((await permission.list(scopeRef))[0].state, 'granted');
assert.equal((await permission.request(scopeRef, {
  permissionScope,
  reason: 'consumer smoke',
})).state, 'pending');

const catalog = createScopeCatalogModule({ appId: 'tester.app' });
catalog.registerAppScopes({
  manifest: {
    manifestVersion: '1.0.0',
    scopes: ['app.tester.app.settings.read'],
  },
});
assert.equal(catalog.publishCatalog().status, 'published');

const appProfile = {
  profileId: 'tester-app-profile',
  title: 'Tester App Profile',
  capabilities: {
    'text.generate': {
      targetRef: {
        kind: 'local-runtime',
        readinessRef: 'tester-app-local-text',
      },
    },
  },
};
const hostAI = createNimiAIHostSurface({
  profiles: [appProfile],
  configStore: createNimiAIConfigStore({ enableEphemeralStore: true }),
  snapshotStore: createNimiAISnapshotStore({ enableEphemeralStore: true }),
  now: () => '2026-06-06T00:00:00.000Z',
});
const appRequirementDeclarations = [{
  requirementId: 'tester.app.ai.requirements',
  scopeRef: launchScopeRef,
  requiredSlices: [{
    requirementSliceId: 'tester.app.text.generate',
    capability: 'text.generate',
    profileSliceRef: 'capabilities.text.generate',
    readinessPolicy: 'required',
  }],
  setupProjectionPolicy: 'setup-required',
}];
const applyResult = await hostAI.aiProfile.apply(launchScopeRef, appProfile.profileId, {
  requirementDeclarations: appRequirementDeclarations,
});
assert.equal(applyResult.success, true);
const appConfig = hostAI.aiConfig.get(launchScopeRef);
assert.equal(appConfig.scopeRef.kind, 'app');
assert.equal(appConfig.scopeRef.ownerId, 'tester.app');
assert.equal(appConfig.profileOrigin?.profileId, appProfile.profileId);
assert.equal(appConfig.capabilities.targetRefs['text.generate']?.kind, 'local-runtime');
const appSnapshot = createNimiAISnapshotRecord({
  executionId: 'app-consumer-text-generate-1',
  config: appConfig,
  capability: 'text.generate',
  selectedTargetRef: appConfig.capabilities.targetRefs['text.generate'] ?? null,
  metadata: { consumer: 'sdk-vnext-app-consumer-smoke' },
  createdAt: '2026-06-06T00:00:01.000Z',
});
hostAI.aiSnapshot.record(launchScopeRef, appSnapshot);
assert.equal(hostAI.aiSnapshot.getLatest(launchScopeRef)?.configEvidence.profileOrigin?.profileId, appProfile.profileId);
assert.equal(hostAI.aiSnapshot.get('app-consumer-text-generate-1')?.scopeRef.ownerId, 'tester.app');

const localProfile = {
  alias: 'local-small',
  privacyPosture: 'local-preferred',
  applicableScopes: ['first-run'],
  firstRunInstallLevels: ['minimal'],
  computePosture: 'local-required',
  routingPolicy: 'local-first',
  capabilitySet: ['text.generate'],
  hostCapabilityProfileRefs: [],
  localComputePackRefs: ['qwen-small'],
  dependencyFamilyRefs: ['ollama'],
  materializationConfirmationRequired: true,
  sourceRule: 'consumer-smoke',
};
assert.equal(isAdmittedNimiFirstRunLocalBaseline(localProfile), true);
assert.equal(selectNimiAppFactoryAIProfileForFirstRun([localProfile])?.alias, 'local-small');
`);

  writeFileSync(path.join(tempRoot, 'consumer.ts'), `
import {
  createNimiAIConfigStore,
  createNimiAIHostSurface,
  createNimiAISnapshotRecord,
  createNimiAISnapshotStore,
  type NimiAICapabilityRequirementDeclaration,
  type NimiAIHostSurface,
  type NimiAIProfile,
} from '@nimiplatform/sdk/ai';
import {
  NimiAppClient,
  PermissionClient,
  createAppScopeRef,
  createNimiAppClient,
  createPermissionClient,
  createScopeCatalogModule,
  type GrantSpec,
  type NimiAppInventoryEntry,
  type NimiAppRow,
  type NimiAppScopeRef,
  type NimiAppStatus,
  type NimiAppAIProfileFactoryRow,
  type PermissionScopeRef,
} from '@nimiplatform/sdk/app';

const row: NimiAppRow = {
  appId: 'nimi.example-app',
  appKind: 'nimi-app',
  displayName: 'Example App',
  trustTier: 'nimi-first-party',
  publisher: 'Nimi',
  aiProfileSelectionRef: 'local-standard',
  capabilitySet: ['text.generate'],
  releaseDescriptorRef: 'nimi.example-app.bundled',
  installStoragePolicyRef: 'nimi-data-app-roots',
  sourceRule: 'P-NAPP-004',
};
const entry: NimiAppInventoryEntry = {
  appId: row.appId,
  appKind: row.appKind,
  displayName: row.displayName,
  trustTier: row.trustTier,
  publisher: row.publisher,
  aiProfileSelectionRef: row.aiProfileSelectionRef,
  capabilitySet: row.capabilitySet,
  releaseDescriptorRef: row.releaseDescriptorRef,
  installStoragePolicyRef: row.installStoragePolicyRef,
  sources: {
    catalog: { status: 'present', value: row },
    account: { status: 'absent' },
    local: { status: 'absent' },
    packageReadiness: { status: 'absent' },
  },
  installState: 'not-installed',
  openReadiness: 'install-required',
  activeJobs: [],
  nextActions: [],
};
const status: NimiAppStatus = { appId: row.appId, launchReadiness: 'ready' };
const appClient: NimiAppClient = createNimiAppClient({
  async list() { return [entry]; },
  async get() { return entry; },
  async status() { return status; },
});
const scopeRef: NimiAppScopeRef = createAppScopeRef({ appId: 'tester.app', surfaceId: 'settings' });
const launchScopeRef: NimiAppScopeRef = createAppScopeRef({ appId: 'tester.app' });
const permissionScope: PermissionScopeRef = {
  appId: 'tester.app',
  scopeFamily: 'account',
  scopeName: 'account.read',
};
const grantSpec: GrantSpec = { permissionScope, reason: 'consumer smoke' };
const permissionClient: PermissionClient = createPermissionClient({
  async list() { return []; },
  async get() { return { scopeRef, grant: { grantId: 'grant-1', permissionScope }, state: 'granted' }; },
  async request() { return { scopeRef, grant: { grantId: 'grant-1', permissionScope }, state: 'pending' }; },
  async revoke() { return { scopeRef, grant: { grantId: 'grant-1', permissionScope }, state: 'revoked' }; },
  async status() { return { scopeRef, grants: [] }; },
  subscribe() { return () => {}; },
});
const catalog = createScopeCatalogModule({ appId: 'tester.app' });
const profile: NimiAppAIProfileFactoryRow = {
  alias: 'local-small',
  privacyPosture: 'local-preferred',
  applicableScopes: ['first-run'],
  firstRunInstallLevels: ['minimal'],
  computePosture: 'local-required',
  routingPolicy: 'local-first',
  capabilitySet: ['text.generate'],
  hostCapabilityProfileRefs: [],
  localComputePackRefs: ['qwen-small'],
  dependencyFamilyRefs: ['ollama'],
  materializationConfirmationRequired: true,
  sourceRule: 'consumer-smoke',
};
const appProfile: NimiAIProfile = {
  profileId: 'tester-app-profile',
  title: 'Tester App Profile',
  capabilities: {
    'text.generate': {
      targetRef: {
        kind: 'local-runtime',
        readinessRef: 'tester-app-local-text',
      },
    },
  },
};
const hostAI: NimiAIHostSurface = createNimiAIHostSurface({
  profiles: [appProfile],
  configStore: createNimiAIConfigStore({ enableEphemeralStore: true }),
  snapshotStore: createNimiAISnapshotStore({ enableEphemeralStore: true }),
});
const appRequirements: NimiAICapabilityRequirementDeclaration[] = [{
  requirementId: 'tester.app.ai.requirements',
  scopeRef: launchScopeRef,
  requiredSlices: [{
    requirementSliceId: 'tester.app.text.generate',
    capability: 'text.generate',
    profileSliceRef: 'capabilities.text.generate',
    readinessPolicy: 'required',
  }],
  setupProjectionPolicy: 'setup-required',
}];
const appConfig = hostAI.aiConfig.get(launchScopeRef);
const snapshot = createNimiAISnapshotRecord({
  config: appConfig,
  capability: 'text.generate',
  selectedTargetRef: appConfig.capabilities.targetRefs['text.generate'] ?? null,
});

void appClient;
void permissionClient;
void grantSpec;
void catalog;
void profile;
void hostAI;
void appRequirements;
void snapshot;
`);

  writeFileSync(path.join(tempRoot, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      target: 'ES2022',
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      strict: true,
      noEmit: true,
      skipLibCheck: true,
      lib: ['ES2022', 'DOM', 'DOM.Iterable'],
    },
    include: ['consumer.ts'],
  }, null, 2));
}

function main() {
  run('building sdks/typescript package', PNPM_BIN, ['--dir', vnextRoot, 'build']);
  writeConsumerFiles();
  run('running package export consumer', 'node', [path.join(tempRoot, 'consumer.mjs')], { cwd: tempRoot });
  run('typechecking package export consumer', PNPM_BIN, [
    '--dir',
    vnextRoot,
    'exec',
    'tsc',
    '-p',
    path.join(tempRoot, 'tsconfig.json'),
  ]);
  process.stdout.write('SDK vNext App consumer smoke passed\n');
}

try {
  await withSdkDistLock('check-sdk-vnext-app-consumer-smoke build+consumer', main);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`check-sdk-vnext-app-consumer-smoke failed: ${message}\n`);
  process.exitCode = 1;
} finally {
  cleanup();
}
