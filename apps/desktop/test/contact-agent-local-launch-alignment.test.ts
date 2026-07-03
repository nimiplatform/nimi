import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  describeRealmPersonaPrimaryAction,
  resolveRealmPersonaSourceState,
} from '../src/shell/renderer/features/explore/realm-persona-source-materialization.js';
import { toSourceContactLaunchTarget } from '../src/shell/renderer/features/relationship/source-contact-launch-target.js';

const repoRoot = path.join(import.meta.dirname, '../../..');

function readRepo(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), 'utf8');
}

test('profile detail modal materializes source chat without Realm connection evidence', () => {
  const source = readRepo('apps/desktop/src/shell/renderer/features/relationship/profile-detail-modal.tsx');
  const launchTarget = readRepo('apps/desktop/src/shell/renderer/features/relationship/source-contact-launch-target.ts');

  assert.match(source, /launchAgentConversationFromDisplay/);
  assert.match(source, /materializeSourceContactLaunchTarget\(profile,\s*ownerUserId\)/);
  assert.match(launchTarget, /initializeLocalAgent/);
  assert.match(launchTarget, /sourceMaterializationPacket:\s*packet/);
  assert.match(launchTarget, /initialized\.localAgentRef/);
  assert.doesNotMatch(launchTarget, /createNimiClientId\('local-agent:desktop'\)/);
  assert.doesNotMatch(source, new RegExp(['source', 'Connection', 'State'].join('')));
  assert.doesNotMatch(source, new RegExp(['source', 'Connected'].join('')));
  assert.doesNotMatch(source, new RegExp(['source', 'Connection', 'Required', 'For', 'Chat'].join('')));
  assert.doesNotMatch(source, /!profile\.isFriend/);
  assert.doesNotMatch(source, /profile\.isSource\s*\|\|\s*isBlockedProfile/);
});

test('shared profile detail modal keeps source message actions fail-closed on materialization eligibility', () => {
  const source = readRepo('apps/desktop/src/shell/renderer/features/relationship/profile-detail-modal.tsx');

  assert.match(source, /isBlockedProfile/);
  assert.match(source, /profile\.isSource/);
  assert.match(source, /sourceMaterializationUnavailable = sourceAction\?\.disabled === true/);
  assert.doesNotMatch(source, /showMessageButton=\{!profile\?\.isSource &&/);
});

test('World detail offers View profile only for a Realm source — no direct chat/voice path', () => {
  // T5-2 (`9d558335d`) removed the world-detail source direct-chat drift:
  // `handleChatCharacter` / `handleVoiceCharacter` synthesized runtime identity from a
  // non-materialized source and launched a session directly. A Realm source in
  // a World is NOT chat-reachable from World detail without packet-backed
  // Runtime materialization.
  const source = readRepo('apps/desktop/src/shell/renderer/features/world/world-detail.tsx');
  const templateSource = readRepo(
    'apps/desktop/src/shell/renderer/features/world/world-detail-template.tsx',
  );

  // The removed direct-launch handlers must not reappear.
  assert.doesNotMatch(source, /const handleChatCharacter/);
  assert.doesNotMatch(source, /const handleVoiceCharacter/);
  assert.doesNotMatch(source, /launchCharacterConversationFromDisplay/);
  assert.doesNotMatch(source, /launchCharacterVoiceFromDisplay/);

  // The sole source affordance is View profile, routed to source-detail where
  // source materialization remains fail-closed until a hash-bearing sourceRef exists.
  assert.match(source, /const handleViewCharacter = \(character: WorldCharacter\) => \{/);
  assert.match(source, /navigateToSourceDetail\(character\.sourceRef\)/);
  assert.match(source, /materializeSourceContactLaunchTarget/);
  assert.match(source, /ensureRuntimeAgentExists/);
  assert.doesNotMatch(source, /navigateToProfile\(character\.id, 'source-detail'\)/);
  assert.match(source, /onViewCharacter=\{handleViewCharacter\}/);

  // The template exposes only an onViewCharacter affordance — no chat/voice props.
  // A real prop is the `onXCharacter?: (...)` typed form; the only textual mention
  // of chat/voice is a comment explaining the deliberate absence.
  assert.match(templateSource, /onViewCharacter\?: \(character: WorldCharacter\) => void;/);
  assert.doesNotMatch(templateSource, /onChatCharacter\?: \(/);
  assert.doesNotMatch(templateSource, /onVoiceCharacter\?: \(/);
});

test('source contact launch target fails closed and requires Runtime-owned localAgent identity', () => {
  assert.deepEqual(toSourceContactLaunchTarget({
    id: 'character-1',
    displayName: 'Archivist',
    handle: 'archivist',
    avatarUrl: null,
    bio: 'ordinary source contact',
    isSource: true,
    worldId: 'oasis',
    sourceKind: 'worldCharacter',
    sourceId: 'character-1',
    sourceContentHash: 'hash-1',
    runtimeSourceRef: 'runtime-source:worldCharacter:oasis:character-1:hash-1',
    localAgentRef: 'local-agent:opaque-character-1',
    worldName: 'OASIS',
    sourceOwnershipType: 'MASTER_OWNED',
  }, 'user-1'), {
    ownerUserId: 'user-1',
    runtimeSourceRef: 'runtime-source:worldCharacter:oasis:character-1:hash-1',
    localAgentRef: 'local-agent:opaque-character-1',
    displayName: 'Archivist',
    handle: 'archivist',
    avatarUrl: null,
    worldId: 'oasis',
    worldName: 'OASIS',
    bio: 'ordinary source contact',
    ownershipType: 'MASTER_OWNED',
    // Contact-launch sources carry identity only; runtime source content
    // (greeting / docs) is supplied by source materialization.
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
      id: 'character-1',
      displayName: 'Character',
      handle: 'character',
      avatarUrl: null,
      bio: null,
      isSource: true,
    }, '');
  }, /requires ownerUserId/);

  assert.throws(() => {
    toSourceContactLaunchTarget({
      id: '',
      displayName: 'Character',
      handle: 'character',
      avatarUrl: null,
      bio: null,
      isSource: true,
    }, 'user-1');
  }, /requires hash-bearing sourceRef/);

  assert.throws(() => {
    toSourceContactLaunchTarget({
      id: 'character-1',
      displayName: 'Character',
      handle: 'character',
      avatarUrl: null,
      bio: null,
      isSource: true,
      worldId: 'oasis',
      sourceKind: 'worldCharacter',
      sourceId: 'character-1',
      sourceContentHash: 'hash-1',
    }, 'user-1');
  }, /requires runtimeSourceRef/);

  assert.throws(() => {
    toSourceContactLaunchTarget({
      id: 'character-1',
      displayName: 'Character',
      handle: 'character',
      avatarUrl: null,
      bio: null,
      isSource: true,
      worldId: 'oasis',
      sourceKind: 'worldCharacter',
      sourceId: 'character-1',
      sourceContentHash: 'hash-1',
      runtimeSourceRef: 'runtime-source:worldCharacter:oasis:character-1:hash-1',
    }, 'user-1');
  }, /requires localAgentRef/);

  assert.throws(() => {
    toSourceContactLaunchTarget({
      id: 'character-1',
      displayName: 'Character',
      handle: 'character',
      avatarUrl: null,
      bio: null,
      isSource: true,
      worldId: 'oasis',
      sourceKind: 'worldCharacter',
      sourceId: 'character-1',
      sourceContentHash: 'hash-1',
      runtimeSourceRef: 'runtime-source:worldCharacter:oasis:character-1:hash-1',
      localAgentRef: 'agent-1',
    }, 'user-1');
  }, /requires Runtime-owned localAgentRef/);
});

test('Realm source state distinguishes packet availability from Runtime-owned LocalAgent discovery', () => {
  const source = {
    id: 'character-1',
    displayName: 'Archivist',
    handle: 'archivist',
    avatarUrl: null,
    bio: 'ordinary source contact',
    isSource: true,
    worldId: 'oasis',
    sourceKind: 'worldCharacter',
    sourceId: 'character-1',
    sourceContentHash: 'hash-1',
    runtimeSourceRef: 'runtime-source:worldCharacter:oasis:character-1:hash-1',
  };

  assert.equal(resolveRealmPersonaSourceState(source), 'source_materialization_available');
  const availableAction = describeRealmPersonaPrimaryAction('source_materialization_available');
  assert.equal(availableAction.action, 'become_partner');
  assert.equal(availableAction.label, 'Become my partner');

  assert.equal(resolveRealmPersonaSourceState({
    ...source,
    runtimeSourceRef: null,
  }, [{
    ownerUserId: 'user-1',
    runtimeSourceRef: 'runtime-source:worldCharacter:oasis:character-1:hash-1',
    localAgentRef: 'local-agent:runtime-owned-existing',
    sourceKind: 'worldCharacter',
    sourceWorldId: 'oasis',
    sourceId: 'character-1',
    sourceContentHash: 'hash-1',
  }]), 'local_agent_available');

  assert.equal(resolveRealmPersonaSourceState(source, [{
    ownerUserId: 'user-1',
    runtimeSourceRef: 'runtime-source:worldCharacter:oasis:character-1:hash-1',
    localAgentRef: 'local-agent:runtime-owned-existing',
    sourceKind: 'worldCharacter',
    sourceWorldId: 'oasis',
    sourceId: 'character-1',
    sourceContentHash: 'hash-1',
  }]), 'local_agent_available');
  const existingAction = describeRealmPersonaPrimaryAction('local_agent_available');
  assert.equal(existingAction.action, 'open_partner');
  assert.equal(existingAction.label, 'Open partner');

  const duplicateAgents = [
    {
      ownerUserId: 'user-1',
      runtimeSourceRef: 'runtime-source:worldCharacter:oasis:character-1:hash-1',
      localAgentRef: 'local-agent:runtime-owned-existing-a',
      sourceKind: 'worldCharacter',
      sourceWorldId: 'oasis',
      sourceId: 'character-1',
      sourceContentHash: 'hash-1',
    },
    {
      ownerUserId: 'user-1',
      runtimeSourceRef: 'runtime-source:worldCharacter:oasis:character-1:hash-1',
      localAgentRef: 'local-agent:runtime-owned-existing-b',
      sourceKind: 'worldCharacter',
      sourceWorldId: 'oasis',
      sourceId: 'character-1',
      sourceContentHash: 'hash-1',
    },
  ];
  assert.equal(resolveRealmPersonaSourceState(source, duplicateAgents), 'local_agent_ambiguous');
  const ambiguousAction = describeRealmPersonaPrimaryAction('local_agent_ambiguous');
  assert.equal(ambiguousAction.action, 'partner_ambiguous');
  assert.equal(ambiguousAction.disabled, true);

  assert.equal(
    resolveRealmPersonaSourceState(source, [], { runtimeInventoryUnavailable: true }),
    'runtime_agent_inventory_unavailable',
  );
  const runtimeFailureAction = describeRealmPersonaPrimaryAction('runtime_agent_inventory_unavailable');
  assert.equal(runtimeFailureAction.action, 'partner_runtime_unavailable');
  assert.equal(runtimeFailureAction.disabled, true);

  assert.equal(resolveRealmPersonaSourceState({
    ...source,
    sourceContentHash: '',
    runtimeSourceRef: '',
  }, [{
    ownerUserId: 'user-1',
    runtimeSourceRef: 'runtime-source:worldCharacter:oasis:character-1:hash-1',
    localAgentRef: 'local-agent:runtime-owned-existing',
    sourceKind: 'worldCharacter',
    sourceWorldId: 'oasis',
    sourceId: 'character-1',
    sourceContentHash: 'hash-1',
  }]), 'source_materialization_unavailable');
});

test('Realm persona materialization UI copy uses partner relationship semantics', () => {
  const materialization = readRepo('apps/desktop/src/shell/renderer/features/explore/realm-persona-source-materialization.ts');
  const exploreEn = readRepo('apps/desktop/src/shell/renderer/locales/en/11-Explore.json');
  const exploreZh = readRepo('apps/desktop/src/shell/renderer/locales/zh/11-Explore.json');
  const relationshipEn = readRepo('apps/desktop/src/shell/renderer/locales/en/24-Relationship.json');
  const relationshipZh = readRepo('apps/desktop/src/shell/renderer/locales/zh/24-Relationship.json');

  for (const source of [materialization, exploreEn, exploreZh, relationshipEn, relationshipZh]) {
    assert.doesNotMatch(source, /Create local agent|创建 local agent|创建本地伙伴/);
  }
  assert.match(exploreZh, /"realmPersonaSourceMaterialize": "成为我的伙伴"/);
  assert.match(exploreZh, /"realmPersonaSourceOpenLocalAgent": "打开伙伴"/);
  assert.match(relationshipZh, /"createLocalAgent": "成为我的伙伴"/);
});
