import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { ReasonCode } from '@nimiplatform/sdk/types';
import { resolveUncertainIdempotencyFailure } from '../src/runtime/hook/services/action-service-ledger.js';

type TauriRuntime = {
  core: {
    invoke: (command: string, payload?: unknown) => Promise<unknown>;
  };
  event: {
    listen: () => () => void;
  };
};

type MutableGlobalTauri = Record<string, unknown> & {
  __NIMI_TAURI_TEST__?: {
    invoke?: TauriRuntime['core']['invoke'];
    listen?: TauriRuntime['event']['listen'];
  };
  window?: Record<string, unknown> & {
    __NIMI_TAURI_TEST__?: {
      invoke?: TauriRuntime['core']['invoke'];
      listen?: TauriRuntime['event']['listen'];
    };
  };
};

const actionServiceLedgerSource = fs.readFileSync(
  path.join(import.meta.dirname, '../src/runtime/hook/services/action-service-ledger.ts'),
  'utf8',
);

function installTauriRuntime(
  invoke: (command: string, payload?: unknown) => Promise<unknown>,
): () => void {
  const target = globalThis as unknown as MutableGlobalTauri;
  const previousRoot = target.__NIMI_TAURI_TEST__;
  const previousWindow = target.window;
  const runtime: TauriRuntime = {
    core: { invoke },
    event: { listen: () => () => {} },
  };
  const windowObject = previousWindow || {};
  const hook = {
    invoke: runtime.core.invoke,
    listen: runtime.event.listen,
  };

  windowObject.__NIMI_TAURI_TEST__ = hook;
  target.__NIMI_TAURI_TEST__ = hook;
  target.window = windowObject;

  return () => {
    if (typeof previousRoot === 'undefined') {
      delete target.__NIMI_TAURI_TEST__;
    } else {
      target.__NIMI_TAURI_TEST__ = previousRoot;
    }

    if (typeof previousWindow === 'undefined') {
      target.window = undefined;
    } else {
      target.window = previousWindow;
    }
  };
}

test('action-service-ledger surfaces ledger query failures as structured retry-later results', async () => {
  const restoreTauri = installTauriRuntime(async (command) => {
    if (command === 'runtime_mod_query_action_execution_ledger') {
      throw new Error('ledger unavailable');
    }
    throw new Error(`unexpected command: ${command}`);
  });

  try {
    const result = await resolveUncertainIdempotencyFailure({
      entries: new Map(),
      registryListeners: new Set(),
      ajv: {} as never,
      idempotencyMemory: new Map(),
      verifyTicketMemory: new Map(),
      now: () => Date.now(),
      idempotencyWindowMs: 60_000,
      verifyTicketWindowMs: 60_000,
      lastPurgeAtMs: 0,
      lastLedgerPurgeAtMs: 0,
      serviceInput: {
        evaluatePermission: () => ({
          sourceType: 'sideload',
          reasonCodes: [],
        }),
        auditSink: { append: async () => ({ auditId: 'audit-1' }) } as never,
        socialPreconditionService: {} as never,
      },
    }, {
      principalId: 'principal-1',
      actionId: 'action-1',
      idempotencyKey: 'idempotency-1',
      inputDigest: 'digest-1',
      executionId: 'execution-1',
      traceId: 'trace-1',
      executionMode: 'guarded',
    });

    assert.equal(result?.ok, false);
    assert.equal(result?.reasonCode, ReasonCode.ACTION_RUNTIME_STORE_UNAVAILABLE);
    assert.equal(result?.actionHint, 'retry-later');
    assert.deepEqual(result?.warnings, ['ledger-query-failed']);
  } finally {
    restoreTauri();
  }
});

test('action-service-ledger no longer swallows ledger query failures with catch-null', () => {
  assert.doesNotMatch(actionServiceLedgerSource, /\.catch\(\(\) => null\)/);
  assert.match(actionServiceLedgerSource, /warnings: \['ledger-query-failed'\]/);
});
