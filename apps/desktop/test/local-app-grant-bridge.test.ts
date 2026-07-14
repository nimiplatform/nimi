import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';

import {
  decideLocalAppGrant,
  listLocalAppGrants,
  listPendingLocalAppGrants,
  localAppGrantBridgeAvailable,
  revokeLocalAppGrant,
  subscribePendingLocalAppGrants,
} from '../src/shell/renderer/features/local-app-grants/local-app-grant-bridge';

type TestGlobal = typeof globalThis & {
  __NIMI_TAURI_TEST__?: {
    invoke: (command: string, payload?: unknown) => Promise<unknown>;
    listen: () => () => void;
  };
  __NIMI_ELECTRON_TEST__?: {
    invoke: (command: string, payload?: unknown) => Promise<unknown>;
    listen: () => () => void;
  };
};

Object.defineProperty(globalThis, 'window', {
  configurable: true,
  value: globalThis,
});

afterEach(() => {
  delete (globalThis as TestGlobal).__NIMI_TAURI_TEST__;
  delete (globalThis as TestGlobal).__NIMI_ELECTRON_TEST__;
});

test('local app grant bridge carries only renderer-safe selectors and exact projections', async () => {
  const calls: Array<{ command: string; payload?: unknown }> = [];
  (globalThis as TestGlobal).__NIMI_TAURI_TEST__ = {
    listen: () => () => {},
    invoke: async (command, payload) => {
      calls.push({ command, payload });
      if (command === 'local_app_grant_pending_list') {
        return [{
          selector: 'grant-approval-safe_1',
          operationId: 'runtime_agent.conversation.turn_send',
          resourceRef: 'agent:agent-a/conversation:anchor-a',
          state: 'pending',
          reasonCode: 'local-app-presence-required',
          retryable: false,
          expiresAtUnixMs: Date.now() + 60_000,
        }];
      }
      if (command === 'local_app_grant_decide') {
        return {
          selector: 'grant-control-safe_1',
          operationId: 'runtime_agent.conversation.turn_send',
          resourceRef: 'agent:agent-a/conversation:anchor-a',
          state: 'granted',
          reasonCode: 'action-executed',
          retryable: false,
        };
      }
      if (command === 'local_app_grant_list') return [];
      if (command === 'local_app_grant_revoke') {
        return {
          selector: 'grant-control-safe_1',
          operationId: 'runtime_agent.conversation.turn_send',
          resourceRef: 'agent:agent-a/conversation:anchor-a',
          state: 'revoked',
          reasonCode: 'local-app-grant-revoked',
          retryable: false,
        };
      }
      throw new Error(`unexpected ${command}`);
    },
  };

  assert.equal((await listPendingLocalAppGrants())[0]?.state, 'pending');
  assert.equal((await decideLocalAppGrant('grant-approval-safe_1', true)).state, 'granted');
  assert.deepEqual(await listLocalAppGrants(), []);
  assert.equal((await revokeLocalAppGrant('grant-control-safe_1')).state, 'revoked');
  assert.deepEqual(calls.map((call) => call.command), [
    'local_app_grant_pending_list',
    'local_app_grant_decide',
    'local_app_grant_list',
    'local_app_grant_revoke',
  ]);
  assert.deepEqual(calls[1]?.payload, { payload: { selector: 'grant-approval-safe_1', approved: true } });
});

test('local app grant bridge rejects raw Runtime authority identifiers', async () => {
  (globalThis as TestGlobal).__NIMI_TAURI_TEST__ = {
    listen: () => () => {},
    invoke: async () => [{
      selector: 'grant-approval-safe_1',
      operationId: 'runtime_agent.conversation.open',
      resourceRef: 'agent:agent-a',
      state: 'pending',
      reasonCode: 'local-app-presence-required',
      retryable: false,
      expiresAtUnixMs: Date.now() + 60_000,
      requestId: 'forbidden',
    }],
  };
  await assert.rejects(() => listPendingLocalAppGrants(), /local-app-grant-projection-invalid/u);
});

test('local app grant bridge uses the Electron shell invoke and polls renderer-safe approvals', async () => {
  let calls = 0;
  (globalThis as TestGlobal).__NIMI_ELECTRON_TEST__ = {
    listen: () => () => {},
    invoke: async (command) => {
      assert.equal(command, 'local_app_grant_pending_list');
      calls += 1;
      return [{
        selector: 'grant-approval-electron_1',
        operationId: 'runtime_agent.conversation.open',
        resourceRef: 'agent:agent-a',
        state: 'pending',
        reasonCode: 'local-app-presence-required',
        retryable: false,
        expiresAtUnixMs: Date.now() + 60_000,
      }];
    },
  };
  assert.equal(localAppGrantBridgeAvailable(), true);
  const observed: string[] = [];
  const unsubscribe = await subscribePendingLocalAppGrants((approval) => observed.push(approval.selector));
  await new Promise((resolve) => setTimeout(resolve, 30));
  unsubscribe();
  assert.equal(calls, 1);
  assert.deepEqual(observed, ['grant-approval-electron_1']);
});
