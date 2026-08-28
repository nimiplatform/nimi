import assert from 'node:assert/strict';
import test from 'node:test';
import type { TFunction } from 'i18next';
import {
  describeCharacterPrimaryAction,
  resolveCharacterSourceState,
} from '../src/shell/renderer/features/explore/character-source-materialization.js';
import {
  ensureCharacterSourceMaterialized,
} from '../src/shell/renderer/features/relationship/character-source-launch-target.js';
import type { DesktopRendererSdkPort } from '../src/shell/renderer/renderer/sdk-port.js';

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

test('existing character source materialization stays outside renderer Chat identity', async () => {
  let materializeCalls = 0;
  const sdk = {
    accountProduct: () => ({
      materializeRealmSource: async () => {
        materializeCalls += 1;
        throw new Error('existing source must not be rematerialized');
      },
    }),
    runtimeAgentDiscovery: () => ({
      discoverLocalAgentsBySource: async () => [{
        localAgentRef: 'local-agent:opaque-existing',
        ownerUserId: 'user-1',
        runtimeSourceRef: 'runtime-source:private-existing',
      }],
    }),
  } as unknown as DesktopRendererSdkPort;

  const result = await ensureCharacterSourceMaterialized({
    id: 'character-1',
    displayName: 'Archivist',
    handle: 'archivist',
    avatarUrl: null,
    bio: 'ordinary character source',
    sourceRef: WORLD_SOURCE_REF,
  }, 'user-1', testTranslate, sdk);

  assert.equal(result, undefined);
  assert.equal(materializeCalls, 0);
});

test('character source materialization re-reads committed ownership without returning raw identity', async () => {
  const discoveryInputs: unknown[] = [];
  let discoveryCall = 0;
  const sdk = {
    accountProduct: () => ({
      materializeRealmSource: async () => ({
        localAgentRef: 'local-agent:opaque-materialized',
        idempotentReplay: false,
        reasonCode: 1,
      }),
    }),
    runtimeAgentDiscovery: () => ({
      discoverLocalAgentsBySource: async (input: unknown) => {
        discoveryInputs.push(input);
        discoveryCall += 1;
        if (discoveryCall === 1) return [];
        return [{
          localAgentRef: 'local-agent:opaque-materialized',
          ownerUserId: 'user-1',
          runtimeSourceRef: 'runtime-source:canonical-materialized',
          displayName: 'Archivist',
          sourceKind: 'worldCharacter',
          sourceWorldId: 'oasis',
          sourceWorldName: null,
          sourceId: 'character-1',
          sourceHash: SOURCE_HASH,
          sourceSchemaVersion: 'v3',
          snapshotHash: 'snapshot-1',
          worldContentHash: 'world-content-1',
          materializationContextHash: 'context-1',
          capturedAt: null,
          sourceContextStatus: null,
          agent: {},
        }];
      },
    }),
  } as unknown as DesktopRendererSdkPort;

  const result = await ensureCharacterSourceMaterialized({
    id: 'character-1',
    displayName: 'Archivist',
    handle: 'archivist',
    avatarUrl: null,
    bio: 'ordinary character source',
    worldId: 'oasis',
    sourceKind: 'worldCharacter',
    sourceId: 'character-1',
    sourceHash: SOURCE_HASH,
    sourceRef: WORLD_SOURCE_REF,
  }, 'user-1', testTranslate, sdk);

  assert.equal(result, undefined);
  assert.deepEqual(discoveryInputs[1], { ownerUserId: 'user-1', sourceRef: WORLD_SOURCE_REF });
});

test('Realm source state distinguishes packet availability from Runtime-owned LocalAgent discovery', () => {
  const source = {
    id: 'character-1',
    displayName: 'Archivist',
    handle: 'archivist',
    avatarUrl: null,
    bio: 'ordinary character source',
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
