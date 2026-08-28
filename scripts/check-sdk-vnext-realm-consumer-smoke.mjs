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
  if (tempRoot) {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

function run(label, command, args, options = {}) {
  process.stdout.write(`[check-sdk-vnext-realm-consumer-smoke] ${label}\n`);
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
  tempRoot = mkdtempSync(path.join(os.tmpdir(), 'nimi-sdk-vnext-realm-consumer-'));
  const packageDir = path.join(tempRoot, 'node_modules', '@nimiplatform');
  mkdirSync(packageDir, { recursive: true });
  linkWorkspacePackage(vnextRoot, path.join(packageDir, 'sdk'));
  writeFileSync(path.join(tempRoot, 'package.json'), JSON.stringify({ private: true, type: 'module' }, null, 2));

  writeFileSync(path.join(tempRoot, 'consumer.mjs'), `
import assert from 'node:assert/strict';
import {
  Realm,
  createRealm,
  REALM_AUTH_METHODS,
  REALM_WORLD_CORE_METHODS,
} from '@nimiplatform/sdk/realm';

let lastRequest;
const transport = {
  async unary(request) {
    lastRequest = request;
    if (request.methodId === 'getMe') {
      return {
        id: 'user-1',
        handle: 'realm-smoke',
        displayName: 'Realm Smoke',
        createdAt: '2026-06-10T00:00:00.000Z',
        role: 'USER',
        status: 'ACTIVE',
      };
    }
    if (request.methodId === 'WorldCoreController_getOasisWorld') {
      return {
        contentHash: 'sha256:realm-smoke',
        contentRevision: 1,
        core: {
          assets: { intents: [], resourceRefs: [] },
          authoring: { source: 'realm-smoke' },
          entities: [],
          identity: { name: 'OASIS', summary: 'Realm smoke world' },
          ontology: { entityKinds: [], relationshipTypes: [] },
          presentation: {},
          relationships: [],
          scenes: [],
          systems: [],
          timeModel: {
            anchor: {
              realStartedAt: '2026-06-10T00:00:00.000Z',
              worldStartedAt: '2026-06-10T00:00:00.000Z',
              worldStartedAtDisplay: '2026-06-10 00:00:00',
            },
            calendar: null,
            displayFormat: null,
            flowRatio: 1,
            isPaused: false,
            mode: 'wallClockAnchored',
            pausedWorldTime: null,
          },
          timeline: { events: [] },
        },
        createdAt: '2026-06-10T00:00:00.000Z',
        id: 'world-oasis',
        lorebookDeclaration: {
          identityBaseSetting: 'OASIS is the canonical Realm smoke world.',
          rolePlacements: [],
          worldRules: [],
        },
        origin: { kind: 'system' },
        schemaVersion: 'world-core/v1',
        updatedAt: '2026-06-10T00:00:00.000Z',
        visibility: 'system',
      };
    }
    return { ok: true, methodId: request.methodId };
  },
  async *serverStream() {
    throw new Error('Realm consumer smoke must not use streaming');
  },
};

const realm = createRealm({ transport, authMetadata: () => ({ authorization: 'Bearer token' }) });
assert(realm instanceof Realm);
assert.equal(REALM_AUTH_METHODS.includes('checkEmail'), true);
assert.equal(REALM_WORLD_CORE_METHODS.includes('worldCoreControllerGetOasisWorld'), true);
assert.equal(typeof realm.auth.checkEmail, 'function');
assert.equal(typeof realm.worldCore.worldCoreControllerGetOasisWorld, 'function');

await realm.me();
assert.equal(lastRequest.methodId, 'getMe');
assert.equal(lastRequest.metadata.authorization, 'Bearer token');
assert.equal(typeof realm.generated.terminateCurrentAccount, 'function');

await realm.worldCore.worldCoreControllerGetOasisWorld({ path: {} });
assert.equal(lastRequest.methodId, 'WorldCoreController_getOasisWorld');

for (const privateMethod of [
  'requestMyAppPermissionGrant',
  'grantMyAppPermissionGrant',
  'getSourceMaterializationJwks',
  'issueRuntimeRealmGrant',
  'worldCoreControllerCreateSourceMaterializationPacket',
]) {
  assert.equal(privateMethod in realm.generated, false);
}
assert.equal('core' in realm, false);
assert.equal(Object.getPrototypeOf(realm.generated), null);
assert.equal(Object.isFrozen(realm.generated), true);
`);

  writeFileSync(path.join(tempRoot, 'consumer.ts'), `
import {
  Realm,
  createRealm,
  type CoreTransport,
} from '@nimiplatform/sdk/realm';
import {
  type RealmGetMeOperationResponse,
  type RealmWorldCoreControllerGetOasisWorldOperationResponse,
} from '@nimiplatform/sdk/realm/generated';

const transport: CoreTransport = {
  async unary<Response>() {
    return { id: 'entity-1' } as Response;
  },
  async *serverStream<Response>() {
    yield { id: 'entity-1' } as Response;
  },
};

const realm: Realm = createRealm({ transport });
const me: Promise<RealmGetMeOperationResponse> = realm.me();
const world: Promise<RealmWorldCoreControllerGetOasisWorldOperationResponse> =
  realm.worldCore.worldCoreControllerGetOasisWorld({ path: {} });
// @ts-expect-error Retired Realm app-grant methods are absent from the first-party API.
realm.generated.requestMyAppPermissionGrant({
  path: {},
  body: {
    appId: 'nimi.avatar',
    scopeFamily: 'realm_source',
    scopeName: 'realm_source.snapshot.consume',
    reason: 'realm source consumption',
  },
});
// @ts-expect-error Packet acquisition is Runtime-internal authority.
realm.generated.worldCoreControllerCreateSourceMaterializationPacket({ path: {}, body: {} });
// @ts-expect-error Realm does not expose its raw CoreClient transport.
realm.core;

void me;
void world;
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
    '--dir',
    vnextRoot,
    'exec',
    'tsc',
    '-p',
    path.join(tempRoot, 'tsconfig.json'),
  ]);
  process.stdout.write('SDK vNext Realm consumer smoke passed\n');
}

try {
  await withSdkDistLock('check-sdk-vnext-realm-consumer-smoke build+consumer', main);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`check-sdk-vnext-realm-consumer-smoke failed: ${message}\n`);
  process.exitCode = 1;
} finally {
  cleanup();
}
