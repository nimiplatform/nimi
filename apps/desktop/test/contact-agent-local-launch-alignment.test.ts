import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { toAgentContactLaunchTarget } from '../src/shell/renderer/features/contacts/agent-contact-launch-target.js';

const repoRoot = path.join(import.meta.dirname, '../../..');

function readRepo(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('Contacts panel routes agent friends through LocalAgent launcher', () => {
  const source = readRepo('apps/desktop/src/shell/renderer/features/contacts/contacts-panel.tsx');

  assert.match(source, /launchAgentConversationFromDisplay/);
  assert.match(source, /toAgentContactLaunchTargetFromContact\(contact,\s*currentUserId\)/);
  assert.match(source, /blockedIds\.has\(contact\.id\)/);
  assert.doesNotMatch(source, /if\s*\(\s*contact\.isAgent\s*\)\s*\{\s*return;\s*\}/);
  assert.match(source, /setAgentConversationSelection/);
  assert.match(source, /setSelectedTargetForSource/);
});

test('Contact profile modal only exposes agent chat after ordinary friendship evidence', () => {
  const source = readRepo('apps/desktop/src/shell/renderer/features/contacts/contact-detail-profile-modal.tsx');

  assert.match(source, /launchAgentConversationFromDisplay/);
  assert.match(source, /toAgentContactLaunchTargetFromProfile\(profile,\s*ownerUserId\)/);
  assert.match(source, /!profile\.isFriend/);
  assert.match(source, /profile\.isFriend/);
  assert.doesNotMatch(source, /profile\.isAgent\s*\|\|\s*isBlockedProfile/);
});

test('shared contact profile modal does not hide ordinary agent-friend message actions', () => {
  const source = readRepo('apps/desktop/src/shell/renderer/features/contacts/contact-detail-profile-modal.tsx');

  assert.match(source, /isBlockedProfile/);
  assert.match(source, /profile\.isAgent/);
  assert.match(source, /!profile\.isFriend/);
  assert.match(source, /!isBlockedProfile\s*&& profile\.accessState !== 'restricted'\s*&& \(!profile\.isAgent \|\| profile\.isFriend\)/);
  assert.doesNotMatch(source, /showMessageButton=\{!profile\?\.isAgent &&/);
});

test('World detail offers View profile only for a RealmAgent — no direct chat/voice path', () => {
  // T5-2 (`9d558335d`) removed the world-detail RealmAgent direct-chat drift:
  // `handleChatAgent` / `handleVoiceAgent` synthesized a `localAgentRef` from a
  // non-befriended RealmAgent and launched a session directly. Per D-EXPL-006
  // a RealmAgent in a World is NOT chat-reachable from World detail; chat is
  // reachable solely via friend -> Open Agent Chat -> LocalAgent Chat. World
  // detail's agent affordance is now View profile only.
  const source = readRepo('apps/desktop/src/shell/renderer/features/world/world-detail.tsx');
  const templateSource = readRepo(
    'apps/desktop/src/shell/renderer/features/world/world-detail-template.tsx',
  );

  // The removed direct-launch handlers must not reappear.
  assert.doesNotMatch(source, /const handleChatAgent/);
  assert.doesNotMatch(source, /const handleVoiceAgent/);
  assert.doesNotMatch(source, /launchAgentConversationFromDisplay/);
  assert.doesNotMatch(source, /launchAgentVoiceFromDisplay/);

  // The sole RealmAgent affordance is View profile, routed to agent-detail
  // where the friend-state primary action lives.
  assert.match(source, /const handleViewAgent = \(agent: WorldAgent\) => \{/);
  assert.match(source, /navigateToProfile\(agent\.id, 'agent-detail'\)/);
  assert.match(source, /onViewAgent=\{handleViewAgent\}/);

  // The template exposes only an onViewAgent affordance — no chat/voice props.
  // A real prop is the `onXAgent?: (...)` typed form; the only textual mention
  // of chat/voice is a comment explaining the deliberate absence.
  assert.match(templateSource, /onViewAgent\?: \(agent: WorldAgent\) => void;/);
  assert.doesNotMatch(templateSource, /onChatAgent\?: \(/);
  assert.doesNotMatch(templateSource, /onVoiceAgent\?: \(/);
});

test('agent contact launch target fails closed and builds owner-scoped LocalAgent identity', () => {
  assert.deepEqual(toAgentContactLaunchTarget({
    id: 'agent-1',
    displayName: 'Archivist',
    handle: 'archivist',
    avatarUrl: null,
    bio: 'ordinary agent friend',
    isAgent: true,
    worldId: 'oasis',
    worldName: 'OASIS',
    agentOwnershipType: 'MASTER_OWNED',
  }, 'user-1'), {
    ownerUserId: 'user-1',
    realmAgentId: 'agent-1',
    localAgentRef: 'local-agent:user-1:agent-1',
    displayName: 'Archivist',
    handle: 'archivist',
    avatarUrl: null,
    worldId: 'oasis',
    worldName: 'OASIS',
    bio: 'ordinary agent friend',
    ownershipType: 'MASTER_OWNED',
    // Contact-launch sources carry identity only; ordinary RealmAgent profile
    // content (greeting / docs) is supplied by the live Realm/SDK projection.
    greeting: null,
    builtinDocsContext: null,
  });

  assert.throws(() => {
    toAgentContactLaunchTarget({
      id: 'human-1',
      displayName: 'Human',
      handle: 'human',
      avatarUrl: null,
      bio: null,
      isAgent: false,
    }, 'user-1');
  }, /requires an agent contact/);

  assert.throws(() => {
    toAgentContactLaunchTarget({
      id: 'agent-1',
      displayName: 'Agent',
      handle: 'agent',
      avatarUrl: null,
      bio: null,
      isAgent: true,
    }, '');
  }, /requires ownerUserId/);

  assert.throws(() => {
    toAgentContactLaunchTarget({
      id: '',
      displayName: 'Agent',
      handle: 'agent',
      avatarUrl: null,
      bio: null,
      isAgent: true,
    }, 'user-1');
  }, /requires realmAgentId/);
});
