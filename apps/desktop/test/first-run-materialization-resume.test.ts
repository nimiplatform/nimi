import assert from 'node:assert/strict';
import test from 'node:test';

import {
  shouldResumeConfirmedFirstRunMaterialization,
  type FirstRunMaterializationProjection,
} from '../src/shell/renderer/first-run/runtime-materialization.js';

function projection(status: FirstRunMaterializationProjection['status']): FirstRunMaterializationProjection {
  return {
    status,
    productState: 'local_ai_profile_selected_assets_missing',
    reason: 'test',
    missingDependencyFamilies: [],
    dependencies: [],
  };
}

test('confirmed first-run setup resumes startable materialization after restart', () => {
  assert.equal(
    shouldResumeConfirmedFirstRunMaterialization(
      'local_ai_profile_selected_assets_missing',
      projection('needs_confirmation'),
    ),
    true,
  );
  assert.equal(
    shouldResumeConfirmedFirstRunMaterialization(
      'local_ai_profile_selected_environment_not_ready',
      projection('needs_confirmation'),
    ),
    true,
  );
  assert.equal(
    shouldResumeConfirmedFirstRunMaterialization(
      'local_ai_assets_downloaded_environment_not_ready',
      projection('needs_confirmation'),
    ),
    true,
  );
});

test('first-run materialization resume does not run before setup confirmation or after readiness', () => {
  assert.equal(
    shouldResumeConfirmedFirstRunMaterialization(
      'ai_environment_unconfigured',
      projection('needs_confirmation'),
    ),
    false,
  );
  assert.equal(
    shouldResumeConfirmedFirstRunMaterialization(
      'local_ai_profile_selected_assets_missing',
      projection('local_ai_ready'),
    ),
    false,
  );
});
