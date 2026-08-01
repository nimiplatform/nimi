import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  AgentLocalThreadRecord,
} from '../src/shell/renderer/bridge/runtime-bridge/types.js';
import {
  hydrateAgentThreadBundleFromRuntimeSessionSnapshot,
} from '../src/shell/renderer/features/chat/chat-agent-session-hydration.js';
import {
  createAgentImageMessage,
  createAgentTextMessage,
} from './helpers/agent-chat-record-fixtures.js';

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

function transcriptText(id: string, role: 'user' | 'assistant', content: string, createdAt: string) {
  return {
    id,
    role,
    content,
    status: 'complete' as const,
    kind: 'text' as const,
    createdAt,
    updatedAt: createdAt,
  };
}

function transcriptImage(id: string, input: { artifactId: string; mediaUrl?: string; createdAt: string }) {
  return {
    id,
    role: 'user' as const,
    content: '',
    status: 'complete' as const,
    kind: 'image' as const,
    artifactId: input.artifactId,
    mediaMimeType: 'image/png',
    ...(input.mediaUrl ? { mediaUrl: input.mediaUrl } : {}),
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
  };
}

test('agent session hydration admits transcript image messages with artifact refs', () => {
  const hydrated = hydrateAgentThreadBundleFromRuntimeSessionSnapshot({
    thread: sampleThread(),
    bundle: null,
    conversationAnchorId: 'anchor-1',
    snapshot: {
      transcript: [
        transcriptText('rt-1', 'user', 'look at this', '2026-07-31T00:00:00.000Z'),
        transcriptImage('rt-2', {
          artifactId: 'artifact-1',
          mediaUrl: 'data:image/png;base64,aW1hZ2UtMQ==',
          createdAt: '2026-07-31T00:00:01.000Z',
        }),
        transcriptText('rt-3', 'assistant', 'nice photo', '2026-07-31T00:00:02.000Z'),
      ],
    },
    nowMs: 500,
  });

  assert.ok(hydrated);
  assert.deepEqual(hydrated.messages.map((message) => message.id), ['rt-1', 'rt-2', 'rt-3']);
  const image = hydrated.messages[1];
  assert.equal(image?.kind, 'image');
  assert.equal(image?.role, 'user');
  assert.equal(image?.contentText, '');
  assert.equal(image?.artifactId, 'artifact-1');
  assert.equal(image?.mediaMimeType, 'image/png');
  assert.equal(image?.mediaUrl, 'data:image/png;base64,aW1hZ2UtMQ==');
});

test('agent session hydration replaces local image projection carrying the same artifactId', () => {
  const bundle = {
    thread: sampleThread(),
    messages: [createAgentTextMessage({
      id: 'turn-user-1:message:0',
      threadId: 'thread-1',
      role: 'user',
      status: 'complete',
      contentText: 'hello',
      createdAtMs: 100,
      updatedAtMs: 100,
    }), createAgentImageMessage({
      id: 'turn-user-1:message:1',
      threadId: 'thread-1',
      role: 'user',
      status: 'complete',
      contentText: '',
      mediaUrl: 'blob:local-preview',
      mediaMimeType: 'image/png',
      artifactId: 'artifact-1',
      createdAtMs: 101,
      updatedAtMs: 101,
    })],
  };
  const hydrated = hydrateAgentThreadBundleFromRuntimeSessionSnapshot({
    thread: sampleThread(),
    bundle,
    conversationAnchorId: 'anchor-1',
    snapshot: {
      transcript: [
        transcriptText('rt-1', 'user', 'hello', '2026-07-31T00:00:00.000Z'),
        transcriptImage('rt-2', {
          artifactId: 'artifact-1',
          mediaUrl: 'data:image/png;base64,aW1hZ2UtMQ==',
          createdAt: '2026-07-31T00:00:01.000Z',
        }),
        transcriptText('rt-3', 'assistant', 'reply', '2026-07-31T00:00:02.000Z'),
      ],
    },
    nowMs: 500,
  });

  assert.ok(hydrated);
  assert.deepEqual(hydrated.messages.map((message) => message.id), ['rt-1', 'rt-2', 'rt-3']);
  assert.equal(hydrated.messages.filter((message) => message.artifactId === 'artifact-1').length, 1);
  assert.equal(hydrated.messages[1]?.mediaUrl, 'data:image/png;base64,aW1hZ2UtMQ==');
});

test('agent session hydration is a no-op when bundle already matches transcript text and images', () => {
  const bundle = {
    thread: sampleThread(),
    messages: [createAgentTextMessage({
      id: 'rt-1',
      threadId: 'thread-1',
      role: 'user',
      status: 'complete',
      contentText: 'hello',
      createdAtMs: 100,
      updatedAtMs: 100,
    }), createAgentImageMessage({
      id: 'rt-2',
      threadId: 'thread-1',
      role: 'user',
      status: 'complete',
      contentText: '',
      mediaUrl: 'data:image/png;base64,aW1hZ2UtMQ==',
      mediaMimeType: 'image/png',
      artifactId: 'artifact-1',
      createdAtMs: 101,
      updatedAtMs: 101,
    })],
  };
  const hydrated = hydrateAgentThreadBundleFromRuntimeSessionSnapshot({
    thread: sampleThread(),
    bundle,
    conversationAnchorId: 'anchor-1',
    snapshot: {
      transcript: [
        transcriptText('rt-1', 'user', 'hello', '2026-07-31T00:00:00.000Z'),
        transcriptImage('rt-2', {
          artifactId: 'artifact-1',
          mediaUrl: 'data:image/png;base64,aW1hZ2UtMQ==',
          createdAt: '2026-07-31T00:00:01.000Z',
        }),
      ],
    },
    nowMs: 500,
  });

  assert.equal(hydrated, null);
});
