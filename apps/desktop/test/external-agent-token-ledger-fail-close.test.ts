import assert from 'node:assert/strict';
import test from 'node:test';

import { listExternalAgentTokens } from '../src/runtime/external-agent';

type TauriTestHook = {
  invoke?: (command: string, payload?: unknown) => Promise<unknown>;
};

type TauriTestGlobal = typeof globalThis & {
  __NIMI_TAURI_TEST__?: TauriTestHook;
  window?: {
    __NIMI_TAURI_TEST__?: TauriTestHook;
  } & Window & typeof globalThis;
};

const target = globalThis as TauriTestGlobal;

async function withTauriInvoke<T>(invoke: TauriTestHook['invoke'], run: () => Promise<T>): Promise<T> {
  const previousRoot = target.__NIMI_TAURI_TEST__;
  const previousWindow = target.window?.__NIMI_TAURI_TEST__;
  target.__NIMI_TAURI_TEST__ = { invoke };
  if (target.window) {
    target.window.__NIMI_TAURI_TEST__ = { invoke };
  }
  try {
    return await run();
  } finally {
    if (previousRoot) {
      target.__NIMI_TAURI_TEST__ = previousRoot;
    } else {
      delete target.__NIMI_TAURI_TEST__;
    }
    if (target.window) {
      if (previousWindow) {
        target.window.__NIMI_TAURI_TEST__ = previousWindow;
      } else {
        delete target.window.__NIMI_TAURI_TEST__;
      }
    }
  }
}

const validToken = {
  tokenId: 'token-1',
  principalId: 'principal-1',
  mode: 'delegated',
  subjectAccountId: 'account-1',
  actions: ['action.message.send'],
  scopes: [{ actionId: 'action.message.send', ops: ['verify'] }],
  issuedAt: '2026-05-08T00:00:00Z',
  expiresAt: '2026-05-09T00:00:00Z',
  issuer: 'local',
};

test('external agent token ledger rejects non-array Tauri evidence', async () => {
  await withTauriInvoke(async () => ({ rows: [] }), async () => {
    await assert.rejects(
      () => listExternalAgentTokens(),
      /EXTERNAL_AGENT_TOKEN_LEDGER_INVALID_RESPONSE/,
    );
  });
});

test('external agent token ledger rejects partial records instead of filtering them out', async () => {
  await withTauriInvoke(async () => [
    validToken,
    {
      ...validToken,
      tokenId: '',
    },
  ], async () => {
    await assert.rejects(
      () => listExternalAgentTokens(),
      /EXTERNAL_AGENT_TOKEN_LEDGER_FIELD_INVALID:tokens\[1\]\.tokenId/,
    );
  });
});

test('external agent token ledger rejects malformed action and scope arrays', async () => {
  await withTauriInvoke(async () => [
    {
      ...validToken,
      actions: 'action.message.send',
    },
  ], async () => {
    await assert.rejects(
      () => listExternalAgentTokens(),
      /EXTERNAL_AGENT_TOKEN_LEDGER_FIELD_INVALID:tokens\[0\]\.actions/,
    );
  });

  await withTauriInvoke(async () => [
    {
      ...validToken,
      scopes: [{ actionId: 'action.message.send', ops: 'verify' }],
    },
  ], async () => {
    await assert.rejects(
      () => listExternalAgentTokens(),
      /EXTERNAL_AGENT_TOKEN_LEDGER_FIELD_INVALID:scopes\[0\]\.ops/,
    );
  });
});

test('external agent token ledger preserves valid token rows', async () => {
  await withTauriInvoke(async () => [validToken], async () => {
    const rows = await listExternalAgentTokens();
    assert.deepEqual(rows, [{ ...validToken, revokedAt: undefined }]);
  });
});
