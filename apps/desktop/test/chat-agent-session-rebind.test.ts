import assert from 'node:assert/strict';
import test from 'node:test';

import type { NimiLocalAppAgentHandle } from '@nimiplatform/sdk/app';
import { createNimiError } from '@nimiplatform/sdk/types';
import type { AgentLocalTargetSnapshot } from '../src/shell/renderer/bridge/runtime-bridge/types.js';
import {
  isDesktopAgentSessionBindingError,
  resolveDesktopAgentSessionRebind,
  type DesktopAgentSessionRebindClients,
} from '../src/shell/renderer/features/chat/chat-agent-session-rebind.js';

const staleHandle = `agent_ref_${'a'.repeat(43)}` as NimiLocalAppAgentHandle;
const firstCurrentHandle = `agent_ref_${'b'.repeat(43)}` as NimiLocalAppAgentHandle;
const matchingCurrentHandle = `agent_ref_${'c'.repeat(43)}` as NimiLocalAppAgentHandle;

function accessDenied(): Error {
  return createNimiError({
    message: 'agent handle does not belong to the current App session',
    reasonCode: 'LOCAL_APP_ACCESS_DENIED',
    actionHint: 'refresh_local_app_agent_references',
    source: 'runtime',
  });
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

function target(): AgentLocalTargetSnapshot {
  return {
    agentHandle: staleHandle,
    conversationAnchorId: 'agent_anchor_current',
    displayName: 'Old display name',
    handle: '',
    avatarUrl: null,
    worldId: null,
    worldName: null,
    bio: 'preserved profile data',
    ownershipType: null,
    greeting: null,
    builtinDocsContext: null,
  };
}

test('Desktop remints an active Agent target only through its durable Conversation anchor', async () => {
  const probed: string[] = [];
  const clients: DesktopAgentSessionRebindClients = {
    agents: {
      async listReferences() {
        return [
          { agentHandle: firstCurrentHandle, displayName: 'Other Agent', avatarUrl: null },
          {
            agentHandle: matchingCurrentHandle,
            displayName: 'Current Agent',
            avatarUrl: 'https://cdn.nimi.example/current.webp',
          },
        ];
      },
    },
    conversation: {
      async snapshot(input) {
        probed.push(input.agentHandle);
        if (input.agentHandle === firstCurrentHandle) throw conversationResourceNotFound();
        return {
          conversationAnchorId: input.conversationAnchorId,
          throughSequence: '4',
          truncatedBefore: false,
          turns: [],
          messages: [],
          actions: [],
          voices: [],
          liveActions: [],
          liveTools: [],
        };
      },
    },
  };

  const rebound = await resolveDesktopAgentSessionRebind(target(), clients);

  assert.deepEqual(probed, [firstCurrentHandle, matchingCurrentHandle]);
  assert.equal(rebound?.agentHandle, matchingCurrentHandle);
  assert.equal(rebound?.conversationAnchorId, 'agent_anchor_current');
  assert.equal(rebound?.displayName, 'Current Agent');
  assert.equal(rebound?.avatarUrl, 'https://cdn.nimi.example/current.webp');
  assert.equal(rebound?.bio, 'preserved profile data');
});

test('Desktop does not reinterpret an ordinary access denial as a rotated handle', async () => {
  let snapshotCalls = 0;
  const clients: DesktopAgentSessionRebindClients = {
    agents: {
      async listReferences() {
        return [{ agentHandle: staleHandle, displayName: 'Current Agent', avatarUrl: null }];
      },
    },
    conversation: {
      async snapshot() {
        snapshotCalls += 1;
        throw new Error('must not probe while the handle is current');
      },
    },
  };

  assert.equal(await resolveDesktopAgentSessionRebind(target(), clients), null);
  assert.equal(snapshotCalls, 0);
});

test('Desktop makes no rebind decision when a candidate probe has a non-identity failure', async () => {
  for (const failure of [
    createNimiError({
      message: 'Runtime unavailable',
      reasonCode: 'RUNTIME_UNAVAILABLE',
      actionHint: 'retry_when_runtime_is_ready',
      source: 'runtime',
    }),
    Object.assign(
      new Error('5 NOT_FOUND: local-app conversation owner not found'),
      { code: 5 },
    ),
  ]) {
    const clients: DesktopAgentSessionRebindClients = {
      agents: {
        async listReferences() {
          return [{ agentHandle: matchingCurrentHandle, displayName: 'Current Agent', avatarUrl: null }];
        },
      },
      conversation: {
        async snapshot() {
          throw failure;
        },
      },
    };

    await assert.rejects(
      () => resolveDesktopAgentSessionRebind(target(), clients),
      (error: unknown) => error === failure,
    );
  }
});

test('Desktop recognizes only current-session binding failures as rebootstrap signals', () => {
  assert.equal(isDesktopAgentSessionBindingError(accessDenied()), true);
  assert.equal(isDesktopAgentSessionBindingError(conversationResourceNotFound()), true);
  assert.equal(isDesktopAgentSessionBindingError(createNimiError({
    message: 'session expired',
    reasonCode: 'LOCAL_APP_SESSION_REVOKED',
    actionHint: 'open_current_local_app_session',
    source: 'runtime',
  })), true);
  assert.equal(isDesktopAgentSessionBindingError(createNimiError({
    message: 'account changed',
    reasonCode: 'LOCAL_APP_ACCOUNT_CHANGED',
    actionHint: 'restart_with_current_account',
    source: 'runtime',
  })), false);
  assert.equal(isDesktopAgentSessionBindingError(Object.assign(
    new Error('5 NOT_FOUND: local-app conversation owner not found'),
    { code: 5 },
  )), false);
});
