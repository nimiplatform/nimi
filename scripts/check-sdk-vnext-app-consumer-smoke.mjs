#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { linkWorkspacePackage } from './lib/sdk-consumer-link.mjs';
import { isSdkDistPrepared, withSdkDistLock } from './lib/sdk-dist-lock.mjs';

const PNPM_BIN = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '..');
const vnextRoot = path.join(repoRoot, 'sdks', 'typescript');
let tempRoot = '';

function cleanup() {
  if (tempRoot) rmSync(tempRoot, { recursive: true, force: true });
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
  linkWorkspacePackage(vnextRoot, path.join(packageDir, 'sdk'));
  writeFileSync(path.join(tempRoot, 'package.json'), JSON.stringify({ private: true, type: 'module' }, null, 2));

  writeFileSync(path.join(tempRoot, 'consumer.mjs'), `
import assert from 'node:assert/strict';
import {
  NimiAppClient,
  PermissionClient,
  createAppScopeRef,
  createNimiAppClient,
  createPermissionClient,
} from '@nimiplatform/sdk/app';

function entryFor(appId = 'nimi.example-app') {
  const localRecord = {
    appId,
    displayName: 'Example App',
    trustClass: 'local_development',
    recordState: 'active',
    sessionState: 'session-bound',
  };
  return {
    appId,
    displayName: localRecord.displayName,
    trustClass: localRecord.trustClass,
    source: { status: 'present', value: localRecord },
    localRecordState: 'active',
    openReadiness: 'ready',
    nextActions: ['open'],
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

const scopeRef = createAppScopeRef({ appId: 'tester.app', surfaceId: 'settings' });
const permission = createPermissionClient({
  async status(permissionId) { return { permissionId, posture: 'unavailable', canRequest: false, agents: [] }; },
  async request({ permissionId }) { return { permissionId, posture: 'unavailable', canRequest: false, agents: [] }; },
  subscribe(permissionId, callback) {
    callback({ status: { permissionId, posture: 'unavailable', canRequest: false, agents: [] } });
    return () => {};
  },
});
assert(permission instanceof PermissionClient);
assert.equal((await permission.status('agents.interact')).posture, 'unavailable');
await assert.rejects(
  permission.request({ permissionId: 'agents.voice', reason: 'consumer smoke' }),
  (error) => error?.reasonCode === 'SDK_PERMISSION_NOT_ADMITTED',
);
assert.equal(scopeRef.ownerId, 'tester.app');
`);

  writeFileSync(path.join(tempRoot, 'consumer.ts'), `
import {
  NimiAppClient,
  PermissionClient,
  createAppScopeRef,
  createNimiAppClient,
  createPermissionClient,
  type NimiAppInventoryEntry,
  type NimiAppScopeRef,
  type NimiAppStatus,
} from '@nimiplatform/sdk/app';

const entry: NimiAppInventoryEntry = {
  appId: 'nimi.example-app',
  displayName: 'Example App',
  trustClass: 'local_development',
  source: {
    status: 'present',
    value: {
      appId: 'nimi.example-app',
      displayName: 'Example App',
      trustClass: 'local_development',
      recordState: 'active',
      sessionState: 'session-bound',
    },
  },
  localRecordState: 'active',
  openReadiness: 'ready',
  nextActions: ['open'],
};
const status: NimiAppStatus = { appId: 'nimi.example-app', launchReadiness: 'ready' };
const appClient: NimiAppClient = createNimiAppClient({
  async list() { return [entry]; },
  async get() { return entry; },
  async status() { return status; },
});
const scopeRef: NimiAppScopeRef = createAppScopeRef({ appId: 'tester.app', surfaceId: 'settings' });
const permissionClient: PermissionClient = createPermissionClient({
  async status(permissionId) { return { permissionId, posture: 'unavailable', canRequest: false, agents: [] }; },
  async request({ permissionId }) { return { permissionId, posture: 'unavailable', canRequest: false, agents: [] }; },
  subscribe(permissionId, callback) {
    callback({ status: { permissionId, posture: 'unavailable', canRequest: false, agents: [] } });
    return () => {};
  },
});
void appClient;
void scopeRef;
void permissionClient;
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
  if (!isSdkDistPrepared()) {
    run('building sdks/typescript package', PNPM_BIN, ['--dir', vnextRoot, 'build']);
  }
  writeConsumerFiles();
  run('running package export consumer', 'node', [path.join(tempRoot, 'consumer.mjs')], { cwd: tempRoot });
  run('typechecking package export consumer', PNPM_BIN, [
    '--dir', vnextRoot, 'exec', 'tsc', '-p', path.join(tempRoot, 'tsconfig.json'),
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
