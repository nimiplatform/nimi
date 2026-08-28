import assert from 'node:assert/strict';
import test from 'node:test';

import type { AgentLocalThreadRecord } from '../src/shell/renderer/bridge/runtime-bridge/types.js';
import { createEmptyAgentThreadBundle } from '../src/shell/renderer/features/chat/chat-agent-shell-bundle.js';

// T9.W3 Part A — first-message floor projection.
//
// The first-message floor remains SourceMaterializationPacket data carried on
// `AgentLocalTargetSnapshot.greeting`. Desktop must not author that greeting as
// a persisted assistant transcript row; Runtime owns assistant transcript replay
// and session initialization.

// Product first-message floor for the source-core `greeting`; W3 must render it
// byte-identical without turning it into a persisted assistant transcript row.
const MANUAL_ARCHIVIST_FLOOR =
  'Welcome to Nimi. I am Archivist, your guide to this world. I can help you set up Runtime, understand profiles, find Worlds and PersonaCharacters, and bring a persona into a Runtime-backed partner conversation. What would you like to do first?';

function sampleThread(id: string): AgentLocalThreadRecord {
  return {
    id,
    title: 'Agent',
    createdAtMs: 100,
    updatedAtMs: 100,
    lastMessageAtMs: null,
    targetSnapshot: {
      displayName: 'Agent',
      handle: '~agent',
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

test('empty LocalAgent thread keeps the runtime source greeting as target snapshot only', () => {
  const thread = sampleThread('thread-archivist');
  thread.targetSnapshot = {
    ...thread.targetSnapshot,
    greeting: MANUAL_ARCHIVIST_FLOOR,
  };
  const bundle = createEmptyAgentThreadBundle(thread);
  assert.equal(bundle.messages.length, 0);
  assert.equal(bundle.thread.targetSnapshot.greeting, MANUAL_ARCHIVIST_FLOOR);
});
