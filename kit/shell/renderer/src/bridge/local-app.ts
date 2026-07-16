import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';
import { BridgeError, invokeChecked } from './invoke.js';
import { assertRecord, parseRequiredString } from './types.js';
import type { JsonObject, JsonValue } from './types.js';

const MAX_IDENTIFIER_LENGTH = 512;
const MAX_INLINE_ARTIFACT_BYTES = 32 * 1024 * 1024;
const MAX_USER_TEXT_LENGTH = 256 * 1024;
const MAX_STORAGE_PATH_BYTES = 240;
const MAX_STORAGE_DOCUMENT_BYTES = 256 * 1024;
const MAX_VOICE_AUDIO_BYTES = 8 * 1024 * 1024;
const MAX_VOICE_CHUNK_BYTES = 32 * 1024 * 1024;
const MAX_VOICE_TRANSCRIPT_BYTES = 64 * 1024;

const FORBIDDEN_PROJECTION_KEYS = new Set([
  'endpoint', 'authorization', 'token', 'localappprincipalid', 'localapprecordid',
  'trustclass', 'provenancerevision', 'launchlease', 'bootstrap', 'processid',
  'sessionid', 'sessionproof', 'accountid', 'grantid', 'runtimebootepoch',
]);

const LOCAL_APP_STATUS_STATES = new Set([
  'authorizing', 'zero-grant', 'ready', 'denied', 'runtime-unavailable', 'revoked', 'project-changed',
]);

export type NimiLocalAppSessionStatus = {
  readonly state: 'authorizing' | 'zero-grant' | 'ready' | 'denied' | 'runtime-unavailable' | 'revoked' | 'project-changed';
  readonly reasonCode: string;
  readonly retryable: boolean;
};

export type NimiLocalAppPermissionPostureInput = {
  readonly operationId: string;
  readonly resourceRef: string;
};

export type NimiLocalAppPermissionRequestInput = NimiLocalAppPermissionPostureInput & {
  readonly purpose: string;
};

export type NimiLocalAppArtifactBytes = {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly mimeInferred: boolean;
};

export type NimiLocalAppStorageDocument = {
  readonly value: JsonValue;
  readonly sizeBytes: number;
};

export type NimiLocalAppStorageRemoveResult = {
  readonly removed: boolean;
};

export type NimiLocalAppAgentOpenConversationInput = {
  readonly agentId: string;
  readonly requestedAnchorDisposition: 'create-or-resume' | 'create-new';
};

export type NimiLocalAppAgentSendTurnInput = {
  readonly agentId: string;
  readonly conversationAnchorId: string;
  readonly clientTurnId: string;
  readonly userText: string;
};

export type NimiLocalAppAgentSubscribeTurnInput = {
  readonly agentId: string;
  readonly conversationAnchorId: string;
  readonly cursor?: string;
};

export type NimiLocalAppAgentGetConversationSnapshotInput = {
  readonly agentId: string;
  readonly conversationAnchorId: string;
};

export type NimiLocalAppAgentTranscribeVoiceInput = {
  readonly agentId: string;
  readonly clientRequestId: string;
  readonly audio: Uint8Array;
  readonly mimeType: string;
};

export type NimiLocalAppAgentVoiceTranscription = {
  readonly clientRequestId: string;
  readonly text: string;
};

export type NimiLocalAppAgentSubscribeVoiceStreamInput = {
  readonly agentId: string;
  readonly conversationAnchorId: string;
  readonly turnId: string;
  readonly voiceStreamId: string;
  readonly cursor?: string;
};

export type NimiLocalAppAgentVoiceCarrierEvent = {
  readonly voiceStreamId: string;
  readonly conversationAnchorId: string;
  readonly turnId: string;
  readonly streamId: string;
  readonly messageId: string;
  readonly chunkSequence: string;
  readonly chunkBase64: string;
  readonly mimeType: string;
  readonly voiceOutputMode: number;
  readonly playbackTarget: string;
  readonly terminal: boolean;
  readonly voicePlaybackState: number;
  readonly terminalReason: string;
  readonly replayTruncated: false;
};

export type NimiLocalAppAgentVoiceStreamPage = {
  readonly cursor: string;
  readonly events: readonly [NimiLocalAppAgentVoiceCarrierEvent];
};

export type NimiLocalAppAgentTurnCarrierEvent = {
  readonly eventType: number;
  readonly sequence: string;
  readonly messageId: string;
  readonly messageType: string;
  readonly payload: JsonObject;
  readonly reasonCode: number;
  readonly traceId: string;
  readonly timestamp: { readonly seconds: string; readonly nanos: number } | null;
};

export type NimiLocalAppAgentTurnEventPage = {
  readonly cursor: string;
  readonly events: readonly [NimiLocalAppAgentTurnCarrierEvent];
};

export type NimiLocalAppStandardShellSurface = {
  readonly session: {
    readonly status: () => Promise<NimiLocalAppSessionStatus>;
  };
  readonly permission: {
    readonly posture: (input: NimiLocalAppPermissionPostureInput) => Promise<JsonObject>;
    readonly request: (input: NimiLocalAppPermissionRequestInput) => Promise<JsonObject>;
  };
  readonly artifacts: {
    readonly readRuntimeBytes: (artifactId: string) => Promise<NimiLocalAppArtifactBytes>;
  };
  readonly storage: {
    readonly readJson: (relativePath: string) => Promise<NimiLocalAppStorageDocument>;
    readonly writeJson: (relativePath: string, value: JsonValue) => Promise<NimiLocalAppStorageDocument>;
    readonly removeJson: (relativePath: string) => Promise<NimiLocalAppStorageRemoveResult>;
  };
  readonly agent: {
    readonly inventory: () => Promise<JsonObject>;
    readonly openConversation: (input: NimiLocalAppAgentOpenConversationInput) => Promise<JsonObject>;
    readonly sendTurn: (input: NimiLocalAppAgentSendTurnInput) => Promise<JsonObject>;
    /** Pulls exactly one next correlated event from the native Runtime stream. */
    readonly subscribeTurn: (input: NimiLocalAppAgentSubscribeTurnInput) => Promise<NimiLocalAppAgentTurnEventPage>;
    readonly getConversationSnapshot: (input: NimiLocalAppAgentGetConversationSnapshotInput) => Promise<JsonObject>;
    readonly transcribeVoice: (input: NimiLocalAppAgentTranscribeVoiceInput) => Promise<NimiLocalAppAgentVoiceTranscription>;
    readonly subscribeVoiceStream: (input: NimiLocalAppAgentSubscribeVoiceStreamInput) => Promise<NimiLocalAppAgentVoiceStreamPage>;
  };
};

export function createNimiLocalAppStandardShellSurface(): NimiLocalAppStandardShellSurface {
  return {
    session: { status: getNimiLocalAppSessionStatus },
    permission: {
      posture: getNimiLocalAppPermissionPosture,
      request: requestNimiLocalAppPermission,
    },
    artifacts: { readRuntimeBytes: readNimiLocalAppRuntimeArtifactBytes },
    storage: {
      readJson: readNimiLocalAppStorageJson,
      writeJson: writeNimiLocalAppStorageJson,
      removeJson: removeNimiLocalAppStorageJson,
    },
    agent: {
      inventory: getNimiLocalAppAgentInventory,
      openConversation: openNimiLocalAppAgentConversation,
      sendTurn: sendNimiLocalAppAgentTurn,
      subscribeTurn: subscribeNimiLocalAppAgentTurn,
      getConversationSnapshot: getNimiLocalAppAgentConversationSnapshot,
      transcribeVoice: transcribeNimiLocalAppAgentVoice,
      subscribeVoiceStream: subscribeNimiLocalAppAgentVoiceStream,
    },
  };
}

export function getNimiLocalAppSessionStatus(): Promise<NimiLocalAppSessionStatus> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.sessionStatus'];
  return invokeChecked(command, {}, (value) => parseSessionStatus(value, command));
}

export function getNimiLocalAppPermissionPosture(
  input: NimiLocalAppPermissionPostureInput,
): Promise<JsonObject> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.permissionPosture'];
  return invokeLocalAppRecord(command, identifiers(input, ['operationId', 'resourceRef'], command));
}

export function requestNimiLocalAppPermission(
  input: NimiLocalAppPermissionRequestInput,
): Promise<JsonObject> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.permissionRequest'];
  return invokeLocalAppRecord(
    command,
    identifiers(input, ['operationId', 'resourceRef', 'purpose'], command),
  );
}

export function readNimiLocalAppRuntimeArtifactBytes(artifactId: string): Promise<NimiLocalAppArtifactBytes> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.artifactsReadRuntimeBytes'];
  const payload = { artifactId: requiredText(artifactId, 'artifactId', command, MAX_IDENTIFIER_LENGTH) };
  return invokeChecked(command, { payload }, (value) => parseArtifactBytes(value, command));
}

export function readNimiLocalAppStorageJson(relativePath: string): Promise<NimiLocalAppStorageDocument> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['storage.readJson'];
  const normalizedPath = canonicalStoragePath(relativePath, command);
  return invokeChecked(
    command,
    { payload: { relativePath: normalizedPath } },
    (value) => parseStorageDocument(value, command),
  );
}

export function writeNimiLocalAppStorageJson(
  relativePath: string,
  value: JsonValue,
): Promise<NimiLocalAppStorageDocument> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['storage.writeJson'];
  const normalizedPath = canonicalStoragePath(relativePath, command);
  validateStorageJsonValue(value, command);
  const encoded = JSON.stringify(value);
  if (new TextEncoder().encode(encoded).byteLength > MAX_STORAGE_DOCUMENT_BYTES) {
    throw new Error(`${command}: value exceeds the JSON document bound`);
  }
  return invokeChecked(
    command,
    { payload: { relativePath: normalizedPath, value } },
    (result) => parseStorageDocument(result, command),
  );
}

export function removeNimiLocalAppStorageJson(relativePath: string): Promise<NimiLocalAppStorageRemoveResult> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['storage.removeJson'];
  const normalizedPath = canonicalStoragePath(relativePath, command);
  return invokeChecked(command, { payload: { relativePath: normalizedPath } }, (value) => {
    const record = assertRecord(value, `${command} returned invalid payload`);
    assertProjectionKeys(record, ['removed'], command, 'storage remove result');
    if (typeof record.removed !== 'boolean') throw new Error(`${command}: removed is invalid`);
    return { removed: record.removed };
  });
}

export function openNimiLocalAppAgentConversation(
  input: NimiLocalAppAgentOpenConversationInput,
): Promise<JsonObject> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.agentOpenConversation'];
  return invokeLocalAppRecord(command, identifiers(input, ['agentId', 'requestedAnchorDisposition'], command));
}

export function getNimiLocalAppAgentInventory(): Promise<JsonObject> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.agentInventory'];
  return invokeLocalAppRecord(command, {});
}

export function sendNimiLocalAppAgentTurn(input: NimiLocalAppAgentSendTurnInput): Promise<JsonObject> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.agentSendTurn'];
  const payload = identifiers(
    input,
    ['agentId', 'conversationAnchorId', 'clientTurnId'],
    command,
    ['agentId', 'conversationAnchorId', 'clientTurnId', 'userText'],
  );
  return invokeLocalAppRecord(command, {
    ...payload,
    userText: requiredText(input.userText, 'userText', command, MAX_USER_TEXT_LENGTH),
  });
}

export function subscribeNimiLocalAppAgentTurn(
  input: NimiLocalAppAgentSubscribeTurnInput,
): Promise<NimiLocalAppAgentTurnEventPage> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.agentSubscribeTurn'];
  const payload = {
    ...identifiers(
      input,
      ['agentId', 'conversationAnchorId'],
      command,
      input.cursor === undefined
        ? ['agentId', 'conversationAnchorId']
        : ['agentId', 'conversationAnchorId', 'cursor'],
    ),
    cursor: input.cursor === undefined ? '' : optionalText(input.cursor, 'cursor', command, MAX_IDENTIFIER_LENGTH),
  };
  return invokeChecked(command, { payload }, (value) => parseTurnEventPage(value, input, command));
}

export function getNimiLocalAppAgentConversationSnapshot(
  input: NimiLocalAppAgentGetConversationSnapshotInput,
): Promise<JsonObject> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.agentGetConversationSnapshot'];
  return invokeLocalAppRecord(command, identifiers(input, ['agentId', 'conversationAnchorId'], command));
}

export function transcribeNimiLocalAppAgentVoice(
  input: NimiLocalAppAgentTranscribeVoiceInput,
): Promise<NimiLocalAppAgentVoiceTranscription> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.agentTranscribeVoice'];
  assertExactInputKeys(input, ['agentId', 'clientRequestId', 'audio', 'mimeType'], command);
  const agentId = requiredText(input.agentId, 'agentId', command, MAX_IDENTIFIER_LENGTH);
  const clientRequestId = requiredText(input.clientRequestId, 'clientRequestId', command, MAX_IDENTIFIER_LENGTH);
  if (!(input.audio instanceof Uint8Array) || input.audio.byteLength === 0 || input.audio.byteLength > MAX_VOICE_AUDIO_BYTES) {
    throw new Error(`${command}: audio is invalid`);
  }
  const mimeType = admittedAudioMime(input.mimeType, command);
  return invokeChecked(
    command,
    { payload: { agentId, clientRequestId, audioBase64: encodeBase64(input.audio), mimeType } },
    (value) => parseVoiceTranscription(value, clientRequestId, command),
  );
}

export function subscribeNimiLocalAppAgentVoiceStream(
  input: NimiLocalAppAgentSubscribeVoiceStreamInput,
): Promise<NimiLocalAppAgentVoiceStreamPage> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.agentSubscribeVoiceStream'];
  assertExactInputKeys(
    input,
    input.cursor === undefined
      ? ['agentId', 'conversationAnchorId', 'turnId', 'voiceStreamId']
      : ['agentId', 'conversationAnchorId', 'turnId', 'voiceStreamId', 'cursor'],
    command,
  );
  const normalized = {
    agentId: requiredText(input.agentId, 'agentId', command, MAX_IDENTIFIER_LENGTH),
    conversationAnchorId: requiredText(input.conversationAnchorId, 'conversationAnchorId', command, MAX_IDENTIFIER_LENGTH),
    turnId: requiredText(input.turnId, 'turnId', command, MAX_IDENTIFIER_LENGTH),
    voiceStreamId: requiredText(input.voiceStreamId, 'voiceStreamId', command, MAX_IDENTIFIER_LENGTH),
    cursor: input.cursor === undefined ? '' : optionalText(input.cursor, 'cursor', command, MAX_IDENTIFIER_LENGTH),
  };
  return invokeChecked(
    command,
    { payload: normalized },
    (value) => parseVoiceStreamPage(value, normalized, command),
  );
}

function invokeLocalAppRecord(command: string, payload: JsonObject): Promise<JsonObject> {
  return invokeChecked(command, { payload }, (value) => parseSafeProjection(value, command));
}

function parseSessionStatus(value: unknown, command: string): NimiLocalAppSessionStatus {
  const record = parseSafeProjection(value, command);
  if (JSON.stringify(Object.keys(record).sort()) !== JSON.stringify(['reasonCode', 'retryable', 'state'])) {
    throw new Error(`${command}: result fields must be state, reasonCode, retryable`);
  }
  const state = parseRequiredString(record.state, 'state', command);
  const reasonCode = parseRequiredString(record.reasonCode, 'reasonCode', command);
  if (!LOCAL_APP_STATUS_STATES.has(state) || typeof record.retryable !== 'boolean') {
    throw new Error(`${command}: session status projection is invalid`);
  }
  return { state: state as NimiLocalAppSessionStatus['state'], reasonCode, retryable: record.retryable };
}

function parseStorageDocument(value: unknown, command: string): NimiLocalAppStorageDocument {
  const record = assertRecord(value, `${command} returned invalid payload`);
  assertProjectionKeys(record, ['value', 'sizeBytes'], command, 'storage document');
  const sizeBytes = nonNegativeInteger(record.sizeBytes, command, 'sizeBytes');
  if (sizeBytes > MAX_STORAGE_DOCUMENT_BYTES) throw new Error(`${command}: sizeBytes exceeds the document bound`);
  validateStorageJsonValue(record.value, command);
  return { value: record.value as JsonValue, sizeBytes };
}

function canonicalStoragePath(value: string, command: string): string {
  if (
    !value
    || value.trim() !== value
    || new TextEncoder().encode(value).byteLength > MAX_STORAGE_PATH_BYTES
    || !value.endsWith('.json')
    || value.startsWith('/')
    || /[\\:\0]/u.test(value)
  ) {
    throw new Error(`${command}: relativePath is invalid`);
  }
  for (const segment of value.split('/')) {
    const base = segment.split('.', 1)[0]?.toUpperCase() ?? '';
    if (
      !segment
      || segment === '.'
      || segment === '..'
      || segment.length > 128
      || segment.endsWith('.')
      || /^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/u.test(base)
      || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(segment)
    ) {
      throw new Error(`${command}: relativePath is invalid`);
    }
  }
  return value;
}

function validateStorageJsonValue(value: unknown, command: string, depth = 0, nodes = { value: 0 }): void {
  nodes.value += 1;
  if (depth > 32 || nodes.value > 100_000) throw new Error(`${command}: value exceeds structural bounds`);
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    for (const entry of value) validateStorageJsonValue(entry, command, depth + 1, nodes);
    return;
  }
  if (!value || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error(`${command}: value is not JSON-compatible`);
  }
  for (const entry of Object.values(value as Record<string, unknown>)) {
    validateStorageJsonValue(entry, command, depth + 1, nodes);
  }
}

function parseSafeProjection(value: unknown, command: string): JsonObject {
  const record = assertRecord(value, `${command} returned invalid payload`);
  validateProjectionValue(record, command);
  return record;
}

function validateProjectionValue(value: JsonValue, command: string): void {
  if (value === undefined) throw new Error(`${command}: result cannot contain undefined`);
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (Array.isArray(value)) {
    for (const entry of value) validateProjectionValue(entry, command);
    return;
  }
  if (!value || typeof value !== 'object') throw new Error(`${command}: result is not JSON-compatible`);
  for (const [key, entry] of Object.entries(value)) {
    if (FORBIDDEN_PROJECTION_KEYS.has(normalizeFieldName(key))) {
      throw new Error(`${command}: protected field ${key} is forbidden`);
    }
    validateProjectionValue(entry, command);
  }
}

function parseTurnEventPage(
  value: unknown,
  input: NimiLocalAppAgentSubscribeTurnInput,
  command: string,
): NimiLocalAppAgentTurnEventPage {
  const record = parseSafeProjection(value, command);
  assertProjectionKeys(record, ['cursor', 'events'], command, 'event page');
  const cursor = decimalCursor(record.cursor, command, 'cursor');
  const previousCursor = input.cursor ? decimalCursor(input.cursor, command, 'input cursor') : undefined;
  if (previousCursor !== undefined && BigInt(cursor) <= BigInt(previousCursor)) {
    throw new Error(`${command}: event cursor did not advance`);
  }
  if (!Array.isArray(record.events) || record.events.length !== 1) {
    throw new Error(`${command}: event page must contain exactly one event`);
  }
  const event = assertRecord(record.events[0], `${command}: event is invalid`);
  assertProjectionKeys(event, [
    'eventType', 'sequence', 'messageId', 'messageType', 'payload',
    'reasonCode', 'traceId', 'timestamp',
  ], command, 'event');
  const sequence = decimalCursor(event.sequence, command, 'event sequence');
  if (sequence !== cursor) throw new Error(`${command}: event sequence does not match cursor`);
  const eventType = nonNegativeInteger(event.eventType, command, 'eventType');
  const reasonCode = nonNegativeInteger(event.reasonCode, command, 'reasonCode');
  const messageId = requiredText(event.messageId, 'messageId', command, MAX_IDENTIFIER_LENGTH);
  const messageType = requiredText(event.messageType, 'messageType', command, MAX_IDENTIFIER_LENGTH);
  if (!messageType.startsWith('runtime.agent.turn.')) {
    throw new Error(`${command}: event is outside the selected RuntimeAgent turn family`);
  }
  const projection = assertRecord(event.payload, `${command}: event payload is invalid`);
  const localAgentRef = projection.localAgentRef ?? projection.local_agent_ref;
  const conversationAnchorId = projection.conversationAnchorId ?? projection.conversation_anchor_id;
  if (localAgentRef !== input.agentId || conversationAnchorId !== input.conversationAnchorId) {
    throw new Error(`${command}: event correlation is invalid`);
  }
  const traceId = canonicalText(event.traceId, command, 'traceId');
  const timestamp = parseCarrierTimestamp(event.timestamp, command);
  return {
    cursor,
    events: [{
      eventType,
      sequence,
      messageId,
      messageType,
      payload: projection,
      reasonCode,
      traceId,
      timestamp,
    }],
  };
}

function parseVoiceTranscription(
  value: unknown,
  expectedRequestId: string,
  command: string,
): NimiLocalAppAgentVoiceTranscription {
  const record = parseSafeProjection(value, command);
  assertProjectionKeys(record, ['clientRequestId', 'text'], command, 'voice transcription');
  const clientRequestId = requiredText(record.clientRequestId, 'clientRequestId', command, MAX_IDENTIFIER_LENGTH);
  if (clientRequestId !== expectedRequestId || typeof record.text !== 'string') {
    throw new Error(`${command}: transcription correlation is invalid`);
  }
  if (new TextEncoder().encode(record.text).byteLength > MAX_VOICE_TRANSCRIPT_BYTES) {
    throw new Error(`${command}: transcription exceeds the admitted bound`);
  }
  return { clientRequestId, text: record.text };
}

function parseVoiceStreamPage(
  value: unknown,
  input: Required<NimiLocalAppAgentSubscribeVoiceStreamInput>,
  command: string,
): NimiLocalAppAgentVoiceStreamPage {
  const record = parseSafeProjection(value, command);
  assertProjectionKeys(record, ['cursor', 'events'], command, 'voice event page');
  const cursor = decimalCursor(record.cursor, command, 'cursor');
  if (input.cursor && BigInt(cursor) <= BigInt(decimalCursor(input.cursor, command, 'input cursor'))) {
    throw new Error(`${command}: voice event cursor did not advance`);
  }
  if (!Array.isArray(record.events) || record.events.length !== 1) {
    throw new Error(`${command}: voice event page must contain exactly one event`);
  }
  const event = assertRecord(record.events[0], `${command}: voice event is invalid`);
  assertProjectionKeys(event, [
    'voiceStreamId', 'conversationAnchorId', 'turnId', 'streamId', 'messageId',
    'chunkSequence', 'chunkBase64', 'mimeType', 'voiceOutputMode', 'playbackTarget',
    'terminal', 'voicePlaybackState', 'terminalReason', 'replayTruncated',
  ], command, 'voice event');
  const voiceStreamId = requiredText(event.voiceStreamId, 'voiceStreamId', command, MAX_IDENTIFIER_LENGTH);
  const conversationAnchorId = requiredText(event.conversationAnchorId, 'conversationAnchorId', command, MAX_IDENTIFIER_LENGTH);
  const turnId = requiredText(event.turnId, 'turnId', command, MAX_IDENTIFIER_LENGTH);
  if (
    voiceStreamId !== input.voiceStreamId
    || conversationAnchorId !== input.conversationAnchorId
    || turnId !== input.turnId
    || event.replayTruncated !== false
  ) {
    throw new Error(`${command}: voice event correlation is invalid`);
  }
  const terminal = event.terminal;
  if (typeof terminal !== 'boolean') throw new Error(`${command}: terminal is invalid`);
  const chunkBase64 = typeof event.chunkBase64 === 'string' ? event.chunkBase64 : '';
  const chunk = decodeBase64(chunkBase64, command, MAX_VOICE_CHUNK_BYTES, true);
  const mimeType = canonicalText(event.mimeType, command, 'mimeType');
  if ((terminal && chunk.byteLength !== 0) || (!terminal && (chunk.byteLength === 0 || !isAdmittedAudioMime(mimeType)))) {
    throw new Error(`${command}: voice chunk is invalid`);
  }
  const voiceOutputMode = positiveEnum(event.voiceOutputMode, 4, command, 'voiceOutputMode');
  const voicePlaybackState = positiveEnum(event.voicePlaybackState, 5, command, 'voicePlaybackState');
  const projected: NimiLocalAppAgentVoiceCarrierEvent = {
    voiceStreamId,
    conversationAnchorId,
    turnId,
    streamId: requiredText(event.streamId, 'streamId', command, MAX_IDENTIFIER_LENGTH),
    messageId: requiredText(event.messageId, 'messageId', command, MAX_IDENTIFIER_LENGTH),
    chunkSequence: decimalCursor(event.chunkSequence, command, 'chunkSequence'),
    chunkBase64,
    mimeType,
    voiceOutputMode,
    playbackTarget: canonicalText(event.playbackTarget, command, 'playbackTarget'),
    terminal,
    voicePlaybackState,
    terminalReason: canonicalText(event.terminalReason, command, 'terminalReason'),
    replayTruncated: false,
  };
  return { cursor, events: [projected] };
}

function positiveEnum(value: unknown, max: number, command: string, field: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > max) {
    throw new Error(`${command}: ${field} is invalid`);
  }
  return value;
}

function admittedAudioMime(value: unknown, command: string): string {
  const text = requiredText(value, 'mimeType', command, 128);
  const base = text.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  if (!isAdmittedAudioMime(base)) throw new Error(`${command}: mimeType is not admitted`);
  return base;
}

function isAdmittedAudioMime(value: string): boolean {
  return ['audio/webm', 'audio/ogg', 'audio/wav', 'audio/mpeg', 'audio/mp4', 'audio/flac'].includes(value);
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.byteLength)));
  }
  return btoa(binary);
}

function decodeBase64(
  value: string,
  command: string,
  maxBytes: number,
  allowEmpty = false,
): Uint8Array {
  if (
    (!allowEmpty && value.length === 0)
    || value.length % 4 !== 0
    || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(value)
  ) {
    throw new Error(`${command}: base64 payload is invalid`);
  }
  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw new Error(`${command}: base64 payload is invalid`);
  }
  if (binary.length > maxBytes) throw new Error(`${command}: byte payload exceeds the admitted bound`);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  if (encodeBase64(bytes) !== value) throw new Error(`${command}: base64 payload is not canonical`);
  return bytes;
}

function assertExactInputKeys(value: object, keys: readonly string[], command: string): void {
  if (JSON.stringify(Object.keys(value).sort()) !== JSON.stringify([...keys].sort())) {
    throw new Error(`${command}: input fields are invalid`);
  }
}

function assertProjectionKeys(
  record: JsonObject,
  keys: readonly string[],
  command: string,
  label: string,
): void {
  if (JSON.stringify(Object.keys(record).sort()) !== JSON.stringify([...keys].sort())) {
    throw new Error(`${command}: ${label} fields are invalid`);
  }
}

function decimalCursor(value: unknown, command: string, field: string): string {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)$/u.test(value)) {
    throw new Error(`${command}: ${field} is invalid`);
  }
  return value;
}

function nonNegativeInteger(value: unknown, command: string, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${command}: ${field} is invalid`);
  }
  return value;
}

function canonicalText(value: unknown, command: string, field: string): string {
  if (typeof value !== 'string' || value.trim() !== value) {
    throw new Error(`${command}: ${field} is invalid`);
  }
  return value;
}

function parseCarrierTimestamp(
  value: JsonValue,
  command: string,
): NimiLocalAppAgentTurnCarrierEvent['timestamp'] {
  if (value === null) return null;
  const timestamp = assertRecord(value, `${command}: timestamp is invalid`);
  assertProjectionKeys(timestamp, ['seconds', 'nanos'], command, 'timestamp');
  const seconds = typeof timestamp.seconds === 'string'
    && /^-?(?:0|[1-9]\d*)$/u.test(timestamp.seconds)
    ? timestamp.seconds
    : undefined;
  const nanos = timestamp.nanos;
  if (!seconds || typeof nanos !== 'number' || !Number.isInteger(nanos) || nanos < 0 || nanos > 999_999_999) {
    throw new Error(`${command}: timestamp is invalid`);
  }
  return { seconds, nanos };
}

function normalizeFieldName(value: string): string {
  return value.replace(/[^a-z0-9]/giu, '').toLowerCase();
}

function parseArtifactBytes(value: unknown, command: string): NimiLocalAppArtifactBytes {
  const record = assertRecord(value, `${command} returned invalid payload`);
  if (JSON.stringify(Object.keys(record).sort()) !== JSON.stringify(['dataBase64', 'mimeInferred', 'mimeType', 'sizeBytes'])) {
    throw new Error(`${command}: result fields do not match the artifact projection`);
  }
  const dataBase64 = parseRequiredString(record.dataBase64, 'dataBase64', command);
  const mimeType = parseRequiredString(record.mimeType, 'mimeType', command);
  const sizeBytes = Number(record.sizeBytes);
  if (
    !Number.isSafeInteger(sizeBytes)
    || sizeBytes < 0
    || sizeBytes > MAX_INLINE_ARTIFACT_BYTES
    || mimeType.trim() !== mimeType
    || !mimeType.includes('/')
    || typeof record.mimeInferred !== 'boolean'
  ) {
    throw new Error(`${command}: artifact metadata is invalid`);
  }
  const bytes = decodeCanonicalBase64(dataBase64, command);
  if (bytes.byteLength !== sizeBytes) throw new Error(`${command}: artifact size does not match decoded bytes`);
  return { bytes, mimeType, sizeBytes, mimeInferred: record.mimeInferred };
}

function identifiers<T extends object>(
  input: T,
  keys: readonly (keyof T & string)[],
  command: string,
  exactKeys: readonly (keyof T & string)[] = keys,
): JsonObject {
  assertExactInput(input, exactKeys, command);
  return Object.fromEntries(keys.map((key) => [
    key,
    requiredText(input[key], key, command, MAX_IDENTIFIER_LENGTH),
  ]));
}

function assertExactInput<T extends object>(input: T, keys: readonly (keyof T & string)[], command: string): void {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw invalidInput(command, 'input must be an object');
  if (JSON.stringify(Object.keys(input).sort()) !== JSON.stringify([...keys].sort())) {
    throw invalidInput(command, `input fields must be exactly ${keys.join(', ')}`);
  }
}

function requiredText(value: unknown, field: string, command: string, maxLength: number): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized || normalized !== value || normalized.length > maxLength) {
    throw invalidInput(command, `${field} is invalid`);
  }
  return normalized;
}

function optionalText(value: unknown, field: string, command: string, maxLength: number): string {
  if (value === '') return '';
  return requiredText(value, field, command, maxLength);
}

function invalidInput(command: string, reason: string): BridgeError {
  return new BridgeError(`Local-app operation input is invalid: ${reason}`, command, {
    code: 'invalid-payload',
    reasonCode: 'renderer-local-app-payload-invalid',
    actionHint: 'send_only_declared_local_app_operation_fields',
    source: 'renderer',
  });
}

function decodeCanonicalBase64(value: string, command: string): Uint8Array {
  try {
    const decoded = globalThis.atob(value);
    if (globalThis.btoa(decoded) !== value) throw new Error('non-canonical base64');
    return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
  } catch {
    throw new Error(`${command}: dataBase64 must be canonical base64`);
  }
}
