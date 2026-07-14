import type {
  NimiAppAccountInventorySourceRow,
  NimiAppInventoryEntry,
  NimiAppInventorySources,
  NimiAppLocalRecordRow,
  NimiAppRow,
} from '@nimiplatform/sdk/app';

export const catalogRow: NimiAppRow = {
  appId: 'community.example.read-only',
  appKind: 'nimi-app',
  displayName: 'Read-only Example',
  trustTier: 'nimi-community',
  ordinaryVisibility: 'ordinary-visible',
  publisher: 'Example Publisher',
  aiProfileSelectionRef: 'profile.example',
  capabilitySet: ['runtime.agent.turn'],
  releaseDescriptorRef: 'release.example',
  installStoragePolicyRef: 'storage.example',
  sourceRule: 'P-NAPP-031',
};

export const accountRow: NimiAppAccountInventorySourceRow = {
  appId: catalogRow.appId,
  accountState: 'entitled',
  installState: 'not-present',
  dataPolicy: 'account-private',
};

export function localRecord(
  recordState: NimiAppLocalRecordRow['recordState'] = 'active',
  overrides: Partial<NimiAppLocalRecordRow> = {},
): NimiAppLocalRecordRow {
  return {
    appId: catalogRow.appId,
    displayName: catalogRow.displayName,
    trustClass: 'local_development',
    recordState,
    sessionState: recordState === 'active' ? 'session-bound' : 'unavailable',
    grantPosture: recordState === 'active' ? 'granted' : 'unavailable',
    ...overrides,
  };
}

export function inventoryEntry(
  overrides: Partial<Omit<NimiAppInventoryEntry, 'sources'>> & {
    readonly sources?: Partial<NimiAppInventorySources>;
  } = {},
): NimiAppInventoryEntry {
  const sources: NimiAppInventorySources = {
    catalog: { status: 'present', value: catalogRow },
    account: { status: 'absent' },
    localRecord: { status: 'absent' },
    packageReadiness: {
      status: 'present',
      value: {
        state: 'unavailable',
        reasonCode: 'IMMUTABLE_PROFILE_UNAVAILABLE',
        detail: 'Immutable package materialization is unavailable until 0P.',
      },
    },
    ...overrides.sources,
  };
  return {
    appId: catalogRow.appId,
    displayName: catalogRow.displayName,
    appKind: catalogRow.appKind,
    publisher: catalogRow.publisher,
    aiProfileSelectionRef: catalogRow.aiProfileSelectionRef,
    releaseDescriptorRef: catalogRow.releaseDescriptorRef,
    installStoragePolicyRef: catalogRow.installStoragePolicyRef,
    trustTier: catalogRow.trustTier,
    capabilitySet: catalogRow.capabilitySet,
    installState: 'not-present',
    openReadiness: 'package-unavailable',
    activeJobs: [],
    nextActions: [],
    ...overrides,
    sources,
  };
}
