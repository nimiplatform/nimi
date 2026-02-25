import {
  capabilityMatches,
  normalizeCapabilityKey,
} from '@runtime/hook/contracts/capabilities';

export type CodegenCapabilityTier = 'T0' | 'T1' | 'T2' | 'UNKNOWN';

export const CODEGEN_T0_CAPABILITY_PATTERNS = [
  'llm.text.generate',
  'llm.text.stream',
  'ui.register.ui-extension.app.*',
  'data.register.data-api.user-*.*.*',
  'data.query.data-api.user-*.*.*',
  'audit.read.self',
  'meta.read.self',
] as const;

export const CODEGEN_T1_CAPABILITY_PATTERNS = [
  'llm.image.generate',
  'llm.video.generate',
  'llm.embedding.generate',
  'llm.speech.*',
  'data.query.data-api.core.*',
] as const;

export const CODEGEN_T2_CAPABILITY_PATTERNS = [
  'turn.register.*',
  'inter-mod.*',
  'action.*',
  'network*',
  'filesystem*',
  'process*',
  'economy-write*',
  'identity-write*',
  'platform-cloud-write*',
  'audit.read.all',
  'meta.read.all',
] as const;

export type CodegenCapabilityDecision = {
  autoGranted: string[];
  requiresConsent: string[];
  denied: string[];
  unknown: string[];
};

function dedupe(values: string[]): string[] {
  return Array.from(new Set(values));
}

export function normalizeCodegenCapabilityWildcard(value: string): string {
  const normalized = normalizeCapabilityKey(value);
  if (!normalized) return '';
  if (normalized === '*') return normalized;
  return normalized.replace(/:\*/g, '.*');
}

export function classifyCodegenCapability(value: string): CodegenCapabilityTier {
  const capability = normalizeCodegenCapabilityWildcard(value);
  if (!capability) return 'UNKNOWN';

  if (CODEGEN_T2_CAPABILITY_PATTERNS.some((pattern) => capabilityMatches(pattern, capability))) {
    return 'T2';
  }
  if (CODEGEN_T1_CAPABILITY_PATTERNS.some((pattern) => capabilityMatches(pattern, capability))) {
    return 'T1';
  }
  if (CODEGEN_T0_CAPABILITY_PATTERNS.some((pattern) => capabilityMatches(pattern, capability))) {
    return 'T0';
  }
  return 'UNKNOWN';
}

export function resolveCodegenCapabilityDecision(capabilities: string[]): CodegenCapabilityDecision {
  const autoGranted: string[] = [];
  const requiresConsent: string[] = [];
  const denied: string[] = [];
  const unknown: string[] = [];

  for (const capability of capabilities || []) {
    const normalized = normalizeCodegenCapabilityWildcard(capability);
    if (!normalized) continue;
    const tier = classifyCodegenCapability(normalized);
    if (tier === 'T0') {
      autoGranted.push(normalized);
      continue;
    }
    if (tier === 'T1') {
      requiresConsent.push(normalized);
      continue;
    }
    if (tier === 'T2') {
      denied.push(normalized);
      continue;
    }
    unknown.push(normalized);
  }

  return {
    autoGranted: dedupe(autoGranted),
    requiresConsent: dedupe(requiresConsent),
    denied: dedupe(denied),
    unknown: dedupe(unknown),
  };
}
