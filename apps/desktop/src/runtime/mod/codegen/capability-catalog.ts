// Re-export from shared kit/core/runtime-capabilities — single owner for
// codegen capability tier classification.

export type {
  CodegenCapabilityTier,
  CodegenCapabilityDecision,
} from '@nimiplatform/nimi-kit/core/runtime-capabilities';

export {
  CODEGEN_T0_CAPABILITY_PATTERNS,
  CODEGEN_T1_CAPABILITY_PATTERNS,
  CODEGEN_T2_CAPABILITY_PATTERNS,
  normalizeCodegenCapabilityWildcard,
  classifyCodegenCapability,
  resolveCodegenCapabilityDecision,
} from '@nimiplatform/nimi-kit/core/runtime-capabilities';
