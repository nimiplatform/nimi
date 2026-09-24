import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LocalRecommendationApplicability,
  ReasonCode,
} from '../core-generated/runtime-typed-client.js';
import {
  projectNimiRuntimeFactoryProfileRecommendation,
  projectNimiRuntimeModelAssetMarketCandidate,
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
