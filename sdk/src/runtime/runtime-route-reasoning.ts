import type { NimiReasoningConfig } from './types-media.js';
import type {
  RuntimeResolvedBinding,
  RuntimeRouteDescribeResult,
} from './runtime-route.js';

export type RuntimeRouteReasoningPreference = 'off' | 'on';

export type RuntimeTextRouteReasoningSupportReason =
  | 'missing_route'
  | 'metadata_missing'
  | 'trace_mode_unsupported'
  | 'thinking_unsupported';

export type RuntimeTextRouteReasoningSupport = {
  supported: boolean;
  reason: RuntimeTextRouteReasoningSupportReason | null;
};

export type RuntimeTextRouteReasoningProjectionInput = {
  resolvedBinding?: RuntimeResolvedBinding | null;
  metadata?: RuntimeRouteDescribeResult | null;
};

const RUNTIME_REASONING_OFF_CONFIG: NimiReasoningConfig = {
  mode: 'off',
  traceMode: 'hide',
};

const RUNTIME_REASONING_ON_CONFIG: NimiReasoningConfig = {
  mode: 'on',
  traceMode: 'separate',
};

export function normalizeRuntimeRouteReasoningPreference(value: unknown): RuntimeRouteReasoningPreference {
  return value === 'on' ? 'on' : 'off';
}

export function resolveRuntimeTextRouteReasoningSupport(
  input: RuntimeTextRouteReasoningProjectionInput | null | undefined,
): RuntimeTextRouteReasoningSupport {
  if (!input?.resolvedBinding) {
    return {
      supported: false,
      reason: 'missing_route',
    };
  }
  if (input.metadata?.metadataKind !== 'text.generate') {
    return {
      supported: false,
      reason: 'metadata_missing',
    };
  }
  if (!input.metadata.metadata.supportsThinking) {
    return {
      supported: false,
      reason: 'thinking_unsupported',
    };
  }
  if (input.metadata.metadata.traceModeSupport !== 'separate') {
    return {
      supported: false,
      reason: 'trace_mode_unsupported',
    };
  }
  return {
    supported: true,
    reason: null,
  };
}

export function resolveRuntimeRouteReasoningConfig(
  preference: RuntimeRouteReasoningPreference,
  support: RuntimeTextRouteReasoningSupport,
): NimiReasoningConfig {
  if (preference === 'on' && support.supported) {
    return { ...RUNTIME_REASONING_ON_CONFIG };
  }
  return { ...RUNTIME_REASONING_OFF_CONFIG };
}
