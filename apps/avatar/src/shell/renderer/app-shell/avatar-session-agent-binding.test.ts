import { describe, expect, it, vi } from 'vitest';
import type {
  NimiLocalAppAgentHandle,
  NimiLocalAppAgentReferencesClient,
  NimiLocalAppConversationClient,
} from '@nimiplatform/sdk/app';
import {
  createAvatarSessionAgentBinding,
  resolveAvatarSessionAgentHandle,
} from './avatar-session-agent-binding.js';

const HANDLE_A = `agent_ref_${'a'.repeat(43)}` as NimiLocalAppAgentHandle;
const HANDLE_B = `agent_ref_${'b'.repeat(43)}` as NimiLocalAppAgentHandle;
const ANCHOR = 'agent_anchor_target';

function accessDenied(): Error {
  return Object.assign(new Error('selector mismatch'), { reasonCode: 'LOCAL_APP_ACCESS_DENIED' });
}

function conversationResourceNotFound(): Error {
  return Object.assign(
    new Error(
      'Electron Runtime endpoint is unavailable for nimi.shell.runtime.unary: '
      + '5 NOT_FOUND: local-app conversation resource not found',
    ),
    {
      code: 'external-daemon-required',
      reasonCode: 'electron-runtime-endpoint-unavailable',
      details: {
        cause: '5 NOT_FOUND: local-app conversation resource not found',
      },
    },
  );
}

function tauriConversationResourceNotFound(): Error {
  return Object.assign(new Error(JSON.stringify({
    reasonCode: 'RUNTIME_GRPC_NOT_FOUND',
    actionHint: 'check_request_and_app_auth',
    message: 'local-app conversation resource not found',
    retryable: false,
    traceId: '',
  })), {
    code: 'RUNTIME_GRPC_NOT_FOUND',
    reasonCode: 'RUNTIME_GRPC_NOT_FOUND',
  });
}

function references(current: () => readonly NimiLocalAppAgentHandle[]): NimiLocalAppAgentReferencesClient {
  return {
    async listReferences() {
      return current().map((agentHandle, index) => ({
        agentHandle,
        displayName: `Agent ${index + 1}`,
        avatarUrl: null,
      }));
    },
  };
}

function snapshotClient(
  snapshot: (agentHandle: NimiLocalAppAgentHandle) => Promise<unknown>,
): NimiLocalAppConversationClient {
  return {
    snapshot: (input: { readonly agentHandle: NimiLocalAppAgentHandle }) => (
      snapshot(input.agentHandle)
    ),
  } as unknown as NimiLocalAppConversationClient;
}

describe('Avatar current-session Agent binding', () => {
  it.each([
    ['Electron', conversationResourceNotFound],
    ['Tauri', tauriConversationResourceNotFound],
  ])('rebinds from the handed-off anchor across the %s transport error shape', async (_transport, mismatch) => {
    const snapshot = vi.fn(async (agentHandle: NimiLocalAppAgentHandle) => {
      if (agentHandle === HANDLE_A) throw mismatch();
      return { conversationAnchorId: ANCHOR };
    });

    await expect(resolveAvatarSessionAgentHandle({
      agents: references(() => [HANDLE_A, HANDLE_B]),
      conversation: snapshotClient(snapshot),
      conversationAnchorId: ANCHOR,
    })).resolves.toBe(HANDLE_B);
    expect(snapshot.mock.calls.map(([handle]) => handle)).toEqual([HANDLE_A, HANDLE_B]);
  });

  it('refreshes the handle once after technical-session rotation and retries the operation', async () => {
    let generation = 0;
    const agents = references(() => generation === 0 ? [HANDLE_A] : [HANDLE_B]);
    const conversation = snapshotClient(async () => ({ conversationAnchorId: ANCHOR }));
    const changed: NimiLocalAppAgentHandle[] = [];
    const binding = await createAvatarSessionAgentBinding({
      agents,
      conversation,
      conversationAnchorId: ANCHOR,
      onHandleChange: (handle) => changed.push(handle),
    });
    generation = 1;
    const operation = vi.fn(async (handle: NimiLocalAppAgentHandle) => {
      if (handle === HANDLE_A) throw accessDenied();
      return 'committed';
    });

    await expect(binding.run(operation)).resolves.toBe('committed');
    expect(operation.mock.calls.map(([handle]) => handle)).toEqual([HANDLE_A, HANDLE_B]);
    expect(binding.current()).toBe(HANDLE_B);
    expect(changed).toEqual([HANDLE_A, HANDLE_B]);
  });

  it('does not hide a Runtime read failure as an Agent mismatch', async () => {
    const unavailable = Object.assign(new Error('Runtime unavailable'), {
      reasonCode: 'RUNTIME_UNAVAILABLE',
    });
    await expect(resolveAvatarSessionAgentHandle({
      agents: references(() => [HANDLE_A]),
      conversation: snapshotClient(async () => { throw unavailable; }),
      conversationAnchorId: ANCHOR,
    })).rejects.toBe(unavailable);
  });

  it('does not enumerate past another NotFound or owner failure', async () => {
    for (const failure of [
      Object.assign(new Error('5 NOT_FOUND: local-app conversation owner not found'), { code: 5 }),
      Object.assign(new Error('owner unavailable'), { reasonCode: 'LOCAL_APP_OWNER_UNAVAILABLE' }),
    ]) {
      const snapshot = vi.fn(async () => { throw failure; });
      await expect(resolveAvatarSessionAgentHandle({
        agents: references(() => [HANDLE_A, HANDLE_B]),
        conversation: snapshotClient(snapshot),
        conversationAnchorId: ANCHOR,
      })).rejects.toBe(failure);
      expect(snapshot).toHaveBeenCalledTimes(1);
    }
  });
});
