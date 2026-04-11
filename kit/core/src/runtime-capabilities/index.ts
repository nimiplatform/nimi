// Core normalization, matching, builders, and catalog
export type {
  HookCapabilityKey,
  HookSourceType,
  TurnHookPoint,
} from './capabilities.js';
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
} from './capabilities.js';

// Codegen tier classification
export type {
  CodegenCapabilityTier,
  CodegenCapabilityDecision,
} from './codegen-catalog.js';
export {
  CODEGEN_T0_CAPABILITY_PATTERNS,
  CODEGEN_T1_CAPABILITY_PATTERNS,
  CODEGEN_T2_CAPABILITY_PATTERNS,
  normalizeCodegenCapabilityWildcard,
  classifyCodegenCapability,
  resolveCodegenCapabilityDecision,
} from './codegen-catalog.js';
