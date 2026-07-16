import type { JsonValue } from '../../types';
import {
  asRecord,
  assertExactKeys,
  assertExactProjectionKeys,
  assertNoAuthorityMaterial,
  assertSafeProjection,
  canonicalString,
  decimalCursor,
  localAppError,
  localAppProjectionError,
  nonNegativeInteger,
  optionalCursor,
  projectionText,
  requireText,
} from './local-app-runtime-platform-validation';

const MAX_LOCAL_APP_STORAGE_PATH_BYTES = 240;
const MAX_LOCAL_APP_STORAGE_DOCUMENT_BYTES = 256 * 1024;
const MAX_LOCAL_APP_VOICE_AUDIO_BYTES = 8 * 1024 * 1024;
const MAX_LOCAL_APP_VOICE_CHUNK_BYTES = 32 * 1024 * 1024;
const MAX_LOCAL_APP_VOICE_TRANSCRIPT_BYTES = 64 * 1024;
const LOCAL_APP_AUDIO_MIME_TYPES = new Set([
  'audio/webm', 'audio/ogg', 'audio/wav', 'audio/mpeg', 'audio/mp4', 'audio/flac',
]);

export type NimiAppRuntimeStorageDocument = {
  readonly value: JsonValue;
  readonly sizeBytes: number;
};

export type NimiAppRuntimeStorageRemoveResult = {
  readonly removed: boolean;
};

export type NimiAppRuntimeAgentTranscribeVoiceInput = {
  readonly agentId: string;
  readonly clientRequestId: string;
  readonly audio: Uint8Array;
  readonly mimeType: string;
};

export type NimiAppRuntimeAgentVoiceTranscription = {
  readonly clientRequestId: string;
  readonly text: string;
};

export type NimiAppRuntimeAgentSubscribeVoiceStreamInput = {
  readonly agentId: string;
  readonly conversationAnchorId: string;
  readonly turnId: string;
  readonly voiceStreamId: string;
  readonly cursor?: string;
};

export type NimiAppRuntimeAgentVoiceOutputMode =
  | 'native_stream'
  | 'simulated_stream'
  | 'batch_final_artifact'
  | 'text_only';

export type NimiAppRuntimeAgentVoicePlaybackState =
  | 'active'
  | 'completed'
  | 'failed'
  | 'interrupted'
  | 'canceled';

export type NimiAppRuntimeAgentVoiceStreamEvent = {
  readonly voiceStreamId: string;
  readonly conversationAnchorId: string;
  readonly turnId: string;
  readonly streamId: string;
  readonly messageId: string;
  readonly chunkSequence: string;
  readonly chunk: Uint8Array;
  readonly mimeType: string;
  readonly voiceOutputMode: NimiAppRuntimeAgentVoiceOutputMode;
  readonly playbackTarget: string;
  readonly terminal: boolean;
  readonly voicePlaybackState: NimiAppRuntimeAgentVoicePlaybackState;
  readonly terminalReason: string;
  readonly replayTruncated: false;
};

export type NimiAppRuntimeAgentVoiceStreamPage = {
  readonly cursor: string;
  readonly events: readonly [NimiAppRuntimeAgentVoiceStreamEvent];
};

type StorageShell = {
  readonly readJson: (relativePath: string) => Promise<unknown>;
  readonly writeJson: (relativePath: string, value: JsonValue) => Promise<unknown>;
  readonly removeJson: (relativePath: string) => Promise<unknown>;
};

type VoiceShell = {
  readonly transcribeVoice: (input: NimiAppRuntimeAgentTranscribeVoiceInput) => Promise<unknown>;
  readonly subscribeVoiceStream: (input: NimiAppRuntimeAgentSubscribeVoiceStreamInput) => Promise<unknown>;
};

export function createNimiAppRuntimeStorageClient(standardShell: StorageShell) {
  return Object.freeze({
    readJson: async (relativePath: string) => projectStorageDocument(
      await standardShell.readJson(requireStorageRelativePath(relativePath)),
    ),
    writeJson: async (relativePath: string, value: JsonValue) => {
      const path = requireStorageRelativePath(relativePath);
      assertStorageJsonValue(value);
      const encoded = JSON.stringify(value);
      if (
        encoded === undefined
        || new TextEncoder().encode(encoded).byteLength > MAX_LOCAL_APP_STORAGE_DOCUMENT_BYTES
      ) {
        return localAppError(
          'Local-app storage document exceeds the admitted bound.',
          'SDK_LOCAL_APP_STORAGE_DOCUMENT_TOO_LARGE',
          'reduce_storage_document_size',
        );
      }
      return projectStorageDocument(await standardShell.writeJson(path, value));
    },
    removeJson: async (relativePath: string) => projectStorageRemoveResult(
      await standardShell.removeJson(requireStorageRelativePath(relativePath)),
    ),
  });
}

export function createNimiAppRuntimeVoiceClient(standardShell: VoiceShell) {
  return Object.freeze({
    transcribeVoice: async (voiceInput: NimiAppRuntimeAgentTranscribeVoiceInput) => {
      assertNoAuthorityMaterial(voiceInput);
      assertExactKeys(
        voiceInput,
        ['agentId', 'clientRequestId', 'audio', 'mimeType'],
        'local-app voice transcription input',
      );
      if (
        !(voiceInput.audio instanceof Uint8Array)
        || voiceInput.audio.byteLength === 0
        || voiceInput.audio.byteLength > MAX_LOCAL_APP_VOICE_AUDIO_BYTES
      ) {
        return localAppError(
          'Local-app voice transcription audio is invalid.',
          'SDK_LOCAL_APP_VOICE_AUDIO_INVALID',
          'provide_bounded_voice_audio',
        );
      }
      const normalized = {
        agentId: requireText(voiceInput.agentId, 'agentId'),
        clientRequestId: requireText(voiceInput.clientRequestId, 'clientRequestId'),
        audio: Uint8Array.from(voiceInput.audio),
        mimeType: requireAudioMime(voiceInput.mimeType),
      };
      return projectVoiceTranscription(
        await standardShell.transcribeVoice(normalized),
        normalized.clientRequestId,
      );
    },
    subscribeVoiceStream: async (voiceInput: NimiAppRuntimeAgentSubscribeVoiceStreamInput) => {
      assertNoAuthorityMaterial(voiceInput);
      assertExactKeys(
        voiceInput,
        ['agentId', 'conversationAnchorId', 'turnId', 'voiceStreamId', 'cursor'],
        'local-app voice stream input',
      );
      const cursor = optionalCursor(voiceInput.cursor);
      const normalized = {
        agentId: requireText(voiceInput.agentId, 'agentId'),
        conversationAnchorId: requireText(voiceInput.conversationAnchorId, 'conversationAnchorId'),
        turnId: requireText(voiceInput.turnId, 'turnId'),
        voiceStreamId: requireText(voiceInput.voiceStreamId, 'voiceStreamId'),
        ...(cursor ? { cursor } : {}),
      };
      return projectVoiceStreamPage(
        await standardShell.subscribeVoiceStream(normalized),
        normalized,
        cursor,
      );
    },
  });
}

function projectVoiceTranscription(
  value: unknown,
  expectedRequestId: string,
): NimiAppRuntimeAgentVoiceTranscription {
  const record = asRecord(value);
  assertSafeProjection(record);
  assertExactProjectionKeys(record, ['clientRequestId', 'text'], 'voice transcription');
  const clientRequestId = projectionText(record.clientRequestId, 'clientRequestId');
  if (
    clientRequestId !== expectedRequestId
    || typeof record.text !== 'string'
    || new TextEncoder().encode(record.text).byteLength > MAX_LOCAL_APP_VOICE_TRANSCRIPT_BYTES
  ) {
    localAppProjectionError('voice transcription correlation');
  }
  return { clientRequestId, text: record.text };
}

function projectVoiceStreamPage(
  value: unknown,
  expected: Omit<NimiAppRuntimeAgentSubscribeVoiceStreamInput, 'cursor'>,
  previousCursor: string | undefined,
): NimiAppRuntimeAgentVoiceStreamPage {
  const record = asRecord(value);
  assertSafeProjection(record);
  assertExactProjectionKeys(record, ['cursor', 'events'], 'voice stream page');
  const cursor = decimalCursor(record.cursor, 'voice stream cursor');
  if (previousCursor !== undefined && BigInt(cursor) <= BigInt(previousCursor)) {
    localAppProjectionError('voice stream cursor progression');
  }
  if (!Array.isArray(record.events) || record.events.length !== 1) {
    localAppProjectionError('voice stream page event count');
  }
  const raw = asRecord(record.events[0]);
  assertExactProjectionKeys(raw, [
    'voiceStreamId', 'conversationAnchorId', 'turnId', 'streamId', 'messageId',
    'chunkSequence', 'chunkBase64', 'mimeType', 'voiceOutputMode', 'playbackTarget',
    'terminal', 'voicePlaybackState', 'terminalReason', 'replayTruncated',
  ], 'voice stream event');
  const voiceStreamId = projectionText(raw.voiceStreamId, 'voiceStreamId');
  const conversationAnchorId = projectionText(raw.conversationAnchorId, 'conversationAnchorId');
  const turnId = projectionText(raw.turnId, 'turnId');
  if (
    voiceStreamId !== expected.voiceStreamId
    || conversationAnchorId !== expected.conversationAnchorId
    || turnId !== expected.turnId
    || raw.replayTruncated !== false
    || typeof raw.terminal !== 'boolean'
  ) {
    localAppProjectionError('voice stream event correlation');
  }
  const chunk = decodeCanonicalBase64(raw.chunkBase64, MAX_LOCAL_APP_VOICE_CHUNK_BYTES, true);
  const mimeType = canonicalString(raw.mimeType, 'mimeType');
  if (
    (raw.terminal && chunk.byteLength !== 0)
    || (!raw.terminal && (chunk.byteLength === 0 || !LOCAL_APP_AUDIO_MIME_TYPES.has(mimeType)))
  ) {
    localAppProjectionError('voice stream chunk');
  }
  const event: NimiAppRuntimeAgentVoiceStreamEvent = {
    voiceStreamId,
    conversationAnchorId,
    turnId,
    streamId: projectionText(raw.streamId, 'streamId'),
    messageId: projectionText(raw.messageId, 'messageId'),
    chunkSequence: decimalCursor(raw.chunkSequence, 'chunkSequence'),
    chunk,
    mimeType,
    voiceOutputMode: projectVoiceOutputMode(raw.voiceOutputMode),
    playbackTarget: canonicalString(raw.playbackTarget, 'playbackTarget'),
    terminal: raw.terminal,
    voicePlaybackState: projectVoicePlaybackState(raw.voicePlaybackState),
    terminalReason: canonicalString(raw.terminalReason, 'terminalReason'),
    replayTruncated: false,
  };
  return { cursor, events: [event] };
}

function projectVoiceOutputMode(value: unknown): NimiAppRuntimeAgentVoiceOutputMode {
  switch (value) {
    case 1: return 'native_stream';
    case 2: return 'simulated_stream';
    case 3: return 'batch_final_artifact';
    case 4: return 'text_only';
    default: return localAppProjectionError('voiceOutputMode');
  }
}

function projectVoicePlaybackState(value: unknown): NimiAppRuntimeAgentVoicePlaybackState {
  switch (value) {
    case 1: return 'active';
    case 2: return 'completed';
    case 3: return 'failed';
    case 4: return 'interrupted';
    case 5: return 'canceled';
    default: return localAppProjectionError('voicePlaybackState');
  }
}

function requireAudioMime(value: unknown): string {
  const text = requireText(value, 'mimeType');
  const base = text.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  if (!LOCAL_APP_AUDIO_MIME_TYPES.has(base)) {
    return localAppError(
      'Local-app voice transcription MIME is not admitted.',
      'SDK_LOCAL_APP_VOICE_MIME_INVALID',
      'use_admitted_voice_audio_mime',
    );
  }
  return base;
}

function decodeCanonicalBase64(value: unknown, maxBytes: number, allowEmpty = false): Uint8Array {
  const encoded = typeof value === 'string' ? value : '';
  if (
    (!allowEmpty && encoded.length === 0)
    || encoded.length % 4 !== 0
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(encoded)
  ) {
    return localAppProjectionError('voice chunk base64');
  }
  let binary: string;
  try {
    binary = globalThis.atob(encoded);
  } catch {
    return localAppProjectionError('voice chunk base64');
  }
  if (binary.length > maxBytes) return localAppProjectionError('voice chunk size');
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (encodeBase64(bytes) !== encoded) return localAppProjectionError('voice chunk base64');
  return bytes;
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.byteLength, offset + chunkSize)));
  }
  return globalThis.btoa(binary);
}

function projectStorageDocument(value: unknown): NimiAppRuntimeStorageDocument {
  const record = asRecord(value);
  assertExactProjectionKeys(record, ['value', 'sizeBytes'], 'storage document');
  const sizeBytes = nonNegativeInteger(record.sizeBytes, 'storage document sizeBytes');
  if (sizeBytes > MAX_LOCAL_APP_STORAGE_DOCUMENT_BYTES) {
    localAppProjectionError('storage document sizeBytes');
  }
  assertStorageJsonValue(record.value, true);
  return { value: record.value, sizeBytes };
}

function projectStorageRemoveResult(value: unknown): NimiAppRuntimeStorageRemoveResult {
  const record = asRecord(value);
  assertExactProjectionKeys(record, ['removed'], 'storage remove result');
  if (typeof record.removed !== 'boolean') localAppProjectionError('storage remove result');
  return { removed: record.removed };
}

function requireStorageRelativePath(value: unknown): string {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value.trim() !== value
    || value.length > MAX_LOCAL_APP_STORAGE_PATH_BYTES
    || !/^[\x00-\x7f]+$/u.test(value)
    || !value.endsWith('.json')
    || value.startsWith('/')
    || /[\\:\0]/u.test(value)
    || value.split('/').some((segment) => !validStoragePathSegment(segment))
  ) {
    return localAppError(
      'Local-app storage requires a canonical relative JSON path.',
      'SDK_LOCAL_APP_STORAGE_PATH_INVALID',
      'provide_canonical_relative_json_path',
    );
  }
  return value;
}

function validStoragePathSegment(segment: string): boolean {
  if (
    segment.length === 0
    || segment.length > 128
    || segment === '.'
    || segment === '..'
    || segment.endsWith('.')
    || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(segment)
  ) {
    return false;
  }
  const base = segment.split('.')[0]?.toUpperCase() || '';
  return !['CON', 'PRN', 'AUX', 'NUL'].includes(base)
    && !/^(?:COM|LPT)[1-9]$/u.test(base);
}

function assertStorageJsonValue(
  value: unknown,
  projection = false,
  depth = 0,
  state = { nodes: 0, ancestors: new Set<object>() },
): asserts value is JsonValue {
  state.nodes += 1;
  if (depth > 32 || state.nodes > 100_000) {
    return storageJsonError(projection);
  }
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (!value || typeof value !== 'object' || state.ancestors.has(value)) {
    return storageJsonError(projection);
  }
  state.ancestors.add(value);
  if (Array.isArray(value)) {
    for (const entry of value) assertStorageJsonValue(entry, projection, depth + 1, state);
  } else {
    const record = asRecord(value);
    if (!record || Reflect.ownKeys(value).some((key) => typeof key !== 'string')) {
      return storageJsonError(projection);
    }
    for (const entry of Object.values(record)) {
      assertStorageJsonValue(entry, projection, depth + 1, state);
    }
  }
  state.ancestors.delete(value);
}

function storageJsonError(projection: boolean): never {
  if (projection) return localAppProjectionError('storage JSON value');
  return localAppError(
    'Local-app storage value must be bounded JSON.',
    'SDK_LOCAL_APP_STORAGE_VALUE_INVALID',
    'provide_bounded_json_value',
  );
}
