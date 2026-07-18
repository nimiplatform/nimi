import assert from 'node:assert/strict';
import test from 'node:test';

import { createNimiClient } from '../../root-client';
import type { NimiLocalAppClientInput } from './local-app-runtime-platform';

function createLocalAppClient(input: NimiLocalAppClientInput) {
  return createNimiClient({ localApp: input });
}

function standardShell(overrides: Record<string, unknown> = {}) {
  return {
    session: {
      status: async () => ({ state: 'ready', reasonCode: 'action-executed', retryable: false }),
    },
    permission: {
      status: async ({ permissionId }: { permissionId: string }) => ({
        permissionId,
        state: 'unavailable',
        canRequest: false,
        reasonCode: 'LOCAL_APP_OPERATION_UNAVAILABLE',
      }),
      request: async ({ permissionId }: { permissionId: string }) => ({
        permissionId,
        state: 'unavailable',
        canRequest: false,
        reasonCode: 'LOCAL_APP_OPERATION_UNAVAILABLE',
      }),
    },
    storage: {
      readJson: async () => ({ value: { version: 1 }, sizeBytes: 13 }),
      writeJson: async (_path: string, value: unknown) => ({ value, sizeBytes: 13 }),
      removeJson: async () => ({ removed: false }),
    },
    ...overrides,
  };
}

test('local-app client exposes only auth, product permissions, and app-private storage', async () => {
  const client = createLocalAppClient({ standardShell: standardShell() });
  assert.deepEqual(Object.keys(client).sort(), ['auth', 'permissions', 'storage']);
  assert.deepEqual(await client.auth.status(), {
    mode: 'local-app',
    state: 'session-bound',
    sessionBound: true,
    reasonCode: 'action-executed',
    actionHint: 'continue_local_app_session',
    retryable: false,
  });
  assert.equal('agent' in client, false);
  assert.equal('artifacts' in client, false);
});

test('reserved product permission status is visible without leaking internal selectors', async () => {
  const calls: unknown[] = [];
  const client = createLocalAppClient({
    standardShell: standardShell({
      permission: {
        status: async (input: unknown) => {
          calls.push(input);
          return {
            permissionId: 'agents.interact',
            state: 'unavailable',
            canRequest: false,
            reasonCode: 'LOCAL_APP_OPERATION_UNAVAILABLE',
          };
        },
        request: async () => { throw new Error('reserved permission must not reach transport'); },
      },
    }),
  });
  assert.deepEqual(await client.permissions.status('agents.interact'), {
    permissionId: 'agents.interact',
    posture: 'unavailable',
    canRequest: false,
    detail: 'LOCAL_APP_OPERATION_UNAVAILABLE',
  });
  assert.deepEqual(calls, [{ permissionId: 'agents.interact' }]);
  await assert.rejects(
    () => client.permissions.request({ permissionId: 'agents.interact', reason: 'Continue the conversation' }),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_PERMISSION_NOT_ADMITTED',
  );
  assert.equal(JSON.stringify(calls).includes('operationId'), false);
  assert.equal(JSON.stringify(calls).includes('resourceRef'), false);
});

test('permission ids and projections are closed to the public catalog', async () => {
  const client = createLocalAppClient({ standardShell: standardShell() });
  await assert.rejects(
    () => client.permissions.status('runtime_agent.conversation.open' as never),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_PERMISSION_ID_UNKNOWN',
  );

  const mismatched = createLocalAppClient({
    standardShell: standardShell({
      permission: {
        status: async () => ({
          permissionId: 'artifacts.open', state: 'unavailable', canRequest: false, reasonCode: 'unavailable',
        }),
        request: async () => ({}),
      },
    }),
  });
  await assert.rejects(
    () => mismatched.permissions.status('agents.interact'),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_LOCAL_APP_PROJECTION_INVALID',
  );
});

test('app-private storage works without a permission request', async () => {
  const calls: unknown[] = [];
  const client = createLocalAppClient({
    standardShell: standardShell({
      storage: {
        readJson: async (path: string) => { calls.push(['read', path]); return { value: { version: 1 }, sizeBytes: 13 }; },
        writeJson: async (path: string, value: unknown) => { calls.push(['write', path, value]); return { value, sizeBytes: 13 }; },
        removeJson: async (path: string) => { calls.push(['remove', path]); return { removed: false }; },
      },
    }),
  });
  assert.deepEqual(await client.storage.readJson('agent-chat/state.json'), { value: { version: 1 }, sizeBytes: 13 });
  assert.deepEqual(await client.storage.writeJson('agent-chat/state.json', { version: 2 }), {
    value: { version: 2 }, sizeBytes: 13,
  });
  assert.deepEqual(await client.storage.removeJson('agent-chat/state.json'), { removed: false });
  assert.deepEqual(calls, [
    ['read', 'agent-chat/state.json'],
    ['write', 'agent-chat/state.json', { version: 2 }],
    ['remove', 'agent-chat/state.json'],
  ]);
});

test('app-private storage rejects path escape and non-JSON values before transport', async () => {
  const client = createLocalAppClient({ standardShell: standardShell() });
  for (const relativePath of ['../state.json', '/state.json', 'agent\\state.json', 'CON.json', 'state.txt']) {
    await assert.rejects(
      () => client.storage.readJson(relativePath),
      (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_LOCAL_APP_STORAGE_PATH_INVALID',
    );
  }
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  await assert.rejects(
    () => client.storage.writeJson('state.json', cyclic as never),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_LOCAL_APP_STORAGE_VALUE_INVALID',
  );
});

test('client rejects expanded host namespaces and permission operation selectors', async () => {
  assert.throws(
    () => createLocalAppClient({
      standardShell: { ...standardShell(), runtime: { unary: async () => ({}) } },
    } as never),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_LOCAL_APP_INPUT_INVALID',
  );
  const client = createLocalAppClient({ standardShell: standardShell() });
  await assert.rejects(
    () => client.permissions.request({
      permissionId: 'agents.interact',
      reason: 'Continue',
      operationId: 'runtime_agent.conversation.open',
    } as never),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_LOCAL_APP_INPUT_INVALID',
  );
});

test('auth projection rejects host pseudo-success flags', async () => {
  const client = createLocalAppClient({
    standardShell: standardShell({
      session: {
        status: async () => ({
          state: 'ready', reasonCode: 'action-executed', retryable: false, operationAllowed: true,
        }),
      },
    }),
  });
  await assert.rejects(
    () => client.auth.status(),
    (error: unknown) => (error as { reasonCode?: string }).reasonCode === 'SDK_LOCAL_APP_PROJECTION_INVALID',
  );
});
