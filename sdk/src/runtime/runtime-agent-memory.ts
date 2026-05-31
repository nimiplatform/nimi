import { asNimiError } from '../core/errors.js';
import { ReasonCode } from '../types/index.js';
import type {
  MemoryEmbeddingConfig,
  MemoryEmbeddingSourceKind,
} from './memory-embedding-config.js';
import type {
  MemoryBank,
  MemoryBankLocator,
  MemoryRequestContext,
} from './generated/runtime/v1/memory.js';
import { MemoryBankScope } from './generated/runtime/v1/memory.js';
import type {
  MemoryEmbeddingRuntimeState,
} from './memory-embedding-runtime.js';
import {
  parseRuntimeLocalAgentIdentity,
  type RuntimeLocalAgentIdentityProjection,
} from './local-agent-identity.js';

export type RuntimeAgentCanonicalMemoryMode = 'baseline' | 'standard' | 'unavailable';

export type RuntimeAgentCanonicalMemoryBankStatus = {
  mode: RuntimeAgentCanonicalMemoryMode;
  bankId?: string;
  embeddingProfileModelId?: string;
  bindingSourceKind?: MemoryEmbeddingSourceKind;
  blockedReasonCode?: string;
  pendingCutover?: boolean;
};

export type RuntimeAgentMemoryRequestContextInput = {
  runtimeAppId: unknown;
  subjectUserId: unknown;
};

function normalizeText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function projectRuntimeLocalAgentIdentityFromRef(
  localAgentRef: unknown,
): RuntimeLocalAgentIdentityProjection {
  return parseRuntimeLocalAgentIdentity(localAgentRef);
}

export function buildRuntimeMemoryRequestContext(
  input: RuntimeAgentMemoryRequestContextInput,
): MemoryRequestContext {
  return {
    appId: normalizeText(input.runtimeAppId),
    subjectUserId: normalizeText(input.subjectUserId),
  };
}

export function buildRuntimeAgentCoreMemoryBankLocator(agentId: unknown): MemoryBankLocator {
  return {
    scope: MemoryBankScope.AGENT_CORE,
    owner: {
      oneofKind: 'agentCore',
      agentCore: {
        agentId: normalizeText(agentId),
      },
    },
  };
}

export function runtimeMemoryEmbeddingConfigHasBindingIntent(config: MemoryEmbeddingConfig): boolean {
  return Boolean(config.sourceKind && config.bindingRef);
}

export function isRuntimeMemoryUnavailableError(error: unknown): boolean {
  const normalized = asNimiError(error, {
    reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
    source: 'runtime',
  });
  const reasonCode = normalizeText(normalized.reasonCode);
  if (
    reasonCode === 'AI_LOCAL_SERVICE_UNAVAILABLE'
    || reasonCode === 'RUNTIME_GRPC_UNAVAILABLE'
    || reasonCode === ReasonCode.RUNTIME_UNAVAILABLE
  ) {
    return true;
  }
  const message = normalizeText(normalized.message).toLowerCase();
  return message.includes('local memory substrate is not configured')
    || message.includes('memory embedding profile is unavailable');
}

export function isRuntimeMemoryNotFoundError(error: unknown): boolean {
  const normalized = asNimiError(error, {
    reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
    source: 'runtime',
  });
  return normalizeText(normalized.reasonCode) === 'RUNTIME_GRPC_NOT_FOUND'
    || normalizeText(normalized.message).toLowerCase().includes('not found');
}

function isStandardCanonicalBankStatus(value: string | undefined): boolean {
  const normalized = normalizeText(value);
  return normalized === 'bound_equivalent'
    || normalized === 'bound_profile_mismatch'
    || normalized === 'rebuild_pending'
    || normalized === 'cutover_ready';
}

export function projectRuntimeAgentCanonicalMemoryBankStatus(input: {
  state: MemoryEmbeddingRuntimeState;
  config: MemoryEmbeddingConfig;
  bank?: MemoryBank | null;
}): RuntimeAgentCanonicalMemoryBankStatus {
  const bankId = normalizeText(input.bank?.bankId) || undefined;
  const bankEmbeddingProfileModelId = normalizeText(input.bank?.embeddingProfile?.modelId) || undefined;
  const blockedReasonCode = normalizeText(input.state.blockedReasonCode || '') || undefined;
  const bindingSourceKind = input.state.bindingSourceKind || undefined;

  if (isStandardCanonicalBankStatus(input.state.canonicalBankStatus)) {
    return {
      mode: 'standard',
      bankId,
      embeddingProfileModelId: bankEmbeddingProfileModelId
        || normalizeText(input.state.resolvedProfileIdentity)
        || undefined,
      bindingSourceKind,
      blockedReasonCode,
      pendingCutover: input.state.canonicalBankStatus === 'rebuild_pending'
        || input.state.canonicalBankStatus === 'cutover_ready',
    };
  }

  if (
    input.state.resolutionState === 'resolved'
    && runtimeMemoryEmbeddingConfigHasBindingIntent(input.config)
  ) {
    return {
      mode: 'baseline',
      bankId,
      bindingSourceKind,
    };
  }

  return {
    mode: 'unavailable',
    bankId,
    bindingSourceKind,
    blockedReasonCode,
  };
}
