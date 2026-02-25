import type { CapabilityRequest, ModelCapability, ModelProfile } from '../types';

function canModelServeCapability(model: ModelProfile, capability: ModelCapability) {
  return model.capabilities.includes(capability);
}

function getModelContextLimit(profile: ModelProfile) {
  return profile.constraints.maxContextTokens ?? profile.fingerprint?.maxInputTokens ?? 0;
}

function canServeStreaming(profile: ModelProfile) {
  if (profile.constraints.allowStreaming === false) {
    return false;
  }
  return profile.fingerprint?.supportsStreaming !== false;
}

function canServeToolUse(profile: ModelProfile) {
  if (profile.constraints.allowToolUse === false) {
    return false;
  }
  return profile.constraints.allowToolUse === true || profile.fingerprint?.supportsToolUse === true;
}

export function filterByCapability(
  profiles: ModelProfile[],
  capability: ModelCapability,
  constraints?: Partial<CapabilityRequest>,
) {
  return profiles.filter((profile) => {
    if (!canModelServeCapability(profile, capability)) {
      return false;
    }

    if (constraints?.minContextTokens) {
      const contextLimit = getModelContextLimit(profile);
      if (contextLimit > 0 && contextLimit < constraints.minContextTokens) {
        return false;
      }
    }

    if (constraints?.requireStreaming && !canServeStreaming(profile)) {
      return false;
    }

    if (constraints?.requireToolUse && !canServeToolUse(profile)) {
      return false;
    }

    return true;
  });
}
