import assert from 'node:assert/strict';
import test from 'node:test';

import type { AgentLocalThreadBundle, AgentLocalThreadRecord } from '../src/shell/renderer/bridge/runtime-bridge/types.js';
import { resolveAgentProjectionRefreshOutcome } from '../src/shell/renderer/features/chat/chat-agent-shell-projection-refresh.js';
import { createAgentTextMessage } from './helpers/agent-chat-record-fixtures.js';

function sampleThread(): AgentLocalThreadRecord {
  return {
    id: 'thread-1',
    agentId: 'agent-1',
    title: 'Companion',
    createdAtMs: 10,
    updatedAtMs: 20,
    lastMessageAtMs: 20,
    archivedAtMs: null,
    targetSnapshot: {
      agentId: 'agent-1',
      displayName: 'Companion',
      handle: '~companion',
      avatarUrl: null,
      worldId: null,
      worldName: null,
      bio: null,
      ownershipType: null,
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
    draft: null,
  };
}

test('agent projection refresh applies authoritative bundle while the turn is still running', () => {
  const outcome = resolveAgentProjectionRefreshOutcome({
    requestedProjectionVersion: 'truth:10:t1',
    latestProjectionVersion: 'truth:10:t1',
    terminal: 'running',
    refreshedBundle: sampleBundle(),
  });

  assert.ok(outcome);
  assert.equal(outcome?.bundle.messages.at(-1)?.contentText, 'authoritative projection');
  assert.deepEqual(outcome?.selection, {
    threadId: 'thread-1',
    agentId: 'agent-1',
    targetId: 'agent-1',
  });
});

test('agent projection refresh ignores stale versions so older rebuilds cannot overwrite newer cache', () => {
  const outcome = resolveAgentProjectionRefreshOutcome({
    requestedProjectionVersion: 'truth:10:t1',
    latestProjectionVersion: 'truth:11:t1',
    terminal: 'running',
    refreshedBundle: sampleBundle(),
  });

  assert.equal(outcome, null);
});

test('agent projection refresh still applies after completed terminal so follow-up commits can surface immediately', () => {
  const outcome = resolveAgentProjectionRefreshOutcome({
    requestedProjectionVersion: 'truth:11:t2',
    latestProjectionVersion: 'truth:11:t2',
    terminal: 'completed',
    refreshedBundle: sampleBundle(),
  });

  assert.ok(outcome);
  assert.equal(outcome?.bundle.messages.at(-1)?.contentText, 'authoritative projection');
});

test('agent projection refresh does not apply after terminal cancellation', () => {
  assert.equal(resolveAgentProjectionRefreshOutcome({
    requestedProjectionVersion: 'truth:10:t1',
    latestProjectionVersion: 'truth:10:t1',
    terminal: 'canceled',
    refreshedBundle: sampleBundle(),
  }), null);
});
