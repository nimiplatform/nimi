import {
  AgentCanonicalMemoryBankMode,
  type AgentCanonicalMemoryBankStatus as RuntimeAgentCanonicalMemoryBankStatusPayload,
} from './generated/runtime/v1/agent_service.js';
import { normalizeRuntimeReasonCode } from './reason-code-messages.js';

export type RuntimeAgentCanonicalMemoryMode = 'baseline' | 'standard' | 'unavailable';

export type RuntimeAgentCanonicalMemoryBankStatus = {
  mode: RuntimeAgentCanonicalMemoryMode;
  bankId?: string;
  embeddingProfileModelId?: string;
  bindingSourceKind?: string;
  blockedReasonCode?: string;
  pendingCutover?: boolean;
  canonicalBankStatus?: string;
  bindAllowed?: boolean;
  cutoverAllowed?: boolean;
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function projectAgentCanonicalMemoryMode(value: AgentCanonicalMemoryBankMode): RuntimeAgentCanonicalMemoryMode {
  switch (value) {
    case AgentCanonicalMemoryBankMode.BASELINE:
      return 'baseline';
    case AgentCanonicalMemoryBankMode.STANDARD:
      return 'standard';
    case AgentCanonicalMemoryBankMode.UNAVAILABLE:
      return 'unavailable';
    default:
      throw new Error('RUNTIME_AGENT_CANONICAL_MEMORY_MODE_REQUIRED');
  }
}

export function projectRuntimeAgentCanonicalMemoryBankStatus(
  status: RuntimeAgentCanonicalMemoryBankStatusPayload | undefined,
): RuntimeAgentCanonicalMemoryBankStatus {
  if (!status) {
    throw new Error('RUNTIME_AGENT_CANONICAL_MEMORY_STATUS_REQUIRED');
  }
  const blockedReasonCode = normalizeRuntimeReasonCode(status.blockedReasonCode) || undefined;
  return {
    mode: projectAgentCanonicalMemoryMode(status.mode),
    bankId: normalizeText(status.bankId) || undefined,
    embeddingProfileModelId: normalizeText(status.embeddingProfile?.modelId) || undefined,
    bindingSourceKind: normalizeText(status.bindingSourceKind) || undefined,
    blockedReasonCode,
    pendingCutover: status.pendingCutover,
    canonicalBankStatus: normalizeText(status.canonicalBankStatus) || undefined,
    bindAllowed: status.bindAllowed,
    cutoverAllowed: status.cutoverAllowed,
  };
}
