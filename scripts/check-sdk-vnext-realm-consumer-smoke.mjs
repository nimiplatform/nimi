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
  symlinkSync(vnextRoot, path.join(packageDir, 'sdk'), 'dir');
  writeFileSync(path.join(tempRoot, 'package.json'), JSON.stringify({ private: true, type: 'module' }, null, 2));

  writeFileSync(path.join(tempRoot, 'consumer.mjs'), `
import assert from 'node:assert/strict';
import {
  Realm,
  RealmCore,
  createRealm,
  REALM_AUTH_METHODS,
  REALM_WORLD_METHODS,
} from '@nimiplatform/sdk/realm';

let lastRequest;
const transport = {
  async unary(request) {
    lastRequest = request;
    if (request.methodId === 'getMe') return { id: 'user-1', status: 'ACTIVE' };
    if (request.methodId === 'WorldController_getMainWorld') return { id: 'world-1' };
    return { ok: true, methodId: request.methodId };
  },
  async *serverStream() {
    throw new Error('Realm consumer smoke must not use streaming');
  },
};

const realm = createRealm({ transport, authMetadata: () => ({ authorization: 'Bearer token' }) });
assert(realm instanceof Realm);
assert.equal(REALM_AUTH_METHODS.includes('checkEmail'), true);
assert.equal(REALM_WORLD_METHODS.includes('worldControllerGetMainWorld'), true);
assert.equal(typeof realm.auth.checkEmail, 'function');
assert.equal(typeof realm.world.worldControllerGetMainWorld, 'function');

await realm.me();
assert.equal(lastRequest.methodId, 'getMe');
assert.equal(lastRequest.metadata.authorization, 'Bearer token');

await realm.world.worldControllerGetMainWorld({ path: {} });
assert.equal(lastRequest.methodId, 'WorldController_getMainWorld');

const core = new RealmCore(realm.core);
await core.operation({ operationId: 'getMe', body: { path: {} } });
assert.equal(lastRequest.methodId, 'getMe');
`);

  writeFileSync(path.join(tempRoot, 'consumer.ts'), `
import {
  Realm,
  RealmCore,
  createRealm,
  type CoreTransport,
} from '@nimiplatform/sdk/realm';
import {
  type RealmGetMeOperationResponse,
  type RealmWorldControllerGetMainWorldOperationResponse,
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
const core: RealmCore = new RealmCore(realm.core);
const me: Promise<RealmGetMeOperationResponse> = realm.me();
const world: Promise<RealmWorldControllerGetMainWorldOperationResponse> =
  realm.world.worldControllerGetMainWorld({ path: {} });

void core;
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
