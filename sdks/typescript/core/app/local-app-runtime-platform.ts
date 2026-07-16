import { createNimiError, type JsonObject } from '../../types';
import {
  decodeNimiRuntimeAgentConversationAnchorSnapshot,
  projectNimiRuntimeAgentAppMessageEvent,
  toNimiRuntimeProtoStruct,
  type NimiRuntimeAgentConsumeEvent,
  type NimiRuntimeAgentConversationAnchorSnapshot,
  type NimiRuntimeAgentSessionSnapshot,
} from '../../runtime';
import { parseNimiRuntimeAgentSessionSnapshot } from '../../runtime/runtime-agent-consume-snapshot';
import type {
  AppMessageEvent,
  ConversationAnchorSnapshot,
  SendAppMessageResponse,
} from '../../core-generated/runtime-typed-client';

const MAX_INLINE_ARTIFACT_BYTES = 32 * 1024 * 1024;
const FORBIDDEN_AUTHORITY_FIELDS = new Set([
  'accountid',
  'authorization',
  'bearer',
  'endpoint',
  'grantid',
  'launchid',
  'localappprincipalid',
  'localapprecordid',
  'processid',
  'scopedbinding',
  'sessionid',
  'sessionproof',
  'token',
  'trustclass',
]);

export type NimiAppAuthMode = 'local-first-party-app' | 'local-app';

export type NimiAppLocalSessionState =
  | 'session-bound-zero-grant'
  | 'session-bound-granted'
  | 'action-required'
  | 'revoked'
  | 'project-changed'
  | 'process-replaced'
  | 'account-changed'
  | 'runtime-restarted';

export type NimiAppLocalSessionProjection = {
  readonly mode: NimiAppAuthMode;
  readonly state: NimiAppLocalSessionState;
  readonly sessionBound: boolean;
  readonly operationAllowed: boolean;
  readonly reasonCode: string;
  readonly actionHint: string;
  readonly retryable: boolean;
};

export type NimiAppAuthUnavailable = {
  readonly mode: NimiAppAuthMode;
  readonly state: 'unavailable';
  readonly sessionBound: false;
  readonly operationAllowed: false;
  readonly reasonCode: string;
  readonly actionHint: string;
  readonly retryable: boolean;
};

export type NimiAppAuthProjection = NimiAppLocalSessionProjection | NimiAppAuthUnavailable;

export type NimiAppPermissionPostureInput = {
  readonly operationId: string;
  readonly resourceRef: string;
};

export type NimiAppPermissionRequestInput = NimiAppPermissionPostureInput & {
  readonly purpose: string;
};

export type NimiAppPermissionPosture = {
  readonly state: 'zero-grant' | 'pending' | 'granted' | 'denied' | 'revoked' | 'superseded' | 'unavailable';
  readonly operationId: string;
  readonly resourceRef: string;
  readonly reasonCode: string;
  readonly actionHint: string;
  readonly retryable: boolean;
};

export type NimiAppRuntimeArtifactBytes = {
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  readonly sizeBytes: number;
  readonly mimeInferred: boolean;
};

export type NimiAppRuntimeAgentOpenConversationInput = {
  readonly agentId: string;
  readonly requestedAnchorDisposition: 'create-or-resume' | 'create-new';
};

export type NimiAppRuntimeAgentSendTurnInput = {
  readonly agentId: string;
  readonly conversationAnchorId: string;
  readonly clientTurnId: string;
  readonly userText: string;
};

export type NimiAppRuntimeAgentSubscribeTurnInput = {
  readonly agentId: string;
  readonly conversationAnchorId: string;
  readonly cursor?: string;
};

export type NimiAppRuntimeAgentConversationSnapshotInput = {
  readonly agentId: string;
  readonly conversationAnchorId: string;
};

export type NimiAppRuntimeAgentTurnEventPage = {
  /** Opaque decimal cursor returned by the protected carrier for the next pull. */
  readonly cursor: string;
  /** The current carrier returns exactly one correlated Runtime event per pull. */
  readonly events: readonly [NimiRuntimeAgentConsumeEvent];
};

export type NimiAppRuntimeAgentInventoryItem = {
  readonly localAgentRef: string;
  readonly displayName: string;
  readonly ownerUserId: string;
  readonly runtimeSourceRef: string;
  readonly sourceReady: boolean;
};

export type NimiAppRuntimeAgentInventory = {
  readonly ownerUserId: string;
  readonly count: number;
  readonly localAgents: readonly NimiAppRuntimeAgentInventoryItem[];
};

/**
 * Host-neutral structural contract implemented directly by Kit's
 * createNimiLocalAppStandardShellSurface. The nested namespaces and nine
 * operations are the complete admitted local-app carrier; this is not a Runtime
 * client and contains no generic forwarding surface.
 */
export type NimiAppRuntimePlatformStandardShell = {
  readonly session: {
    readonly status: () => Promise<unknown>;
  };
  readonly permission: {
    readonly posture: (input: NimiAppPermissionPostureInput) => Promise<unknown>;
    readonly request: (input: NimiAppPermissionRequestInput) => Promise<unknown>;
  };
  readonly artifacts: {
    readonly readRuntimeBytes: (artifactId: string) => Promise<unknown>;
  };
  readonly agent: {
    readonly inventory: () => Promise<unknown>;
    readonly openConversation: (input: NimiAppRuntimeAgentOpenConversationInput) => Promise<unknown>;
    readonly sendTurn: (input: NimiAppRuntimeAgentSendTurnInput) => Promise<unknown>;
    readonly subscribeTurn: (input: NimiAppRuntimeAgentSubscribeTurnInput) => Promise<unknown>;
    readonly getConversationSnapshot: (input: NimiAppRuntimeAgentConversationSnapshotInput) => Promise<unknown>;
  };
};

export type NimiAppRuntimePlatformClientInput = {
  readonly standardShell: NimiAppRuntimePlatformStandardShell;
};

export type NimiAppRuntimePlatformClient = {
  readonly auth: {
    readonly status: () => Promise<NimiAppAuthProjection>;
  };
  readonly permissions: {
    readonly posture: (input: NimiAppPermissionPostureInput) => Promise<NimiAppPermissionPosture>;
    readonly request: (input: NimiAppPermissionRequestInput) => Promise<NimiAppPermissionPosture>;
  };
  readonly artifacts: {
    readonly readRuntimeBytes: (artifactId: string) => Promise<NimiAppRuntimeArtifactBytes>;
  };
  readonly agent: {
    readonly listInventory: () => Promise<NimiAppRuntimeAgentInventory>;
    readonly openConversation: (
      input: NimiAppRuntimeAgentOpenConversationInput,
    ) => Promise<NimiRuntimeAgentConversationAnchorSnapshot>;
    readonly sendTurn: (input: NimiAppRuntimeAgentSendTurnInput) => Promise<SendAppMessageResponse>;
    readonly subscribeTurn: (
      input: NimiAppRuntimeAgentSubscribeTurnInput,
    ) => Promise<NimiAppRuntimeAgentTurnEventPage>;
    readonly getConversationSnapshot: (
      input: NimiAppRuntimeAgentConversationSnapshotInput,
    ) => Promise<NimiRuntimeAgentSessionSnapshot>;
  };
};

export function createNimiAppRuntimePlatformClient(
  input: NimiAppRuntimePlatformClientInput,
): NimiAppRuntimePlatformClient {
  assertExactKeys(input, ['standardShell'], 'SDK local-app client input');
  const standardShell = input.standardShell;
  assertExactKeys(standardShell, ['session', 'permission', 'artifacts', 'agent'], 'local-app standardShell');
  assertExactMethodNamespace(standardShell.session, ['status'], 'session');
  assertExactMethodNamespace(standardShell.permission, ['posture', 'request'], 'permission');
  assertExactMethodNamespace(standardShell.artifacts, ['readRuntimeBytes'], 'artifacts');
  assertExactMethodNamespace(
    standardShell.agent,
    ['inventory', 'openConversation', 'sendTurn', 'subscribeTurn', 'getConversationSnapshot'],
    'agent',
  );

  return Object.freeze({
    auth: Object.freeze({
      status: async () => projectAuth(await standardShell.session.status()),
    }),
    permissions: Object.freeze({
      posture: async (postureInput: NimiAppPermissionPostureInput) => {
        assertExactKeys(postureInput, ['operationId', 'resourceRef'], 'local-app permission posture input');
        const operationId = requireText(postureInput.operationId, 'operationId');
        const resourceRef = requireText(postureInput.resourceRef, 'resourceRef');
        return projectPermissionPosture(
          await standardShell.permission.posture({ operationId, resourceRef }),
          operationId,
          resourceRef,
        );
      },
      request: async (requestInput: NimiAppPermissionRequestInput) => {
        assertExactKeys(
          requestInput,
          ['operationId', 'resourceRef', 'purpose'],
          'local-app permission request input',
        );
        const operationId = requireText(requestInput.operationId, 'operationId');
        const resourceRef = requireText(requestInput.resourceRef, 'resourceRef');
        const purpose = requireText(requestInput.purpose, 'purpose');
        const posture = projectPermissionPosture(
          await standardShell.permission.request({ operationId, resourceRef, purpose }),
          operationId,
          resourceRef,
        );
        if (posture.state !== 'pending') {
          localAppProjectionError('permission request state');
        }
        return posture;
      },
    }),
    artifacts: Object.freeze({
      readRuntimeBytes: async (artifactId: string) => projectArtifact(
        await standardShell.artifacts.readRuntimeBytes(requireText(artifactId, 'artifactId')),
      ),
    }),
    agent: Object.freeze({
      listInventory: async () => projectAgentInventory(await standardShell.agent.inventory()),
      openConversation: async (agentInput: NimiAppRuntimeAgentOpenConversationInput) => {
        assertNoAuthorityMaterial(agentInput);
        assertExactKeys(
          agentInput,
          ['agentId', 'requestedAnchorDisposition'],
          'local-app open conversation input',
        );
        const normalized = {
          agentId: requireText(agentInput.agentId, 'agentId'),
          requestedAnchorDisposition: requireAnchorDisposition(agentInput.requestedAnchorDisposition),
        };
        return projectConversationAnchor(
          await standardShell.agent.openConversation(normalized),
          normalized.agentId,
        );
      },
      sendTurn: async (turnInput: NimiAppRuntimeAgentSendTurnInput) => {
        assertNoAuthorityMaterial(turnInput);
        assertExactKeys(
          turnInput,
          ['agentId', 'conversationAnchorId', 'clientTurnId', 'userText'],
          'local-app send turn input',
        );
        const normalized = {
          agentId: requireText(turnInput.agentId, 'agentId'),
          conversationAnchorId: requireText(turnInput.conversationAnchorId, 'conversationAnchorId'),
          clientTurnId: requireText(turnInput.clientTurnId, 'clientTurnId'),
          userText: requireText(turnInput.userText, 'userText'),
        };
        return projectSendTurn(await standardShell.agent.sendTurn(normalized));
      },
      subscribeTurn: async (subscribeInput: NimiAppRuntimeAgentSubscribeTurnInput) => {
        assertNoAuthorityMaterial(subscribeInput);
        assertExactKeys(
          subscribeInput,
          ['agentId', 'conversationAnchorId', 'cursor'],
          'local-app subscribe turn input',
        );
        const cursor = optionalCursor(subscribeInput.cursor);
        const normalized = {
          agentId: requireText(subscribeInput.agentId, 'agentId'),
          conversationAnchorId: requireText(subscribeInput.conversationAnchorId, 'conversationAnchorId'),
          ...(cursor ? { cursor } : {}),
        };
        return projectTurnEventPage(
          await standardShell.agent.subscribeTurn(normalized),
          normalized.agentId,
          normalized.conversationAnchorId,
          cursor,
        );
      },
      getConversationSnapshot: async (snapshotInput: NimiAppRuntimeAgentConversationSnapshotInput) => {
        assertNoAuthorityMaterial(snapshotInput);
        assertExactKeys(
          snapshotInput,
          ['agentId', 'conversationAnchorId'],
          'local-app conversation snapshot input',
        );
        const normalized = {
          agentId: requireText(snapshotInput.agentId, 'agentId'),
          conversationAnchorId: requireText(snapshotInput.conversationAnchorId, 'conversationAnchorId'),
        };
        return projectConversationSnapshot(
          await standardShell.agent.getConversationSnapshot(normalized),
          normalized.agentId,
          normalized.conversationAnchorId,
        );
      },
    }),
  });
}

function projectAgentInventory(value: unknown): NimiAppRuntimeAgentInventory {
  const record = asRecord(value);
  assertSafeProjection(record);
  assertExactProjectionKeys(record, ['ownerUserId', 'count', 'localAgents'], 'agent inventory');
  const ownerUserId = projectionText(record.ownerUserId, 'ownerUserId');
  const count = nonNegativeInteger(record.count, 'agent inventory count');
  if (!Array.isArray(record.localAgents) || count !== record.localAgents.length || count > 200) {
    localAppProjectionError('agent inventory count');
  }
  const localAgents = record.localAgents.map((entry, index): NimiAppRuntimeAgentInventoryItem => {
    const item = asRecord(entry);
    assertExactProjectionKeys(
      item,
      ['localAgentRef', 'displayName', 'ownerUserId', 'runtimeSourceRef', 'sourceReady'],
      `agent inventory item ${index}`,
    );
    const itemOwnerUserId = projectionText(item.ownerUserId, 'ownerUserId');
    if (itemOwnerUserId !== ownerUserId || typeof item.sourceReady !== 'boolean') {
      localAppProjectionError(`agent inventory item ${index} correlation`);
    }
    return {
      localAgentRef: projectionText(item.localAgentRef, 'localAgentRef'),
      displayName: projectionText(item.displayName, 'displayName'),
      ownerUserId: itemOwnerUserId,
      runtimeSourceRef: projectionText(item.runtimeSourceRef, 'runtimeSourceRef'),
      sourceReady: item.sourceReady,
    };
  });
  return { ownerUserId, count, localAgents };
}

function projectAuth(value: unknown): NimiAppAuthProjection {
  const record = asRecord(value);
  assertExactProjectionKeys(record, ['state', 'reasonCode', 'retryable'], 'auth');
  const rawState = projectionText(record.state, 'state');
  const reasonCode = projectionText(record.reasonCode, 'reasonCode');
  if (typeof record.retryable !== 'boolean') localAppProjectionError('auth retryable');
  const state = localAppSessionState(rawState, reasonCode);
  const actionHint = localAppSessionActionHint(state);
  if (state === 'unavailable') {
    return {
      mode: 'local-app',
      state,
      sessionBound: false,
      operationAllowed: false,
      reasonCode,
      actionHint,
      retryable: record.retryable,
    };
  }
  const sessionBound = state === 'session-bound-zero-grant' || state === 'session-bound-granted';
  return {
    mode: 'local-app',
    state,
    sessionBound,
    operationAllowed: state === 'session-bound-granted',
    reasonCode,
    actionHint,
    retryable: record.retryable,
  };
}

function projectPermissionPosture(
  value: unknown,
  requestedOperationId: string,
  requestedResourceRef: string,
): NimiAppPermissionPosture {
  const record = asRecord(value);
  assertExactProjectionKeys(
    record,
    ['state', 'operationId', 'resourceRef', 'reasonCode', 'actionHint', 'retryable'],
    'permission',
  );
  const state = String(record.state || '');
  if (!['zero-grant', 'pending', 'granted', 'denied', 'revoked', 'superseded', 'unavailable'].includes(state)) {
    localAppProjectionError('permission state');
  }
  const operationId = projectionText(record.operationId, 'operationId');
  const resourceRef = projectionText(record.resourceRef, 'resourceRef');
  if (operationId !== requestedOperationId || resourceRef !== requestedResourceRef) {
    localAppProjectionError('permission operation binding');
  }
  if (typeof record.retryable !== 'boolean') localAppProjectionError('permission retryable');
  return {
    state: state as NimiAppPermissionPosture['state'],
    operationId,
    resourceRef,
    reasonCode: projectionText(record.reasonCode, 'reasonCode'),
    actionHint: projectionText(record.actionHint, 'actionHint'),
    retryable: record.retryable,
  };
}

function projectConversationAnchor(
  value: unknown,
  expectedAgentId: string,
): NimiRuntimeAgentConversationAnchorSnapshot {
  const record = asRecord(value);
  assertSafeProjection(record);
  assertExactProjectionKeys(record, ['anchor', 'activeTurnId', 'activeStreamId'], 'conversation anchor');
  const anchor = asRecord(record.anchor);
  assertExactProjectionKeys(anchor, [
    'conversationAnchorId', 'agentId', 'status', 'lastTurnId', 'lastMessageId',
    'createdAt', 'updatedAt', 'metadata', 'localAgentRef',
  ], 'conversation anchor body');
  const conversationAnchorId = projectionText(anchor.conversationAnchorId, 'conversationAnchorId');
  const agentId = projectionText(anchor.agentId, 'agentId');
  const localAgentRef = projectionText(anchor.localAgentRef, 'localAgentRef');
  if (agentId !== expectedAgentId || localAgentRef !== expectedAgentId) {
    localAppProjectionError('conversation anchor correlation');
  }
  const status = nonNegativeInteger(anchor.status, 'conversation anchor status');
  const metadata = asRecord(anchor.metadata);
  if (!metadata) localAppProjectionError('conversation anchor metadata');
  const createdAt = projectTimestamp(anchor.createdAt, 'createdAt');
  const updatedAt = projectTimestamp(anchor.updatedAt, 'updatedAt');
  const normalized: ConversationAnchorSnapshot = {
    anchor: {
      conversationAnchorId,
      agentId,
      subjectUserId: '',
      status: status as NonNullable<ConversationAnchorSnapshot['anchor']>['status'],
      lastTurnId: canonicalString(anchor.lastTurnId, 'lastTurnId'),
      lastMessageId: canonicalString(anchor.lastMessageId, 'lastMessageId'),
      ...(createdAt ? { createdAt } : {}),
      ...(updatedAt ? { updatedAt } : {}),
      metadata: toNimiRuntimeProtoStruct(metadata as JsonObject),
      localAgentRef,
      ownerUserId: '',
      runtimeSourceRef: '',
    },
    activeTurnId: canonicalString(record.activeTurnId, 'activeTurnId'),
    activeStreamId: canonicalString(record.activeStreamId, 'activeStreamId'),
  };
  try {
    return decodeNimiRuntimeAgentConversationAnchorSnapshot(normalized, expectedAgentId);
  } catch {
    return localAppProjectionError('conversation anchor');
  }
}

function projectSendTurn(value: unknown): SendAppMessageResponse {
  const record = asRecord(value);
  assertSafeProjection(record);
  assertExactProjectionKeys(record, ['messageId', 'accepted', 'reasonCode'], 'send turn');
  if (record.accepted !== true) localAppProjectionError('send turn acceptance');
  return {
    messageId: projectionText(record.messageId, 'messageId'),
    accepted: true,
    reasonCode: nonNegativeInteger(record.reasonCode, 'reasonCode') as SendAppMessageResponse['reasonCode'],
  };
}

function projectTurnEventPage(
  value: unknown,
  expectedAgentId: string,
  expectedConversationAnchorId: string,
  previousCursor: string | undefined,
): NimiAppRuntimeAgentTurnEventPage {
  const record = asRecord(value);
  assertSafeProjection(record);
  assertExactProjectionKeys(record, ['cursor', 'events'], 'subscribe turn');
  const cursor = decimalCursor(record.cursor, 'cursor');
  if (previousCursor !== undefined && BigInt(cursor) <= BigInt(previousCursor)) {
    localAppProjectionError('subscribe turn cursor progression');
  }
  if (!Array.isArray(record.events) || record.events.length !== 1) {
    localAppProjectionError('subscribe turn event page');
  }
  const rawEvent = asRecord(record.events[0]);
  assertExactProjectionKeys(rawEvent, [
    'eventType', 'sequence', 'messageId', 'messageType', 'payload',
    'reasonCode', 'traceId', 'timestamp',
  ], 'subscribe turn event');
  const sequence = decimalCursor(rawEvent.sequence, 'event sequence');
  if (sequence !== cursor) localAppProjectionError('subscribe turn cursor correlation');
  const payload = asRecord(rawEvent.payload);
  if (!payload) localAppProjectionError('subscribe turn event payload');
  const timestamp = projectTimestamp(rawEvent.timestamp, 'timestamp');
  const event: AppMessageEvent = {
    eventType: nonNegativeInteger(rawEvent.eventType, 'eventType') as AppMessageEvent['eventType'],
    sequence,
    messageId: projectionText(rawEvent.messageId, 'messageId'),
    fromAppId: 'runtime.agent',
    toAppId: '',
    subjectUserId: '',
    messageType: projectionText(rawEvent.messageType, 'messageType'),
    payload: toNimiRuntimeProtoStruct(payload as JsonObject),
    reasonCode: nonNegativeInteger(rawEvent.reasonCode, 'reasonCode') as AppMessageEvent['reasonCode'],
    traceId: canonicalString(rawEvent.traceId, 'traceId'),
    ...(timestamp ? { timestamp } : {}),
  };
  let projected: NimiRuntimeAgentConsumeEvent | null;
  try {
    projected = projectNimiRuntimeAgentAppMessageEvent(event);
  } catch {
    return localAppProjectionError('subscribe turn event');
  }
  if (
    !projected
    || projected.localAgentRef !== expectedAgentId
    || projected.conversationAnchorId !== expectedConversationAnchorId
  ) {
    localAppProjectionError('subscribe turn event correlation');
  }
  return { cursor, events: [projected] };
}

function projectConversationSnapshot(
  value: unknown,
  expectedAgentId: string,
  expectedConversationAnchorId: string,
): NimiRuntimeAgentSessionSnapshot {
  const record = asRecord(value);
  if (!record) localAppProjectionError('conversation snapshot');
  assertSafeProjection(record);
  try {
    return parseNimiRuntimeAgentSessionSnapshot(toNimiRuntimeProtoStruct(record as JsonObject), {
      localAgentRef: expectedAgentId,
      conversationAnchorId: expectedConversationAnchorId,
    });
  } catch {
    return localAppProjectionError('conversation snapshot');
  }
}

function projectArtifact(value: unknown): NimiAppRuntimeArtifactBytes {
  const record = asRecord(value);
  assertExactProjectionKeys(record, ['bytes', 'mimeType', 'sizeBytes', 'mimeInferred'], 'artifact');
  const bytes = record.bytes;
  const sizeBytes = Number(record.sizeBytes);
  const mimeType = projectionText(record.mimeType, 'mimeType');
  if (
    !(bytes instanceof Uint8Array)
    || !Number.isSafeInteger(sizeBytes)
    || sizeBytes < 0
    || sizeBytes > MAX_INLINE_ARTIFACT_BYTES
    || bytes.byteLength !== sizeBytes
    || !mimeType.includes('/')
    || typeof record.mimeInferred !== 'boolean'
  ) {
    localAppProjectionError('artifact');
  }
  return { bytes: Uint8Array.from(bytes), mimeType, sizeBytes, mimeInferred: record.mimeInferred };
}

function localAppSessionState(
  rawState: string,
  reasonCode: string,
): NimiAppLocalSessionState | 'unavailable' {
  const normalizedReason = normalizeFieldName(reasonCode);
  if (normalizedReason.includes('processreplaced')) return 'process-replaced';
  if (normalizedReason.includes('accountchanged')) return 'account-changed';
  if (normalizedReason.includes('runtimerestarted')) return 'runtime-restarted';
  switch (rawState) {
    case 'authorizing': return 'action-required';
    case 'zero-grant': return 'session-bound-zero-grant';
    case 'ready': return 'session-bound-granted';
    case 'denied': return 'action-required';
    case 'runtime-unavailable': return 'unavailable';
    case 'revoked': return 'revoked';
    case 'project-changed': return 'project-changed';
    default: return localAppProjectionError('auth state');
  }
}

function localAppSessionActionHint(state: NimiAppLocalSessionState | 'unavailable'): string {
  switch (state) {
    case 'session-bound-zero-grant': return 'request_local_app_operation_grant';
    case 'session-bound-granted': return 'continue_local_app_operation';
    case 'action-required': return 'complete_local_app_authorization';
    case 'revoked': return 'request_local_app_operation_grant';
    case 'project-changed': return 'readmit_local_development_project';
    case 'process-replaced': return 'restart_through_verified_desktop_supervisor';
    case 'account-changed': return 'reauthorize_for_current_account';
    case 'runtime-restarted': return 'reopen_local_app_session';
    case 'unavailable': return 'start_fixed_runtime_service';
  }
}

function requireAnchorDisposition(value: unknown): NimiAppRuntimeAgentOpenConversationInput['requestedAnchorDisposition'] {
  if (value === 'create-or-resume' || value === 'create-new') return value;
  return localAppError(
    'Local-app conversation anchor disposition is invalid.',
    'SDK_LOCAL_APP_INPUT_INVALID',
    'use_declared_anchor_disposition',
  );
}

function optionalCursor(value: unknown): string | undefined {
  if (value === undefined || value === '') return undefined;
  return decimalCursor(value, 'cursor');
}

function decimalCursor(value: unknown, field: string): string {
  if (typeof value !== 'string' || !/^(?:0|[1-9]\d*)$/u.test(value)) {
    localAppProjectionError(field);
  }
  return value;
}

function nonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    localAppProjectionError(field);
  }
  return value;
}

function canonicalString(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() !== value) localAppProjectionError(field);
  return value;
}

function projectTimestamp(
  value: unknown,
  field: string,
): { readonly seconds: string; readonly nanos: number } | undefined {
  if (value === null || value === undefined) return undefined;
  const record = asRecord(value);
  assertExactProjectionKeys(record, ['seconds', 'nanos'], field);
  const seconds = typeof record.seconds === 'string' && /^-?(?:0|[1-9]\d*)$/u.test(record.seconds)
    ? record.seconds
    : undefined;
  const nanos = record.nanos;
  if (!seconds || typeof nanos !== 'number' || !Number.isInteger(nanos) || nanos < 0 || nanos > 999_999_999) {
    localAppProjectionError(field);
  }
  return { seconds, nanos };
}

function assertExactMethodNamespace(
  value: unknown,
  methods: readonly string[],
  namespace: string,
): void {
  const record = asRecord(value);
  if (!record || !sameKeys(record, methods) || methods.some((method) => typeof record[method] !== 'function')) {
    localAppError(
      `Host-injected local-app standardShell ${namespace} namespace is invalid.`,
      'SDK_LOCAL_APP_CARRIER_REQUIRED',
      'use_host_injected_standard_shell',
    );
  }
}

function assertExactProjectionKeys(
  value: unknown,
  expected: readonly string[],
  field: string,
): asserts value is Record<string, unknown> {
  const record = asRecord(value);
  if (!record || !sameKeys(record, expected)) localAppProjectionError(field);
}

function sameKeys(record: Record<string, unknown>, expected: readonly string[]): boolean {
  const actual = Object.keys(record).sort();
  const wanted = [...expected].sort();
  return actual.length === wanted.length && actual.every((key, index) => key === wanted[index]);
}

function assertSafeProjection(value: unknown, seen = new Set<object>()): void {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number' && Number.isFinite(value)) return;
  if (!value || typeof value !== 'object') localAppProjectionError('unsafe value');
  if (seen.has(value)) localAppProjectionError('cyclic value');
  seen.add(value);
  if (value instanceof Uint8Array) return;
  if (Array.isArray(value)) {
    for (const entry of value) assertSafeProjection(entry, seen);
    return;
  }
  const record = asRecord(value);
  if (!record) localAppProjectionError('unsafe object');
  for (const [key, entry] of Object.entries(record)) {
    if (FORBIDDEN_AUTHORITY_FIELDS.has(normalizeFieldName(key))) {
      localAppProjectionError(`forbidden ${key}`);
    }
    assertSafeProjection(entry, seen);
  }
}

function assertNoAuthorityMaterial(value: unknown, seen = new Set<object>()): void {
  if (!value || typeof value !== 'object') return;
  if (seen.has(value)) return;
  seen.add(value);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') localAppProjectionError('symbol input field');
    if (FORBIDDEN_AUTHORITY_FIELDS.has(normalizeFieldName(key))) {
      localAppError(
        `Local-app operation input cannot carry ${key}.`,
        'SDK_LOCAL_APP_AUTHORITY_FIELD_FORBIDDEN',
        'remove_app_supplied_authority_material',
      );
    }
    assertNoAuthorityMaterial((value as Record<string, unknown>)[key], seen);
  }
}

function normalizeFieldName(value: string): string {
  return value.replace(/[^a-z0-9]/giu, '').toLowerCase();
}

function assertExactKeys(value: unknown, allowed: readonly string[], label: string): asserts value is Record<string, unknown> {
  const record = asRecord(value);
  if (!record || Object.keys(record).some((key) => !allowed.includes(key))) {
    localAppError(`${label} contains unsupported fields.`, 'SDK_LOCAL_APP_INPUT_INVALID', 'remove_unsupported_fields');
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null
    ? value as Record<string, unknown>
    : undefined;
}

function requireText(value: unknown, field: string): string {
  const normalized = optionalText(value);
  if (!normalized || normalized !== value) {
    localAppError(`Local-app carrier requires canonical ${field}.`, 'SDK_LOCAL_APP_INPUT_INVALID', `provide_${field}`);
  }
  return normalized;
}

function projectionText(value: unknown, field: string): string {
  const normalized = optionalText(value);
  if (!normalized || normalized !== value) localAppProjectionError(field);
  return normalized;
}

function optionalText(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function localAppProjectionError(field: string): never {
  return localAppError(
    `Host-injected local-app carrier returned an invalid ${field} projection.`,
    'SDK_LOCAL_APP_PROJECTION_INVALID',
    'repair_host_injected_standard_shell',
  );
}

function localAppError(message: string, reasonCode: string, actionHint: string): never {
  throw createNimiError({ message, reasonCode, actionHint, source: 'sdk' });
}
