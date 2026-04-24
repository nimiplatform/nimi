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

// Codegen tier classification (hook capability permission tiering)
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

// Canonical capability catalog (spec-resident, generated from
// .nimi/spec/platform/kernel/tables/canonical-capability-catalog.yaml).
// See P-CAPCAT-001 / P-CAPCAT-002 / P-CAPCAT-003.
export type {
  CanonicalCapabilitySectionId,
  CanonicalCapabilityEditorKind,
  CanonicalCapabilityRuntimeEvidenceClass,
  CanonicalCapabilitySourceTable,
  CanonicalCapabilitySourceRef,
  CanonicalCapabilityI18nKeys,
  CanonicalCapabilityDescriptor,
  CanonicalCapabilityDeferredEntry,
} from './generated/canonical-capability-catalog.js';
export {
  CANONICAL_CAPABILITY_CATALOG,
  CANONICAL_CAPABILITY_CATALOG_BY_ID,
  CANONICAL_CAPABILITY_IDS,
  CANONICAL_CAPABILITY_DEFERRED,
} from './generated/canonical-capability-catalog.js';
