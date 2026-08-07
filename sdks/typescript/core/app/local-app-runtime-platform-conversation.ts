import type { JsonObject, JsonValue } from '../../types/index.js';
import type { NimiLocalAppAgentHandle } from './local-app-agent-selector.js';
import {
  asRecord,
  assertExactKeys,
  assertExactProjectionKeys,
  assertNoAuthorityMaterial,
  assertSafeProjection,
  localAppError,
  localAppProjectionError,
  projectionText,
  requireText,
} from './local-app-runtime-platform-validation.js';

export type { NimiLocalAppAgentHandle } from './local-app-agent-selector.js';

export type NimiLocalAppConversationOpenInput = {
  readonly agentHandle: NimiLocalAppAgentHandle;
};

export type NimiLocalAppConversationOpenResult = {
  readonly conversationAnchorId: string;
  readonly activeTurnId: string | null;
  readonly activeStreamId: string | null;
};

export type NimiLocalAppConversationAttachment = {
  readonly artifactId: string;
  readonly displayName?: string;
};

export type NimiLocalAppConversationSendInput = {
  readonly agentHandle: NimiLocalAppAgentHandle;
  readonly conversationAnchorId: string;
  readonly requestId: string;
  readonly text: string;
  readonly attachments: readonly NimiLocalAppConversationAttachment[];
};

export type NimiLocalAppConversationSendResult = {
  readonly messageId: string;
};

export type NimiLocalAppConversationInterruptResult = {
  readonly messageId: string;
};

export type NimiLocalAppConversationScopeInput = {
  readonly agentHandle: NimiLocalAppAgentHandle;
  readonly conversationAnchorId: string;
};

export type NimiLocalAppConversationEvent = {
  readonly eventType: number;
  readonly sequence: string;
  readonly messageId: string;
  readonly messageType: string;
  readonly payload: JsonValue;
  readonly reasonCode: string;
  readonly traceId: string;
  readonly timestampUnixMs: number | null;
};

export type NimiLocalAppConversationSnapshot = JsonObject;

export type NimiLocalAppConversationSubscription = AsyncIterable<NimiLocalAppConversationEvent> & {
  readonly cancel: () => Promise<void>;
};

export type NimiLocalAppConversationShellSubscription = {
  readonly events: AsyncIterable<unknown>;
  readonly cancel: () => Promise<void>;
};

export type NimiLocalAppConversationShell = {
  readonly open: (input: {
    readonly agentHandle: string;
  }) => Promise<unknown>;
  readonly send: (input: {
    readonly agentHandle: string;
    readonly conversationAnchorId: string;
    readonly requestId: string;
    readonly text: string;
    readonly attachments: readonly NimiLocalAppConversationAttachment[];
  }) => Promise<unknown>;
  readonly interruptTurn: (input: {
    readonly agentHandle: string;
    readonly conversationAnchorId: string;
  }) => Promise<unknown>;
  readonly subscribe: (input: {
    readonly agentHandle: string;
    readonly conversationAnchorId: string;
  }) => Promise<NimiLocalAppConversationShellSubscription>;
  readonly snapshot: (input: {
    readonly agentHandle: string;
    readonly conversationAnchorId: string;
  }) => Promise<unknown>;
};

export type NimiLocalAppConversationClient = {
  readonly open: (input: NimiLocalAppConversationOpenInput) => Promise<NimiLocalAppConversationOpenResult>;
  readonly send: (input: NimiLocalAppConversationSendInput) => Promise<NimiLocalAppConversationSendResult>;
  readonly interruptTurn: (input: NimiLocalAppConversationScopeInput) => Promise<NimiLocalAppConversationInterruptResult>;
  readonly subscribe: (input: NimiLocalAppConversationScopeInput) => Promise<NimiLocalAppConversationSubscription>;
  readonly snapshot: (input: NimiLocalAppConversationScopeInput) => Promise<NimiLocalAppConversationSnapshot>;
};

export function createNimiLocalAppConversationClient(
  _shell: NimiLocalAppConversationShell,
): NimiLocalAppConversationClient {
  const unavailable = async (): Promise<never> => protectedAppAccessUnavailable();
  return Object.freeze({
    open: unavailable,
    send: unavailable,
    interruptTurn: unavailable,
    subscribe: unavailable,
    snapshot: unavailable,
  });
}

function protectedAppAccessUnavailable(): never {
  return localAppError(
    'Protected App operations are unavailable until Runtime establishes a fresh App Access session.',
    'SDK_LOCAL_APP_ACCESS_UNAVAILABLE',
    'retry_after_protected_session_establishment',
  );
}

function validateConversationAttachments(
  value: unknown,
): readonly NimiLocalAppConversationAttachment[] {
  if (!Array.isArray(value) || value.length > 1) {
    return localAppError(
      'Local-app conversation attachments admit at most one item.',
      'SDK_LOCAL_APP_INPUT_INVALID',
      'provide_valid_conversation_attachment',
    );
  }
  return value.map((item) => {
    const record = asRecord(item);
    if (!record || Object.keys(record).some((key) => key !== 'artifactId' && key !== 'displayName')) {
      return localAppError(
        'Local-app conversation attachment contains unsupported fields.',
        'SDK_LOCAL_APP_INPUT_INVALID',
        'provide_valid_conversation_attachment',
      );
    }
    const artifactId = requireText(record.artifactId, 'attachments.artifactId');
    if (record.displayName !== undefined && typeof record.displayName !== 'string') {
      return localAppError(
        'Local-app conversation attachment displayName must be a string.',
        'SDK_LOCAL_APP_INPUT_INVALID',
        'provide_valid_conversation_attachment',
      );
    }
    const displayName = typeof record.displayName === 'string' && record.displayName.trim()
      ? record.displayName.trim()
      : '';
    return Object.freeze({
      artifactId,
      ...(displayName ? { displayName } : {}),
    });
  });
}

function conversationScope(
  input: NimiLocalAppConversationScopeInput,
  operation: string,
): { readonly agentHandle: string; readonly conversationAnchorId: string } {
  assertExactKeys(
    input,
    ['agentHandle', 'conversationAnchorId'],
    `local-app conversation ${operation} input`,
  );
  assertNoAuthorityMaterial(input);
  return {
    agentHandle: requireText(input.agentHandle, 'agentHandle'),
    conversationAnchorId: requireText(input.conversationAnchorId, 'conversationAnchorId'),
  };
}

function projectOpen(value: unknown): NimiLocalAppConversationOpenResult {
  const record = asRecord(value);
  assertExactProjectionKeys(
    record,
    ['conversationAnchorId', 'activeTurnId', 'activeStreamId'],
    'conversation open',
  );
  return Object.freeze({
    conversationAnchorId: projectionText(record.conversationAnchorId, 'conversationAnchorId'),
    activeTurnId: nullableProjectionText(record.activeTurnId, 'activeTurnId'),
    activeStreamId: nullableProjectionText(record.activeStreamId, 'activeStreamId'),
  });
}

function projectEvent(value: unknown): NimiLocalAppConversationEvent {
  const record = asRecord(value);
  assertExactProjectionKeys(record, [
    'eventType',
    'sequence',
    'messageId',
    'messageType',
    'payload',
    'reasonCode',
    'traceId',
    'timestampUnixMs',
  ], 'conversation event');
  if (!Number.isSafeInteger(record.eventType)
    || typeof record.sequence !== 'string'
    || !/^(?:0|[1-9][0-9]*)$/u.test(record.sequence)
    || (record.timestampUnixMs !== null
      && (!Number.isSafeInteger(record.timestampUnixMs) || Number(record.timestampUnixMs) < 0))) {
    return localAppProjectionError('conversation event');
  }
  assertSafeProjection(record.payload);
  return Object.freeze({
    eventType: record.eventType as number,
    sequence: record.sequence,
    messageId: projectionText(record.messageId, 'messageId'),
    messageType: projectionText(record.messageType, 'messageType'),
    payload: record.payload as JsonValue,
    reasonCode: projectionText(record.reasonCode, 'reasonCode'),
    traceId: projectionText(record.traceId, 'traceId'),
    timestampUnixMs: record.timestampUnixMs as number | null,
  });
}

function nullableProjectionText(value: unknown, field: string): string | null {
  return value === null ? null : projectionText(value, field);
}
