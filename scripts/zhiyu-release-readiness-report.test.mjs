import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const scriptPath = path.join(repoRoot, 'scripts', 'zhiyu-release-readiness-report.mjs');

async function loadReporter() {
  return import(`${pathToFileURL(scriptPath).href}?cacheBust=${Date.now()}`);
}

function baseEvidence() {
  return {
    evidenceVersion: 1,
    checkpoint: 'PP12',
    evidenceRole: 'developer-submitted-input',
    admissionTrack: 'preparation',
    generatedBy: '@nimiplatform/zhiyu pack:release-evidence',
    packageName: '@nimiplatform/zhiyu',
    packageVersion: '0.1.0',
    entryRefs: [
      'dist/index.html',
      'dist-electron/main.js',
    ],
    artifact: {
      role: 'zhiyu-local-build-output',
      path: '.nimi/local/evidence/zhiyu/pp12/nimiplatform-zhiyu-0.1.0-local-preparation.tar',
      digest_algorithm: 'sha256',
      sha256: '4c754f83e1e110c3f53ef8b66de218598a598c4f1d0c921d74ec4e29cfdb15b4',
      size: {
        download: '2954240',
        installed: '2946706',
        user_data: 'not-generated',
        cache: 'not-generated',
        shared_deps: 'not-generated',
      },
      files: [
        {
          path: 'dist/index.html',
          sha256: 'dd2593930c88e4d8dc6560cbf82208b47dd5ccd8acde453f8daa161caacebaad',
          size: '402',
        },
        {
          path: 'dist-electron/main.js',
          sha256: '1976e4f1ca21bf4feaeebf01b74f1a9398a6a188625fe6d2567e9c0c102ee4fc',
          size: '4666',
        },
      ],
    },
    missingPlatformAdmissionFields: [
      'admitted registry row',
      'admitted release descriptor row',
      'permission scope ref set',
      'storage policy ref',
      'capability refs',
      'artifact provenance and signing assurance',
      'platform review decision',
      'support and rollback posture',
      'ordinary or developer visibility decision',
    ],
    registryAdmissionTruth: 'not-generated',
    releaseDescriptorTruth: 'not-generated',
    ordinaryVisibilityTruth: 'not-generated',
    permissionGrantTruth: 'not-generated',
    signingTruth: 'not-generated',
    notarizationTruth: 'not-generated',
    mirrorLicenseClearanceTruth: 'not-generated',
    supportApprovalTruth: 'not-generated',
    reviewDecisionTruth: 'not-generated',
    productReadinessClaimAllowed: false,
    ordinaryCatalogDiscovery: false,
  };
}

function r1PermissionScopeRef() {
  return [
    {
      appId: 'nimi.zhiyu',
      scopeFamily: 'account',
      scopeName: 'account.session.read',
    },
    {
      appId: 'nimi.zhiyu',
      scopeFamily: 'agent',
      scopeName: 'agent.identity.project',
    },
    {
      appId: 'nimi.zhiyu',
      scopeFamily: 'ai_spend',
      scopeName: 'ai.spend.meter',
    },
    {
      appId: 'nimi.zhiyu',
      scopeFamily: 'ai_profile',
      scopeName: 'ai_profile.selection.consume',
    },
    {
      appId: 'nimi.zhiyu',
      scopeFamily: 'memory',
      scopeName: 'memory.read.bounded',
      qualifier: 'persona-scoped',
    },
    {
      appId: 'nimi.zhiyu',
      scopeFamily: 'memory',
      scopeName: 'memory.write.admitted',
      qualifier: 'session-scoped-chat-derived-projection',
    },
    {
      appId: 'nimi.zhiyu',
      scopeFamily: 'notification',
      scopeName: 'notification.subscribe',
      qualifier: 'proactive_interruptibility_v1.in_app_surface',
    },
    {
      appId: 'nimi.zhiyu',
      scopeFamily: 'audit',
      scopeName: 'audit.read.scoped',
      qualifier: 'zhiyu-own-audit-projections',
    },
  ];
}

function r1RegistryDoc() {
  return {
    apps: [
      {
        app_id: 'nimi.zhiyu',
        display_label: 'Zhiyu',
        publisher: 'nimi-first-party',
        trust_tier_ref: 'nimi-first-party',
        package_kind: 'nimi-app',
        package_signature_policy_ref: 'nimi-first-party-signature-policy',
        update_channel_ref: 'stable',
        ai_profile_selection_ref: 'local-standard',
        capability_set_refs: ['text.generate'],
        local_compute_pack_refs: ['local-text'],
        runtime_registration_mode: 'app-managed',
        permission_scope_ref: r1PermissionScopeRef(),
        health_repair_projection: [
          'unavailable',
          'setup-required',
          'needs-confirmation',
          'in-progress',
          'failed',
          'unsupported',
          'repair-required',
          'stale-projection',
        ],
        ordinary_visibility: 'developer-only',
        release_descriptor_ref: 'nimi.zhiyu.bundled-with-nimi',
        install_storage_policy_ref: 'nimi-data-app-roots',
        source_repo_url: null,
        admission_status: 'admitted',
        source_rule: 'P-NAPP-011',
      },
    ],
  };
}

function r1DescriptorDoc() {
  return {
    descriptors: [
      {
        descriptor_id: 'nimi.zhiyu.bundled-with-nimi',
        app_id: 'nimi.zhiyu',
        version: 'bundled-with-current-nimi-release',
        descriptor_class: 'bundled-with-nimi',
        source: {
          kind: 'nimi-bundle',
          ref: 'current-atomic-nimi-release',
        },
        artifact: {
          locator: 'current-nimi-release-bundle',
          digest_algorithm: 'sha256',
          sha256: 'inherited-from-atomic-nimi-release-manifest',
          size: 'inherited-from-atomic-nimi-release-manifest',
          signature_or_provenance_ref: 'nimi-first-party-signature-policy',
        },
        runtime: {
          package_kind: 'nimi-app',
          entry_ref: 'zhiyu-runtime-registration',
          sandbox_ref: 'first-party-bundled-app',
        },
        permissions_ref: 'nimi.zhiyu.permission_scope_ref',
        storage_policy_ref: 'nimi-data-app-roots',
        review: {
          admission_path: 'first-party-bundled-release',
          mutable_source_allowed: false,
          install_digest_verification_required: 'inherited_from_atomic_bundle',
        },
        source_rule: 'P-NAPP-014',
      },
    ],
  };
}

test('Zhiyu readiness report blocks PP12 while preserving preparation-only artifact evidence', async () => {
  const { createZhiyuReleaseReadinessReport, validateZhiyuPreparationEvidence } = await loadReporter();
  const evidence = baseEvidence();
  assert.deepEqual(validateZhiyuPreparationEvidence(evidence), []);

  const report = createZhiyuReleaseReadinessReport({
    evidence,
    registryDoc: { apps: [] },
    descriptorDoc: { descriptors: [] },
  });

  assert.equal(report.checkpoint, 'PP12');
  assert.equal(report.unblockTrack, 'PP12U2-release-readiness-report');
  assert.equal(report.appId, 'nimi.zhiyu');
  assert.equal(report.readinessStatus, 'blocked');
  assert.equal(report.productReadinessClaimAllowed, false);
  assert.equal(report.ordinaryCatalogDiscovery, false);
  assert.equal(report.platformRows.registryRowPresent, false);
  assert.equal(report.platformRows.releaseDescriptorPresent, false);
  assert.equal(report.platformTruth.registryAdmissionTruth, 'not-generated');
  assert.equal(report.platformTruth.releaseDescriptorTruth, 'not-generated');
  assert.equal(report.artifact.sha256, evidence.artifact.sha256);
  assert.equal(report.artifact.size.download, evidence.artifact.size.download);
  assert.ok(report.missingPlatformAdmissionFields.includes('admitted registry row'));
  assert.ok(report.missingPlatformAdmissionFields.includes('admitted release descriptor row'));
  assert.ok(report.missingPlatformAdmissionFields.includes('permission scope ref set'));
  assert.ok(report.nextRequiredDecisions.includes('first admission target'));
});

test('Zhiyu readiness report recognizes approved R1 developer-only bundled Platform admission', async () => {
  const { createZhiyuReleaseReadinessReport } = await loadReporter();

  const report = createZhiyuReleaseReadinessReport({
    evidence: baseEvidence(),
    registryDoc: r1RegistryDoc(),
    descriptorDoc: r1DescriptorDoc(),
  });

  assert.equal(report.readinessStatus, 'r1-platform-admitted');
  assert.equal(report.productReadinessClaimAllowed, false);
  assert.equal(report.ordinaryCatalogDiscovery, false);
  assert.equal(report.platformRows.registryRowPresent, true);
  assert.equal(report.platformRows.admittedRegistryRowPresent, true);
  assert.equal(report.platformRows.releaseDescriptorPresent, true);
  assert.equal(report.platformTruth.registryAdmissionTruth, 'admitted');
  assert.equal(report.platformTruth.releaseDescriptorTruth, 'admitted-first-party-bundled');
  assert.equal(report.platformTruth.ordinaryVisibilityTruth, 'developer-only');
  assert.equal(report.platformTruth.permissionGrantTruth, 'bounded-r1-scope-set');
  assert.equal(report.platformTruth.signingTruth, 'inherited-from-atomic-bundle');
  assert.equal(report.platformTruth.notarizationTruth, 'ordinary-release-deferred');
  assert.deepEqual(report.missingPlatformAdmissionFields, []);
  assert.ok(report.deferredOrdinaryReleaseFields.includes('ordinary-visible registry row'));
});

test('Zhiyu readiness report rejects preparation evidence that claims admission truth', async () => {
  const { validateZhiyuPreparationEvidence } = await loadReporter();
  const evidence = baseEvidence();
  evidence.registryAdmissionTruth = 'admitted';
  evidence.productReadinessClaimAllowed = true;

  const failures = validateZhiyuPreparationEvidence(evidence);
  assert.ok(failures.some((failure) => /registryAdmissionTruth/.test(failure)));
  assert.ok(failures.some((failure) => /productReadinessClaimAllowed/.test(failure)));
});

test('Zhiyu readiness report CLI writes a local report from evidence and Platform tables', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'zhiyu-release-readiness-'));
  const evidencePath = path.join(tempDir, 'evidence.json');
  const registryPath = path.join(tempDir, 'registry.yaml');
  const descriptorPath = path.join(tempDir, 'descriptors.yaml');
  const reportPath = path.join(tempDir, 'readiness-report.json');

  fs.writeFileSync(evidencePath, `${JSON.stringify(baseEvidence(), null, 2)}\n`);
  fs.writeFileSync(registryPath, 'version: 1\napps: []\n');
  fs.writeFileSync(descriptorPath, 'version: 1\ndescriptors: []\n');

  const result = spawnSync(process.execPath, [
    scriptPath,
    '--evidence',
    evidencePath,
    '--registry',
    registryPath,
    '--descriptors',
    descriptorPath,
    '--out',
    reportPath,
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  assert.equal(report.readinessStatus, 'blocked');
  assert.equal(report.artifact.sha256, baseEvidence().artifact.sha256);
  assert.ok(report.missingPlatformAdmissionFields.includes('ordinary or developer visibility decision'));
});
