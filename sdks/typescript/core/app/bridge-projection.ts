import type { NimiAppReleaseDescriptorRow } from './index.js';
import type { NimiAppRegistrySourceRow } from './registry-transport.js';

export interface NimiAppBridgeProjection {
  readonly registryPath: string;
  readonly packagesPath: string;
  readonly registryRows: readonly NimiAppRegistrySourceRow[];
  readonly releaseDescriptors: readonly NimiAppReleaseDescriptorRow[];
}

const NIMI_APP_RELEASE_DESCRIPTOR_CLASSES = new Set([
  'bundled-with-nimi',
  'external-immutable-artifact',
]);

const NIMI_APP_RELEASE_SOURCE_KINDS = new Set([
  'nimi-bundle',
  'github-release',
  'github-commit',
  'npm-package',
]);

const NIMI_APP_ADMISSION_STATUSES = new Set([
  'admitted',
  'gated_by_avatar_master_gate',
  'permission_fabric_pending',
  'deferred',
  'retired',
]);

const NIMI_APP_ORDINARY_VISIBILITIES = new Set([
  'ordinary-visible',
  'hidden-internal',
  'developer-only',
  'not-admitted-visible',
]);

export function parseNimiAppBridgeProjection(value: unknown): NimiAppBridgeProjection {
  const record = asNimiAppBridgeRecord(value, 'apps_bridge_projection_get');
  return {
    registryPath: requireNimiAppBridgeString(record.registryPath, 'apps_bridge_projection registryPath'),
    packagesPath: requireNimiAppBridgeString(record.packagesPath, 'apps_bridge_projection packagesPath'),
    registryRows: asNimiAppBridgeArray(record.registryRows, 'apps_bridge_projection registryRows').map(
      parseNimiAppBridgeRegistryRow,
    ),
    releaseDescriptors: asNimiAppBridgeArray(
      record.releaseDescriptors,
      'apps_bridge_projection releaseDescriptors',
    ).map(parseNimiAppBridgeReleaseDescriptorRow),
  };
}

export function parseNimiAppBridgeRegistryRow(value: unknown, index: number): NimiAppRegistrySourceRow {
  const record = asNimiAppBridgeRecord(value, `apps_bridge_projection registryRows[${index}]`);
  const appKind = requireNimiAppBridgeString(record.appKind, `registryRows[${index}].appKind`);
  if (appKind !== 'nimi-app') {
    throw new Error(`registryRows[${index}].appKind must be nimi-app`);
  }
  const ordinaryVisibility = requireNimiAppBridgeString(
    record.ordinaryVisibility,
    `registryRows[${index}].ordinaryVisibility`,
  );
  if (!NIMI_APP_ORDINARY_VISIBILITIES.has(ordinaryVisibility)) {
    throw new Error(`registryRows[${index}].ordinaryVisibility is invalid: ${ordinaryVisibility}`);
  }
  const admissionStatus = requireNimiAppBridgeString(
    record.admissionStatus,
    `registryRows[${index}].admissionStatus`,
  );
  if (!NIMI_APP_ADMISSION_STATUSES.has(admissionStatus)) {
    throw new Error(`registryRows[${index}].admissionStatus is invalid: ${admissionStatus}`);
  }
  return {
    appId: requireNimiAppBridgeString(record.appId, `registryRows[${index}].appId`),
    appKind: 'nimi-app',
    displayName: requireNimiAppBridgeString(record.displayName, `registryRows[${index}].displayName`),
    publisher: requireNimiAppBridgeString(record.publisher, `registryRows[${index}].publisher`),
    trustTier: requireNimiAppBridgeString(record.trustTier, `registryRows[${index}].trustTier`) as
      NimiAppRegistrySourceRow['trustTier'],
    ordinaryVisibility: ordinaryVisibility as NimiAppRegistrySourceRow['ordinaryVisibility'],
    aiProfileSelectionRef: requireNimiAppBridgeString(
      record.aiProfileSelectionRef,
      `registryRows[${index}].aiProfileSelectionRef`,
    ),
    capabilitySet: requireNimiAppBridgeStringArray(
      record.capabilitySet,
      `registryRows[${index}].capabilitySet`,
    ),
    releaseDescriptorRef: requireNimiAppBridgeString(
      record.releaseDescriptorRef,
      `registryRows[${index}].releaseDescriptorRef`,
    ),
    installStoragePolicyRef: requireNimiAppBridgeString(
      record.installStoragePolicyRef,
      `registryRows[${index}].installStoragePolicyRef`,
    ),
    sourceRule: requireNimiAppBridgeString(record.sourceRule, `registryRows[${index}].sourceRule`),
    admissionStatus: admissionStatus as NimiAppRegistrySourceRow['admissionStatus'],
    installedVersion: optionalNimiAppBridgeString(record.installedVersion),
    availableVersion: optionalNimiAppBridgeString(record.availableVersion),
    detail: optionalNimiAppBridgeString(record.detail),
  };
}

export function parseNimiAppBridgeReleaseDescriptorRow(value: unknown, index: number): NimiAppReleaseDescriptorRow {
  const record = asNimiAppBridgeRecord(value, `apps_bridge_projection releaseDescriptors[${index}]`);
  const descriptorClass = requireNimiAppBridgeString(
    record.descriptorClass,
    `releaseDescriptors[${index}].descriptorClass`,
  );
  if (!NIMI_APP_RELEASE_DESCRIPTOR_CLASSES.has(descriptorClass)) {
    throw new Error(`releaseDescriptors[${index}].descriptorClass is invalid: ${descriptorClass}`);
  }
  const sourceKind = requireNimiAppBridgeString(record.sourceKind, `releaseDescriptors[${index}].sourceKind`);
  if (!NIMI_APP_RELEASE_SOURCE_KINDS.has(sourceKind)) {
    throw new Error(`releaseDescriptors[${index}].sourceKind is invalid: ${sourceKind}`);
  }
  const packageKind = requireNimiAppBridgeString(record.packageKind, `releaseDescriptors[${index}].packageKind`);
  if (packageKind !== 'nimi-app') {
    throw new Error(`releaseDescriptors[${index}].packageKind must be nimi-app`);
  }
  const digestAlgorithm = requireNimiAppBridgeString(
    record.digestAlgorithm,
    `releaseDescriptors[${index}].digestAlgorithm`,
  );
  if (digestAlgorithm !== 'sha256') {
    throw new Error(`releaseDescriptors[${index}].digestAlgorithm must be sha256`);
  }
  return {
    descriptorId: requireNimiAppBridgeString(record.descriptorId, `releaseDescriptors[${index}].descriptorId`),
    appId: requireNimiAppBridgeString(record.appId, `releaseDescriptors[${index}].appId`),
    version: requireNimiAppBridgeString(record.version, `releaseDescriptors[${index}].version`),
    descriptorClass: descriptorClass as NimiAppReleaseDescriptorRow['descriptorClass'],
    sourceKind: sourceKind as NimiAppReleaseDescriptorRow['sourceKind'],
    sourceRef: requireNimiAppBridgeString(record.sourceRef, `releaseDescriptors[${index}].sourceRef`),
    artifactLocator: requireNimiAppBridgeString(
      record.artifactLocator,
      `releaseDescriptors[${index}].artifactLocator`,
    ),
    digestAlgorithm: 'sha256',
    sha256: requireNimiAppBridgeString(record.sha256, `releaseDescriptors[${index}].sha256`),
    size: requireNimiAppBridgeString(record.size, `releaseDescriptors[${index}].size`),
    provenanceRef: requireNimiAppBridgeString(record.provenanceRef, `releaseDescriptors[${index}].provenanceRef`),
    packageKind: 'nimi-app',
    entryRef: requireNimiAppBridgeString(record.entryRef, `releaseDescriptors[${index}].entryRef`),
    sandboxRef: requireNimiAppBridgeString(record.sandboxRef, `releaseDescriptors[${index}].sandboxRef`),
    permissionsRef: requireNimiAppBridgeString(
      record.permissionsRef,
      `releaseDescriptors[${index}].permissionsRef`,
    ),
    storagePolicyRef: requireNimiAppBridgeString(
      record.storagePolicyRef,
      `releaseDescriptors[${index}].storagePolicyRef`,
    ),
    admissionPath: requireNimiAppBridgeString(record.admissionPath, `releaseDescriptors[${index}].admissionPath`),
    mutableSourceAllowed: record.mutableSourceAllowed === true,
    installDigestVerificationRequired: requireNimiAppBridgeString(
      record.installDigestVerificationRequired,
      `releaseDescriptors[${index}].installDigestVerificationRequired`,
    ),
    sourceRule: requireNimiAppBridgeString(record.sourceRule, `releaseDescriptors[${index}].sourceRule`),
  };
}

function asNimiAppBridgeRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} returned an invalid payload`);
  }
  return value as Record<string, unknown>;
}

function asNimiAppBridgeArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value;
}

function requireNimiAppBridgeStringArray(value: unknown, label: string): readonly string[] {
  return asNimiAppBridgeArray(value, label).map((item, index) =>
    requireNimiAppBridgeString(item, `${label}[${index}]`));
}

function requireNimiAppBridgeString(value: unknown, label: string): string {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    throw new Error(`${label} is required`);
  }
  return normalized;
}

function optionalNimiAppBridgeString(value: unknown): string | undefined {
  const normalized = String(value ?? '').trim();
  return normalized || undefined;
}
