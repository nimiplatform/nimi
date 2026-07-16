import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';
import { BridgeError, invokeChecked } from './invoke.js';
import { assertRecord, parseRequiredString } from './types.js';
import type { JsonObject, JsonValue } from './types.js';

const MAX_IDENTIFIER_LENGTH = 512;
const MAX_INLINE_ARTIFACT_BYTES = 32 * 1024 * 1024;
const MAX_USER_TEXT_LENGTH = 256 * 1024;

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
  readonly agent: {
    readonly inventory: () => Promise<JsonObject>;
    readonly openConversation: (input: NimiLocalAppAgentOpenConversationInput) => Promise<JsonObject>;
    readonly sendTurn: (input: NimiLocalAppAgentSendTurnInput) => Promise<JsonObject>;
    /** Pulls exactly one next correlated event from the native Runtime stream. */
    readonly subscribeTurn: (input: NimiLocalAppAgentSubscribeTurnInput) => Promise<NimiLocalAppAgentTurnEventPage>;
    readonly getConversationSnapshot: (input: NimiLocalAppAgentGetConversationSnapshotInput) => Promise<JsonObject>;
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
    agent: {
      inventory: getNimiLocalAppAgentInventory,
      openConversation: openNimiLocalAppAgentConversation,
      sendTurn: sendNimiLocalAppAgentTurn,
      subscribeTurn: subscribeNimiLocalAppAgentTurn,
      getConversationSnapshot: getNimiLocalAppAgentConversationSnapshot,
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
