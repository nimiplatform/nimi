import type {
  CapabilityRequest,
  CredentialRef,
  ModelProfile,
} from '../types';

export type ModelRuntimeStats = {
  ttftP95Ms?: number;
  latencyP95Ms?: number;
};

function contextLimit(profile: ModelProfile) {
  return profile.constraints.maxContextTokens ?? profile.fingerprint?.maxInputTokens ?? 0;
}

function supportsStreaming(profile: ModelProfile) {
  if (profile.constraints.allowStreaming === false) {
    return false;
  }
  return profile.fingerprint?.supportsStreaming !== false;
}

function supportsToolUse(profile: ModelProfile) {
  if (profile.constraints.allowToolUse === false) {
    return false;
  }
  return profile.constraints.allowToolUse === true || profile.fingerprint?.supportsToolUse === true;
}

function healthScore(profile: ModelProfile) {
  if (profile.healthStatus === 'healthy') {
    return 35;
  }

  if (profile.healthStatus === 'unknown') {
    return 10;
  }

  if (profile.healthStatus === 'unsupported') {
    return -20;
  }

  return -40;
}

export function findCredentialRef(
  profile: ModelProfile,
  refs: CredentialRef[] | undefined,
  refsByProvider: Record<string, CredentialRef[]> | undefined,
): CredentialRef {
  const byProvider = refsByProvider?.[profile.providerType] ?? refsByProvider?.[profile.providerType.toLowerCase()];
  const pool = byProvider && byProvider.length > 0 ? byProvider : refs;
  if (pool && pool.length > 0) {
    return pool[0]!;
  }

  return {
    refId: `implicit:${profile.providerType}:default`,
    provider: profile.providerType,
    profileId: 'default',
  };
}

export function scoreProfile(
  profile: ModelProfile,
  request: CapabilityRequest,
  stats: ModelRuntimeStats | undefined,
): { score: number; reason: string } | null {
  if (!profile.capabilities.includes(request.capability)) {
    return null;
  }

  if (request.minContextTokens) {
    const limit = contextLimit(profile);
    if (limit > 0 && limit < request.minContextTokens) {
      return null;
    }
  }

  if (request.requireStreaming && !supportsStreaming(profile)) {
    return null;
  }

  if (request.requireToolUse && !supportsToolUse(profile)) {
    return null;
  }

  let score = 100;
  const reasons: string[] = [];

  if (request.preferredModelId && profile.id === request.preferredModelId) {
    score += 1_000;
    reasons.push('preferred model');
  }

  score += healthScore(profile);
  reasons.push(`health=${profile.healthStatus}`);

  const limit = contextLimit(profile);
  if (limit > 0) {
    score += Math.min(25, Math.floor(limit / 8_192));
    reasons.push(`context=${limit}`);
  } else {
    score -= 5;
  }

  if (request.requireStreaming) {
    score += 15;
  }

  if (request.requireToolUse && supportsToolUse(profile)) {
    score += 20;
  }

  if (stats?.ttftP95Ms && stats.ttftP95Ms > 2_000) {
    score -= Math.min(40, Math.floor((stats.ttftP95Ms - 2_000) / 250));
    reasons.push(`ttft=${stats.ttftP95Ms}`);
  }

  if (stats?.latencyP95Ms && stats.latencyP95Ms > 6_000) {
    score -= Math.min(30, Math.floor((stats.latencyP95Ms - 6_000) / 500));
    reasons.push(`latency=${stats.latencyP95Ms}`);
  }

  return {
    score,
    reason: reasons.join('; '),
  };
}

export function isFallbackErrorCode(
  code: 'MODEL_NOT_FOUND' | 'PROVIDER_UNREACHABLE' | 'AUTH_FAILED' | 'RATE_LIMITED' | 'CONTEXT_OVERFLOW' | 'TIMEOUT' | 'UNKNOWN',
) {
  return (
    code === 'RATE_LIMITED' ||
    code === 'TIMEOUT' ||
    code === 'PROVIDER_UNREACHABLE' ||
    code === 'MODEL_NOT_FOUND' ||
    code === 'AUTH_FAILED' ||
    code === 'CONTEXT_OVERFLOW'
  );
}
