import {
  NIMI_STANDARD_SHELL_COMMANDS,
  isNimiStandardShellErrorEnvelope,
} from '@nimiplatform/kit/shell/capabilities';
import { BridgeError, invokeChecked } from './invoke.js';
import { listenShell } from './tauri-api.js';
import { assertRecord, parseRequiredString } from './types.js';
import type { JsonObject, JsonValue } from './types.js';

const MAX_IDENTIFIER_LENGTH = 512;
const MAX_PERMISSION_REASON_BYTES = 240;
const MAX_STORAGE_PATH_BYTES = 240;
const MAX_STORAGE_DOCUMENT_BYTES = 256 * 1024;

const FORBIDDEN_PROJECTION_KEYS = new Set([
  'endpoint', 'authorization', 'token', 'localappprincipalid', 'localapprecordid',
  'trustclass', 'provenancerevision', 'launchlease', 'bootstrap', 'processid',
  'sessionid', 'sessionproof', 'accountid', 'grantid', 'runtimebootepoch',
]);

const LOCAL_APP_STATUS_STATES = new Set([
  'authorizing', 'ready', 'denied', 'runtime-unavailable', 'revoked', 'project-changed',
]);
const LOCAL_APP_PERMISSION_STATES = new Set([
  'prompt', 'pending', 'granted', 'denied', 'unavailable',
]);

export type NimiLocalAppSessionStatus = {
  readonly state: 'authorizing' | 'ready' | 'denied' | 'runtime-unavailable' | 'revoked' | 'project-changed';
  readonly reasonCode: string;
  readonly retryable: boolean;
};

export type NimiLocalAppPermissionStatusInput = {
  readonly permissionId: string;
};

export type NimiLocalAppPermissionRequestInput = NimiLocalAppPermissionStatusInput & {
  readonly reason: string;
};

export type NimiLocalAppAgentHandle = {
  readonly agentHandle: string;
  readonly displayName: string;
};

export type NimiLocalAppPermissionStatus = {
  readonly state: 'prompt' | 'pending' | 'granted' | 'denied' | 'unavailable';
  readonly permissionId: string;
  readonly canRequest: boolean;
  readonly reasonCode: string;
  readonly agents: readonly NimiLocalAppAgentHandle[];
};

export type NimiLocalAppStorageDocument = {
  readonly value: JsonValue;
  readonly sizeBytes: number;
};

export type NimiLocalAppStorageRemoveResult = {
  readonly removed: boolean;
};

export type NimiLocalAppConversationScopeInput = {
  readonly agentHandle: string;
  readonly conversationAnchorId: string;
};

export type NimiLocalAppConversationSubscription = {
  readonly events: AsyncIterable<unknown>;
  readonly cancel: () => Promise<void>;
};

export type NimiLocalAppStandardShellSurface = {
  readonly session: {
    readonly status: () => Promise<NimiLocalAppSessionStatus>;
  };
  readonly permission: {
    readonly status: (input: NimiLocalAppPermissionStatusInput) => Promise<NimiLocalAppPermissionStatus>;
    readonly request: (input: NimiLocalAppPermissionRequestInput) => Promise<NimiLocalAppPermissionStatus>;
  };
  readonly storage: {
    readonly readJson: (relativePath: string) => Promise<NimiLocalAppStorageDocument>;
    readonly writeJson: (relativePath: string, value: JsonValue) => Promise<NimiLocalAppStorageDocument>;
    readonly removeJson: (relativePath: string) => Promise<NimiLocalAppStorageRemoveResult>;
  };
  readonly conversation: {
    readonly open: (input: {
      readonly agentHandle: string;
      readonly disposition: 'create-or-resume' | 'create-new';
    }) => Promise<JsonObject>;
    readonly send: (input: NimiLocalAppConversationScopeInput & {
      readonly requestId: string;
      readonly text: string;
    }) => Promise<JsonObject>;
    readonly subscribe: (input: NimiLocalAppConversationScopeInput) => Promise<NimiLocalAppConversationSubscription>;
    readonly snapshot: (input: NimiLocalAppConversationScopeInput) => Promise<JsonObject>;
  };
};

export function createNimiLocalAppStandardShellSurface(): NimiLocalAppStandardShellSurface {
  return {
    session: { status: getNimiLocalAppSessionStatus },
    permission: {
      status: getNimiLocalAppPermissionStatus,
      request: requestNimiLocalAppPermission,
    },
    storage: {
      readJson: readNimiLocalAppStorageJson,
      writeJson: writeNimiLocalAppStorageJson,
      removeJson: removeNimiLocalAppStorageJson,
    },
    conversation: {
      open: openNimiLocalAppConversation,
      send: sendNimiLocalAppConversationTurn,
      subscribe: subscribeNimiLocalAppConversation,
      snapshot: getNimiLocalAppConversationSnapshot,
    },
  };
}

export function getNimiLocalAppSessionStatus(): Promise<NimiLocalAppSessionStatus> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.sessionStatus'];
  return invokeChecked(command, {}, (value) => parseSessionStatus(value, command));
}

export function getNimiLocalAppPermissionStatus(
  input: NimiLocalAppPermissionStatusInput,
): Promise<NimiLocalAppPermissionStatus> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.permissionStatus'];
  assertExactInput(input, ['permissionId'], command);
  const permissionId = requiredText(input.permissionId, 'permissionId', command, MAX_IDENTIFIER_LENGTH);
  return invokeChecked(
    command,
    { payload: { permissionId } },
    (value) => parsePermissionStatus(value, permissionId, command),
  );
}

export function requestNimiLocalAppPermission(
  input: NimiLocalAppPermissionRequestInput,
): Promise<NimiLocalAppPermissionStatus> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.permissionRequest'];
  assertExactInput(input, ['permissionId', 'reason'], command);
  const permissionId = requiredText(input.permissionId, 'permissionId', command, MAX_IDENTIFIER_LENGTH);
  return invokeChecked(
    command,
    { payload: {
      permissionId,
      reason: requiredUtf8Text(input.reason, 'reason', command, MAX_PERMISSION_REASON_BYTES),
    } },
    (value) => parsePermissionStatus(value, permissionId, command),
  );
}

export function openNimiLocalAppConversation(input: {
  readonly agentHandle: string;
  readonly disposition: 'create-or-resume' | 'create-new';
}): Promise<JsonObject> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.conversationOpen'];
  assertExactInput(input, ['agentHandle', 'disposition'], command);
  if (input.disposition !== 'create-or-resume' && input.disposition !== 'create-new') {
    throw invalidInput(command, 'disposition is invalid');
  }
  return invokeLocalAppRecord(command, {
    agentHandle: requiredText(input.agentHandle, 'agentHandle', command, MAX_IDENTIFIER_LENGTH),
    disposition: input.disposition,
  });
}

export function sendNimiLocalAppConversationTurn(input: NimiLocalAppConversationScopeInput & {
  readonly requestId: string;
  readonly text: string;
}): Promise<JsonObject> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.conversationSendTurn'];
  assertExactInput(input, ['agentHandle', 'conversationAnchorId', 'requestId', 'text'], command);
  return invokeLocalAppRecord(command, {
    agentHandle: requiredText(input.agentHandle, 'agentHandle', command, MAX_IDENTIFIER_LENGTH),
    conversationAnchorId: requiredText(input.conversationAnchorId, 'conversationAnchorId', command, MAX_IDENTIFIER_LENGTH),
    requestId: requiredText(input.requestId, 'requestId', command, MAX_IDENTIFIER_LENGTH),
    text: requiredUtf8Text(input.text, 'text', command, 64 * 1024),
  });
}

export async function subscribeNimiLocalAppConversation(
  input: NimiLocalAppConversationScopeInput,
): Promise<NimiLocalAppConversationSubscription> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.conversationSubscribe'];
  const scope = identifiers(input, ['agentHandle', 'conversationAnchorId'], command);
  const opened = await invokeChecked(command, { payload: scope }, (value) => {
    const record = assertRecord(value, `${command} returned invalid payload`);
    assertProjectionKeys(record, ['subscriptionId', 'eventName'], command, 'conversation subscription');
    return {
      subscriptionId: requiredText(record.subscriptionId, 'subscriptionId', command, MAX_IDENTIFIER_LENGTH),
      eventName: requiredText(record.eventName, 'eventName', command, MAX_IDENTIFIER_LENGTH),
    };
  });
  const subscription = new LocalAppConversationEventSubscription(command, opened.subscriptionId);
  try {
    subscription.attach(await listenShell(opened.eventName, ({ payload }) => subscription.accept(payload)));
  } catch (error) {
    await subscription.cancel().catch(() => undefined);
    throw error;
  }
  return subscription;
}

export function getNimiLocalAppConversationSnapshot(
  input: NimiLocalAppConversationScopeInput,
): Promise<JsonObject> {
  const command = NIMI_STANDARD_SHELL_COMMANDS['local-app.conversationSnapshot'];
  return invokeLocalAppRecord(
    command,
    identifiers(input, ['agentHandle', 'conversationAnchorId'], command),
  );
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

class LocalAppConversationEventSubscription implements NimiLocalAppConversationSubscription {
  readonly events: AsyncIterable<unknown> = this;
  private readonly queued: unknown[] = [];
  private readonly waiting: Array<{
    resolve: (result: IteratorResult<unknown>) => void;
    reject: (error: unknown) => void;
  }> = [];
  private unlisten: (() => void) | undefined;
  private terminalError: unknown;
  private done = false;
  private remoteCompleted = false;
  private cancelPromise: Promise<void> | undefined;

  constructor(
    private readonly command: string,
    private readonly subscriptionId: string,
  ) {}

  attach(unlisten: () => void): void {
    if (this.done) unlisten();
    else this.unlisten = unlisten;
  }

  [Symbol.asyncIterator](): AsyncIterator<unknown> {
    return {
      next: () => this.next(),
      return: async () => {
        await this.cancel();
        return { done: true, value: undefined };
      },
    };
  }

  cancel(): Promise<void> {
    if (this.cancelPromise) return this.cancelPromise;
    if (this.remoteCompleted) {
      this.cancelPromise = Promise.resolve();
      return this.cancelPromise;
    }
    this.finish();
    this.cancelPromise = invokeChecked(
      this.command,
      { payload: { action: 'cancel', subscriptionId: this.subscriptionId } },
      (value) => {
        const record = assertRecord(value, `${this.command} returned invalid cancel payload`);
        assertProjectionKeys(record, ['subscriptionId', 'closed'], this.command, 'conversation cancel');
        if (record.subscriptionId !== this.subscriptionId || typeof record.closed !== 'boolean') {
          throw new Error(`${this.command}: conversation cancel projection is invalid`);
        }
      },
    );
    return this.cancelPromise;
  }

  accept(value: unknown): void {
    if (this.done) return;
    try {
      const record = assertRecord(value, `${this.command} emitted invalid payload`);
      if (record.subscriptionId !== this.subscriptionId) {
        throw new Error(`${this.command}: subscription binding is invalid`);
      }
      if (record.eventType === 'completed') {
        assertProjectionKeys(record, ['subscriptionId', 'eventType'], this.command, 'conversation completion');
        this.remoteCompleted = true;
        this.finish();
        return;
      }
      if (record.eventType === 'error') {
        assertProjectionKeys(record, ['subscriptionId', 'eventType', 'error'], this.command, 'conversation error');
        this.fail(parseConversationStreamError(record.error, this.command));
        return;
      }
      if (record.eventType !== 'next') throw new Error(`${this.command}: conversation event type is invalid`);
      assertProjectionKeys(record, ['subscriptionId', 'eventType', 'event'], this.command, 'conversation event');
      const event = parseSafeProjection(record.event, this.command);
      const waiter = this.waiting.shift();
      if (waiter) waiter.resolve({ done: false, value: event });
      else if (this.queued.length < 32) this.queued.push(event);
      else {
        const error = new BridgeError('Local-app conversation event buffer is exhausted', this.command, {
          code: 'resource-exhausted',
          reasonCode: 'renderer-local-app-conversation-buffer-exhausted',
          actionHint: 'consume_or_cancel_conversation_subscription',
          source: 'renderer',
        });
        this.fail(error);
        void this.cancel().catch(() => undefined);
      }
    } catch (error) {
      this.fail(error instanceof BridgeError ? error : new BridgeError(
        error instanceof Error ? error.message : 'Local-app conversation event is invalid',
        this.command,
        {
          code: 'invalid-payload',
          reasonCode: 'renderer-standard-shell-result-invalid',
          actionHint: 'inspect_standard_shell_host_result',
          source: 'renderer',
        },
      ));
    }
  }

  private next(): Promise<IteratorResult<unknown>> {
    if (this.queued.length > 0) {
      return Promise.resolve({ done: false, value: this.queued.shift() });
    }
    if (this.terminalError) return Promise.reject(this.terminalError);
    if (this.done) return Promise.resolve({ done: true, value: undefined });
    return new Promise((resolve, reject) => this.waiting.push({ resolve, reject }));
  }

  private finish(): void {
    if (this.done) return;
    this.done = true;
    this.unlisten?.();
    this.unlisten = undefined;
    for (const waiter of this.waiting.splice(0)) waiter.resolve({ done: true, value: undefined });
  }

  private fail(error: unknown): void {
    if (this.done) return;
    this.terminalError = error;
    this.done = true;
    this.unlisten?.();
    this.unlisten = undefined;
    for (const waiter of this.waiting.splice(0)) waiter.reject(error);
  }
}

function parseConversationStreamError(value: unknown, command: string): BridgeError {
  const envelope = assertRecord(value, `${command} emitted invalid error`);
  if (!isNimiStandardShellErrorEnvelope(envelope)) {
    throw new Error(`${command}: conversation error envelope is invalid`);
  }
  return new BridgeError(envelope.reasonCode, command, envelope);
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

function parsePermissionStatus(
  value: unknown,
  requestedPermissionId: string,
  command: string,
): NimiLocalAppPermissionStatus {
  const record = parseSafeProjection(value, command);
  assertProjectionKeys(
    record,
    ['state', 'permissionId', 'canRequest', 'reasonCode', 'agents'],
    command,
    'permission status',
  );
  const state = requiredText(record.state, 'state', command, MAX_IDENTIFIER_LENGTH);
  const permissionId = requiredText(record.permissionId, 'permissionId', command, MAX_IDENTIFIER_LENGTH);
  const reasonCode = requiredText(record.reasonCode, 'reasonCode', command, MAX_IDENTIFIER_LENGTH);
  if (!LOCAL_APP_PERMISSION_STATES.has(state)
    || permissionId !== requestedPermissionId
    || typeof record.canRequest !== 'boolean'
    || record.canRequest !== (state === 'prompt')
    || !Array.isArray(record.agents)
    || (state !== 'granted' && record.agents.length > 0)) {
    throw new Error(`${command}: permission status projection is invalid`);
  }
  const seen = new Set<string>();
  const agents = record.agents.map((value) => {
    const agent = assertRecord(value, `${command} returned invalid agent handle`);
    assertProjectionKeys(agent, ['agentHandle', 'displayName'], command, 'permission agent');
    const agentHandle = requiredText(agent.agentHandle, 'agentHandle', command, MAX_IDENTIFIER_LENGTH);
    const displayName = requiredUtf8Text(agent.displayName, 'displayName', command, 240);
    if (seen.has(agentHandle)) throw new Error(`${command}: permission agent handle is duplicated`);
    seen.add(agentHandle);
    return Object.freeze({ agentHandle, displayName });
  });
  return Object.freeze({
    state: state as NimiLocalAppPermissionStatus['state'],
    permissionId,
    canRequest: record.canRequest,
    reasonCode,
    agents: Object.freeze(agents),
  });
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

function nonNegativeInteger(value: unknown, command: string, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${command}: ${field} is invalid`);
  }
  return value;
}

function normalizeFieldName(value: string): string {
  return value.replace(/[^a-z0-9]/giu, '').toLowerCase();
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

function requiredUtf8Text(value: unknown, field: string, command: string, maxBytes: number): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized || normalized !== value || new TextEncoder().encode(normalized).byteLength > maxBytes) {
    throw invalidInput(command, `${field} is invalid`);
  }
  return normalized;
}

function invalidInput(command: string, reason: string): BridgeError {
  return new BridgeError(`Local-app operation input is invalid: ${reason}`, command, {
    code: 'invalid-payload',
    reasonCode: 'renderer-local-app-payload-invalid',
    actionHint: 'send_only_declared_local_app_operation_fields',
    source: 'renderer',
  });
}
