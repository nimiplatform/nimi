import assert from 'node:assert/strict';
import test from 'node:test';
import YAML from 'yaml';

import {
  authorityPaths,
  loadAuthorityBundle,
  validateLocalDevelopmentAuthority,
} from './check-local-development-admission-authority.mjs';

test('local-development admission authority is complete and internally bounded', () => {
  assert.deepEqual(validateLocalDevelopmentAuthority(loadAuthorityBundle()), []);
});

test('gate rejects adoption-only privilege and production trust conversion', () => {
  const bundle = loadAuthorityBundle();
  const policy = YAML.parse(bundle.policy);
  policy.trust_class.adoption_alone_authorizes = true;
  policy.trust_class.production_release_conversion = 'allowed';
  const issues = validateLocalDevelopmentAuthority({ ...bundle, policy: YAML.stringify(policy) });
  assert.ok(issues.some((entry) => entry.code === 'LOCAL_DEVELOPMENT_TRUST_CLASS_INVALID'));
});

test('gate rejects session leakage and weak transport fallbacks', () => {
  const bundle = loadAuthorityBundle();
  const policy = YAML.parse(bundle.policy);
  policy.technical_session.cli_visibility = 'allowed';
  policy.platform_posture.localhost_grpc_fallback = 'allowed';
  const issues = validateLocalDevelopmentAuthority({ ...bundle, policy: YAML.stringify(policy) });
  assert.ok(issues.some((entry) => entry.code === 'LOCAL_DEVELOPMENT_TECHNICAL_SESSION_INVALID'));
  assert.ok(issues.some((entry) => entry.code === 'LOCAL_DEVELOPMENT_PLATFORM_POSTURE_INVALID'));
});

test('gate rejects missing owner and reapproval rules', () => {
  const bundle = loadAuthorityBundle();
  const policy = YAML.parse(bundle.policy);
  policy.rows = policy.rows.filter((row) => row.owner_id !== 'desktop');
  policy.reapproval_matrix.reapprove_or_reject = [];
  const issues = validateLocalDevelopmentAuthority({ ...bundle, policy: YAML.stringify(policy) });
  assert.ok(issues.some((entry) => entry.code === 'LOCAL_DEVELOPMENT_OWNER_BOUNDARY_INVALID'));
  assert.ok(issues.some((entry) => entry.code === 'LOCAL_DEVELOPMENT_REAPPROVAL_MATRIX_INVALID'));
});

test('authority paths remain canonical spec files', () => {
  for (const relative of Object.values(authorityPaths)) {
    assert.match(relative, /^\.nimi\/spec\//);
  }
});
