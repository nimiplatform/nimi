import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import YAML from 'yaml';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const defaultDescriptorPath = path.join(repoRoot, 'config/platform-nimi-app-release-descriptors.yaml');

const externalClass = 'external-immutable-artifact';
const ordinaryTrack = 'ordinary-release-proof';
const externalSourceKinds = new Set(['github-release', 'github-commit', 'npm-package']);

export function validateCatalogDocument(doc) {
  const failures = [];
  const descriptors = Array.isArray(doc?.descriptors) ? doc.descriptors : [];
  descriptors.forEach((descriptor, index) => {
    const id = stringValue(descriptor?.descriptor_id) || `descriptors[${index}]`;
    if (stringValue(descriptor?.descriptor_class) !== externalClass) return;
    validateExternalDescriptor(descriptor, id, failures);
  });
  return failures;
}

function validateExternalDescriptor(descriptor, id, failures) {
  requiredStringFields(descriptor, [
    'descriptor_id',
    'app_id',
    'version',
    'admission_track',
    'publisher.github_namespace',
    'publisher.namespace_kind',
    'publisher.identity_assurance',
    'source.kind',
    'source.ref',
    'artifact.locator',
    'artifact.sha256',
    'artifact.signature_or_provenance_ref',
    'artifact_mirror_ref',
    'build_assurance',
    'dependency_assurance',
    'platform_signing_assurance.macos_notarization',
    'platform_signing_assurance.macos_developer_id_subject',
    'platform_signing_assurance.windows_code_signing',
    'platform_signing_assurance.installer_signature',
    'platform_signing_assurance.entitlements_ref',
    'platform_signing_assurance.signing_subject',
    'runtime.package_kind',
    'runtime.entry_ref',
    'runtime.sandbox_ref',
    'permissions_ref',
    'storage_policy_ref.id',
    'storage_policy_ref.kind',
    'update_channel_ref',
    'rollback_eligibility',
    'review.admission_path',
    'review.decision',
    'review.adjudicator_kind',
    'review.adjudicator_ref',
    'review.decided_at',
    'support.escalation_path',
    'support.kill_switch_visibility',
    'source_rule',
  ], id, failures);
  requiredArrayFields(descriptor, [
    'support.diagnostics_bundle_fields',
    'support.redaction_rules',
    'support.user_visible_issue_categories',
    'support.recovery_instructions',
  ], id, failures);
  requiredStringFields(descriptor, [
    'artifact.size.download',
    'artifact.size.installed',
    'artifact.size.user_data',
    'artifact.size.cache',
    'artifact.size.shared_deps',
  ], id, failures);

  const track = stringValue(descriptor?.admission_track);
  const sourceKind = stringValue(descriptor?.source?.kind);
  if (!externalSourceKinds.has(sourceKind)) {
    failures.push(`${id}: source.kind is not admitted`);
  }
  if (!exactSemanticVersion(stringValue(descriptor?.version))) {
    failures.push(`${id}: version must be exact semantic version`);
  }
  if (!rfc3339Timestamp(stringValue(descriptor?.review?.decided_at))) {
    failures.push(`${id}: review.decided_at must be RFC3339 timestamp`);
  }
  if (!['user', 'org'].includes(stringValue(descriptor?.publisher?.namespace_kind))) {
    failures.push(`${id}: publisher.namespace_kind must be user|org`);
  }
  const identityAssurance = stringValue(descriptor?.publisher?.identity_assurance);
  if (!['pseudonymous', 'domain-verified', 'identity-verified'].includes(identityAssurance)) {
    failures.push(`${id}: publisher.identity_assurance is not admitted`);
  }
  if ((identityAssurance === 'domain-verified' || identityAssurance === 'identity-verified') && !stringValue(descriptor?.publisher?.verified_domain)) {
    failures.push(`${id}: publisher.verified_domain is required for ${identityAssurance}`);
  }
  if (identityAssurance === 'identity-verified' && !stringValue(descriptor?.publisher?.kyc_verification_ref)) {
    failures.push(`${id}: publisher.kyc_verification_ref is required for identity-verified`);
  }
  if (descriptor?.mirror_license_cleared !== true) {
    failures.push(`${id}: mirror_license_cleared must be true`);
  }
  if (stringValue(descriptor?.build_assurance) === 'checksum-pinned') {
    failures.push(`${id}: build_assurance checksum-pinned is forbidden for third-party descriptors`);
  }
  if (stringValue(descriptor?.artifact?.digest_algorithm) !== 'sha256') {
    failures.push(`${id}: artifact.digest_algorithm must be sha256`);
  }
  if (stringValue(descriptor?.runtime?.package_kind) !== 'nimi-app') {
    failures.push(`${id}: runtime.package_kind must be nimi-app`);
  }
  if (descriptor?.review?.mutable_source_allowed !== false) {
    failures.push(`${id}: review.mutable_source_allowed must be false`);
  }
  if (!stringValue(descriptor?.artifact?.locator).startsWith('https://')) {
    failures.push(`${id}: artifact.locator must be immutable https`);
  }
  validateStoragePolicy(descriptor, id, failures);

  if (track === ordinaryTrack) {
    const signing = descriptor?.platform_signing_assurance || {};
    for (const field of ['macos_notarization', 'windows_code_signing', 'installer_signature']) {
      const value = stringValue(signing[field]);
      if (value === 'not-applicable' || value === 'not-required-internal') {
        failures.push(`${id}: ordinary-release-proof requires platform signing for ${field}`);
      }
    }
  } else if (track) {
    failures.push(`${id}: admission_track is not admitted`);
  }
}

function validateStoragePolicy(descriptor, id, failures) {
  const storagePolicyRef = descriptor?.storage_policy_ref;
  const storagePolicyId = stringValue(storagePolicyRef?.id);
  const storagePolicyKind = stringValue(storagePolicyRef?.kind);
  if (storagePolicyKind === 'nimi-mediated-default') {
    if (storagePolicyId !== 'nimi-data-app-roots') {
      failures.push(`${id}: storage_policy_ref.id must be nimi-data-app-roots for nimi-mediated-default`);
    }
    if (Array.isArray(descriptor?.os_storage_disclosure) && descriptor.os_storage_disclosure.length > 0) {
      failures.push(`${id}: os_storage_disclosure must be absent for nimi-mediated-default`);
    }
  } else if (storagePolicyKind === 'app-owned-os-storage') {
    if (!Array.isArray(descriptor?.os_storage_disclosure) || descriptor.os_storage_disclosure.length === 0) {
      failures.push(`${id}: os_storage_disclosure is required for app-owned-os-storage`);
      return;
    }
    descriptor.os_storage_disclosure.forEach((row, index) => {
      for (const field of ['path_pattern', 'purpose', 'expected_size_band']) {
        if (!stringValue(row?.[field])) {
          failures.push(`${id}: os_storage_disclosure[${index}].${field} is required`);
        }
      }
    });
  } else if (storagePolicyKind) {
    failures.push(`${id}: storage_policy_ref.kind is not admitted`);
  }
}

function requiredStringFields(root, fields, id, failures) {
  for (const field of fields) {
    if (!stringValue(readPath(root, field))) {
      failures.push(`${id}: missing ${field}`);
    }
  }
}

function requiredArrayFields(root, fields, id, failures) {
  for (const field of fields) {
    const value = readPath(root, field);
    if (!Array.isArray(value) || value.map(stringValue).filter(Boolean).length === 0) {
      failures.push(`${id}: missing ${field}`);
    }
  }
}

function readPath(root, dottedPath) {
  return dottedPath.split('.').reduce((current, key) => current?.[key], root);
}

function stringValue(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function exactSemanticVersion(version) {
  const [core] = version.split('-', 1);
  const segments = core.split('.');
  return segments.length === 3 && segments.every((segment) => /^[0-9]+$/.test(segment));
}

function rfc3339Timestamp(value) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(value)) return false;
  return !Number.isNaN(Date.parse(value));
}

function main() {
  const descriptorPath = process.argv[2] ? path.resolve(process.cwd(), process.argv[2]) : defaultDescriptorPath;
  const text = fs.readFileSync(descriptorPath, 'utf8');
  const doc = YAML.parse(text);
  const failures = validateCatalogDocument(doc);
  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(`ERROR: ${failure}`);
    }
    process.exit(1);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main();
}
