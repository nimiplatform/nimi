import assert from 'node:assert/strict';
import test from 'node:test';
import type { NimiMachineLoadout, NimiRuntimeModelAssetRecord } from '@nimiplatform/sdk/runtime';
import {
  buildRuntimeConfigShareInventory,
  defaultRuntimeConfigShareChoice,
  includedRuntimeConfigShareLoadouts,
  probeRuntimeConfigShareExport,
  resolveRuntimeConfigShareChoices,
  runtimeConfigShareFileName,
} from '../src/shell/renderer/features/runtime-config/runtime-config-profile-share-model.js';

const A = `sha256:${'a'.repeat(64)}`;
const B = `sha256:${'b'.repeat(64)}`;

function asset(id: string, contentId: string): NimiRuntimeModelAssetRecord {
  return {
    modelAssetId: id,
    contentId,
    displayName: id,
    entry: 'model.gguf',
    files: [{ relativePath: 'model.gguf', sha256: contentId.replace('sha256:', ''), sizeBytes: 100, nonExecutableContent: false }],
    totalSizeBytes: 100,
    contentVerified: true,
    catalogVerification: 'not_matched',
    provenance: null,
  } as unknown as NimiRuntimeModelAssetRecord;
}

function loadout(input: {
  readonly id: string;
  readonly capability?: string;
  readonly state?: NimiMachineLoadout['validationState'];
  readonly modelAssetId?: string;
  readonly contentId?: string;
  readonly displayName?: string;
  readonly createdAt?: string;
  readonly reasons?: readonly string[];
}): NimiMachineLoadout {
  const capability = input.capability ?? 'text.generate';
  return {
    loadoutId: input.id,
    capabilityContract: capability,
    implementation: { implementationId: 'local.test', driverId: 'driver.test', driverDialect: `${capability}/v1` },
    recipeId: `${capability}.recipe`,
    recipeRevision: '1',
    options: {},
    modelAxes: [{
      slotId: 'main.model',
      presence: 'required',
      resolution: 'configured',
      modelAssetId: input.modelAssetId ?? 'text-model',
      expectedContentId: input.contentId ?? A,
    }] as unknown as NimiMachineLoadout['modelAxes'],
    recipeCustody: [],
    implementationSupportedFeatures: [],
    configuredFeatures: [],
    textBehaviors: [],
    validationState: input.state ?? 'configured',
    reasons: input.reasons ?? [],
    displayName: input.displayName ?? 'Gemma 4 text generation',
    provenance: {},
    createdAt: input.createdAt ?? '2026-08-16T00:00:00Z',
    updatedAt: '2026-08-16T00:00:00Z',
    revision: '1',
  };
}

test('share probe reports the Runtime state first and the export failure otherwise', () => {
  const assets = [asset('text-model', A)];
  assert.equal(probeRuntimeConfigShareExport(loadout({ id: 'ok' }), assets), null);
  assert.deepEqual(probeRuntimeConfigShareExport(loadout({ id: 'b', state: 'blocked', reasons: ['driver gone'] }), assets), { kind: 'blocked', detail: 'driver gone' });
  assert.equal(probeRuntimeConfigShareExport(loadout({ id: 'u', state: 'unresolved' }), assets)?.kind, 'unresolved');
  const missing = probeRuntimeConfigShareExport(loadout({ id: 'gone', modelAssetId: 'deleted' }), assets);
  assert.equal(missing?.kind, 'assets');
  assert.match(missing?.detail ?? '', /no matching verified ModelAsset/u);
});

test('share inventory preserves setup identities, prioritizes the default, and splits uses by exportability', () => {
  const assets = [asset('text-model', A)];
  const duplicates = Array.from({ length: 9 }, (_, index) => loadout({ id: `dup-${index}`, createdAt: `2026-08-${String(10 + index).padStart(2, '0')}T00:00:00Z` }));
  const other = loadout({ id: 'other', displayName: 'Gemma 4 · long context' });
  const embed = loadout({ id: 'embed', capability: 'text.embed', modelAssetId: 'deleted', contentId: B, displayName: 'llama.cpp GGUF embeddings' });
  const tts = loadout({ id: 'tts', capability: 'audio.synthesize', state: 'unresolved', displayName: 'Qwen3 TTS Base synthesis' });
  const inventory = buildRuntimeConfigShareInventory({
    loadouts: [...duplicates, other, embed, tts],
    selections: [{ capabilityContract: 'text.generate', loadoutId: 'dup-4', effectiveDefaults: {} }],
    assets,
  });

  assert.deepEqual(inventory.shareable.map((use) => use.capabilityContract), ['text.generate']);
  const text = inventory.shareable[0]!;
  assert.equal(text.candidates.length, 10);
  assert.equal(text.candidates[0]?.loadout.loadoutId, 'dup-4');
  assert.equal(text.candidates[0]?.current, true);
  assert.equal(text.exportable.length, 10);

  assert.deepEqual(inventory.blocked.map((use) => use.capabilityContract), ['text.embed', 'audio.synthesize']);
  assert.equal(inventory.blocked[0]?.candidates[0]?.block?.kind, 'assets');
  assert.equal(inventory.blocked[1]?.candidates[0]?.block?.kind, 'unresolved');
});

test('share choices default to the setup in use and survive a reload with the same rules', () => {
  const assets = [asset('text-model', A), asset('image-model', B)];
  const inventory = buildRuntimeConfigShareInventory({
    loadouts: [
      loadout({ id: 'text-a' }),
      loadout({ id: 'text-b', displayName: 'Gemma 4 · long context' }),
      loadout({ id: 'image', capability: 'image.generate', modelAssetId: 'image-model', contentId: B, displayName: 'Image v1 generation' }),
    ],
    selections: [{ capabilityContract: 'text.generate', loadoutId: 'text-b', effectiveDefaults: {} }],
    assets,
  });
  assert.equal(defaultRuntimeConfigShareChoice(inventory.shareable[0]!), 'text-b');

  const fresh = resolveRuntimeConfigShareChoices(inventory, {});
  assert.deepEqual(fresh, { 'text.generate': 'text-b', 'image.generate': 'image' });

  const kept = resolveRuntimeConfigShareChoices(inventory, { 'text.generate': 'text-a', 'image.generate': null });
  assert.deepEqual(kept, { 'text.generate': 'text-a', 'image.generate': null });
  assert.deepEqual(includedRuntimeConfigShareLoadouts(inventory, kept).map((item) => item.loadoutId), ['text-a']);

  // Losing files never substitutes another setup or forgets an excluded use.
  const degraded = buildRuntimeConfigShareInventory({
    loadouts: [loadout({ id: 'text-a', modelAssetId: 'deleted' }), loadout({ id: 'text-b', displayName: 'Gemma 4 · long context' })],
    selections: [],
    assets,
  });
  const afterFailure = resolveRuntimeConfigShareChoices(degraded, kept);
  assert.deepEqual(afterFailure, kept);
  assert.deepEqual(includedRuntimeConfigShareLoadouts(degraded, afterFailure), []);

  // Returning after repair restores the exact choice, including exclusions.
  const afterRepair = resolveRuntimeConfigShareChoices(inventory, afterFailure);
  assert.deepEqual(afterRepair, kept);
  assert.deepEqual(includedRuntimeConfigShareLoadouts(inventory, afterRepair).map((item) => item.loadoutId), ['text-a']);
});

test('share file name follows the generated profile id, not the title', () => {
  assert.equal(runtimeConfigShareFileName('profile.loadouts.1'), 'profile.loadouts.1.ai-profile.json');
});
