import assert from 'node:assert/strict';
import test from 'node:test';

import { validateCatalogDocument } from './check-nimi-app-descriptor-admission.mjs';

const sandboxDescriptorDoc = {
  descriptors: [
    {
      descriptor_id: 'community.nimi.fixture.platform-proof.0.1.0-sandbox',
      app_id: 'community.nimi.fixture.platform-proof',
      version: '0.1.0-sandbox',
      admission_track: 'admission-sandbox-ci',
      descriptor_class: 'external-immutable-artifact',
      publisher: {
        github_namespace: 'github.com/nimiplatform-fixtures',
        namespace_kind: 'org',
        identity_assurance: 'domain-verified',
        verified_domain: 'fixtures.nimi.test',
        kyc_verification_ref: 'ci-kyc-deferred',
      },
      source: {
        kind: 'admission-sandbox-https-artifact',
        ref: 'https://fixtures.nimi.test/releases/platform-proof/0.1.0-sandbox/app.tgz',
      },
      artifact: {
        locator: 'https://fixtures.nimi.test/releases/platform-proof/0.1.0-sandbox/app.tgz',
        digest_algorithm: 'sha256',
        sha256: '6f1ed002ab5595859014ebf0951522d9b604294d9ad9e4d12d85bc8f0d0bb8a1',
        size: {
          download: '1024',
          installed: '4096',
          user_data: '2048',
          cache: '512',
          shared_deps: '0',
        },
        signature_or_provenance_ref: 'ci-provenance/platform-proof/0.1.0-sandbox',
      },
      artifact_mirror_ref: 'nimi-ci-mirror://platform-proof/0.1.0-sandbox',
      mirror_license_cleared: true,
      build_assurance: 'reproducible-build',
      dependency_assurance: 'lockfile-and-scanner-evidence',
      platform_signing_assurance: {
        macos_notarization: 'not-required-internal',
        macos_developer_id_subject: 'not-required-internal',
        windows_code_signing: 'not-required-internal',
        installer_signature: 'not-required-internal',
        entitlements_ref: 'ci-entitlements/platform-proof',
        signing_subject: 'nimi',
      },
      runtime: {
        package_kind: 'nimi-app',
        entry_ref: 'dist/index.html',
        sandbox_ref: 'installed-nimi-app-standard-shell-v1',
      },
      permissions_ref: 'community.nimi.fixture.platform-proof.permission_scope_ref',
      storage_policy_ref: {
        id: 'nimi-data-app-roots',
        kind: 'nimi-mediated-default',
      },
      update_channel_ref: 'platform-proof-sandbox-channel',
      rollback_eligibility: 'previous-admitted-descriptor',
      review: {
        admission_path: 'admission-sandbox-ci',
        mutable_source_allowed: false,
        install_digest_verification_required: 'required',
        decision: 'approved',
        adjudicator_kind: 'platform-review-bot',
        adjudicator_ref: 'ci/platform-proof',
        decided_at: '2026-06-30T00:00:00Z',
      },
      support: {
        diagnostics_bundle_fields: ['runtime', 'storage'],
        redaction_rules: ['strip-account-token'],
        user_visible_issue_categories: ['launch-failed'],
        escalation_path: 'ci-fixture-support',
        kill_switch_visibility: 'developer-only',
        recovery_instructions: ['reinstall'],
      },
      source_rule: 'P-NAPP-033',
    },
  ],
};

test('descriptor admission guard accepts sandbox CI track descriptor', () => {
  assert.deepEqual(validateCatalogDocument(sandboxDescriptorDoc), []);
});

test('descriptor admission guard rejects ordinary release using sandbox source kind', () => {
  const doc = structuredClone(sandboxDescriptorDoc);
  doc.descriptors[0].admission_track = 'ordinary-release-proof';
  const failures = validateCatalogDocument(doc);
  assert.ok(failures.some((failure) => failure.includes('ordinary-release-proof cannot use admission-sandbox-https-artifact')));
});

test('descriptor admission guard rejects collapsed version and review date', () => {
  const doc = structuredClone(sandboxDescriptorDoc);
  doc.descriptors[0].version = 'latest';
  doc.descriptors[0].review.decided_at = 'today';
  const failures = validateCatalogDocument(doc);
  assert.ok(failures.some((failure) => failure.includes('version must be exact semantic version')));
  assert.ok(failures.some((failure) => failure.includes('review.decided_at must be RFC3339 timestamp')));
});

test('descriptor admission guard rejects missing storage policy kind', () => {
  const doc = structuredClone(sandboxDescriptorDoc);
  delete doc.descriptors[0].storage_policy_ref.kind;
  const failures = validateCatalogDocument(doc);
  assert.ok(failures.some((failure) => failure.includes('storage_policy_ref.kind')));
});

test('descriptor admission guard rejects os storage disclosure on nimi-mediated storage', () => {
  const doc = structuredClone(sandboxDescriptorDoc);
  doc.descriptors[0].os_storage_disclosure = [{
    path_pattern: '%APPDATA%/fixture',
    purpose: 'fixture test data',
    expected_size_band: 'tiny',
  }];
  const failures = validateCatalogDocument(doc);
  assert.ok(failures.some((failure) => failure.includes('os_storage_disclosure')));
});
