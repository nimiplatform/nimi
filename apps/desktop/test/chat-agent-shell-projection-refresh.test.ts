import assert from 'node:assert/strict';
import test from 'node:test';

import type { AgentLocalThreadBundle, AgentLocalThreadRecord } from '../src/shell/renderer/bridge/runtime-bridge/types.js';
import { resolveAgentProjectionRefreshOutcome } from '../src/shell/renderer/features/chat/chat-agent-shell-projection-refresh.js';
import { createAgentTextMessage } from './helpers/agent-chat-record-fixtures.js';

function sampleThread(): AgentLocalThreadRecord {
  return {
    id: 'thread-1',
    ownerUserId: 'user-1',
    runtimeSourceRef: 'agent-1',
    localAgentRef: 'local-agent:user-1:agent-1',
    title: 'Companion',
    createdAtMs: 10,
    updatedAtMs: 20,
    lastMessageAtMs: 20,
    targetSnapshot: {
      ownerUserId: 'user-1',
      runtimeSourceRef: 'agent-1',
      localAgentRef: 'local-agent:user-1:agent-1',
      displayName: 'Companion',
      handle: '~companion',
      avatarUrl: null,
      worldId: null,
      worldName: null,
      bio: null,
      ownershipType: null,
      greeting: null,
      builtinDocsContext: null,
    },
  };
}

function sampleBundle(): AgentLocalThreadBundle {
  return {
    thread: sampleThread(),
    messages: [createAgentTextMessage({
      id: 'assistant-1',
      threadId: 'thread-1',
      role: 'assistant',
      status: 'complete',
      contentText: 'authoritative projection',
      traceId: 'trace-authoritative',
      parentMessageId: 'user-1',
      createdAtMs: 101,
      updatedAtMs: 999,
    })],
  };
}

function emptyBundle(): AgentLocalThreadBundle {
  return {
    thread: {
      ...sampleThread(),
      updatedAtMs: 1000,
      lastMessageAtMs: 1000,
    },
    messages: [],
  };
}

test('agent projection refresh applies authoritative bundle while the turn is still running', () => {
  const outcome = resolveAgentProjectionRefreshOutcome({
    terminal: 'running',
    refreshedBundle: sampleBundle(),
  });

  assert.ok(outcome);
  assert.equal(outcome?.bundle.messages.at(-1)?.contentText, 'authoritative projection');
  assert.deepEqual(outcome?.selection, {
    localAgentRef: 'local-agent:user-1:agent-1',
    targetId: 'local-agent:user-1:agent-1',
  });
});

test('agent projection refresh no longer gates authoritative bundles on local projection versions', () => {
  const outcome = resolveAgentProjectionRefreshOutcome({
    terminal: 'running',
    refreshedBundle: sampleBundle(),
  });

  assert.ok(outcome);
  assert.equal(outcome?.bundle.messages.at(-1)?.contentText, 'authoritative projection');
});

test('agent projection refresh still applies after completed terminal so follow-up commits can surface immediately', () => {
  const outcome = resolveAgentProjectionRefreshOutcome({
    terminal: 'completed',
    refreshedBundle: sampleBundle(),
  });

  assert.ok(outcome);
  assert.equal(outcome?.bundle.messages.at(-1)?.contentText, 'authoritative projection');
});

test('agent projection refresh ignores empty refreshed projection for the current non-empty thread', () => {
  const outcome = resolveAgentProjectionRefreshOutcome({
    terminal: 'running',
    currentBundle: sampleBundle(),
    refreshedBundle: emptyBundle(),
  });

  assert.equal(outcome, null);
});

test('agent projection refresh does not apply after terminal cancellation', () => {
  assert.equal(resolveAgentProjectionRefreshOutcome({
    terminal: 'canceled',
    refreshedBundle: sampleBundle(),
  }), null);
});
