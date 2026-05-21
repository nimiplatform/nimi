import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  AgentLocalTargetSnapshot,
  AgentLocalThreadRecord,
} from '../src/shell/renderer/bridge/runtime-bridge/types.js';
import {
  buildAgentGreetingSeedMessage,
  createEmptyAgentThreadBundle,
} from '../src/shell/renderer/features/chat/chat-agent-shell-bundle.js';
import {
  projectRealmAgentBuiltinDocsContext,
  projectRealmAgentGreeting,
} from '../src/shell/renderer/features/chat/agent-profile-projection.js';

// T9.W3 Part A — first-message floor delivery.
//
// The first-message floor is delivered as an ordinary thread-open mechanic
// keyed on the ordinary `AgentLocalTargetSnapshot.greeting` field, applied
// uniformly to ANY RealmAgent. These tests prove the seed is generic (no guide
// id branch) and renders the stored greeting verbatim.

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

test('empty AgentFriend thread opens with the profile greeting as the first assistant message', () => {
  const thread = sampleThread('thread-archivist');
  const seed = buildAgentGreetingSeedMessage({
    threadId: thread.id,
    greeting: MANUAL_ARCHIVIST_FLOOR,
    createdAtMs: thread.createdAtMs + 1,
  });
  assert.ok(seed, 'a non-empty greeting must produce a seed message');
  const bundle = {
    ...createEmptyAgentThreadBundle(thread),
    messages: seed ? [seed] : [],
  };
  assert.equal(bundle.messages.length, 1);
  const first = bundle.messages[0];
  assert.ok(first);
  assert.equal(first.role, 'assistant');
  assert.equal(first.status, 'complete');
  // Rendered verbatim — byte-identical to the manual first-message floor.
  assert.equal(first.contentText, MANUAL_ARCHIVIST_FLOOR);
});

test('the first-message seed is a generic ordinary mechanic, not a guide branch', () => {
  // Any RealmAgent with an ordinary greeting seeds the same way. The seed
  // builder takes no agent id and carries no guide-specific identifier.
  const ordinary = buildAgentGreetingSeedMessage({
    threadId: 'thread-ordinary',
    greeting: 'Hello, I am an ordinary companion agent.',
    createdAtMs: 5,
  });
  assert.ok(ordinary);
  assert.equal(ordinary?.contentText, 'Hello, I am an ordinary companion agent.');
  assert.equal(ordinary?.id, 'thread-ordinary:message:greeting');

  // The seed builder source carries no guide identity literal.
  const builderSource = buildAgentGreetingSeedMessage.toString().toLowerCase();
  for (const token of ['archivist', 'nimi-guide', 'guide_agent']) {
    assert.ok(!builderSource.includes(token), `seed builder must not branch on ${token}`);
  }
});

test('a RealmAgent with no greeting opens an empty thread (no seed)', () => {
  assert.equal(
    buildAgentGreetingSeedMessage({ threadId: 't', greeting: null, createdAtMs: 1 }),
    null,
  );
  assert.equal(
    buildAgentGreetingSeedMessage({ threadId: 't', greeting: '   ', createdAtMs: 1 }),
    null,
  );
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
