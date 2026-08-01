import type { JsonObject, JsonValue } from '../../types/index.js';
import type { NimiLocalAppAgentHandle } from './permission-types.js';
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

export type { NimiLocalAppAgentHandle } from './permission-types.js';

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

export function createNimiLocalAppConversationClient(shell: NimiLocalAppConversationShell) {
  return Object.freeze({
    open: async (input: NimiLocalAppConversationOpenInput): Promise<NimiLocalAppConversationOpenResult> => {
      assertExactKeys(input, ['agentHandle'], 'local-app conversation open input');
      assertNoAuthorityMaterial(input);
      const agentHandle = requireText(input.agentHandle, 'agentHandle');
      return projectOpen(await shell.open({ agentHandle }));
    },
    send: async (input: NimiLocalAppConversationSendInput): Promise<NimiLocalAppConversationSendResult> => {
      assertExactKeys(
        input,
        ['agentHandle', 'conversationAnchorId', 'requestId', 'text', 'attachments'],
        'local-app conversation send input',
      );
      assertNoAuthorityMaterial(input);
      const attachments = validateConversationAttachments(input.attachments);
      if (typeof input.text !== 'string' || input.text.trim() !== input.text || (!input.text && attachments.length === 0)) {
        return localAppError(
          'Local-app conversation text is invalid.',
          'SDK_LOCAL_APP_INPUT_INVALID',
          'provide_text',
        );
      }
      const text = input.text;
      if (new TextEncoder().encode(text).byteLength > 64 * 1024) {
        return localAppError(
          'Local-app conversation text exceeds 65536 UTF-8 bytes.',
          'SDK_LOCAL_APP_INPUT_INVALID',
          'shorten_conversation_text',
        );
      }
      const value = await shell.send({
        agentHandle: requireText(input.agentHandle, 'agentHandle'),
        conversationAnchorId: requireText(input.conversationAnchorId, 'conversationAnchorId'),
        requestId: requireText(input.requestId, 'requestId'),
        text,
        attachments,
      });
      const record = asRecord(value);
      assertExactProjectionKeys(record, ['messageId'], 'conversation send');
      return Object.freeze({ messageId: projectionText(record.messageId, 'messageId') });
    },
    interruptTurn: async (
      input: NimiLocalAppConversationScopeInput,
    ): Promise<NimiLocalAppConversationInterruptResult> => {
      const value = await shell.interruptTurn(conversationScope(input, 'interrupt turn'));
      const record = asRecord(value);
      assertExactProjectionKeys(record, ['messageId'], 'conversation interrupt turn');
      return Object.freeze({ messageId: projectionText(record.messageId, 'messageId') });
    },
    subscribe: async (
      input: NimiLocalAppConversationScopeInput,
    ): Promise<NimiLocalAppConversationSubscription> => {
      const scope = conversationScope(input, 'subscribe');
      const subscription = await shell.subscribe(scope);
      if (!subscription || typeof subscription !== 'object'
        || typeof subscription.cancel !== 'function'
        || !subscription.events
        || typeof subscription.events[Symbol.asyncIterator] !== 'function') {
        return localAppProjectionError('conversation subscription');
      }
      let cancelled = false;
      const cancel = async (): Promise<void> => {
        if (cancelled) return;
        cancelled = true;
        await subscription.cancel();
      };
      const events = async function* (): AsyncGenerator<NimiLocalAppConversationEvent> {
        try {
          for await (const event of subscription.events) {
            yield projectEvent(event);
          }
        } finally {
          await cancel();
        }
      };
      return Object.freeze({
        [Symbol.asyncIterator]: events,
        cancel,
      });
    },
    snapshot: async (input: NimiLocalAppConversationScopeInput): Promise<NimiLocalAppConversationSnapshot> => {
      const value = await shell.snapshot(conversationScope(input, 'snapshot'));
      assertSafeProjection(value);
      const record = asRecord(value);
      if (!record) return localAppProjectionError('conversation snapshot');
      return Object.freeze({ ...record }) as NimiLocalAppConversationSnapshot;
    },
  });
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
