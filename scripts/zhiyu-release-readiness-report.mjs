#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import YAML from 'yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

const defaultEvidencePath = path.join(
  repoRoot,
  '.nimi/local/evidence/zhiyu/pp12/zhiyu-release-artifact-evidence.json',
);
const defaultRegistryPath = path.join(repoRoot, '.nimi/spec/platform/kernel/tables/nimi-app-registry.yaml');
const defaultDescriptorPath = path.join(repoRoot, '.nimi/spec/platform/kernel/tables/nimi-app-release-descriptors.yaml');
const defaultOutputPath = path.join(
  repoRoot,
  '.nimi/local/evidence/zhiyu/pp12/zhiyu-release-readiness-report.json',
);

const DEFAULT_APP_ID = 'nimi.zhiyu';
const R1_DESCRIPTOR_ID = 'nimi.zhiyu.bundled-with-nimi';
const R1_ADMISSION_TRACK = 'first-party-bundled-developer-only';

const PREPARATION_TRUTH_FIELDS = Object.freeze([
  'registryAdmissionTruth',
  'releaseDescriptorTruth',
  'ordinaryVisibilityTruth',
  'permissionDecisionTruth',
  'signingTruth',
  'notarizationTruth',
  'mirrorLicenseClearanceTruth',
  'supportApprovalTruth',
  'reviewDecisionTruth',
]);

const REQUIRED_MISSING_FIELDS = Object.freeze([
  'admitted registry row',
  'admitted release descriptor row',
  'public permission requirements set',
  'storage policy ref',
  'capability refs',
  'artifact provenance and signing assurance',
  'platform review decision',
  'support and rollback posture',
  'ordinary or developer visibility decision',
]);

const NEXT_REQUIRED_DECISIONS = Object.freeze([
  'first admission target',
  'public permission requirements set',
  'storage policy ref',
  'canonical capability refs',
  'release descriptor and registry row admission',
  'artifact provenance, signing, and notarization posture',
  'Platform review decision',
  'support and rollback posture',
  'ordinary or developer visibility posture',
]);

const DEFERRED_ORDINARY_RELEASE_FIELDS = Object.freeze([
  'ordinary-visible registry row',
  'ordinary Apps catalog discovery',
  'ordinary product readiness claim',
  'external immutable artifact release trust',
  'platform signing and notarization evidence for ordinary release',
  'ordinary support SLA and rollback posture',
]);

const R1_HEALTH_REPAIR_PROJECTION = Object.freeze([
  'unavailable',
  'setup-required',
  'needs-confirmation',
  'in-progress',
  'failed',
  'unsupported',
  'repair-required',
  'stale-projection',
]);

export function validateZhiyuPreparationEvidence(evidence) {
  const failures = [];
  if (stringValue(evidence?.checkpoint) !== 'PP12') {
    failures.push('checkpoint must be PP12');
  }
  if (stringValue(evidence?.evidenceRole) !== 'developer-submitted-input') {
    failures.push('evidenceRole must be developer-submitted-input');
  }
  if (stringValue(evidence?.admissionTrack) !== 'preparation') {
    failures.push('admissionTrack must be preparation');
  }
  if (evidence?.productReadinessClaimAllowed !== false) {
    failures.push('productReadinessClaimAllowed must be false');
  }
  if (evidence?.ordinaryCatalogDiscovery !== false) {
    failures.push('ordinaryCatalogDiscovery must be false');
  }
  for (const field of PREPARATION_TRUTH_FIELDS) {
    if (evidence?.[field] !== 'not-generated') {
      failures.push(`${field} must be not-generated`);
    }
  }
  if (!Array.isArray(evidence?.entryRefs) || evidence.entryRefs.map(stringValue).filter(Boolean).length === 0) {
    failures.push('entryRefs must list built entry points');
  }
  const artifact = evidence?.artifact || {};
  if (!stringValue(artifact.path)) {
    failures.push('artifact.path is required');
  }
  if (stringValue(artifact.digest_algorithm) !== 'sha256') {
    failures.push('artifact.digest_algorithm must be sha256');
  }
  if (!/^[a-f0-9]{64}$/i.test(stringValue(artifact.sha256))) {
    failures.push('artifact.sha256 must be sha256 hex');
  }
  for (const field of ['download', 'installed']) {
    if (!positiveIntegerString(artifact?.size?.[field])) {
      failures.push(`artifact.size.${field} must be a positive integer string`);
    }
  }
  for (const field of ['user_data', 'cache', 'shared_deps']) {
    if (artifact?.size?.[field] !== 'not-generated') {
      failures.push(`artifact.size.${field} must be not-generated`);
    }
  }
  const artifactFiles = Array.isArray(artifact.files) ? artifact.files : [];
  const artifactFilePaths = new Set(artifactFiles.map((file) => stringValue(file?.path)).filter(Boolean));
  for (const entryRef of evidence?.entryRefs || []) {
    if (!artifactFilePaths.has(stringValue(entryRef))) {
      failures.push(`artifact.files must include entryRef ${stringValue(entryRef)}`);
    }
  }
  if (!Array.isArray(evidence?.missingPlatformAdmissionFields) || evidence.missingPlatformAdmissionFields.length === 0) {
    failures.push('missingPlatformAdmissionFields must list Platform admission gaps');
  }
  return failures;
}

export function createZhiyuReleaseReadinessReport({
  evidence,
  registryDoc,
  descriptorDoc,
  appId = DEFAULT_APP_ID,
} = {}) {
  const evidenceFailures = validateZhiyuPreparationEvidence(evidence);
  if (evidenceFailures.length > 0) {
    throw new Error(evidenceFailures.join('; '));
  }

  const registryRows = asArray(registryDoc?.apps).filter((row) => stringValue(row?.app_id) === appId);
  const descriptorRows = asArray(descriptorDoc?.descriptors).filter((row) => stringValue(row?.app_id) === appId);
  const admittedRegistryRows = registryRows.filter((row) => stringValue(row?.admission_status) === 'admitted');
  const descriptorRefs = registryRows.map((row) => stringValue(row?.release_descriptor_ref)).filter(Boolean);
  const descriptorIds = new Set(descriptorRows.map((row) => stringValue(row?.descriptor_id)).filter(Boolean));
  const releaseDescriptorPresent = descriptorRefs.some((ref) => descriptorIds.has(ref)) || descriptorRows.length > 0;
  const primaryRegistryRow = admittedRegistryRows[0] || registryRows[0];
  const primaryDescriptorRow = descriptorRows.find((row) => descriptorRefs.includes(stringValue(row?.descriptor_id)))
    || descriptorRows[0];
  const r1Admission = evaluateR1Admission({
    appId,
    registryRow: primaryRegistryRow,
    releaseDescriptorRow: primaryDescriptorRow,
  });

  const missingFields = deriveMissingPlatformFields(evidence, {
    admittedRegistryRow: primaryRegistryRow && stringValue(primaryRegistryRow.admission_status) === 'admitted'
      ? primaryRegistryRow
      : undefined,
    registryRow: primaryRegistryRow,
    releaseDescriptorRow: primaryDescriptorRow,
    releaseDescriptorPresent,
    r1Admission,
  });

  return {
    reportVersion: 1,
    checkpoint: 'PP12',
    unblockTrack: 'PP12U2-release-readiness-report',
    appId,
    generatedBy: 'scripts/zhiyu-release-readiness-report.mjs',
    readinessStatus: r1Admission.resolved ? 'r1-platform-admitted' : 'blocked',
    evidenceRole: evidence.evidenceRole,
    admissionTrack: r1Admission.resolved ? R1_ADMISSION_TRACK : evidence.admissionTrack,
    productReadinessClaimAllowed: false,
    ordinaryCatalogDiscovery: false,
    platformRows: {
      registryRowPresent: registryRows.length > 0,
      admittedRegistryRowPresent: admittedRegistryRows.length > 0,
      releaseDescriptorPresent,
      registryReleaseDescriptorRefs: descriptorRefs,
      releaseDescriptorIds: [...descriptorIds],
      ordinaryVisibility: stringValue(primaryRegistryRow?.ordinary_visibility) || 'not-generated',
      releaseDescriptorClass: stringValue(primaryDescriptorRow?.descriptor_class) || 'not-generated',
      capabilitySetRefs: asArray(primaryRegistryRow?.capability_set_refs).map(stringValue).filter(Boolean),
      localComputePackRefs: asArray(primaryRegistryRow?.local_compute_pack_refs).map(stringValue).filter(Boolean),
      permissionRequirementCount: asArray(primaryRegistryRow?.permission_requirements).length,
    },
    platformTruth: r1Admission.resolved
      ? createR1PlatformTruth()
      : Object.fromEntries(PREPARATION_TRUTH_FIELDS.map((field) => [field, evidence[field]])),
    r1Admission: {
      resolved: r1Admission.resolved,
      violations: r1Admission.violations,
    },
    artifact: {
      role: evidence.artifact.role,
      path: evidence.artifact.path,
      digest_algorithm: evidence.artifact.digest_algorithm,
      sha256: stringValue(evidence.artifact.sha256).toLowerCase(),
      size: {
        download: stringValue(evidence.artifact.size.download),
        installed: stringValue(evidence.artifact.size.installed),
        user_data: evidence.artifact.size.user_data,
        cache: evidence.artifact.size.cache,
        shared_deps: evidence.artifact.size.shared_deps,
      },
      entryRefs: [...evidence.entryRefs],
    },
    missingPlatformAdmissionFields: missingFields,
    nextRequiredDecisions: r1Admission.resolved ? [] : [...NEXT_REQUIRED_DECISIONS],
    deferredOrdinaryReleaseFields: [...DEFERRED_ORDINARY_RELEASE_FIELDS],
  };
}

function deriveMissingPlatformFields(evidence, context) {
  if (context.r1Admission?.resolved) {
    return [];
  }

  const missing = new Set();

  if (!context.admittedRegistryRow) {
    missing.add('admitted registry row');
  }
  if (!context.releaseDescriptorPresent) {
    missing.add('admitted release descriptor row');
  }
  if (!context.r1Admission?.checks?.permissionRequirements) {
    missing.add('public permission requirements set');
  }
  if (!context.r1Admission?.checks?.storagePolicy) {
    missing.add('storage policy ref');
  }
  if (!context.r1Admission?.checks?.capabilityRefs) {
    missing.add('capability refs');
  }
  if (!context.r1Admission?.checks?.artifactProvenanceAndSigning) {
    missing.add('artifact provenance and signing assurance');
  }
  if (!context.r1Admission?.checks?.review) {
    missing.add('platform review decision');
  }
  if (!context.r1Admission?.checks?.firstPartyBundledDescriptor) {
    missing.add('support and rollback posture');
  }
  if (!context.r1Admission?.checks?.developerVisibility) {
    missing.add('ordinary or developer visibility decision');
  }

  return REQUIRED_MISSING_FIELDS.filter((field) => missing.has(field));
}

function evaluateR1Admission({ appId, registryRow, releaseDescriptorRow }) {
  const expectedDescriptorId = appId === DEFAULT_APP_ID ? R1_DESCRIPTOR_ID : `${appId}.bundled-with-nimi`;
  const checks = {
    admittedRegistry: stringValue(registryRow?.admission_status) === 'admitted',
    firstPartyTrust: stringValue(registryRow?.publisher) === 'nimi-first-party'
      && stringValue(registryRow?.trust_tier_ref) === 'nimi-first-party'
      && stringValue(registryRow?.package_kind) === 'nimi-app'
      && stringValue(registryRow?.package_signature_policy_ref) === 'nimi-first-party-signature-policy'
      && stringValue(registryRow?.update_channel_ref) === 'stable',
    localTextPosture: stringValue(registryRow?.ai_profile_selection_ref) === 'local-standard'
      && sameStringSet(registryRow?.local_compute_pack_refs, ['local-text']),
    capabilityRefs: sameStringSet(registryRow?.capability_set_refs, ['text.generate']),
    runtimeRegistration: stringValue(registryRow?.runtime_registration_mode) === 'app-managed',
    permissionRequirements: Array.isArray(registryRow?.permission_requirements)
      && registryRow.permission_requirements.length === 0
      && stringValue(releaseDescriptorRow?.permissions_ref) === `${appId}.permission_requirements`,
    healthRepairProjection: sameStringSet(registryRow?.health_repair_projection, R1_HEALTH_REPAIR_PROJECTION),
    developerVisibility: stringValue(registryRow?.ordinary_visibility) === 'developer-only',
    releaseDescriptorRef: stringValue(registryRow?.release_descriptor_ref) === expectedDescriptorId
      && stringValue(releaseDescriptorRow?.descriptor_id) === expectedDescriptorId
      && stringValue(releaseDescriptorRow?.app_id) === appId,
    storagePolicy: stringValue(registryRow?.install_storage_policy_ref) === 'nimi-data-app-roots'
      && stringValue(releaseDescriptorRow?.storage_policy_ref) === 'nimi-data-app-roots',
    firstPartyBundledDescriptor: stringValue(releaseDescriptorRow?.descriptor_class) === 'bundled-with-nimi'
      && stringValue(releaseDescriptorRow?.source?.kind) === 'nimi-bundle'
      && stringValue(releaseDescriptorRow?.source?.ref) === 'current-atomic-nimi-release'
      && stringValue(releaseDescriptorRow?.runtime?.package_kind) === 'nimi-app'
      && stringValue(releaseDescriptorRow?.runtime?.entry_ref) === 'zhiyu-runtime-registration'
      && stringValue(releaseDescriptorRow?.runtime?.sandbox_ref) === 'first-party-bundled-app'
      && stringValue(releaseDescriptorRow?.source_rule) === 'P-NAPP-014',
    artifactProvenanceAndSigning: stringValue(releaseDescriptorRow?.artifact?.locator) === 'current-nimi-release-bundle'
      && stringValue(releaseDescriptorRow?.artifact?.digest_algorithm) === 'sha256'
      && stringValue(releaseDescriptorRow?.artifact?.sha256) === 'inherited-from-atomic-nimi-release-manifest'
      && stringValue(releaseDescriptorRow?.artifact?.size) === 'inherited-from-atomic-nimi-release-manifest'
      && stringValue(releaseDescriptorRow?.artifact?.signature_or_provenance_ref) === 'nimi-first-party-signature-policy',
    review: stringValue(releaseDescriptorRow?.review?.admission_path) === 'first-party-bundled-release'
      && releaseDescriptorRow?.review?.mutable_source_allowed === false
      && stringValue(releaseDescriptorRow?.review?.install_digest_verification_required) === 'inherited_from_atomic_bundle',
    sourceRule: stringValue(registryRow?.source_rule) === 'P-NAPP-011',
    noSourceRepoTrust: registryRow?.source_repo_url === null,
  };

  const violations = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);

  return {
    resolved: violations.length === 0,
    checks,
    violations,
  };
}

function createR1PlatformTruth() {
  return {
    registryAdmissionTruth: 'admitted',
    releaseDescriptorTruth: 'admitted-first-party-bundled',
    ordinaryVisibilityTruth: 'developer-only',
    permissionDecisionTruth: 'not-required-empty-public-permission-requirements',
    signingTruth: 'inherited-from-atomic-bundle',
    notarizationTruth: 'ordinary-release-deferred',
    mirrorLicenseClearanceTruth: 'not-applicable-first-party-bundle',
    supportApprovalTruth: 'ordinary-release-deferred',
    reviewDecisionTruth: 'first-party-bundled-release',
  };
}

function sameStringSet(values, expected) {
  const actualSet = new Set(asArray(values).map(stringValue).filter(Boolean));
  const expectedSet = new Set(asArray(expected).map(stringValue).filter(Boolean));
  if (actualSet.size !== expectedSet.size) return false;
  for (const value of expectedSet) {
    if (!actualSet.has(value)) return false;
  }
  return true;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function stringValue(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function positiveIntegerString(value) {
  return /^[1-9][0-9]*$/.test(stringValue(value));
}

function parseArgs(argv) {
  const options = {
    evidence: defaultEvidencePath,
    registry: defaultRegistryPath,
    descriptors: defaultDescriptorPath,
    out: defaultOutputPath,
    appId: DEFAULT_APP_ID,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--evidence') {
      options.evidence = path.resolve(process.cwd(), requiredArg(argv, ++index, arg));
    } else if (arg === '--registry') {
      options.registry = path.resolve(process.cwd(), requiredArg(argv, ++index, arg));
    } else if (arg === '--descriptors') {
      options.descriptors = path.resolve(process.cwd(), requiredArg(argv, ++index, arg));
    } else if (arg === '--out') {
      options.out = path.resolve(process.cwd(), requiredArg(argv, ++index, arg));
    } else if (arg === '--app-id') {
      options.appId = requiredArg(argv, ++index, arg);
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return options;
}

function requiredArg(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith('--')) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readYaml(filePath) {
  return YAML.parse(fs.readFileSync(filePath, 'utf8'));
}

function repoRelative(filePath) {
  return path.relative(repoRoot, filePath).replaceAll(path.sep, '/') || '.';
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const report = createZhiyuReleaseReadinessReport({
    evidence: readJson(options.evidence),
    registryDoc: readYaml(options.registry),
    descriptorDoc: readYaml(options.descriptors),
    appId: options.appId,
  });
  fs.mkdirSync(path.dirname(options.out), { recursive: true });
  fs.writeFileSync(options.out, `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`[zhiyu] wrote ${repoRelative(options.out)}\n`);
  process.stdout.write(`[zhiyu] readinessStatus=${report.readinessStatus}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  }
}
