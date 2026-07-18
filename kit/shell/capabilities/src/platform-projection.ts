import { buildNimiFactoryProfileIndexRecord, type NimiFactoryProfileIndexRecord } from './ai-profile.js';

export type NimiPlatformNimiAppRegistryRow = {
  readonly appId: string;
  readonly appKind: string;
  readonly displayName: string;
  readonly publisher: string;
  readonly trustTier: string;
  readonly ordinaryVisibility: string;
  readonly aiProfileSelectionRef: string;
  readonly capabilitySetRefs: readonly string[];
  readonly releaseDescriptorRef: string;
  readonly installStoragePolicyRef: string;
  readonly admissionStatus: string;
  readonly sourceRule: string;
};

export type NimiPlatformNimiAppReleaseDescriptorRow = {
  readonly descriptorId: string;
  readonly appId: string;
  readonly version: string;
  readonly descriptorClass: string;
  readonly sourceKind: string;
  readonly sourceRef: string;
  readonly artifactLocator: string;
  readonly sha256: string;
  readonly packageKind: string;
  readonly storagePolicyRef: string;
  readonly digestAlgorithm: string;
  readonly mutableSourceAllowed: boolean;
  readonly admissionPath: string;
  readonly installDigestVerificationRequired: string;
  readonly sourceRule: string;
  readonly size: string;
  readonly provenanceRef: string;
  readonly entryRef: string;
  readonly sandboxRef: string;
  readonly permissionsRef: string;
};

export const NIMI_PLATFORM_NIMI_APP_REGISTRY_CATALOG_ID = 'platform_nimi_app_registry';
export const NIMI_PLATFORM_NIMI_APP_REGISTRY_CATALOG_VERSION = 2;

export const NIMI_PLATFORM_NIMI_APP_REGISTRY_ROWS = [
  {
    "appId": "nimi.avatar",
    "appKind": "nimi-app",
    "displayName": "Avatar",
    "publisher": "nimi-first-party",
    "trustTier": "nimi-first-party",
    "ordinaryVisibility": "hidden-internal",
    "aiProfileSelectionRef": "local-gpu",
    "capabilitySetRefs": [
      "text.generate",
      "audio.synthesize",
      "audio.transcribe",
      "image.generate"
    ],
    "releaseDescriptorRef": "nimi.avatar.bundled-with-nimi",
    "installStoragePolicyRef": "nimi-data-app-roots",
    "admissionStatus": "admitted",
    "sourceRule": "P-NAPP-011"
  },
  {
    "appId": "nimi.realm-persona-studio",
    "appKind": "nimi-app",
    "displayName": "Realm Persona Studio",
    "publisher": "nimi-first-party",
    "trustTier": "nimi-first-party",
    "ordinaryVisibility": "developer-only",
    "aiProfileSelectionRef": "local-gpu",
    "capabilitySetRefs": [
      "text.generate",
      "audio.synthesize",
      "image.generate"
    ],
    "releaseDescriptorRef": "nimi.realm-persona-studio.bundled-with-nimi",
    "installStoragePolicyRef": "nimi-data-app-roots",
    "admissionStatus": "admitted",
    "sourceRule": "P-NAPP-011"
  },
  {
    "appId": "nimi.realm-world-studio",
    "appKind": "nimi-app",
    "displayName": "Realm World Studio",
    "publisher": "nimi-first-party",
    "trustTier": "nimi-first-party",
    "ordinaryVisibility": "developer-only",
    "aiProfileSelectionRef": "local-gpu",
    "capabilitySetRefs": [
      "text.generate",
      "audio.synthesize",
      "image.generate"
    ],
    "releaseDescriptorRef": "nimi.realm-world-studio.bundled-with-nimi",
    "installStoragePolicyRef": "nimi-data-app-roots",
    "admissionStatus": "admitted",
    "sourceRule": "P-NAPP-011"
  },
  {
    "appId": "nimi.zhiyu",
    "appKind": "nimi-app",
    "displayName": "织羽 Zhiyu",
    "publisher": "nimi-first-party",
    "trustTier": "nimi-first-party",
    "ordinaryVisibility": "developer-only",
    "aiProfileSelectionRef": "local-standard",
    "capabilitySetRefs": [
      "text.generate"
    ],
    "releaseDescriptorRef": "nimi.zhiyu.bundled-with-nimi",
    "installStoragePolicyRef": "nimi-data-app-roots",
    "admissionStatus": "admitted",
    "sourceRule": "P-NAPP-011"
  }
] as const satisfies readonly NimiPlatformNimiAppRegistryRow[];

export const NIMI_PLATFORM_NIMI_APP_RELEASE_DESCRIPTOR_ROWS = [
  {
    "descriptorId": "nimi.avatar.bundled-with-nimi",
    "appId": "nimi.avatar",
    "version": "bundled-with-current-nimi-release",
    "descriptorClass": "bundled-with-nimi",
    "sourceKind": "nimi-bundle",
    "sourceRef": "current-atomic-nimi-release",
    "artifactLocator": "current-nimi-release-bundle",
    "sha256": "inherited-from-atomic-nimi-release-manifest",
    "packageKind": "nimi-app",
    "storagePolicyRef": "nimi-data-app-roots",
    "digestAlgorithm": "sha256",
    "mutableSourceAllowed": false,
    "admissionPath": "first-party-bundled-release",
    "installDigestVerificationRequired": "inherited_from_atomic_bundle",
    "sourceRule": "P-NAPP-014",
    "size": "inherited-from-atomic-nimi-release-manifest",
    "provenanceRef": "nimi-first-party-signature-policy",
    "entryRef": "avatar-runtime-registration",
    "sandboxRef": "first-party-bundled-app",
    "permissionsRef": "nimi.avatar.permission_requirements"
  },
  {
    "descriptorId": "nimi.realm-persona-studio.bundled-with-nimi",
    "appId": "nimi.realm-persona-studio",
    "version": "bundled-with-current-nimi-release",
    "descriptorClass": "bundled-with-nimi",
    "sourceKind": "nimi-bundle",
    "sourceRef": "current-atomic-nimi-release",
    "artifactLocator": "current-nimi-release-bundle",
    "sha256": "inherited-from-atomic-nimi-release-manifest",
    "packageKind": "nimi-app",
    "storagePolicyRef": "nimi-data-app-roots",
    "digestAlgorithm": "sha256",
    "mutableSourceAllowed": false,
    "admissionPath": "first-party-bundled-release",
    "installDigestVerificationRequired": "inherited_from_atomic_bundle",
    "sourceRule": "P-NAPP-014",
    "size": "inherited-from-atomic-nimi-release-manifest",
    "provenanceRef": "nimi-first-party-signature-policy",
    "entryRef": "realm-persona-studio-runtime-registration",
    "sandboxRef": "first-party-bundled-app",
    "permissionsRef": "nimi.realm-persona-studio.permission_requirements"
  },
  {
    "descriptorId": "nimi.realm-world-studio.bundled-with-nimi",
    "appId": "nimi.realm-world-studio",
    "version": "bundled-with-current-nimi-release",
    "descriptorClass": "bundled-with-nimi",
    "sourceKind": "nimi-bundle",
    "sourceRef": "current-atomic-nimi-release",
    "artifactLocator": "current-nimi-release-bundle",
    "sha256": "inherited-from-atomic-nimi-release-manifest",
    "packageKind": "nimi-app",
    "storagePolicyRef": "nimi-data-app-roots",
    "digestAlgorithm": "sha256",
    "mutableSourceAllowed": false,
    "admissionPath": "first-party-bundled-release",
    "installDigestVerificationRequired": "inherited_from_atomic_bundle",
    "sourceRule": "P-NAPP-014",
    "size": "inherited-from-atomic-nimi-release-manifest",
    "provenanceRef": "nimi-first-party-signature-policy",
    "entryRef": "realm-world-studio-runtime-registration",
    "sandboxRef": "first-party-bundled-app",
    "permissionsRef": "nimi.realm-world-studio.permission_requirements"
  },
  {
    "descriptorId": "nimi.zhiyu.bundled-with-nimi",
    "appId": "nimi.zhiyu",
    "version": "bundled-with-current-nimi-release",
    "descriptorClass": "bundled-with-nimi",
    "sourceKind": "nimi-bundle",
    "sourceRef": "current-atomic-nimi-release",
    "artifactLocator": "current-nimi-release-bundle",
    "sha256": "inherited-from-atomic-nimi-release-manifest",
    "packageKind": "nimi-app",
    "storagePolicyRef": "nimi-data-app-roots",
    "digestAlgorithm": "sha256",
    "mutableSourceAllowed": false,
    "admissionPath": "first-party-bundled-release",
    "installDigestVerificationRequired": "inherited_from_atomic_bundle",
    "sourceRule": "P-NAPP-014",
    "size": "inherited-from-atomic-nimi-release-manifest",
    "provenanceRef": "nimi-first-party-signature-policy",
    "entryRef": "zhiyu-runtime-registration",
    "sandboxRef": "first-party-bundled-app",
    "permissionsRef": "nimi.zhiyu.permission_requirements"
  }
] as const satisfies readonly NimiPlatformNimiAppReleaseDescriptorRow[];

export type NimiAppsRegistryRecord = {
  readonly schemaVersion: 1;
  readonly catalogId: string;
  readonly catalogVersion: number;
  readonly updatedAt: string;
  readonly apps: readonly {
    readonly appId: string;
    readonly displayName: string;
    readonly visibility: string;
    readonly trustTier: string;
    readonly installState: string;
    readonly packageRef: string;
    readonly manifestRef: string;
    readonly recommendedProfileRef?: string;
    readonly requirementsRef: string;
  }[];
};

export type NimiAppsPackageRow = {
  readonly appId: string;
  readonly packageRef: string;
  readonly version: string;
  readonly state: 'installed' | 'repair_required' | 'blocked';
  readonly verifiedAt: string;
};

export type NimiAppsPackagesRecord = {
  readonly schemaVersion: 2;
  readonly updatedAt: string;
  readonly packages: readonly NimiAppsPackageRow[];
};

export type NimiAppsBridgeProjection = {
  readonly registryPath: string;
  readonly packagesPath: string;
  readonly registryRows: readonly {
    readonly appId: string;
    readonly appKind: string;
    readonly displayName: string;
    readonly publisher: string;
    readonly trustTier: string;
    readonly ordinaryVisibility: string;
    readonly aiProfileSelectionRef: string;
    readonly capabilitySet: readonly string[];
    readonly releaseDescriptorRef: string;
    readonly installStoragePolicyRef: string;
    readonly sourceRule: string;
    readonly admissionStatus: string;
    readonly installedVersion?: string;
  }[];
  readonly releaseDescriptors: readonly {
    readonly descriptorId: string;
    readonly appId: string;
    readonly version: string;
    readonly descriptorClass: string;
    readonly sourceKind: string;
    readonly sourceRef: string;
    readonly artifactLocator: string;
    readonly digestAlgorithm: string;
    readonly sha256: string;
    readonly size: string;
    readonly provenanceRef: string;
    readonly packageKind: string;
    readonly entryRef: string;
    readonly sandboxRef: string;
    readonly permissionsRef: string;
    readonly storagePolicyRef: string;
    readonly admissionPath: string;
    readonly mutableSourceAllowed: boolean;
    readonly installDigestVerificationRequired: string;
    readonly sourceRule: string;
  }[];
};

export function resolveNimiAppReleaseDescriptor(
  descriptorId: unknown,
): NimiPlatformNimiAppReleaseDescriptorRow | undefined {
  const normalized = normalizeNimiCapabilityText(descriptorId);
  if (!normalized) {
    return undefined;
  }
  return NIMI_PLATFORM_NIMI_APP_RELEASE_DESCRIPTOR_ROWS.find((row) => row.descriptorId === normalized);
}

export function buildNimiAppsRegistryRecord(updatedAt = new Date().toISOString()): NimiAppsRegistryRecord {
  const apps = NIMI_PLATFORM_NIMI_APP_REGISTRY_ROWS.map((row) => {
    const descriptor = resolveNimiAppReleaseDescriptor(row.releaseDescriptorRef);
    if (!descriptor) {
      throw new Error(`Nimi App registry row ${row.appId} release descriptor does not resolve: ${row.releaseDescriptorRef}`);
    }
    if (descriptor.appId !== row.appId) {
      throw new Error(`Nimi App registry row ${row.appId} release descriptor resolves to a different app: ${descriptor.appId}`);
    }
    if (descriptor.storagePolicyRef !== row.installStoragePolicyRef) {
      throw new Error(`Nimi App registry row ${row.appId} install storage policy does not match release descriptor`);
    }
    return {
      appId: row.appId,
      displayName: row.displayName,
      visibility: projectNimiAppVisibility(row.ordinaryVisibility),
      trustTier: row.trustTier,
      installState: projectNimiAppInstallState(row, descriptor),
      packageRef: row.releaseDescriptorRef,
      manifestRef: row.releaseDescriptorRef,
      recommendedProfileRef: row.aiProfileSelectionRef,
      requirementsRef: row.sourceRule,
    };
  });
  if (apps.length === 0) {
    throw new Error('Platform Nimi App registry catalog projected zero rows');
  }
  return {
    schemaVersion: 1,
    catalogId: NIMI_PLATFORM_NIMI_APP_REGISTRY_CATALOG_ID,
    catalogVersion: NIMI_PLATFORM_NIMI_APP_REGISTRY_CATALOG_VERSION,
    updatedAt,
    apps,
  };
}

export function buildNimiAppsPackagesRecordFromRows(
  updatedAt = new Date().toISOString(),
  packages: readonly NimiAppsPackageRow[] = [],
): NimiAppsPackagesRecord {
  for (const row of packages) {
    if (
      !normalizeNimiCapabilityText(row.appId)
      || !normalizeNimiCapabilityText(row.packageRef)
      || !normalizeNimiCapabilityText(row.version)
      || !normalizeNimiCapabilityText(row.verifiedAt)
    ) {
      throw new Error('~/.nimi/apps/packages.json package row requires appId, packageRef, version, and verifiedAt');
    }
    if (!['installed', 'repair_required', 'blocked'].includes(row.state)) {
      throw new Error(`~/.nimi/apps/packages.json package row ${row.appId} has an unknown state: ${row.state}`);
    }
  }
  return {
    schemaVersion: 2,
    updatedAt,
    packages: packages.map((row) => ({ ...row })),
  };
}

export function buildNimiAppsBridgeProjection(
  registryPath: string,
  packagesPath: string,
): NimiAppsBridgeProjection {
  return {
    registryPath,
    packagesPath,
    registryRows: NIMI_PLATFORM_NIMI_APP_REGISTRY_ROWS.map((row) => ({
      appId: row.appId,
      appKind: row.appKind,
      displayName: row.displayName,
      publisher: row.publisher,
      trustTier: row.trustTier,
      ordinaryVisibility: row.ordinaryVisibility,
      aiProfileSelectionRef: row.aiProfileSelectionRef,
      capabilitySet: [...row.capabilitySetRefs],
      releaseDescriptorRef: row.releaseDescriptorRef,
      installStoragePolicyRef: row.installStoragePolicyRef,
      sourceRule: row.sourceRule,
      admissionStatus: row.admissionStatus,
    })),
    releaseDescriptors: NIMI_PLATFORM_NIMI_APP_RELEASE_DESCRIPTOR_ROWS.map((descriptor) => ({
      descriptorId: descriptor.descriptorId,
      appId: descriptor.appId,
      version: descriptor.version,
      descriptorClass: descriptor.descriptorClass,
      sourceKind: descriptor.sourceKind,
      sourceRef: descriptor.sourceRef,
      artifactLocator: descriptor.artifactLocator,
      digestAlgorithm: descriptor.digestAlgorithm,
      sha256: descriptor.sha256,
      size: descriptor.size,
      provenanceRef: descriptor.provenanceRef,
      packageKind: descriptor.packageKind,
      entryRef: descriptor.entryRef,
      sandboxRef: descriptor.sandboxRef,
      permissionsRef: descriptor.permissionsRef,
      storagePolicyRef: descriptor.storagePolicyRef,
      admissionPath: descriptor.admissionPath,
      mutableSourceAllowed: descriptor.mutableSourceAllowed,
      installDigestVerificationRequired: descriptor.installDigestVerificationRequired,
      sourceRule: descriptor.sourceRule,
    })),
  };
}

export type NimiPlatformProjectionId =
  | 'factory-profile-index'
  | 'apps-registry'
  | 'apps-packages'
  | 'apps-bridge';

export type NimiPlatformProjectionInput = {
  readonly projectionId: string;
  readonly updatedAt?: string;
  readonly registryPath?: string;
  readonly packagesPath?: string;
  readonly packages?: readonly NimiAppsPackageRow[];
};

export type NimiPlatformProjectionResult = {
  readonly projectionId: NimiPlatformProjectionId;
  readonly record: NimiFactoryProfileIndexRecord | NimiAppsRegistryRecord | NimiAppsPackagesRecord | NimiAppsBridgeProjection;
};

export function buildNimiPlatformProjection(input: NimiPlatformProjectionInput): NimiPlatformProjectionResult {
  const projectionId = normalizeNimiCapabilityText(input.projectionId);
  const updatedAt = input.updatedAt || new Date().toISOString();
  if (projectionId === 'factory-profile-index') {
    return { projectionId, record: buildNimiFactoryProfileIndexRecord(updatedAt) };
  }
  if (projectionId === 'apps-registry') {
    return { projectionId, record: buildNimiAppsRegistryRecord(updatedAt) };
  }
  if (projectionId === 'apps-packages') {
    return { projectionId, record: buildNimiAppsPackagesRecordFromRows(updatedAt, input.packages ?? []) };
  }
  if (projectionId === 'apps-bridge') {
    return {
      projectionId,
      record: buildNimiAppsBridgeProjection(
        input.registryPath || '~/.nimi/apps/registry.json',
        input.packagesPath || '~/.nimi/apps/packages.json',
      ),
    };
  }
  throw new Error(`unsupported platform projection: ${projectionId || '<missing>'}`);
}

function projectNimiAppVisibility(ordinaryVisibility: string): string {
  if (ordinaryVisibility === 'ordinary-visible') {
    return 'ordinary';
  }
  if (
    ordinaryVisibility === 'hidden-internal'
    || ordinaryVisibility === 'developer-only'
    || ordinaryVisibility === 'not-admitted-visible'
  ) {
    return ordinaryVisibility;
  }
  throw new Error(`Nimi App registry row has an unknown ordinary_visibility: ${ordinaryVisibility}`);
}

function projectNimiAppInstallState(
  row: NimiPlatformNimiAppRegistryRow,
  descriptor: NimiPlatformNimiAppReleaseDescriptorRow,
): string {
  if (row.admissionStatus === 'admitted') {
    return descriptor.descriptorClass === 'bundled-with-nimi' ? 'bundled' : 'not_installed';
  }
  if (
    row.admissionStatus === 'gated_by_avatar_master_gate'
    || row.admissionStatus === 'permission_fabric_pending'
    || row.admissionStatus === 'deferred'
    || row.admissionStatus === 'retired'
  ) {
    return 'blocked';
  }
  throw new Error(`Nimi App registry row ${row.appId} has an unknown admission_status: ${row.admissionStatus}`);
}

function normalizeNimiCapabilityText(value: unknown): string {
  return String(value ?? '').trim();
}
