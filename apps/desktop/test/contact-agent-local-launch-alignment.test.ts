import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { toSourceContactLaunchTarget } from '../src/shell/renderer/features/relationship/source-contact-launch-target.js';

const repoRoot = path.join(import.meta.dirname, '../../..');

function readRepo(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('profile detail modal only exposes agent chat after ordinary friendship evidence', () => {
  const source = readRepo('apps/desktop/src/shell/renderer/features/relationship/profile-detail-modal.tsx');

  assert.match(source, /launchAgentConversationFromDisplay/);
  assert.match(source, /toSourceContactLaunchTargetFromProfile\(profile,\s*ownerUserId\)/);
  assert.match(source, /!profile\.isFriend/);
  assert.match(source, /profile\.isFriend/);
  assert.doesNotMatch(source, /profile\.isSource\s*\|\|\s*isBlockedProfile/);
});

test('shared profile detail modal keeps admitted source message actions fail-closed', () => {
  const source = readRepo('apps/desktop/src/shell/renderer/features/relationship/profile-detail-modal.tsx');

  assert.match(source, /isBlockedProfile/);
  assert.match(source, /profile\.isSource/);
  assert.match(source, /!profile\.isFriend/);
  assert.match(source, /!isBlockedProfile\s*&& profile\.accessState !== 'restricted'\s*&& \(!profile\.isSource \|\| profile\.isFriend\)/);
  assert.doesNotMatch(source, /showMessageButton=\{!profile\?\.isSource &&/);
});

test('World detail offers View profile only for a Realm source — no direct chat/voice path', () => {
  // T5-2 (`9d558335d`) removed the world-detail source direct-chat drift:
  // `handleChatAgent` / `handleVoiceAgent` synthesized a `localAgentRef` from a
  // non-materialized source and launched a session directly. A Realm source in
  // a World is NOT chat-reachable from World detail; chat requires
  // RuntimeSourceSnapshot materialization. World detail's affordance is now
  // View profile only.
  const source = readRepo('apps/desktop/src/shell/renderer/features/world/world-detail.tsx');
  const templateSource = readRepo(
    'apps/desktop/src/shell/renderer/features/world/world-detail-template.tsx',
  );

  // The removed direct-launch handlers must not reappear.
  assert.doesNotMatch(source, /const handleChatAgent/);
  assert.doesNotMatch(source, /const handleVoiceAgent/);
  assert.doesNotMatch(source, /launchAgentConversationFromDisplay/);
  assert.doesNotMatch(source, /launchAgentVoiceFromDisplay/);

  // The sole source affordance is View profile, routed to source-detail where
  // source admission remains fail-closed until RuntimeSourceSnapshot handoff.
  assert.match(source, /const handleViewAgent = \(agent: WorldAgent\) => \{/);
  assert.match(source, /navigateToProfile\(agent\.id, 'source-detail'\)/);
  assert.match(source, /onViewAgent=\{handleViewAgent\}/);

  // The template exposes only an onViewAgent affordance — no chat/voice props.
  // A real prop is the `onXAgent?: (...)` typed form; the only textual mention
  // of chat/voice is a comment explaining the deliberate absence.
  assert.match(templateSource, /onViewAgent\?: \(agent: WorldAgent\) => void;/);
  assert.doesNotMatch(templateSource, /onChatAgent\?: \(/);
  assert.doesNotMatch(templateSource, /onVoiceAgent\?: \(/);
});

test('agent contact launch target fails closed and builds owner-scoped LocalAgent identity', () => {
  assert.deepEqual(toSourceContactLaunchTarget({
    id: 'agent-1',
    displayName: 'Archivist',
    handle: 'archivist',
    avatarUrl: null,
    bio: 'ordinary source contact',
    isSource: true,
    worldId: 'oasis',
    worldName: 'OASIS',
    sourceOwnershipType: 'MASTER_OWNED',
  }, 'user-1'), {
    ownerUserId: 'user-1',
    runtimeSourceRef: 'agent-1',
    localAgentRef: 'local-agent:user-1:agent-1',
    displayName: 'Archivist',
    handle: 'archivist',
    avatarUrl: null,
    worldId: 'oasis',
    worldName: 'OASIS',
    bio: 'ordinary source contact',
    ownershipType: 'MASTER_OWNED',
    // Contact-launch sources carry identity only; runtime source content
    // (greeting / docs) is supplied by RuntimeSourceSnapshot materialization.
    greeting: null,
    builtinDocsContext: null,
  });

  assert.throws(() => {
    toSourceContactLaunchTarget({
      id: 'human-1',
      displayName: 'Human',
      handle: 'human',
      avatarUrl: null,
      bio: null,
      isSource: false,
    }, 'user-1');
  }, /requires a Realm source contact/);

  assert.throws(() => {
    toSourceContactLaunchTarget({
      id: 'agent-1',
      displayName: 'Agent',
      handle: 'agent',
      avatarUrl: null,
      bio: null,
      isSource: true,
    }, '');
  }, /requires ownerUserId/);

  assert.throws(() => {
    toSourceContactLaunchTarget({
      id: '',
      displayName: 'Agent',
      handle: 'agent',
      avatarUrl: null,
      bio: null,
      isSource: true,
    }, 'user-1');
  }, /requires runtimeSourceRef/);
});
