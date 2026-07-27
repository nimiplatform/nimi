import assert from 'node:assert/strict';
import test from 'node:test';

import { validateCatalogDocument } from './check-nimi-app-descriptor-admission.mjs';

const ordinaryDescriptorDoc = {
  descriptors: [
    {
      descriptor_id: 'community.nimi.example.viewer.1.2.3',
      app_id: 'community.nimi.example.viewer',
      version: '1.2.3',
      admission_track: 'ordinary-release-proof',
      descriptor_class: 'external-immutable-artifact',
      publisher: {
        github_namespace: 'github.com/example-org',
        namespace_kind: 'org',
        identity_assurance: 'domain-verified',
        verified_domain: 'example.com',
        kyc_verification_ref: 'not-required',
      },
      source: {
        kind: 'github-release',
        ref: 'github.com/example-org/viewer/releases/download/v1.2.3/viewer.tgz',
      },
      artifact: {
        locator: 'https://github.com/example-org/viewer/releases/download/v1.2.3/viewer.tgz',
        digest_algorithm: 'sha256',
        sha256: '6f1ed002ab5595859014ebf0951522d9b604294d9ad9e4d12d85bc8f0d0bb8a1', // pragma: allowlist secret -- public fixture digest
        size: {
          download: '1024',
          installed: '4096',
          user_data: '2048',
          cache: '512',
          shared_deps: '0',
        },
        signature_or_provenance_ref: 'release-signature/viewer/1.2.3',
      },
      artifact_mirror_ref: 'nimi-mirror://community.nimi.example.viewer/1.2.3',
      mirror_license_cleared: true,
      build_assurance: 'signed-release-artifact',
      dependency_assurance: 'locked-dependencies',
      platform_signing_assurance: {
        macos_notarization: 'notarized',
        macos_developer_id_subject: 'Developer ID Application: Example Org',
        windows_code_signing: 'signed',
        installer_signature: 'signed',
        entitlements_ref: 'release-entitlements/viewer',
        signing_subject: 'Example Org',
      },
      runtime: {
        package_kind: 'nimi-app',
        entry_ref: 'dist/index.html',
        sandbox_ref: 'installed-nimi-app-standard-shell-v1',
      },
      permissions_ref: 'community.nimi.example.viewer.permission_scope_ref',
      storage_policy_ref: {
        id: 'nimi-data-app-roots',
        kind: 'nimi-mediated-default',
      },
      update_channel_ref: 'viewer-stable',
      rollback_eligibility: 'previous-admitted-descriptor',
      review: {
        admission_path: 'ordinary-release-proof',
        mutable_source_allowed: false,
        install_digest_verification_required: 'required',
        decision: 'approved',
        adjudicator_kind: 'platform-review',
        adjudicator_ref: 'review/community.nimi.example.viewer/1.2.3',
        decided_at: '2026-06-30T00:00:00Z',
      },
      support: {
        diagnostics_bundle_fields: ['runtime', 'storage'],
        redaction_rules: ['strip-account-token'],
        user_visible_issue_categories: ['launch-failed'],
        escalation_path: 'publisher-support',
        kill_switch_visibility: 'platform-and-publisher',
        recovery_instructions: ['reinstall'],
      },
      source_rule: 'P-NAPP-033',
    },
  ],
};

test('descriptor admission guard accepts an ordinary immutable release descriptor', () => {
  assert.deepEqual(validateCatalogDocument(ordinaryDescriptorDoc), []);
});

test('descriptor admission guard rejects non-release tracks and source kinds', () => {
  const doc = structuredClone(ordinaryDescriptorDoc);
  doc.descriptors[0].admission_track = 'unsupported-track';
  doc.descriptors[0].source.kind = 'unsupported-source';
  const failures = validateCatalogDocument(doc);
  assert.ok(failures.some((failure) => failure.includes('source.kind is not admitted')));
  assert.ok(failures.some((failure) => failure.includes('admission_track is not admitted')));
});

test('descriptor admission guard rejects collapsed version and review date', () => {
  const doc = structuredClone(ordinaryDescriptorDoc);
  doc.descriptors[0].version = 'latest';
  doc.descriptors[0].review.decided_at = 'today';
  const failures = validateCatalogDocument(doc);
  assert.ok(failures.some((failure) => failure.includes('version must be exact semantic version')));
  assert.ok(failures.some((failure) => failure.includes('review.decided_at must be RFC3339 timestamp')));
});

test('descriptor admission guard rejects missing storage policy kind', () => {
  const doc = structuredClone(ordinaryDescriptorDoc);
  delete doc.descriptors[0].storage_policy_ref.kind;
  const failures = validateCatalogDocument(doc);
  assert.ok(failures.some((failure) => failure.includes('storage_policy_ref.kind')));
});

test('descriptor admission guard rejects os storage disclosure on nimi-mediated storage', () => {
  const doc = structuredClone(ordinaryDescriptorDoc);
  doc.descriptors[0].os_storage_disclosure = [{
    path_pattern: '%APPDATA%/viewer',
    purpose: 'viewer data',
    expected_size_band: 'tiny',
  }];
  const failures = validateCatalogDocument(doc);
  assert.ok(failures.some((failure) => failure.includes('os_storage_disclosure')));
});
