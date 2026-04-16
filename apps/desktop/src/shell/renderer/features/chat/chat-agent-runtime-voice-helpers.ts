import {
  createNimiError,
} from '@nimiplatform/sdk/runtime';
import {
  ScenarioJobStatus,
} from '@nimiplatform/sdk/runtime';
import { ReasonCode } from '@nimiplatform/sdk/types';
import type { AgentChatVoiceReferenceMeaning } from './chat-agent-voice-workflow';
import type {
  ChatAgentVoiceWorkflowPollResult,
} from './chat-agent-runtime-types';
import {
  encodeBytesAsDataUrl,
  normalizeText,
} from './chat-agent-runtime-shared';
import {
  parseAgentVoicePlaybackCueEnvelope,
  type AgentVoicePlaybackCueEnvelope,
  type AgentVoicePlaybackCuePoint,
} from './chat-agent-voice-playback-envelope';
import type { AgentVoicePlaybackVisemeId } from './chat-agent-voice-playback-state';

type ProtoValueLike = {
  kind?: {
    oneofKind?: string;
    boolValue?: boolean;
    numberValue?: number;
    stringValue?: string;
    structValue?: ProtoStructLike;
    listValue?: {
      values?: ProtoValueLike[];
    };
  };
};

type ProtoStructLike = {
  fields?: Record<string, ProtoValueLike>;
};

function protoValueToJson(value?: ProtoValueLike): unknown {
  switch (value?.kind?.oneofKind) {
    case 'boolValue':
      return value.kind.boolValue ?? false;
    case 'numberValue':
      return value.kind.numberValue ?? 0;
    case 'stringValue':
      return value.kind.stringValue ?? '';
    case 'structValue':
      return protoStructToJson(value.kind.structValue);
    case 'listValue':
      return (value.kind.listValue?.values || []).map((item) => protoValueToJson(item));
    default:
      return null;
  }
}

function protoStructToJson(value?: ProtoStructLike): Record<string, unknown> {
  const output: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value?.fields || {})) {
    output[key] = protoValueToJson(item);
  }
  return output;
}

function parseOptionalNumber(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function parseExplicitVisemeId(value: unknown): AgentVoicePlaybackVisemeId | null {
  const normalized = normalizeText(value).toLowerCase();
  switch (normalized) {
    case 'aa':
    case 'a':
    case 'ah':
    case 'open':
    case 'wide':
      return 'aa';
    case 'ee':
    case 'e':
    case 'eh':
    case 'smile':
      return 'ee';
    case 'ih':
    case 'i':
    case 'y':
      return 'ih';
    case 'oh':
    case 'o':
      return 'oh';
    case 'ou':
    case 'u':
    case 'w':
    case 'oo':
      return 'ou';
    default:
      return null;
  }
}

function isSilentToken(token: string): boolean {
  return !token.trim() || /^[\p{P}\p{S}\s]+$/u.test(token);
}

function hashToken(token: string): number {
  let hash = 0;
  for (const char of token) {
    hash = (hash * 33 + char.codePointAt(0)!) >>> 0;
  }
  return hash;
}

function resolveTokenVisemeId(token: string): AgentVoicePlaybackVisemeId | null {
  const normalized = token.trim().toLowerCase();
  if (!normalized) {
    return null;
  }
  if (/[a]/u.test(normalized)) return 'aa';
  if (/[e]/u.test(normalized)) return 'ee';
  if (/[iy]/u.test(normalized)) return 'ih';
  if (/[o]/u.test(normalized)) return 'oh';
  if (/[uw]/u.test(normalized)) return 'ou';
  switch (hashToken(normalized) % 5) {
    case 0:
      return 'aa';
    case 1:
      return 'ee';
    case 2:
      return 'ih';
    case 3:
      return 'oh';
    default:
      return 'ou';
  }
}

function resolveTokenAmplitude(token: string): number {
  const normalized = token.trim();
  if (!normalized) {
    return 0;
  }
  if (isSilentToken(normalized)) {
    return 0.12;
  }
  const codepointLength = Array.from(normalized).length;
  if (codepointLength <= 1) {
    return 0.44;
  }
  if (codepointLength <= 3) {
    return 0.58;
  }
  return 0.68;
}

function toCuePointFromRecord(record: Record<string, unknown>): AgentVoicePlaybackCuePoint | null {
  const offsetMs = parseOptionalNumber(
    record.offsetMs ?? record.startMs ?? record.start ?? record.timeMs ?? record.time,
  );
  const durationMs = parseOptionalNumber(record.durationMs ?? record.duration)
    ?? (() => {
      const startMs = parseOptionalNumber(record.startMs ?? record.start ?? record.offsetMs ?? record.timeMs);
      const endMs = parseOptionalNumber(record.endMs ?? record.end);
      if (startMs == null || endMs == null || endMs <= startMs) {
        return null;
      }
      return endMs - startMs;
    })();
  if (offsetMs == null || durationMs == null || durationMs <= 0) {
    return null;
  }
  const explicitVisemeId = parseExplicitVisemeId(record.visemeId ?? record.viseme ?? record.phoneme ?? record.shape);
  const token = normalizeText(record.token ?? record.text ?? record.label);
  return {
    offsetMs: Math.max(0, offsetMs),
    durationMs,
    amplitude: Math.max(
      0,
      Math.min(parseOptionalNumber(record.amplitude ?? record.weight) ?? resolveTokenAmplitude(token), 1),
    ),
    visemeId: explicitVisemeId ?? resolveTokenVisemeId(token),
  };
}

function asMetadataRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function* iterateCueMetadataScopes(
  metadataRecord: Record<string, unknown>,
): Generator<Record<string, unknown>> {
  yield metadataRecord;
  for (const key of ['timing', 'alignment', 'speech', 'audio', 'tts', 'lipSync']) {
    const nested = asMetadataRecord(metadataRecord[key]);
    if (nested) {
      yield nested;
    }
  }
}

function resolveCueEnvelopeFromArtifactMetadata(
  metadata: ProtoStructLike | Record<string, unknown> | null | undefined,
): AgentVoicePlaybackCueEnvelope | null {
  const metadataRecord: Record<string, unknown> | null = metadata && 'fields' in metadata
    ? protoStructToJson(metadata)
    : ((metadata && typeof metadata === 'object' && !Array.isArray(metadata))
      ? (metadata as Record<string, unknown>)
      : null);
  if (!metadataRecord) {
    return null;
  }
  for (const scope of iterateCueMetadataScopes(metadataRecord)) {
    const admittedEnvelope = parseAgentVoicePlaybackCueEnvelope(scope.playbackCueEnvelope);
    if (admittedEnvelope) {
      return admittedEnvelope;
    }
    for (const key of ['visemes', 'visemeCues', 'mouthCues', 'phonemes']) {
      const list = Array.isArray(scope[key]) ? scope[key] : [];
      const cues = list
        .map((item) => (
          item && typeof item === 'object' && !Array.isArray(item)
            ? toCuePointFromRecord(item as Record<string, unknown>)
            : null
        ))
        .filter((item): item is AgentVoicePlaybackCuePoint => Boolean(item))
        .sort((left, right) => left.offsetMs - right.offsetMs);
      if (cues.length > 0) {
        return {
          version: 'v1',
          source: 'provider',
          cues,
        };
      }
    }
  }
  return null;
}

function resolveCueEnvelopeFromSpeechAlignment(
  alignment: {
    tokens?: Array<{
      token?: string;
      startMs?: string;
      endMs?: string;
    }>;
  } | null | undefined,
): AgentVoicePlaybackCueEnvelope | null {
  const cues = Array.isArray(alignment?.tokens)
    ? alignment.tokens
      .map((token) => {
        const text = normalizeText(token?.token);
        const startMs = parseOptionalNumber(token?.startMs);
        const endMs = parseOptionalNumber(token?.endMs);
        if (startMs == null || endMs == null || endMs <= startMs || isSilentToken(text)) {
          return null;
        }
        return {
          offsetMs: startMs,
          durationMs: endMs - startMs,
          amplitude: resolveTokenAmplitude(text),
          visemeId: resolveTokenVisemeId(text),
        } satisfies AgentVoicePlaybackCuePoint;
      })
      .filter((item): item is AgentVoicePlaybackCuePoint => Boolean(item))
      .sort((left, right) => left.offsetMs - right.offsetMs)
    : [];
  if (cues.length === 0) {
    return null;
  }
  return {
    version: 'v1',
    source: 'runtime',
    cues,
  };
}

export function resolveVoicePlaybackCueEnvelopeFromArtifact(
  artifact: {
    speechAlignment?: {
      tokens?: Array<{
        token?: string;
        startMs?: string;
        endMs?: string;
      }>;
    } | null;
    metadata?: ProtoStructLike | Record<string, unknown> | null;
  } | null | undefined,
): AgentVoicePlaybackCueEnvelope | null {
  if (!artifact) {
    return null;
  }
  return resolveCueEnvelopeFromArtifactMetadata(artifact.metadata)
    || resolveCueEnvelopeFromSpeechAlignment(artifact.speechAlignment);
}

export function resolveWorkflowJobStatus(status: number): ChatAgentVoiceWorkflowPollResult['workflowStatus'] {
  switch (status) {
    case ScenarioJobStatus.SUBMITTED:
      return 'submitted';
    case ScenarioJobStatus.QUEUED:
      return 'queued';
    case ScenarioJobStatus.RUNNING:
      return 'running';
    case ScenarioJobStatus.COMPLETED:
      return 'complete';
    case ScenarioJobStatus.CANCELED:
      return 'canceled';
    case ScenarioJobStatus.FAILED:
    case ScenarioJobStatus.TIMEOUT:
      return 'failed';
    default:
      return 'submitted';
  }
}

export function toRuntimeVoiceReference(
  reference: AgentChatVoiceReferenceMeaning,
): {
  kind: number;
  reference:
    | { oneofKind: 'presetVoiceId'; presetVoiceId: string }
    | { oneofKind: 'voiceAssetId'; voiceAssetId: string }
    | { oneofKind: 'providerVoiceRef'; providerVoiceRef: string };
} {
  if (reference.kind === 'preset_voice_id') {
    return {
      kind: 1,
      reference: {
        oneofKind: 'presetVoiceId',
        presetVoiceId: reference.stableRef,
      },
    };
  }
  if (reference.kind === 'voice_asset_id') {
    return {
      kind: 2,
      reference: {
        oneofKind: 'voiceAssetId',
        voiceAssetId: reference.stableRef,
      },
    };
  }
  return {
    kind: 3,
    reference: {
      oneofKind: 'providerVoiceRef',
      providerVoiceRef: reference.stableRef,
    },
  };
}

export function resolveVoiceReferenceFromAsset(
  asset: { voiceAssetId?: unknown; providerVoiceRef?: unknown } | null | undefined,
): {
  voiceReference: AgentChatVoiceReferenceMeaning | null;
  voiceAssetId: string | null;
  providerVoiceRef: string | null;
} {
  const voiceAssetId = normalizeText(asset?.voiceAssetId) || null;
  const providerVoiceRef = normalizeText(asset?.providerVoiceRef) || null;
  if (voiceAssetId) {
    return {
      voiceReference: {
        kind: 'voice_asset_id',
        stableRef: voiceAssetId,
      },
      voiceAssetId,
      providerVoiceRef,
    };
  }
  if (providerVoiceRef) {
    return {
      voiceReference: {
        kind: 'provider_voice_ref',
        stableRef: providerVoiceRef,
      },
      voiceAssetId,
      providerVoiceRef,
    };
  }
  return {
    voiceReference: null,
    voiceAssetId,
    providerVoiceRef,
  };
}

export function resolveMediaUrlFromArtifact(input: {
  artifact: {
    mimeType?: unknown;
    uri?: unknown;
    bytes?: Uint8Array | null;
    artifactId?: unknown;
    speechAlignment?: {
      tokens?: Array<{
        token?: string;
        startMs?: string;
        endMs?: string;
      }>;
    } | null;
    metadata?: ProtoStructLike | Record<string, unknown> | null;
  } | null | undefined;
  defaultMimeType: string;
  missingArtifactMessage: string;
  missingMediaMessage: string;
  actionHint: string;
}): {
  mediaUrl: string;
  mimeType: string;
  artifactId: string | null;
  playbackCueEnvelope: AgentVoicePlaybackCueEnvelope | null;
} {
  const artifact = input.artifact;
  if (!artifact) {
    throw createNimiError({
      message: input.missingArtifactMessage,
      reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
      actionHint: input.actionHint,
      source: 'runtime',
    });
  }
  const mimeType = normalizeText(artifact.mimeType) || input.defaultMimeType;
  const uri = normalizeText(artifact.uri);
  const bytes = artifact.bytes || null;
  const mediaUrl = uri || (bytes && bytes.length > 0 ? encodeBytesAsDataUrl(mimeType, bytes) : '');
  if (!mediaUrl) {
    throw createNimiError({
      message: input.missingMediaMessage,
      reasonCode: ReasonCode.RUNTIME_CALL_FAILED,
      actionHint: input.actionHint,
      source: 'runtime',
    });
  }
  return {
    mediaUrl,
    mimeType,
    artifactId: normalizeText(artifact.artifactId) || null,
    playbackCueEnvelope: resolveVoicePlaybackCueEnvelopeFromArtifact(artifact),
  };
}
