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

test('Contacts detail surface does not hide ordinary agent-friend message actions', () => {
  const source = readRepo('apps/desktop/src/shell/renderer/features/contacts/contacts-view.tsx');

  assert.match(source, /selectedContactIsBlocked/);
  assert.match(source, /selectedCategory === 'blocks'/);
  assert.match(source, /blockedUsers\.has\(selectedContact\.id\)/);
  assert.match(source, /selectedContact\?\.isAgent === true/);
  assert.match(source, /selectedProfile\.isFriend/);
  assert.match(source, /!selectedContactIsBlocked/);
  assert.doesNotMatch(source, /showMessageButton=\{!selectedProfile\?\.isAgent &&/);
});

test('World detail chat and voice actions call their matching LocalAgent launchers', () => {
  const source = readRepo('apps/desktop/src/shell/renderer/features/world/world-detail.tsx');
  const chatStart = source.indexOf('const handleChatAgent');
  const voiceStart = source.indexOf('const handleVoiceAgent');
  const viewStart = source.indexOf('const handleViewAgent');

  assert.notEqual(chatStart, -1);
  assert.notEqual(voiceStart, -1);
  assert.notEqual(viewStart, -1);

  const chatBlock = source.slice(chatStart, voiceStart);
  const voiceBlock = source.slice(voiceStart, viewStart);

  assert.match(chatBlock, /launchAgentConversationFromDisplay/);
  assert.doesNotMatch(chatBlock, /launchAgentVoiceFromDisplay/);
  assert.match(voiceBlock, /launchAgentVoiceFromDisplay/);
  assert.doesNotMatch(voiceBlock, /launchAgentConversationFromDisplay/);
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
