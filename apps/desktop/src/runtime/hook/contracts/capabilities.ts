// Re-export from shared kit/core/runtime-capabilities — single owner for
// capability normalization, matching, builders, and catalog constants.

export type {
  HookCapabilityKey,
} from '@nimiplatform/kit/core/runtime-capabilities';
// HookSourceType and TurnHookPoint are exported from ./types.ts to avoid
// duplicate-export conflict in the barrel index.

export {
  normalizeCapabilityKey,
  capabilityMatches,
  anyCapabilityMatches,
  expandCapabilitiesFromDeclarations,
  eventPublishCapability,
  eventSubscribeCapability,
  dataQueryCapability,
  dataRegisterCapability,
  storageFilesReadCapability,
  storageFilesWriteCapability,
  storageFilesDeleteCapability,
  storageFilesListCapability,
  storageSqliteQueryCapability,
  storageSqliteExecuteCapability,
  storageSqliteTransactionCapability,
  turnRegisterCapability,
  uiRegisterCapability,
  interModRequestCapability,
  interModProvideCapability,
  DEFAULT_TURN_HOOK_POINTS,
  DEFAULT_UI_SLOTS,
  DEFAULT_SOURCE_ALLOWLIST,
} from '@nimiplatform/kit/core/runtime-capabilities';
