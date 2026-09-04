import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LocalRecommendationApplicability,
  ReasonCode,
} from '../core-generated/runtime-typed-client.js';
import {
  projectNimiRuntimeFactoryProfileRecommendation,
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
