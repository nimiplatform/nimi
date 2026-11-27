import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LocalRecommendationApplicability,
  ModelAssetSourceAvailability,
  ModelAssetSourceFreshness,
  ReasonCode,
} from '../core-generated/runtime-typed-client.js';
import {
  projectNimiRuntimeFactoryProfileRecommendation,
  projectNimiRuntimeModelAssetMarketCandidate,
  projectNimiRuntimeModelAssetSourceObservation,
  projectNimiRuntimeRecommendationApplicability,
} from './runtime-local-recommendation.js';

test('recommendation applicability is closed and factory Profile limitations remain per capability', () => {
  assert.equal(
    projectNimiRuntimeRecommendationApplicability(LocalRecommendationApplicability.SUPPORTED),
    'supported',
  );
  assert.throws(
    () => projectNimiRuntimeRecommendationApplicability(LocalRecommendationApplicability.UNSPECIFIED),
    /unspecified/,
  );
  const profile = projectNimiRuntimeFactoryProfileRecommendation({
    profileAlias: 'local-gpu',
    capabilities: [
      {
        capabilityContract: 'text.generate',
        applicability: LocalRecommendationApplicability.SUPPORTED,
        reasons: [],
      },
      {
        capabilityContract: 'image.generate',
        applicability: LocalRecommendationApplicability.UNKNOWN,
        reasons: [ReasonCode.AI_LOCAL_COMPONENT_COMPATIBILITY_UNKNOWN],
      },
    ],
  });
  assert.deepEqual(profile, {
    profileAlias: 'local-gpu',
    capabilities: [
      { capabilityContract: 'text.generate', applicability: 'supported', reasons: [] },
      {
        capabilityContract: 'image.generate',
        applicability: 'unknown',
        reasons: ['AI_LOCAL_COMPONENT_COMPATIBILITY_UNKNOWN'],
      },
    ],
  });
  assert.equal('applicability' in profile, false);
});

test('Market candidates keep download size separate from the installed total', () => {
  const candidate = projectNimiRuntimeModelAssetMarketCandidate({
    offerRef: 'offer_spacy', sourceLabel: 'verified', title: 'asset-nlp-spacy-en-core-web-md-3.8.0', description: '',
    categories: [], modelType: 'auxiliary', variantLabel: 'config.cfg', format: '', totalSizeBytes: '56524490',
    license: 'MIT', tags: [], downloads: '0', likes: '0', lastModified: '', verified: true, installed: false,
    installable: true, editorialReason: '', author: 'explosion', downloadSizeBytes: '33480380',
  });
  assert.equal(candidate.totalSizeBytes, 56524490);
  assert.equal(candidate.downloadSizeBytes, 33480380);
  const unknown = projectNimiRuntimeModelAssetMarketCandidate({
    offerRef: 'offer_unknown', sourceLabel: 'huggingface', title: 'unknown', description: '', categories: [],
    modelType: '', variantLabel: 'model.gguf', format: '', totalSizeBytes: '0', license: '', tags: [], downloads: '0',
    likes: '0', lastModified: '', verified: false, installed: false, installable: false, editorialReason: '', author: '',
    downloadSizeBytes: '0',
  });
  assert.equal('downloadSizeBytes' in unknown, false);
});

test('featured source observation preserves refreshInProgress only when active', () => {
  const refreshing = projectNimiRuntimeModelAssetSourceObservation({
    availability: ModelAssetSourceAvailability.AVAILABLE,
    freshness: ModelAssetSourceFreshness.STALE,
    generation: '11111111-1111-4111-8111-111111111111',
    reasonCode: ReasonCode.AI_REMOTE_MODEL_CATALOG_STALE,
    refreshInProgress: true,
  });
  assert.equal(refreshing.refreshInProgress, true);
  assert.equal(refreshing.freshness, 'stale');

  const settled = projectNimiRuntimeModelAssetSourceObservation({
    availability: ModelAssetSourceAvailability.AVAILABLE,
    freshness: ModelAssetSourceFreshness.FRESH,
    generation: '22222222-2222-4222-8222-222222222222',
    reasonCode: ReasonCode.REASON_CODE_UNSPECIFIED,
    refreshInProgress: false,
  });
  assert.equal('refreshInProgress' in settled, false);
});
