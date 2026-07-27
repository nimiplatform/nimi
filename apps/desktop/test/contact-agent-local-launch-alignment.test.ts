import assert from 'node:assert/strict';
import test from 'node:test';
import type { TFunction } from 'i18next';
import {
  describeCharacterPrimaryAction,
  resolveCharacterSourceState,
} from '../src/shell/renderer/features/explore/character-source-materialization.js';
import { toSourceContactLaunchTarget } from '../src/shell/renderer/features/relationship/source-contact-launch-target.js';

const SOURCE_HASH = 'a'.repeat(64);
const WORLD_SOURCE_REF = {
  kind: 'worldCharacter' as const,
  id: 'character-1',
  worldId: 'oasis',
  worldEntityRef: { kind: 'worldEntity' as const, worldId: 'oasis', entityId: 'entity-1' },
  sourceHash: SOURCE_HASH,
};
const testTranslate = ((_: string, options?: { defaultValue?: string }) => (
  options?.defaultValue ?? ''
)) as TFunction;

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
    sourceHash: SOURCE_HASH,
    sourceRef: WORLD_SOURCE_REF,
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
      sourceRef: WORLD_SOURCE_REF,
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
      sourceRef: WORLD_SOURCE_REF,
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
      sourceRef: WORLD_SOURCE_REF,
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
    sourceHash: SOURCE_HASH,
    sourceRef: WORLD_SOURCE_REF,
    runtimeSourceRef: 'runtime-source:worldCharacter:oasis:character-1:hash-1',
  };

  assert.equal(resolveCharacterSourceState(source), 'source_materialization_available');
  const availableAction = describeCharacterPrimaryAction('source_materialization_available', testTranslate);
  assert.equal(availableAction.action, 'become_partner');
  assert.equal(availableAction.label, 'Become my partner');

  assert.equal(resolveCharacterSourceState({
    ...source,
    runtimeSourceRef: null,
  }, [{
    runtimeSourceRef: 'runtime-source:worldCharacter:oasis:character-1:hash-1',
    localAgentRef: 'local-agent:runtime-owned-existing',
    sourceKind: 'worldCharacter',
    sourceWorldId: 'oasis',
    sourceId: 'character-1',
    sourceHash: SOURCE_HASH,
  }]), 'local_agent_available');

  assert.equal(resolveCharacterSourceState(source, [{
    runtimeSourceRef: 'runtime-source:worldCharacter:oasis:character-1:hash-1',
    localAgentRef: 'local-agent:runtime-owned-existing',
    sourceKind: 'worldCharacter',
    sourceWorldId: 'oasis',
    sourceId: 'character-1',
    sourceHash: SOURCE_HASH,
  }]), 'local_agent_available');
  const existingAction = describeCharacterPrimaryAction('local_agent_available', testTranslate);
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
      sourceHash: SOURCE_HASH,
    },
    {
      ownerUserId: 'user-1',
      runtimeSourceRef: 'runtime-source:worldCharacter:oasis:character-1:hash-1',
      localAgentRef: 'local-agent:runtime-owned-existing-b',
      sourceKind: 'worldCharacter',
      sourceWorldId: 'oasis',
      sourceId: 'character-1',
      sourceHash: SOURCE_HASH,
    },
  ];
  assert.equal(resolveCharacterSourceState(source, duplicateAgents), 'local_agent_ambiguous');
  const ambiguousAction = describeCharacterPrimaryAction('local_agent_ambiguous', testTranslate);
  assert.equal(ambiguousAction.action, 'partner_ambiguous');
  assert.equal(ambiguousAction.disabled, true);

  assert.equal(
    resolveCharacterSourceState(source, [], { runtimeInventoryUnavailable: true }),
    'runtime_agent_inventory_unavailable',
  );
  const runtimeFailureAction = describeCharacterPrimaryAction('runtime_agent_inventory_unavailable', testTranslate);
  assert.equal(runtimeFailureAction.action, 'partner_runtime_unavailable');
  assert.equal(runtimeFailureAction.disabled, true);

  assert.equal(resolveCharacterSourceState({
    ...source,
    sourceRef: null,
    runtimeSourceRef: '',
  }, [{
    runtimeSourceRef: 'runtime-source:worldCharacter:oasis:character-1:hash-1',
    localAgentRef: 'local-agent:runtime-owned-existing',
    sourceKind: 'worldCharacter',
    sourceWorldId: 'oasis',
    sourceId: 'character-1',
    sourceHash: SOURCE_HASH,
  }]), 'source_materialization_unavailable');
});
