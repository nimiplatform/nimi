import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createGeneratedDescriptorDryRunReport,
  validateCatalogDocument,
  validateGeneratedDescriptorDryRunReport,
} from './check-nimi-app-descriptor-admission.mjs';

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

const generatedArtifactEvidence = {
  evidenceVersion: 1,
  evidenceRole: 'developer-submitted-input',
  generatedBy: '@nimiplatform/app-tools',
  packageName: 'acme-widget',
  appVersion: '0.1.0',
  tauriIdentifier: 'ai.nimi.apps.acme.widget',
  entryRef: 'dist/index.html',
  manifestPath: 'nimi.app.yaml',
  admissionRequestPath: '.nimi/admission/submission.yaml',
  buildProfileRef: '.nimi/admission/build-profile.yaml',
  artifact: {
    role: 'renderer-entry',
    path: 'dist/index.html',
    mediaType: 'text/html',
    sizeBytes: 1024,
    sha256: '6f1ed002ab5595859014ebf0951522d9b604294d9ad9e4d12d85bc8f0d0bb8a1',
  },
  publicAdmissionTruth: 'not-generated',
  releaseDescriptorTruth: 'not-generated',
  ordinaryVisibilityTruth: 'not-generated',
  permissionGrantTruth: 'not-generated',
  signingTruth: 'not-generated',
  notarizationTruth: 'not-generated',
  mirrorLicenseClearanceTruth: 'not-generated',
  productReadinessClaimAllowed: false,
};

test('generated artifact evidence dry-run remains descriptor review input only', () => {
  const report = createGeneratedDescriptorDryRunReport(generatedArtifactEvidence);
  assert.equal(report.dryRunRole, 'descriptor-review-input');
  assert.equal(report.admissionTrack, 'admission-sandbox-ci');
  assert.equal(report.ordinaryCatalogDiscovery, false);
  assert.equal(report.productReadinessClaimAllowed, false);
  assert.equal(report.artifact.sha256, generatedArtifactEvidence.artifact.sha256);
  assert.equal(report.artifact.sizeBytes, 1024);
  assert.ok(report.missingOrdinaryReleaseProofFields.includes('admitted ordinary-visible registry row'));
  assert.ok(report.missingOrdinaryReleaseProofFields.includes('platform signing and notarization evidence'));
  assert.deepEqual(validateGeneratedDescriptorDryRunReport(report), []);
});

test('generated descriptor dry-run rejects product readiness claims', () => {
  const cases = [
    {
      mutate(report) {
        report.registryAdmissionTruth = 'admitted';
      },
      pattern: /registryAdmissionTruth/,
    },
    {
      mutate(report) {
        report.releaseDescriptorTruth = 'admitted';
      },
      pattern: /releaseDescriptorTruth/,
    },
    {
      mutate(report) {
        report.ordinaryCatalogDiscovery = true;
      },
      pattern: /ordinaryCatalogDiscovery/,
    },
    {
      mutate(report) {
        report.productReadinessClaimAllowed = true;
      },
      pattern: /productReadinessClaimAllowed/,
    },
    {
      mutate(report) {
        report.signingTruth = 'signed';
      },
      pattern: /signingTruth/,
    },
    {
      mutate(report) {
        report.notarizationTruth = 'notarized';
      },
      pattern: /notarizationTruth/,
    },
    {
      mutate(report) {
        report.mirrorLicenseClearanceTruth = 'cleared';
      },
      pattern: /mirrorLicenseClearanceTruth/,
    },
    {
      mutate(report) {
        report.supportApprovalTruth = 'approved';
      },
      pattern: /supportApprovalTruth/,
    },
    {
      mutate(report) {
        report.reviewDecisionTruth = 'approved';
      },
      pattern: /reviewDecisionTruth/,
    },
  ];

  for (const testCase of cases) {
    const report = createGeneratedDescriptorDryRunReport(generatedArtifactEvidence);
    testCase.mutate(report);
    assert.ok(
      validateGeneratedDescriptorDryRunReport(report).some((failure) => testCase.pattern.test(failure)),
      JSON.stringify(report),
    );
  }
});

test('generated descriptor dry-run rejects source evidence that claims product truth', () => {
  const evidence = structuredClone(generatedArtifactEvidence);
  evidence.productReadinessClaimAllowed = true;
  assert.throws(
    () => createGeneratedDescriptorDryRunReport(evidence),
    /generated artifact evidence must keep productReadinessClaimAllowed=false/,
  );
});
