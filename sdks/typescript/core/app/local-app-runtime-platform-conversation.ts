import type { JsonObject, JsonValue } from '../../types/index.js';
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

declare const selectedAgentHandleBrand: unique symbol;

/** Opaque owner-issued selector. Apps cannot use a raw LocalAgent id as authority input. */
export type NimiSelectedAgentHandle = string & {
  readonly [selectedAgentHandleBrand]: 'owner-issued-selected-agent-handle';
};

export type NimiLocalAppConversationOpenInput = {
  readonly selectedAgentHandle: NimiSelectedAgentHandle;
  readonly disposition: 'create-or-resume' | 'create-new';
};

export type NimiLocalAppConversationOpenResult = {
  readonly conversationAnchorId: string;
  readonly activeTurnId: string | null;
  readonly activeStreamId: string | null;
};

export type NimiLocalAppConversationSendInput = {
  readonly selectedAgentHandle: NimiSelectedAgentHandle;
  readonly conversationAnchorId: string;
  readonly requestId: string;
  readonly text: string;
};

export type NimiLocalAppConversationSendResult = {
  readonly messageId: string;
};

export type NimiLocalAppConversationScopeInput = {
  readonly selectedAgentHandle: NimiSelectedAgentHandle;
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
    readonly selectedAgentHandle: string;
    readonly disposition: NimiLocalAppConversationOpenInput['disposition'];
  }) => Promise<unknown>;
  readonly send: (input: {
    readonly selectedAgentHandle: string;
    readonly conversationAnchorId: string;
    readonly requestId: string;
    readonly text: string;
  }) => Promise<unknown>;
  readonly subscribe: (input: {
    readonly selectedAgentHandle: string;
    readonly conversationAnchorId: string;
  }) => Promise<NimiLocalAppConversationShellSubscription>;
  readonly snapshot: (input: {
    readonly selectedAgentHandle: string;
    readonly conversationAnchorId: string;
  }) => Promise<unknown>;
};

export function createNimiLocalAppConversationClient(shell: NimiLocalAppConversationShell) {
  return Object.freeze({
    open: async (input: NimiLocalAppConversationOpenInput): Promise<NimiLocalAppConversationOpenResult> => {
      assertExactKeys(input, ['selectedAgentHandle', 'disposition'], 'local-app conversation open input');
      assertNoAuthorityMaterial(input);
      const selectedAgentHandle = requireText(input.selectedAgentHandle, 'selectedAgentHandle');
      if (input.disposition !== 'create-or-resume' && input.disposition !== 'create-new') {
        return localAppError(
          'Local-app conversation disposition is invalid.',
          'SDK_LOCAL_APP_INPUT_INVALID',
          'use_declared_conversation_disposition',
        );
      }
      return projectOpen(await shell.open({ selectedAgentHandle, disposition: input.disposition }));
    },
    send: async (input: NimiLocalAppConversationSendInput): Promise<NimiLocalAppConversationSendResult> => {
      assertExactKeys(
        input,
        ['selectedAgentHandle', 'conversationAnchorId', 'requestId', 'text'],
        'local-app conversation send input',
      );
      assertNoAuthorityMaterial(input);
      const text = requireText(input.text, 'text');
      if (new TextEncoder().encode(text).byteLength > 64 * 1024) {
        return localAppError(
          'Local-app conversation text exceeds 65536 UTF-8 bytes.',
          'SDK_LOCAL_APP_INPUT_INVALID',
          'shorten_conversation_text',
        );
      }
      const value = await shell.send({
        selectedAgentHandle: requireText(input.selectedAgentHandle, 'selectedAgentHandle'),
        conversationAnchorId: requireText(input.conversationAnchorId, 'conversationAnchorId'),
        requestId: requireText(input.requestId, 'requestId'),
        text,
      });
      const record = asRecord(value);
      assertExactProjectionKeys(record, ['messageId'], 'conversation send');
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

function conversationScope(
  input: NimiLocalAppConversationScopeInput,
  operation: string,
): { readonly selectedAgentHandle: string; readonly conversationAnchorId: string } {
  assertExactKeys(
    input,
    ['selectedAgentHandle', 'conversationAnchorId'],
    `local-app conversation ${operation} input`,
  );
  assertNoAuthorityMaterial(input);
  return {
    selectedAgentHandle: requireText(input.selectedAgentHandle, 'selectedAgentHandle'),
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
