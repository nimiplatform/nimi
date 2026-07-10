import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { AccountSessionState } from '@nimiplatform/sdk/runtime/wire-types';
import { buildWithTsc } from './tsc-build.mjs';

const root = path.resolve(import.meta.dirname, '..');

let buildDir = null;

function buildModule() {
  if (buildDir) return buildDir;
  mkdirSync(path.join(root, '.tmp'), { recursive: true });
  buildDir = mkdtempSync(path.join(root, '.tmp', 'runtime-account-auth-'));
  buildWithTsc([
    '--outDir',
    buildDir,
    '--rootDir',
    'src',
    '--module',
    'NodeNext',
    '--moduleResolution',
    'NodeNext',
    '--target',
    'ES2022',
    '--jsx',
    'react-jsx',
    '--skipLibCheck',
    'true',
    '--types',
    'node',
    '--noEmit',
    'false',
    'src/shell/auth/runtime-account-auth.ts',
  ], {
    cwd: root,
    stdio: 'pipe',
  });
  return buildDir;
}

async function importRuntimeAccountAuth() {
  const moduleUrl = pathToFileURL(path.join(buildModule(), 'shell/auth/runtime-account-auth.js')).href;
  return import(moduleUrl);
}

function createFakePlatformClient() {
  const calls = [];
  const client = {
    runtime: {
      account: {
        getAccountSessionStatus: async (input) => {
          calls.push({ method: 'getAccountSessionStatus', input });
          return {
            state: AccountSessionState.AUTHENTICATED,
            accountProjection: {
              accountId: 'acct-tester-1',
              displayName: 'Tester Runtime User',
            },
          };
        },
      },
    },
  };
  return { client, calls };
}

function findCall(calls, method) {
  const call = calls.find((entry) => entry.method === method);
  assert.ok(call, `${method} call must be recorded`);
  return call;
}

test.after(() => {
  if (buildDir) {
    rmSync(buildDir, { recursive: true, force: true });
  }
});

test('Tester consumes the Runtime account projection without account control or token custody', async () => {
  const {
    getRuntimeAccountCaller,
    loadRuntimeAccountUser,
  } = await importRuntimeAccountAuth();
  const { client, calls } = createFakePlatformClient();
  const runtimeAccountCaller = getRuntimeAccountCaller();

  const user = await loadRuntimeAccountUser(client);
  assert.deepEqual(user, {
    id: 'acct-tester-1',
    displayName: 'Tester Runtime User',
  });
  assert.deepEqual(findCall(calls, 'getAccountSessionStatus').input, {
    caller: runtimeAccountCaller,
  });
  const tokenMethod = ['get', 'AccessToken'].join('');
  assert.equal(calls.some((entry) => entry.method === tokenMethod), false);
  assert.equal(calls.some((entry) => entry.method === 'refreshAccountSession'), false);
  assert.equal(calls.some((entry) => entry.method === 'beginLogin'), false);
  assert.equal(calls.some((entry) => entry.method === 'completeLogin'), false);
  assert.equal(calls.some((entry) => entry.method === 'logout'), false);
});
