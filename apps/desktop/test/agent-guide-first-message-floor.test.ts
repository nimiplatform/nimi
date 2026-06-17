import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import type {
  AgentLocalTargetSnapshot,
  AgentLocalThreadRecord,
} from '../src/shell/renderer/bridge/runtime-bridge/types.js';
import { createEmptyAgentThreadBundle } from '../src/shell/renderer/features/chat/chat-agent-shell-bundle.js';

// T9.W3 Part A — first-message floor projection.
//
// The first-message floor remains runtime source snapshot data carried on
// `AgentLocalTargetSnapshot.greeting`. Desktop must not author that greeting as
// a persisted assistant transcript row; Runtime owns assistant transcript replay
// and session initialization.

// Verbatim manual floor (`product-manual-full-authority.md` "Default Nimi
// Guide Agent" → First message floor). The Archivist greeting is the W1
// `AgentProfile.greeting`; W3 must render it byte-identical.
const MANUAL_ARCHIVIST_FLOOR =
  'Welcome to Nimi. I am Archivist, your guide to this world. I can help you set up Runtime, understand profiles, find Worlds and RealmPersonas, and materialize a LocalAgent companion. What would you like to do first?';

function sampleThread(id: string): AgentLocalThreadRecord {
  return {
    id,
    ownerUserId: 'user-1',
    runtimeSourceRef: 'agent-1',
    localAgentRef: 'local-agent:user-1:agent-1',
    title: 'Agent',
    createdAtMs: 100,
    updatedAtMs: 100,
    lastMessageAtMs: null,
    targetSnapshot: {
      ownerUserId: 'user-1',
      runtimeSourceRef: 'agent-1',
      localAgentRef: 'local-agent:user-1:agent-1',
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

test('Desktop launcher does not persist greeting as assistant transcript truth', () => {
  const launcherSource = readFileSync(
    new URL('../src/shell/renderer/features/chat/agent-conversation-launcher.ts', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(launcherSource, /buildAgentGreetingSeedMessage/);
  assert.doesNotMatch(launcherSource, /createMessage\(/);
  assert.doesNotMatch(launcherSource, /message:greeting/);
});

test('Desktop no longer exposes a legacy Realm source profile projection helper', () => {
  assert.throws(
    () => readFileSync(
      new URL('../src/shell/renderer/features/chat/agent-profile-projection.ts', import.meta.url),
      'utf8',
    ),
    /ENOENT/,
  );
});

test('a target snapshot carries greeting but not Desktop-authored prompt docs', () => {
  const target: AgentLocalTargetSnapshot = {
    ownerUserId: 'user-1',
    runtimeSourceRef: 'agent-1',
    localAgentRef: 'local-agent:user-1:agent-1',
    displayName: 'Agent',
    handle: '~agent',
    avatarUrl: null,
    worldId: null,
    worldName: null,
    bio: null,
    ownershipType: null,
    greeting: MANUAL_ARCHIVIST_FLOOR,
    builtinDocsContext: null,
  };
  assert.equal(target.greeting, MANUAL_ARCHIVIST_FLOOR);
  assert.equal(target.builtinDocsContext, null);
});
