import assert from 'node:assert/strict';
import test from 'node:test';

import { createNimiError } from '@nimiplatform/sdk/types';
import type { NimiLocalAppConversationClient } from '@nimiplatform/sdk/app';
import { openAgentTargetSnapshotFromSummary } from '../src/shell/renderer/features/chat/chat-sidebar-targets.js';

const STALE_HANDLE = `agent_ref_${'s'.repeat(43)}`;

test('stale canonical Agent handle preserves typed failure and performs no mutation', async () => {
  const failure = createNimiError({
    message: 'The Agent handle is stale.',
    reasonCode: 'LOCAL_APP_ACCESS_DENIED',
    actionHint: 'refresh_agent_references',
    source: 'runtime',
  });
  let openCalls = 0;
  const conversation = new Proxy({
    async open() {
      openCalls += 1;
      throw failure;
    },
  }, {
    get(target, property, receiver) {
      if (property !== 'open') throw new Error(`unexpected Conversation mutation: ${String(property)}`);
      return Reflect.get(target, property, receiver);
    },
  }) as unknown as Pick<NimiLocalAppConversationClient, 'open'>;

  await assert.rejects(
    () => openAgentTargetSnapshotFromSummary({
      id: STALE_HANDLE,
      source: 'agent',
      canonicalSessionId: STALE_HANDLE,
      title: 'Stale Agent',
      handle: '',
      avatarUrl: null,
      bio: null,
      metadata: { agentHandle: STALE_HANDLE },
    }, conversation),
    (error: unknown) => error === failure
      && (error as { reasonCode?: unknown }).reasonCode === 'LOCAL_APP_ACCESS_DENIED',
  );
  assert.equal(openCalls, 1);
});
