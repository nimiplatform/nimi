import type { ModelCapability, ModelProfile } from '../types';

export type ModelProfileOverlay = Partial<Omit<ModelProfile, 'id' | 'providerType' | 'model' | 'endpoint'>>;

export type ModelTemplateRule = {
  prefix: string;
  patch: ModelProfileOverlay;
};

export const DEFAULT_TEMPLATES: ModelTemplateRule[] = [
  {
    prefix: 'claude-',
    patch: {
      constraints: {
        maxContextTokens: 200_000,
        allowStreaming: true,
        allowToolUse: true,
      },
      fingerprint: {
        supportsStreaming: true,
        supportsToolUse: true,
        discoveredFrom: 'template',
      },
    },
  },
  {
    prefix: 'gpt-4',
    patch: {
      constraints: {
        maxContextTokens: 128_000,
        allowStreaming: true,
        allowToolUse: true,
      },
      fingerprint: {
        supportsStreaming: true,
        supportsToolUse: true,
        discoveredFrom: 'template',
      },
    },
  },
  {
    prefix: 'o3',
    patch: {
      constraints: {
        maxContextTokens: 128_000,
        allowStreaming: true,
        allowToolUse: true,
      },
      fingerprint: {
        supportsStreaming: true,
        supportsToolUse: true,
        discoveredFrom: 'template',
      },
    },
  },
  {
    prefix: 'llama',
    patch: {
      constraints: {
        maxContextTokens: 8_192,
        allowStreaming: true,
        allowToolUse: false,
      },
      fingerprint: {
        supportsStreaming: true,
        supportsToolUse: false,
        discoveredFrom: 'template',
      },
    },
  },
  {
    prefix: 'qwen',
    patch: {
      constraints: {
        maxContextTokens: 32_768,
        allowStreaming: true,
      },
      fingerprint: {
        supportsStreaming: true,
        discoveredFrom: 'template',
      },
    },
  },
  {
    prefix: 'deepseek',
    patch: {
      constraints: {
        maxContextTokens: 64_000,
        allowStreaming: true,
        allowToolUse: true,
      },
      fingerprint: {
        supportsStreaming: true,
        supportsToolUse: true,
        discoveredFrom: 'template',
      },
    },
  },
];

function mergeCapabilities(base: ModelCapability[], patch: ModelCapability[] | undefined): ModelCapability[] {
  if (!patch || patch.length === 0) {
    return [...base];
  }

  return Array.from(new Set([...base, ...patch]));
}

export function mergeProfile(base: ModelProfile, patch: ModelProfileOverlay): ModelProfile {
  return {
    ...base,
    capabilities: mergeCapabilities(base.capabilities, patch.capabilities),
    constraints: {
      ...base.constraints,
      ...(patch.constraints ?? {}),
    },
    fingerprint: {
      ...(base.fingerprint ?? {}),
      ...(patch.fingerprint ?? {}),
    },
    healthStatus: patch.healthStatus ?? base.healthStatus,
    lastCheckedAt: patch.lastCheckedAt ?? base.lastCheckedAt,
  };
}
