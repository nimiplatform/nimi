import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import type {
  AgentLocalTargetSnapshot,
  AgentLocalThreadRecord,
} from '../src/shell/renderer/bridge/runtime-bridge/types.js';
import { createEmptyAgentThreadBundle } from '../src/shell/renderer/features/chat/chat-agent-shell-bundle.js';
import {
  projectRealmAgentBuiltinDocsContext,
  projectRealmAgentGreeting,
} from '../src/shell/renderer/features/chat/agent-profile-projection.js';

// T9.W3 Part A — first-message floor projection.
//
// The first-message floor remains ordinary RealmAgent profile data projected
// on `AgentLocalTargetSnapshot.greeting`. Desktop must not author that greeting
// as a persisted assistant transcript row; Runtime owns assistant transcript
// replay and session initialization.

// Verbatim manual floor (`product-manual-full-authority.md` "Default Nimi
// Guide Agent" → First message floor). The Archivist greeting is the W1
// `AgentProfile.greeting`; W3 must render it byte-identical.
const MANUAL_ARCHIVIST_FLOOR =
  'Welcome to Nimi. I am Archivist, your guide to this world. I can help you set up Runtime, understand profiles, find Worlds and Agents, and turn a RealmAgent into your LocalAgent companion. What would you like to do first?';

function sampleThread(id: string): AgentLocalThreadRecord {
  return {
    id,
    ownerUserId: 'user-1',
    realmAgentId: 'agent-1',
    localAgentRef: 'local-agent:user-1:agent-1',
    title: 'Agent',
    createdAtMs: 100,
    updatedAtMs: 100,
    lastMessageAtMs: null,
    archivedAtMs: null,
    targetSnapshot: {
      ownerUserId: 'user-1',
      realmAgentId: 'agent-1',
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

test('empty AgentFriend thread keeps the profile greeting as target projection only', () => {
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

test('greeting projects out of the ordinary Realm agentProfile projection', () => {
  // `agentProfile.greeting` is the ordinary RealmAgent profile field for any
  // RealmAgent — the projection takes no guide-special branch.
  assert.equal(
    projectRealmAgentGreeting({ greeting: MANUAL_ARCHIVIST_FLOOR }),
    MANUAL_ARCHIVIST_FLOOR,
  );
  assert.equal(projectRealmAgentGreeting({}), null);
  assert.equal(projectRealmAgentGreeting(null), null);
});

test('built-in docs corpus projects from the ordinary dna knowledge slot as context', () => {
  // The corpus is carried on the ordinary AgentProfile.dna knowledge payload
  // (K-AGCORE-142) and projected as a single static context block.
  const agentProfile = {
    dna: {
      knowledge: {
        format: 'nimi-guide-docs-v1',
        kind: 'builtin-usage-documentation',
        documentation: {
          title: 'Nimi usage documentation',
          sections: [
            { id: 'first-run', title: 'First-run setup', body: 'Sign in and choose a data folder.' },
            { id: 'runtime', title: 'Runtime', body: 'Runtime manages the local AI environment.' },
          ],
        },
      },
    },
  };
  const docs = projectRealmAgentBuiltinDocsContext(agentProfile);
  assert.ok(docs);
  assert.match(docs as string, /## First-run setup/);
  assert.match(docs as string, /## Runtime/);

  // A RealmAgent with no docs knowledge payload projects null.
  assert.equal(projectRealmAgentBuiltinDocsContext({ dna: { identity: {} } }), null);
  assert.equal(projectRealmAgentBuiltinDocsContext({}), null);

  // A non-docs knowledge format is not mistaken for the corpus.
  assert.equal(
    projectRealmAgentBuiltinDocsContext({ dna: { knowledge: { format: 'other' } } }),
    null,
  );
});

test('a target snapshot carries greeting and docs as ordinary projection fields', () => {
  // Type-level + value-level proof the snapshot carries the ordinary fields.
  const target: AgentLocalTargetSnapshot = {
    ownerUserId: 'user-1',
    realmAgentId: 'agent-1',
    localAgentRef: 'local-agent:user-1:agent-1',
    displayName: 'Agent',
    handle: '~agent',
    avatarUrl: null,
    worldId: null,
    worldName: null,
    bio: null,
    ownershipType: null,
    greeting: MANUAL_ARCHIVIST_FLOOR,
    builtinDocsContext: '## First-run setup\nSign in.',
  };
  assert.equal(target.greeting, MANUAL_ARCHIVIST_FLOOR);
  assert.ok(target.builtinDocsContext);
});
