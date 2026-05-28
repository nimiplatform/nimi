import { asNimiError } from '@nimiplatform/sdk/runtime';
import { ReasonCode, type NimiError } from '@nimiplatform/sdk/types';

const RUNTIME_REASON_CODE_TO_LOCAL_AI: Record<string, string> = {
  AI_MODEL_NOT_FOUND: ReasonCode.AI_MODEL_NOT_FOUND,
  AI_MODEL_NOT_READY: 'LOCAL_AI_CAPABILITY_MISSING',
  AI_MODALITY_NOT_SUPPORTED: ReasonCode.AI_MODALITY_NOT_SUPPORTED,
  AI_MEDIA_OPTION_UNSUPPORTED: ReasonCode.AI_MEDIA_OPTION_UNSUPPORTED,
  AI_PROVIDER_UNAVAILABLE: 'LOCAL_AI_SERVICE_UNREACHABLE',
  AI_PROVIDER_TIMEOUT: 'LOCAL_AI_PROVIDER_TIMEOUT',
  AI_ROUTE_UNSUPPORTED: 'LOCAL_AI_CAPABILITY_MISSING',
  AI_ROUTE_FALLBACK_DENIED: 'LOCAL_AI_CAPABILITY_MISSING',
  AI_INPUT_INVALID: ReasonCode.AI_INPUT_INVALID,
  AI_OUTPUT_INVALID: 'LOCAL_AI_PROVIDER_INTERNAL_ERROR',
  AI_STREAM_BROKEN: 'LOCAL_AI_PROVIDER_INTERNAL_ERROR',
  AI_CONTENT_FILTER_BLOCKED: 'LOCAL_AI_CAPABILITY_MISSING',
};

const AI_REASON_CODE_NUMERIC: Record<number, string> = {
  200: 'AI_MODEL_NOT_FOUND',
  201: 'AI_MODEL_NOT_READY',
  202: 'AI_PROVIDER_UNAVAILABLE',
  203: 'AI_PROVIDER_TIMEOUT',
  204: 'AI_ROUTE_UNSUPPORTED',
  205: 'AI_ROUTE_FALLBACK_DENIED',
  206: 'AI_INPUT_INVALID',
  207: 'AI_OUTPUT_INVALID',
  208: 'AI_STREAM_BROKEN',
  209: 'AI_CONTENT_FILTER_BLOCKED',
  351: 'AI_MODALITY_NOT_SUPPORTED',
  411: 'AI_MEDIA_OPTION_UNSUPPORTED',
  560: 'AI_LOCAL_SPEECH_PREFLIGHT_BLOCKED',
  561: 'AI_LOCAL_SPEECH_DOWNLOAD_CONFIRMATION_REQUIRED',
  562: 'AI_LOCAL_SPEECH_ENV_INIT_FAILED',
  563: 'AI_LOCAL_SPEECH_HOST_INIT_FAILED',
  564: 'AI_LOCAL_SPEECH_CAPABILITY_DOWNLOAD_FAILED',
  565: 'AI_LOCAL_SPEECH_BUNDLE_DEGRADED',
};

const DEFAULT_RUNTIME_ACTION_HINT = 'retry_or_check_runtime_status';

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return value as Record<string, unknown>;
}

export type DesktopScenarioOutput = {
  output?: (
    | {
      oneofKind: 'textGenerate';
      textGenerate: {
        text: string;
      };
    }
    | {
      oneofKind: 'textEmbed';
      textEmbed: {
        vectors: Array<{
          values: number[];
        }>;
      };
    }
    | {
      oneofKind: 'imageGenerate';
      imageGenerate: {
        artifacts: unknown[];
      };
    }
    | {
      oneofKind: 'videoGenerate';
      videoGenerate: {
        artifacts: unknown[];
      };
    }
    | {
      oneofKind: 'speechTranscribe';
      speechTranscribe: {
        text: string;
        artifacts: unknown[];
      };
    }
    | {
      oneofKind: 'speechSynthesize';
      speechSynthesize: {
        artifacts: unknown[];
      };
    }
    | {
      oneofKind: 'musicGenerate';
      musicGenerate: {
        artifacts: unknown[];
      };
    }
    | {
      oneofKind: 'worldGenerate';
      worldGenerate: {
        worldId: string;
        spzUrls?: Record<string, string>;
        artifacts: unknown[];
      };
    }
    | {
      oneofKind: undefined;
    }
  );
};

export function extractTextFromGenerateOutput(output: DesktopScenarioOutput | undefined): string {
  const variant = output?.output;
  if (variant?.oneofKind === 'textGenerate') {
    return String(variant.textGenerate.text || '').trim();
  }
  return '';
}

function extractReasonCodeCandidate(value: unknown): string | null {
  if (typeof value === 'string') {
    const normalized = value.trim();
    if (!normalized) return null;
    if (/^\d+$/.test(normalized)) return AI_REASON_CODE_NUMERIC[Number(normalized)] || null;
    return normalized;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return AI_REASON_CODE_NUMERIC[value] || null;
  return null;
}

export function extractRuntimeReasonCode(error: unknown): string | null {
  if (isRuntimeNimiError(error)) {
    const fromNimiError = extractReasonCodeCandidate(error.reasonCode);
    if (fromNimiError) return fromNimiError;
  }
  const record = asRecord(error);
  const direct = extractReasonCodeCandidate(record.reasonCode);
  if (direct) return direct;
  const message = String(record.message || (error instanceof Error ? error.message : '') || '').trim();
  if (!message) return null;
  const explicit = message.match(/\b(AI_[A-Z_]+)\b/);
  if (explicit?.[1]) return explicit[1];
  const numeric = message.match(/\b(\d{3})\b/);
  if (numeric?.[1]) {
    const mapped = AI_REASON_CODE_NUMERIC[Number(numeric[1])];
    if (mapped) return mapped;
  }
  return null;
}

export function toLocalRuntimeReasonCode(error: unknown): string | null {
  const runtimeCode = extractRuntimeReasonCode(error);
  if (!runtimeCode) return null;
  return RUNTIME_REASON_CODE_TO_LOCAL_AI[runtimeCode] || null;
}

function isRuntimeNimiError(error: unknown): error is NimiError {
  if (!error || typeof error !== 'object') return false;
  const record = error as Record<string, unknown>;
  return typeof record.reasonCode === 'string' && typeof record.actionHint === 'string';
}

export function asRuntimeInvokeError(
  error: unknown,
  fallback: {
    traceId?: string;
    reasonCode?: string;
    actionHint?: string;
  } = {},
): NimiError {
  return asNimiError(error, {
    reasonCode: fallback.reasonCode || ReasonCode.RUNTIME_CALL_FAILED,
    actionHint: fallback.actionHint || DEFAULT_RUNTIME_ACTION_HINT,
    traceId: fallback.traceId || '',
    source: 'runtime',
  });
}
