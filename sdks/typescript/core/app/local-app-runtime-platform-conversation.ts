import type { NimiLocalAppAgentHandle } from './local-app-agent-selector.js';
import {
  asRecord,
  assertExactKeys,
  assertExactProjectionKeys,
  assertNoAuthorityMaterial,
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
};

export type NimiLocalAppConversationSendInput = {
  readonly agentHandle: NimiLocalAppAgentHandle;
  readonly conversationAnchorId: string;
  readonly requestId: string;
  readonly text: string;
};

export type NimiLocalAppConversationSendResult = {
  readonly turnId: string;
};

export type NimiLocalAppConversationInterruptResult = {
  readonly turnId: string;
};

export type NimiLocalAppConversationScopeInput = {
  readonly agentHandle: NimiLocalAppAgentHandle;
  readonly conversationAnchorId: string;
};

type NimiLocalAppConversationEventBase = {
  readonly conversationAnchorId: string;
  readonly sequence: string;
  readonly turnId: string;
};

export type NimiLocalAppConversationEvent =
  | (NimiLocalAppConversationEventBase & {
      readonly type: 'turn-accepted';
      readonly requestId: string;
    })
  | (NimiLocalAppConversationEventBase & {
      readonly type: 'turn-started';
    })
  | (NimiLocalAppConversationEventBase & {
      readonly type: 'text-delta';
      readonly text: string;
    })
  | (NimiLocalAppConversationEventBase & {
      readonly type: 'message-committed';
      readonly messageId: string;
      readonly text: string;
    })
  | (NimiLocalAppConversationEventBase & {
      readonly type: 'turn-completed';
      readonly terminalReason: '' | 'stop' | 'length' | 'tool_call' | 'content_filter' | 'error' | 'unspecified';
    })
  | (NimiLocalAppConversationEventBase & {
      readonly type: 'turn-failed';
      readonly reasonCode: string;
      readonly message: string | null;
    })
  | (NimiLocalAppConversationEventBase & {
      readonly type: 'turn-interrupted';
      readonly reason: 'user_cancel' | 'room_closed' | 'superseded_turn' | 'budget_exhausted' | 'timeout' | 'gateway_revoked' | 'policy_refusal';
    });

export type NimiLocalAppConversationMessage = {
  readonly turnId: string;
  readonly role: 'user' | 'assistant';
  readonly text: string;
};

export type NimiLocalAppConversationSnapshot = {
  readonly conversationAnchorId: string;
  readonly activeTurnId: string | null;
  readonly messages: readonly NimiLocalAppConversationMessage[];
  readonly truncatedBefore: boolean;
};

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
  shell: NimiLocalAppConversationShell,
): NimiLocalAppConversationClient {
  return Object.freeze({
    open: async (input) => {
      assertExactKeys(input, ['agentHandle'], 'local-app conversation open input');
      assertNoAuthorityMaterial(input);
      return projectOpen(await shell.open({
        agentHandle: validateAgentHandle(input.agentHandle),
      }));
    },
    send: async (input) => {
      assertExactKeys(
        input,
        ['agentHandle', 'conversationAnchorId', 'requestId', 'text'],
        'local-app conversation send input',
      );
      assertNoAuthorityMaterial(input);
      const value = await shell.send({
        agentHandle: validateAgentHandle(input.agentHandle),
        conversationAnchorId: boundedSelector(input.conversationAnchorId, 'conversationAnchorId'),
        requestId: boundedSelector(input.requestId, 'requestId'),
        text: boundedTurnText(input.text),
      });
      const record = asRecord(value);
      assertExactProjectionKeys(record, ['turnId'], 'conversation send');
      return Object.freeze({ turnId: boundedProjectionSelector(record.turnId, 'turnId') });
    },
    interruptTurn: async (input) => {
      const value = await shell.interruptTurn(conversationScope(input, 'interrupt'));
      const record = asRecord(value);
      assertExactProjectionKeys(record, ['turnId'], 'conversation interrupt');
      return Object.freeze({ turnId: boundedProjectionSelector(record.turnId, 'turnId') });
    },
    subscribe: async (input) => {
      const subscription = await shell.subscribe(conversationScope(input, 'subscribe'));
      const projected: NimiLocalAppConversationSubscription = {
        async *[Symbol.asyncIterator]() {
          for await (const event of subscription.events) {
            yield projectEvent(event);
          }
        },
        cancel: async () => subscription.cancel(),
      };
      return Object.freeze(projected);
    },
    snapshot: async (input) => projectSnapshot(
      await shell.snapshot(conversationScope(input, 'snapshot')),
    ),
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
    agentHandle: validateAgentHandle(input.agentHandle),
    conversationAnchorId: boundedSelector(input.conversationAnchorId, 'conversationAnchorId'),
  };
}

function projectOpen(value: unknown): NimiLocalAppConversationOpenResult {
  const record = asRecord(value);
  assertExactProjectionKeys(
    record,
    ['conversationAnchorId', 'activeTurnId'],
    'conversation open',
  );
  return Object.freeze({
    conversationAnchorId: boundedProjectionSelector(record.conversationAnchorId, 'conversationAnchorId'),
    activeTurnId: nullableProjectionSelector(record.activeTurnId, 'activeTurnId'),
  });
}

function projectEvent(value: unknown): NimiLocalAppConversationEvent {
  const record = asRecord(value);
  if (!record || typeof record.type !== 'string'
    || typeof record.sequence !== 'string'
    || !/^[1-9][0-9]*$/u.test(record.sequence)) {
    return localAppProjectionError('conversation event');
  }
  const base = Object.freeze({
    conversationAnchorId: boundedProjectionSelector(record.conversationAnchorId, 'conversationAnchorId'),
    sequence: record.sequence,
    turnId: boundedProjectionSelector(record.turnId, 'turnId'),
  });
  const commonKeys = ['type', 'conversationAnchorId', 'sequence', 'turnId'];
  switch (record.type) {
    case 'turn-accepted':
      assertExactProjectionKeys(record, [...commonKeys, 'requestId'], 'turn accepted event');
      return Object.freeze({ ...base, type: 'turn-accepted', requestId: boundedProjectionSelector(record.requestId, 'requestId') });
    case 'turn-started':
      assertExactProjectionKeys(record, commonKeys, 'turn started event');
      return Object.freeze({ ...base, type: 'turn-started' });
    case 'text-delta':
      assertExactProjectionKeys(record, [...commonKeys, 'text'], 'text delta event');
      return Object.freeze({ ...base, type: 'text-delta', text: boundedProjectionText(record.text, 'text', 64 * 1024) });
    case 'message-committed':
      assertExactProjectionKeys(record, [...commonKeys, 'messageId', 'text'], 'message committed event');
      return Object.freeze({
        ...base,
        type: 'message-committed',
        messageId: boundedProjectionSelector(record.messageId, 'messageId'),
        text: boundedProjectionText(record.text, 'text', 64 * 1024),
      });
    case 'turn-completed': {
      assertExactProjectionKeys(record, [...commonKeys, 'terminalReason'], 'turn completed event');
      const terminalReason = record.terminalReason;
      if (typeof terminalReason !== 'string'
        || !['', 'stop', 'length', 'tool_call', 'content_filter', 'error', 'unspecified'].includes(terminalReason)) {
        return localAppProjectionError('turn completed terminalReason');
      }
      return Object.freeze({
        ...base,
        type: 'turn-completed',
        terminalReason: terminalReason as Extract<NimiLocalAppConversationEvent, { type: 'turn-completed' }>['terminalReason'],
      });
    }
    case 'turn-failed': {
      assertExactProjectionKeys(record, [...commonKeys, 'reasonCode', 'message'], 'turn failed event');
      if (typeof record.reasonCode !== 'string' || !/^[A-Z0-9_-]{1,128}$/u.test(record.reasonCode)
        || (record.message !== null && typeof record.message !== 'string')) {
        return localAppProjectionError('turn failed event');
      }
      const message = record.message === null
        ? null
        : boundedProjectionText(record.message, 'message', 1024);
      return Object.freeze({ ...base, type: 'turn-failed', reasonCode: record.reasonCode, message });
    }
    case 'turn-interrupted': {
      assertExactProjectionKeys(record, [...commonKeys, 'reason'], 'turn interrupted event');
      const reason = record.reason;
      if (typeof reason !== 'string'
        || !['user_cancel', 'room_closed', 'superseded_turn', 'budget_exhausted', 'timeout', 'gateway_revoked', 'policy_refusal'].includes(reason)) {
        return localAppProjectionError('turn interrupted reason');
      }
      return Object.freeze({
        ...base,
        type: 'turn-interrupted',
        reason: reason as Extract<NimiLocalAppConversationEvent, { type: 'turn-interrupted' }>['reason'],
      });
    }
    default:
      return localAppProjectionError('conversation event type');
  }
}

function projectSnapshot(value: unknown): NimiLocalAppConversationSnapshot {
  const record = asRecord(value);
  assertExactProjectionKeys(
    record,
    ['conversationAnchorId', 'activeTurnId', 'messages', 'truncatedBefore'],
    'conversation snapshot',
  );
  if (!Array.isArray(record.messages) || record.messages.length > 200
    || typeof record.truncatedBefore !== 'boolean') {
    return localAppProjectionError('conversation snapshot');
  }
  let textBytes = 0;
  const messages = record.messages.map((value) => {
    const message = asRecord(value);
    assertExactProjectionKeys(message, ['turnId', 'role', 'text'], 'conversation message');
    if (message.role !== 'user' && message.role !== 'assistant') {
      return localAppProjectionError('conversation message role');
    }
    const text = boundedProjectionText(message.text, 'conversation message text', 64 * 1024);
    textBytes += new TextEncoder().encode(text).byteLength;
    if (textBytes > 1024 * 1024) return localAppProjectionError('conversation snapshot size');
    return Object.freeze({
      turnId: boundedProjectionSelector(message.turnId, 'turnId'),
      role: message.role,
      text,
    });
  });
  return Object.freeze({
    conversationAnchorId: boundedProjectionSelector(record.conversationAnchorId, 'conversationAnchorId'),
    activeTurnId: nullableProjectionSelector(record.activeTurnId, 'activeTurnId'),
    messages: Object.freeze(messages),
    truncatedBefore: record.truncatedBefore,
  });
}

function validateAgentHandle(value: unknown): string {
  const handle = requireText(value, 'agentHandle');
  if (!/^agent_ref_[A-Za-z0-9_-]{43}$/u.test(handle)) {
    return localAppError(
      'Local-app Agent handle is invalid.',
      'SDK_LOCAL_APP_INPUT_INVALID',
      'list_current_agent_references',
    );
  }
  return handle;
}

function boundedSelector(value: unknown, field: string): string {
  const text = requireText(value, field);
  if (new TextEncoder().encode(text).byteLength > 256 || /[\u0000-\u001f\u007f]/u.test(text)) {
    return localAppError(
      `Local-app conversation ${field} is invalid.`,
      'SDK_LOCAL_APP_INPUT_INVALID',
      'provide_valid_conversation_selector',
    );
  }
  return text;
}

function boundedTurnText(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()
    || value.includes('\u0000')
    || new TextEncoder().encode(value).byteLength > 64 * 1024) {
    return localAppError(
      'Local-app conversation text is invalid.',
      'SDK_LOCAL_APP_INPUT_INVALID',
      'provide_valid_conversation_text',
    );
  }
  return value;
}

function boundedProjectionSelector(value: unknown, field: string): string {
  const text = projectionText(value, field);
  if (new TextEncoder().encode(text).byteLength > 256 || /[\u0000-\u001f\u007f]/u.test(text)) {
    return localAppProjectionError(`conversation ${field}`);
  }
  return text;
}

function boundedProjectionText(value: unknown, field: string, maxBytes: number): string {
  if (typeof value !== 'string' || !value.trim() || value.includes('\u0000')
    || new TextEncoder().encode(value).byteLength > maxBytes) {
    return localAppProjectionError(`conversation ${field}`);
  }
  return value;
}

function nullableProjectionSelector(value: unknown, field: string): string | null {
  return value === null ? null : boundedProjectionSelector(value, field);
}
