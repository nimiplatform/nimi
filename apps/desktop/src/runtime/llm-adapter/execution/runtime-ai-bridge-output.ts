import { asNimiError, createNimiError } from '@nimiplatform/sdk/runtime';
import { ReasonCode, type NimiError } from '@nimiplatform/sdk/types';
import { toBase64, fromBase64 } from '../../util/encoding.js';

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

export function extractEmbeddings(output: DesktopScenarioOutput | undefined): number[][] {
  const variant = output?.output;
  if (variant?.oneofKind !== 'textEmbed') {
    return [];
  }
  return variant.textEmbed.vectors.map((vector: { values: number[] }) => vector.values
    .map((value: number) => Number(value))
    .filter((value: number) => Number.isFinite(value)));
}


export function base64FromBytes(bytes: Uint8Array): string {
  return toBase64(bytes);
}

function decodeBase64Payload(raw: string): Uint8Array {
  const normalized = String(raw || '').trim();
  if (!normalized) return new Uint8Array(0);
  const payload = normalized.includes(',') ? normalized.split(',').slice(-1)[0] || '' : normalized;
  return fromBase64(payload);
}

function parseDataUrl(input: string): {
  mimeType: string;
  payload: string;
  isBase64: boolean;
} | null {
  const normalized = String(input || '').trim();
  const match = normalized.match(/^data:([^;,]+)?(;base64)?,(.*)$/i);
  if (!match) return null;
  const mimeType = String(match[1] || '').trim();
  if (!mimeType) {
    throw createNimiError({
      message: 'audio data url missing mimeType',
      reasonCode: ReasonCode.AI_INPUT_INVALID,
      actionHint: 'set_audio_mime_type',
      source: 'runtime',
    });
  }
  return {
    mimeType,
    payload: String(match[3] || ''),
    isBase64: Boolean(match[2]),
  };
}

export type FetchImpl = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export async function resolveTranscribeAudio(input: {
  audioUri?: string;
  audioBase64?: string;
  mimeType?: string;
  fetchImpl?: FetchImpl;
}): Promise<{
  audioBytes: Uint8Array;
  mimeType: string;
}> {
  const explicitMimeType = String(input.mimeType || '').trim();
  const rawBase64 = String(input.audioBase64 || '').trim();
  if (rawBase64) {
    const parsed = parseDataUrl(rawBase64);
    if (parsed) {
      if (!parsed.isBase64) {
        throw createNimiError({
          message: 'audio data url must be base64',
          reasonCode: ReasonCode.AI_INPUT_INVALID,
          actionHint: 'set_audio_base64_payload',
          source: 'runtime',
        });
      }
      const decoded = decodeBase64Payload(parsed.payload);
      if (decoded.length === 0) {
        throw createNimiError({
          message: 'audio payload empty',
          reasonCode: ReasonCode.AI_INPUT_INVALID,
          actionHint: 'set_audio_payload',
          source: 'runtime',
        });
      }
      return { audioBytes: decoded, mimeType: explicitMimeType || parsed.mimeType };
    }
    const decoded = decodeBase64Payload(rawBase64);
    if (decoded.length === 0) {
      throw createNimiError({
        message: 'audio payload empty',
        reasonCode: ReasonCode.AI_INPUT_INVALID,
        actionHint: 'set_audio_payload',
        source: 'runtime',
      });
    }
    if (!explicitMimeType) {
      throw createNimiError({
        message: 'audio mimeType is required for raw base64 input',
        reasonCode: ReasonCode.AI_INPUT_INVALID,
        actionHint: 'set_audio_mime_type',
        source: 'runtime',
      });
    }
    return { audioBytes: decoded, mimeType: explicitMimeType };
  }

  const audioUri = String(input.audioUri || '').trim();
  if (!audioUri) {
    throw createNimiError({
      message: 'audio source required',
      reasonCode: ReasonCode.AI_INPUT_INVALID,
      actionHint: 'set_audio_uri_or_base64',
      source: 'runtime',
    });
  }

  const parsedDataUrl = parseDataUrl(audioUri);
  if (parsedDataUrl) {
    if (!parsedDataUrl.isBase64) {
      throw createNimiError({
        message: 'audio data url must be base64',
        reasonCode: ReasonCode.AI_INPUT_INVALID,
        actionHint: 'set_audio_base64_payload',
        source: 'runtime',
      });
    }
    const decoded = decodeBase64Payload(parsedDataUrl.payload);
    if (decoded.length === 0) {
      throw createNimiError({
        message: 'audio payload empty',
        reasonCode: ReasonCode.AI_INPUT_INVALID,
        actionHint: 'set_audio_payload',
        source: 'runtime',
      });
    }
    return { audioBytes: decoded, mimeType: explicitMimeType || parsedDataUrl.mimeType };
  }

  const fetchImpl = input.fetchImpl || fetch;
  const response = await fetchImpl(audioUri);
  if (!response.ok) {
    throw createNimiError({
      message: `fetch audio failed HTTP_${response.status}`,
      reasonCode: ReasonCode.AI_PROVIDER_UNAVAILABLE,
      actionHint: 'check_audio_uri_or_network',
      source: 'runtime',
    });
  }
  const arrayBuffer = await response.arrayBuffer();
  const audioBytes = new Uint8Array(arrayBuffer);
  if (audioBytes.length === 0) {
    throw createNimiError({
      message: 'audio payload empty',
      reasonCode: ReasonCode.AI_INPUT_INVALID,
      actionHint: 'set_audio_payload',
      source: 'runtime',
    });
  }
  const responseMimeType = String(response.headers.get('content-type') || '').trim();
  const resolvedMimeType = explicitMimeType || responseMimeType;
  if (!resolvedMimeType) {
    throw createNimiError({
      message: 'audio fetch response missing mimeType',
      reasonCode: ReasonCode.AI_INPUT_INVALID,
      actionHint: 'set_audio_mime_type',
      source: 'runtime',
    });
  }
  return { audioBytes, mimeType: resolvedMimeType };
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
