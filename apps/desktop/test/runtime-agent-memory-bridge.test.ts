import assert from 'node:assert/strict';
import test from 'node:test';

import { getAgentMemoryStandardFixtureStatus } from '../src/shell/renderer/bridge/runtime-bridge/agent-memory';

type TauriInvoke = (command: string, payload?: unknown) => Promise<unknown>;

type MutableRuntimeGlobal = typeof globalThis & {
  __NIMI_TAURI_TEST__?: {
    invoke?: TauriInvoke;
  };
  __TAURI__?: unknown;
  __TAURI_INTERNALS__?: unknown;
  __TAURI_IPC__?: unknown;
  window?: {
    __NIMI_TAURI_TEST__?: {
      invoke?: TauriInvoke;
    };
    __TAURI__?: unknown;
    __TAURI_INTERNALS__?: unknown;
    __TAURI_IPC__?: unknown;
  };
};

function clearTauriGlobals(): void {
  const target = globalThis as MutableRuntimeGlobal;
  delete target.__NIMI_TAURI_TEST__;
  delete target.__TAURI__;
  delete target.__TAURI_INTERNALS__;
  delete target.__TAURI_IPC__;
  Reflect.deleteProperty(target, 'window');
}

test('agent memory fixture status invokes the desktop fixture command directly', async () => {
  clearTauriGlobals();
  const target = globalThis as MutableRuntimeGlobal;
  const calls: Array<{ command: string; payload: unknown }> = [];
  target.__NIMI_TAURI_TEST__ = {
    invoke: async (command, payload) => {
      calls.push({ command, payload });
      return {
        available: true,
        alreadyBound: false,
        bank: {
          bankId: 'bank-agent-1',
          embeddingProfile: {
            modelId: 'local/embed-alpha',
          },
        },
      };
    },
  };

  try {
    const result = await getAgentMemoryStandardFixtureStatus({ agentId: 'agent-1' });

    assert.deepEqual(calls, [{
      command: 'agent_memory_standard_fixture_status_get',
      payload: { payload: { agentId: 'agent-1' } },
    }]);
    assert.deepEqual(result, {
      available: true,
      alreadyBound: false,
      bank: {
        bankId: 'bank-agent-1',
        embeddingProfile: {
          modelId: 'local/embed-alpha',
        },
      },
    });
  } finally {
    clearTauriGlobals();
  }
});

test('agent memory fixture status is unavailable outside Tauri without masking command errors', async () => {
  clearTauriGlobals();

  const result = await getAgentMemoryStandardFixtureStatus({ agentId: 'agent-1' });

  assert.deepEqual(result, {
    available: false,
    alreadyBound: false,
    bank: {},
  });
  clearTauriGlobals();
});

test('agent memory fixture status preserves desktop fixture command failures', async () => {
  clearTauriGlobals();
  const target = globalThis as MutableRuntimeGlobal;
  target.__NIMI_TAURI_TEST__ = {
    invoke: async () => {
      throw new Error('fixture status command failed');
    },
  };

  try {
    await assert.rejects(
      () => getAgentMemoryStandardFixtureStatus({ agentId: 'agent-1' }),
      /fixture status command failed/,
    );
  } finally {
    clearTauriGlobals();
  }
});
