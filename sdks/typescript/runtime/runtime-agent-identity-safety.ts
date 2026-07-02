import {
  ReasonCode,
  type CanonicalMemoryRejection,
} from '../core-generated/runtime-typed-client';
import {
  projectRuntimeLocalAgentIdentity,
  type RuntimeLocalAgentIdentityInput,
} from './agent-local-identity';
import type {
  NimiRuntimeAgentDelegatedApprovalRequestProjection,
  NimiRuntimeAgentDelegatedCapabilityDiagnosticProjection,
} from './runtime-agent-delegated';
import { normalizeNimiRuntimeAgentText } from './runtime-agent-values';

export const NIMI_RUNTIME_AGENT_IDENTITY_SAFETY_SCHEMA_VERSION = 1;

export const NIMI_RUNTIME_AGENT_IDENTITY_SAFETY_UNSUPPORTED_FIELDS = [
  'identityConflictEvent',
  'firewallThreatIndicators',
  'firewallNormalizedOutputDiff',
] as const;

export type NimiRuntimeAgentIdentitySafetyState = 'ready' | 'warning' | 'blocked';

export interface NimiRuntimeAgentIdentitySafetyInput {
  readonly identity?: RuntimeLocalAgentIdentityInput;
  readonly conversationAnchorId?: string | null;
  readonly memoryRejections?: readonly CanonicalMemoryRejection[];
  readonly delegatedDiagnostics?: readonly NimiRuntimeAgentDelegatedCapabilityDiagnosticProjection[];
  readonly delegatedApprovalRequests?: readonly NimiRuntimeAgentDelegatedApprovalRequestProjection[];
  readonly observedAt?: string;
}

export interface NimiRuntimeAgentIdentitySafetyIdentity {
  readonly state: 'ready' | 'blocked';
  readonly ownerUserId: string | null;
  readonly runtimeSourceRef: string | null;
  readonly localAgentRef: string | null;
  readonly conversationAnchorId: string | null;
  readonly reasonCode: string;
  readonly source: 'runtime-agent-local-identity';
}

export interface NimiRuntimeAgentIdentitySafetyConflict {
  readonly state: 'detected' | 'not_projected';
  readonly reasonCode: string;
  readonly source: 'runtime-agent-memory-admission' | 'not_projected';
  readonly sourceEventId: string | null;
  readonly message: string | null;
}

export interface NimiRuntimeAgentIdentitySafetyMemoryAdmission {
  readonly state: 'rejected' | 'not_projected';
  readonly reasonCode: string;
  readonly source: 'runtime-agent-memory-admission' | 'not_projected';
  readonly sourceEventId: string | null;
  readonly message: string | null;
  readonly identityConflictRelated: boolean;
}

export interface NimiRuntimeAgentIdentitySafetyOutputFirewall {
  readonly state: 'accepted' | 'approval_required' | 'blocked' | 'quarantined' | 'not_projected';
  readonly reasonCode: string;
  readonly source: 'runtime-delegation-firewall' | 'not_projected';
  readonly diagnosticId: string | null;
  readonly firewallInputId: string | null;
  readonly firewallVerdict: string | null;
  readonly runtimeDecision: string | null;
}

export interface NimiRuntimeAgentIdentitySafetyPromptInjection {
  readonly state: 'suppressed' | 'not_projected';
  readonly reasonCode: string;
  readonly source: 'runtime-delegation-firewall' | 'not_projected';
  readonly firewallInputId: string | null;
}

export interface NimiRuntimeAgentIdentitySafetyProjection {
  readonly schemaVersion: typeof NIMI_RUNTIME_AGENT_IDENTITY_SAFETY_SCHEMA_VERSION;
  readonly observedAt: string;
  readonly state: NimiRuntimeAgentIdentitySafetyState;
  readonly identity: NimiRuntimeAgentIdentitySafetyIdentity;
  readonly identityConflict: NimiRuntimeAgentIdentitySafetyConflict;
  readonly memoryAdmission: NimiRuntimeAgentIdentitySafetyMemoryAdmission;
  readonly outputFirewall: NimiRuntimeAgentIdentitySafetyOutputFirewall;
  readonly promptInjection: NimiRuntimeAgentIdentitySafetyPromptInjection;
  readonly unsupportedProjectionFields: typeof NIMI_RUNTIME_AGENT_IDENTITY_SAFETY_UNSUPPORTED_FIELDS;
}

const NOT_PROJECTED_MEMORY_ADMISSION: NimiRuntimeAgentIdentitySafetyMemoryAdmission = {
  state: 'not_projected',
  reasonCode: 'runtime-agent-memory-admission-rejection-not-projected',
  source: 'not_projected',
  sourceEventId: null,
  message: null,
  identityConflictRelated: false,
};

const NOT_PROJECTED_IDENTITY_CONFLICT: NimiRuntimeAgentIdentitySafetyConflict = {
  state: 'not_projected',
  reasonCode: 'runtime-agent-identity-conflict-event-not-projected',
  source: 'not_projected',
  sourceEventId: null,
  message: null,
};

const NOT_PROJECTED_OUTPUT_FIREWALL: NimiRuntimeAgentIdentitySafetyOutputFirewall = {
  state: 'not_projected',
  reasonCode: 'runtime-agent-output-firewall-verdict-not-projected',
  source: 'not_projected',
  diagnosticId: null,
  firewallInputId: null,
  firewallVerdict: null,
  runtimeDecision: null,
};

const NOT_PROJECTED_PROMPT_INJECTION: NimiRuntimeAgentIdentitySafetyPromptInjection = {
  state: 'not_projected',
  reasonCode: 'runtime-agent-firewall-threat-indicators-not-projected',
  source: 'not_projected',
  firewallInputId: null,
};

export function projectNimiRuntimeAgentIdentitySafety(
  input: NimiRuntimeAgentIdentitySafetyInput,
): NimiRuntimeAgentIdentitySafetyProjection {
  const identity = projectIdentity(input.identity, input.conversationAnchorId);
  const memoryAdmission = projectMemoryAdmission(input.memoryRejections);
  const identityConflict = memoryAdmission.identityConflictRelated
    ? {
      state: 'detected' as const,
      reasonCode: memoryAdmission.reasonCode,
      source: 'runtime-agent-memory-admission' as const,
      sourceEventId: memoryAdmission.sourceEventId,
      message: memoryAdmission.message,
    }
    : NOT_PROJECTED_IDENTITY_CONFLICT;
  const outputFirewall = projectOutputFirewall(input.delegatedDiagnostics, input.delegatedApprovalRequests);
  const promptInjection = projectPromptInjection(outputFirewall);
  const state: NimiRuntimeAgentIdentitySafetyState = identity.state === 'blocked' || outputFirewall.state === 'blocked'
    ? 'blocked'
    : memoryAdmission.state === 'rejected' || outputFirewall.state === 'approval_required' || outputFirewall.state === 'quarantined'
      ? 'warning'
      : 'ready';

  return {
    schemaVersion: NIMI_RUNTIME_AGENT_IDENTITY_SAFETY_SCHEMA_VERSION,
    observedAt: normalizeNimiRuntimeAgentText(input.observedAt) || new Date(0).toISOString(),
    state,
    identity,
    identityConflict,
    memoryAdmission,
    outputFirewall,
    promptInjection,
    unsupportedProjectionFields: NIMI_RUNTIME_AGENT_IDENTITY_SAFETY_UNSUPPORTED_FIELDS,
  };
}

function projectIdentity(
  identityInput: RuntimeLocalAgentIdentityInput | undefined,
  conversationAnchorId: string | null | undefined,
): NimiRuntimeAgentIdentitySafetyIdentity {
  try {
    const identity = identityInput ? projectRuntimeLocalAgentIdentity(identityInput) : null;
    if (!identity) {
      return blockedIdentity('runtime-agent-local-identity-required');
    }
    return {
      state: 'ready',
      ownerUserId: identity.ownerUserId,
      runtimeSourceRef: identity.runtimeSourceRef,
      localAgentRef: identity.localAgentRef,
      conversationAnchorId: normalizeNimiRuntimeAgentText(conversationAnchorId) || null,
      reasonCode: 'runtime-agent-local-identity-ready',
      source: 'runtime-agent-local-identity',
    };
  } catch {
    return blockedIdentity('runtime-agent-local-identity-invalid');
  }
}

function blockedIdentity(reasonCode: string): NimiRuntimeAgentIdentitySafetyIdentity {
  return {
    state: 'blocked',
    ownerUserId: null,
    runtimeSourceRef: null,
    localAgentRef: null,
    conversationAnchorId: null,
    reasonCode,
    source: 'runtime-agent-local-identity',
  };
}

function projectMemoryAdmission(
  rejections: readonly CanonicalMemoryRejection[] | undefined,
): NimiRuntimeAgentIdentitySafetyMemoryAdmission {
  const rejection = (rejections ?? []).find((item) => normalizeNimiRuntimeAgentText(item.message)
    || normalizeNimiRuntimeAgentText(item.sourceEventId)
    || reasonCodeLabel(item.reasonCode) !== 'REASON_CODE_UNSPECIFIED');
  if (!rejection) {
    return NOT_PROJECTED_MEMORY_ADMISSION;
  }
  const reasonCode = reasonCodeLabel(rejection.reasonCode);
  const message = normalizeNimiRuntimeAgentText(rejection.message) || null;
  return {
    state: 'rejected',
    reasonCode,
    source: 'runtime-agent-memory-admission',
    sourceEventId: normalizeNimiRuntimeAgentText(rejection.sourceEventId) || null,
    message,
    identityConflictRelated: isIdentityConflictRelatedRejection(reasonCode, message),
  };
}

function isIdentityConflictRelatedRejection(reasonCode: string, message: string | null): boolean {
  if (reasonCode !== 'PROTOCOL_DOMAIN_FIELD_CONFLICT') {
    return false;
  }
  return /\b(identity|owner|local agent|agent identity|agent_id|local_agent_ref)\b/i.test(message ?? '');
}

function projectOutputFirewall(
  diagnostics: readonly NimiRuntimeAgentDelegatedCapabilityDiagnosticProjection[] | undefined,
  approvals: readonly NimiRuntimeAgentDelegatedApprovalRequestProjection[] | undefined,
): NimiRuntimeAgentIdentitySafetyOutputFirewall {
  const diagnostic = (diagnostics ?? []).find((item) => normalizeNimiRuntimeAgentText(item.firewallVerdict));
  if (diagnostic) {
    return {
      state: firewallState(diagnostic.firewallVerdict),
      reasonCode: normalizeNimiRuntimeAgentText(diagnostic.reasonCode) || 'runtime-agent-output-firewall-verdict',
      source: 'runtime-delegation-firewall',
      diagnosticId: normalizeNimiRuntimeAgentText(diagnostic.diagnosticId) || null,
      firewallInputId: normalizeNimiRuntimeAgentText(diagnostic.firewallInputId) || null,
      firewallVerdict: normalizeNimiRuntimeAgentText(diagnostic.firewallVerdict) || null,
      runtimeDecision: normalizeNimiRuntimeAgentText(diagnostic.runtimeDecision) || null,
    };
  }
  const approval = (approvals ?? []).find((item) => normalizeNimiRuntimeAgentText(item.firewallVerdict));
  if (!approval) {
    return NOT_PROJECTED_OUTPUT_FIREWALL;
  }
  return {
    state: firewallState(approval.firewallVerdict),
    reasonCode: normalizeNimiRuntimeAgentText(approval.reasonCode) || 'runtime-agent-output-firewall-approval-required',
    source: 'runtime-delegation-firewall',
    diagnosticId: null,
    firewallInputId: null,
    firewallVerdict: normalizeNimiRuntimeAgentText(approval.firewallVerdict) || null,
    runtimeDecision: normalizeNimiRuntimeAgentText(approval.state) || null,
  };
}

function projectPromptInjection(
  firewall: NimiRuntimeAgentIdentitySafetyOutputFirewall,
): NimiRuntimeAgentIdentitySafetyPromptInjection {
  if (
    firewall.source === 'runtime-delegation-firewall'
    && (firewall.state === 'blocked' || firewall.state === 'quarantined')
    && firewall.reasonCode === 'DELEG_FIREWALL_QUARANTINED'
  ) {
    return {
      state: 'suppressed',
      reasonCode: firewall.reasonCode,
      source: 'runtime-delegation-firewall',
      firewallInputId: firewall.firewallInputId,
    };
  }
  return NOT_PROJECTED_PROMPT_INJECTION;
}

function firewallState(verdict: unknown): NimiRuntimeAgentIdentitySafetyOutputFirewall['state'] {
  const normalized = normalizeNimiRuntimeAgentText(verdict).toUpperCase();
  switch (normalized) {
    case 'ACCEPTED_OBSERVATION':
    case 'ACCEPTED_SUGGESTION':
      return 'accepted';
    case 'APPROVAL_REQUIRED':
      return 'approval_required';
    case 'QUARANTINED':
      return 'quarantined';
    case 'POLICY_BLOCKED':
    case 'REJECTED':
    case 'SCHEMA_INVALID':
    case 'PROVIDER_DRIFTED':
      return 'blocked';
    default:
      return 'blocked';
  }
}

function reasonCodeLabel(value: ReasonCode | string | number | undefined): string {
  if (typeof value === 'string') {
    return normalizeNimiRuntimeAgentText(value) || 'REASON_CODE_UNSPECIFIED';
  }
  if (typeof value === 'number') {
    return ReasonCode[value] || 'REASON_CODE_UNSPECIFIED';
  }
  return 'REASON_CODE_UNSPECIFIED';
}
