// Desktop Apps bridge projection client.
//
// T4 Fork C: the Desktop Apps bridge reads the runtime `~/.nimi/apps`
// projections (`registry.json` + `packages.json`) — not the SDK Platform
// catalog fixture. This
// module is the renderer half of that seam: it invokes the
// `apps_bridge_projection_get` Tauri command, which materializes both
// `~/.nimi/apps` projections from catalog + Runtime install-evidence truth and
// returns the three SDK Nimi App transport loader payloads.
//
// Fails closed: a malformed payload throws rather than projecting a partial or
// empty registry as success.

import type {
  NimiAppInstallEvidenceRow,
  NimiAppInstallVerificationState,
  NimiAppRegistrySourceRow,
  NimiAppReleaseDescriptorRow,
} from '@nimiplatform/sdk/app';
import { hasTauriInvoke } from './env';
import { invokeChecked } from './invoke';

/** The three SDK transport loader payloads sourced from `~/.nimi/apps`. */
export interface AppsBridgeProjection {
  readonly registryPath: string;
  readonly packagesPath: string;
  readonly registryRows: readonly NimiAppRegistrySourceRow[];
  readonly releaseDescriptors: readonly NimiAppReleaseDescriptorRow[];
  readonly installEvidence: readonly NimiAppInstallEvidenceRow[];
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} returned an invalid payload`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value;
}

function requireString(value: unknown, label: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    throw new Error(`${label} is required`);
  }
  return normalized;
}

function optionalString(value: unknown): string | undefined {
  const normalized = String(value ?? '').trim();
  return normalized || undefined;
}

const RELEASE_DESCRIPTOR_CLASSES = new Set(['bundled-with-nimi', 'external-immutable-artifact']);
const RELEASE_SOURCE_KINDS = new Set(['nimi-bundle', 'github-release', 'github-commit', 'npm-package']);
const ADMISSION_STATUSES = new Set([
  'admitted',
  'gated_by_avatar_master_gate',
  'pending_wave_4',
  'deferred',
  'retired',
]);
const ORDINARY_VISIBILITIES = new Set([
  'ordinary-visible',
  'hidden-internal',
  'developer-only',
  'not-admitted-visible',
]);
const VERIFICATION_STATES = new Set<NimiAppInstallVerificationState>([
  'not-installed',
  'digest-verified',
  'digest-mismatch',
  'blocked',
  'unsupported',
]);

function parseRegistryRow(value: unknown, index: number): NimiAppRegistrySourceRow {
  const record = asRecord(value, `apps_bridge_projection registryRows[${index}]`);
  const appKind = requireString(record.appKind, `registryRows[${index}].appKind`);
  if (appKind !== 'nimi-app') {
    throw new Error(`registryRows[${index}].appKind must be nimi-app`);
  }
  const ordinaryVisibility = requireString(
    record.ordinaryVisibility,
    `registryRows[${index}].ordinaryVisibility`,
  );
  if (!ORDINARY_VISIBILITIES.has(ordinaryVisibility)) {
    throw new Error(`registryRows[${index}].ordinaryVisibility is invalid: ${ordinaryVisibility}`);
  }
  const admissionStatus = requireString(
    record.admissionStatus,
    `registryRows[${index}].admissionStatus`,
  );
  if (!ADMISSION_STATUSES.has(admissionStatus)) {
    throw new Error(`registryRows[${index}].admissionStatus is invalid: ${admissionStatus}`);
  }
  return {
    appId: requireString(record.appId, `registryRows[${index}].appId`),
    appKind: 'nimi-app',
    displayName: requireString(record.displayName, `registryRows[${index}].displayName`),
    publisher: requireString(record.publisher, `registryRows[${index}].publisher`),
    trustTier: requireString(record.trustTier, `registryRows[${index}].trustTier`) as
      NimiAppRegistrySourceRow['trustTier'],
    ordinaryVisibility: ordinaryVisibility as NimiAppRegistrySourceRow['ordinaryVisibility'],
    releaseDescriptorRef: requireString(
      record.releaseDescriptorRef,
      `registryRows[${index}].releaseDescriptorRef`,
    ),
    installStoragePolicyRef: requireString(
      record.installStoragePolicyRef,
      `registryRows[${index}].installStoragePolicyRef`,
    ),
    sourceRule: requireString(record.sourceRule, `registryRows[${index}].sourceRule`),
    admissionStatus: admissionStatus as NimiAppRegistrySourceRow['admissionStatus'],
    installedVersion: optionalString(record.installedVersion),
  };
}

function parseReleaseDescriptorRow(value: unknown, index: number): NimiAppReleaseDescriptorRow {
  const record = asRecord(value, `apps_bridge_projection releaseDescriptors[${index}]`);
  const descriptorClass = requireString(
    record.descriptorClass,
    `releaseDescriptors[${index}].descriptorClass`,
  );
  if (!RELEASE_DESCRIPTOR_CLASSES.has(descriptorClass)) {
    throw new Error(`releaseDescriptors[${index}].descriptorClass is invalid: ${descriptorClass}`);
  }
  const sourceKind = requireString(record.sourceKind, `releaseDescriptors[${index}].sourceKind`);
  if (!RELEASE_SOURCE_KINDS.has(sourceKind)) {
    throw new Error(`releaseDescriptors[${index}].sourceKind is invalid: ${sourceKind}`);
  }
  const packageKind = requireString(record.packageKind, `releaseDescriptors[${index}].packageKind`);
  if (packageKind !== 'nimi-app') {
    throw new Error(`releaseDescriptors[${index}].packageKind must be nimi-app`);
  }
  const digestAlgorithm = requireString(
    record.digestAlgorithm,
    `releaseDescriptors[${index}].digestAlgorithm`,
  );
  if (digestAlgorithm !== 'sha256') {
    throw new Error(`releaseDescriptors[${index}].digestAlgorithm must be sha256`);
  }
  return {
    descriptorId: requireString(record.descriptorId, `releaseDescriptors[${index}].descriptorId`),
    appId: requireString(record.appId, `releaseDescriptors[${index}].appId`),
    version: requireString(record.version, `releaseDescriptors[${index}].version`),
    descriptorClass: descriptorClass as NimiAppReleaseDescriptorRow['descriptorClass'],
    sourceKind: sourceKind as NimiAppReleaseDescriptorRow['sourceKind'],
    sourceRef: requireString(record.sourceRef, `releaseDescriptors[${index}].sourceRef`),
    artifactLocator: requireString(
      record.artifactLocator,
      `releaseDescriptors[${index}].artifactLocator`,
    ),
    digestAlgorithm: 'sha256',
    sha256: requireString(record.sha256, `releaseDescriptors[${index}].sha256`),
    size: requireString(record.size, `releaseDescriptors[${index}].size`),
    provenanceRef: requireString(record.provenanceRef, `releaseDescriptors[${index}].provenanceRef`),
    packageKind: 'nimi-app',
    entryRef: requireString(record.entryRef, `releaseDescriptors[${index}].entryRef`),
    sandboxRef: requireString(record.sandboxRef, `releaseDescriptors[${index}].sandboxRef`),
    permissionsRef: requireString(
      record.permissionsRef,
      `releaseDescriptors[${index}].permissionsRef`,
    ),
    storagePolicyRef: requireString(
      record.storagePolicyRef,
      `releaseDescriptors[${index}].storagePolicyRef`,
    ),
    admissionPath: requireString(record.admissionPath, `releaseDescriptors[${index}].admissionPath`),
    mutableSourceAllowed: record.mutableSourceAllowed === true,
    installDigestVerificationRequired: requireString(
      record.installDigestVerificationRequired,
      `releaseDescriptors[${index}].installDigestVerificationRequired`,
    ),
    sourceRule: requireString(record.sourceRule, `releaseDescriptors[${index}].sourceRule`),
  };
}

function parseInstallEvidenceRow(value: unknown, index: number): NimiAppInstallEvidenceRow {
  const record = asRecord(value, `apps_bridge_projection installEvidence[${index}]`);
  const verificationState = requireString(
    record.verificationState,
    `installEvidence[${index}].verificationState`,
  );
  if (!VERIFICATION_STATES.has(verificationState as NimiAppInstallVerificationState)) {
    throw new Error(`installEvidence[${index}].verificationState is invalid: ${verificationState}`);
  }
  return {
    appId: requireString(record.appId, `installEvidence[${index}].appId`),
    releaseDescriptorRef: requireString(
      record.releaseDescriptorRef,
      `installEvidence[${index}].releaseDescriptorRef`,
    ),
    storagePolicyRef: requireString(
      record.storagePolicyRef,
      `installEvidence[${index}].storagePolicyRef`,
    ),
    installedVersion: optionalString(record.installedVersion),
    sha256: optionalString(record.sha256),
    verificationState: verificationState as NimiAppInstallVerificationState,
  };
}

function parseProjection(value: unknown): AppsBridgeProjection {
  const record = asRecord(value, 'apps_bridge_projection_get');
  return {
    registryPath: requireString(record.registryPath, 'apps_bridge_projection registryPath'),
    packagesPath: requireString(record.packagesPath, 'apps_bridge_projection packagesPath'),
    registryRows: asArray(record.registryRows, 'apps_bridge_projection registryRows').map(
      parseRegistryRow,
    ),
    releaseDescriptors: asArray(
      record.releaseDescriptors,
      'apps_bridge_projection releaseDescriptors',
    ).map(parseReleaseDescriptorRow),
    installEvidence: asArray(record.installEvidence, 'apps_bridge_projection installEvidence').map(
      parseInstallEvidenceRow,
    ),
  };
}

/**
 * Invoke the `apps_bridge_projection_get` Tauri command.
 *
 * Ensures `~/.nimi/apps/registry.json` and `~/.nimi/apps/packages.json` are
 * materialized, then returns the three SDK Nimi App transport loader payloads.
 * Requires the Tauri runtime — the Apps bridge has no non-desktop source.
 */
export async function getAppsBridgeProjection(): Promise<AppsBridgeProjection> {
  if (!hasTauriInvoke()) {
    throw new Error('apps_bridge_projection_get requires the desktop Tauri runtime');
  }
  return invokeChecked('apps_bridge_projection_get', {}, parseProjection);
}
