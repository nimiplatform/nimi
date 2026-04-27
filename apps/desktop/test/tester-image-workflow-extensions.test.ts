import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildWorkflowExtensions,
  shouldUseLocalImageWorkflowExtensions,
} from '../src/shell/renderer/features/tester/panels/panel-image-generate-model.js';
import type { ImageWorkflowDraftState } from '../src/shell/renderer/features/tester/tester-types.js';

function createImageDraft(overrides: Partial<ImageWorkflowDraftState> = {}): ImageWorkflowDraftState {
  return {
    prompt: 'A cat wearing a top hat in a field of flowers.',
    negativePrompt: '',
    size: '512x512',
    n: '1',
    seed: '',
    responseFormatMode: 'auto',
    timeoutMs: '600000',
    step: '15',
    cfgScale: '',
    sampler: '',
    scheduler: '',
    optionsText: '',
    rawProfileOverridesText: '',
    vaeModel: '',
    llmModel: '',
    clipLModel: '',
    clipGModel: '',
    controlnetModel: '',
    loraModel: '',
    auxiliaryModel: '',
    componentDrafts: [],
    ...overrides,
  };
}

test('tester image workflow uses profile extensions for local imported image bindings without media engine metadata', () => {
  assert.equal(shouldUseLocalImageWorkflowExtensions({
    source: 'local',
    connectorId: '',
    model: '01KN7DNKEEJ3T7WYSW7BBEZ7ZZ',
    modelLabel: 'z_image_turbo-Q4_K',
    localModelId: '01KN7DNKEEJ3T7WYSW7BBEZ7ZZ',
  }), true);

  const result = buildWorkflowExtensions({
    draft: createImageDraft(),
    profileOverrides: { steps: 15 },
    mainLocalAssetId: '01KN7DNKEEJ3T7WYSW7BBEZ7ZZ',
    mainAssetId: '01KN7DNKEEJ3T7WYSW7BBEZ7ZZ',
  });

  assert.equal(result.error, '');
  assert.deepEqual(result.extensions, {
    entry_overrides: [
      {
        entry_id: 'tester/image-main-model',
        local_asset_id: '01KN7DNKEEJ3T7WYSW7BBEZ7ZZ',
      },
    ],
    profile_overrides: {
      steps: 15,
    },
    profile_entries: [
      {
        entryId: 'tester/image-main-model',
        kind: 'asset',
        capability: 'image',
        title: 'Selected local image model',
        required: true,
        preferred: true,
        assetId: '01KN7DNKEEJ3T7WYSW7BBEZ7ZZ',
        assetKind: 'image',
      },
    ],
  });
});
