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
        beginLogin: async (input) => {
          calls.push({ method: 'beginLogin', input });
          return {
            accepted: true,
            loginAttemptId: 'attempt-1',
            oauthAuthorizationUrl: 'https://realm.nimi.test/api/auth/oauth/authorize?client_id=nimi.tester',
            state: 'state-1',
            nonce: 'nonce-1',
          };
        },
        completeLogin: async (input) => {
          calls.push({ method: 'completeLogin', input });
          return {
            accepted: true,
            accountProjection: {
              accountId: 'acct-tester-1',
              displayName: 'Tester Runtime User',
            },
          };
        },
        logout: async (input) => {
          calls.push({ method: 'logout', input });
          return { accepted: true };
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

test('Tester auth flow consumes RuntimeAccountService without app-owned token custody', async () => {
  const {
    createNimiAppDesktopBrowserAuthAdapter,
    createNimiAppRuntimeAccountBroker,
    getRuntimeAccountCaller,
    loadRuntimeAccountUser,
    logoutRuntimeAccount,
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

  const broker = createNimiAppRuntimeAccountBroker(client);
  const beginResult = await broker.begin({
    callbackUrl: 'http://127.0.0.1:4100/oauth/callback',
    timeoutMs: 12_500,
  });
  assert.deepEqual(beginResult, {
    loginAttemptId: 'attempt-1',
    authorizationUrl: 'https://realm.nimi.test/api/auth/oauth/authorize?client_id=nimi.tester',
    state: 'state-1',
    nonce: 'nonce-1',
  });
  assert.deepEqual(findCall(calls, 'beginLogin').input, {
    caller: runtimeAccountCaller,
    redirectUri: 'http://127.0.0.1:4100/oauth/callback',
    callbackOrigin: 'http://127.0.0.1:4100',
    requestedScopes: [],
    ttlSeconds: 13,
  });

  const completeResult = await broker.complete({
    loginAttemptId: 'attempt-1',
    code: 'oauth-code',
    state: 'state-1',
    nonce: 'nonce-1',
    callbackUrl: 'http://127.0.0.1:4100/oauth/callback',
  });
  assert.deepEqual(completeResult, {
    user: {
      id: 'acct-tester-1',
      displayName: 'Tester Runtime User',
    },
  });
  const completeInput = findCall(calls, 'completeLogin').input;
  assert.equal(completeInput.refreshToken, '');
  assert.equal('accessToken' in completeInput, false);
  assert.equal('subjectUserId' in completeInput, false);
  assert.deepEqual(completeInput.caller, runtimeAccountCaller);

  const adapter = createNimiAppDesktopBrowserAuthAdapter(() => {}, client);
  await assert.rejects(
    () => adapter.applyToken('app-access-token', 'app-refresh-token'),
    /must not own access or refresh token custody/,
  );
  await assert.rejects(
    () => adapter.persistSession({
      user: { id: 'acct-tester-1' },
      accessToken: 'app-access-token',
      refreshToken: 'app-refresh-token',
    }),
    /must not persist access or refresh tokens/,
  );

  await adapter.clearPersistedSession();
  await logoutRuntimeAccount(client);
  const logoutCalls = calls.filter((entry) => entry.method === 'logout');
  assert.equal(logoutCalls.length, 2);
  for (const call of logoutCalls) {
    assert.deepEqual(call.input, {
      caller: runtimeAccountCaller,
      reason: 'nimi_lab_logout',
    });
  }

  const rejected = createFakePlatformClient();
  rejected.client.runtime.account.logout = async (input) => {
    rejected.calls.push({ method: 'logout', input });
    return { accepted: false, accountReasonCode: 'ACCOUNT_REASON_CODE_CALLER_UNAUTHORIZED' };
  };
  await assert.rejects(
    () => logoutRuntimeAccount(rejected.client),
    /Runtime account logout rejected: ACCOUNT_REASON_CODE_CALLER_UNAUTHORIZED/,
  );
});
