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
  readonly parts: readonly NimiLocalAppConversationInputPart[];
};

export type NimiLocalAppConversationInputPart =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'artifact-ref'; readonly artifactId: string };

export type NimiLocalAppConversationAttachmentUploadInput = {
  readonly agentHandle: NimiLocalAppAgentHandle;
  readonly conversationAnchorId: string;
  readonly mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif';
  readonly displayName?: string;
  readonly bytes: Uint8Array;
};

export type NimiLocalAppConversationAttachmentUploadResult = {
  readonly artifactId: string;
  readonly expiresAt: string;
};

export type NimiLocalAppConversationArtifactReadInput = {
  readonly agentHandle: NimiLocalAppAgentHandle;
  readonly conversationAnchorId: string;
  readonly artifactId: string;
};

export type NimiLocalAppConversationArtifactReadResult = {
  readonly artifactId: string;
  readonly bytes: Uint8Array;
  readonly mimeType: string;
  readonly byteLength: number;
};

export type NimiLocalAppConversationVoiceTranscriptionInput = {
  readonly agentHandle: NimiLocalAppAgentHandle;
  readonly conversationAnchorId: string;
  readonly requestId: string;
  readonly mimeType: string;
  readonly audioBytes: Uint8Array;
};

export type NimiLocalAppConversationVoiceTranscriptionResult = {
  readonly text: string;
};

export type NimiLocalAppConversationCallOptions = {
  readonly signal?: AbortSignal;
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
    })
  | (NimiLocalAppConversationEventBase & {
      readonly type: 'turn-started';
    })
  | (NimiLocalAppConversationEventBase & {
      readonly type: 'text-delta';
      readonly delta: string;
    })
  | (NimiLocalAppConversationEventBase & {
      readonly type: 'reasoning-status';
      readonly state: 'started' | 'active' | 'completed';
    })
  | (NimiLocalAppConversationEventBase & {
      readonly type: 'live-action';
      readonly action: NimiLocalAppConversationLiveAction;
    })
  | (NimiLocalAppConversationEventBase & {
      readonly type: 'live-tool';
      readonly tool: NimiLocalAppConversationLiveTool;
    })
  | (NimiLocalAppConversationEventBase & {
      readonly type: 'message-committed';
      readonly message: NimiLocalAppConversationMessage;
    })
  | (NimiLocalAppConversationEventBase & {
      readonly type: 'action-planned' | 'action-started' | 'action-completed' | 'action-failed';
      readonly action: NimiLocalAppConversationAction;
    })
  | (NimiLocalAppConversationEventBase & {
      readonly type: 'artifact-ready';
      readonly actionId: string;
      readonly capabilityContract: 'image.generate';
      readonly projectionMessageId: string;
      readonly artifactId: string;
    })
  | (NimiLocalAppConversationEventBase & {
      readonly type: 'voice-ready' | 'voice-failed';
      readonly voice: NimiLocalAppConversationVoice;
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
  readonly messageId: string;
  readonly turnId: string;
  readonly role: 'user' | 'assistant';
  readonly parts: readonly NimiLocalAppConversationMessagePart[];
};

export type NimiLocalAppConversationMessagePart =
  | { readonly kind: 'text'; readonly text: string }
  | {
      readonly kind: 'artifact-ref';
      readonly artifactId: string;
      readonly mediaKind: 'image';
      readonly mimeType: string;
      readonly displayName: string | null;
    };

export type NimiLocalAppConversationTurn = {
  readonly turnId: string;
  readonly status: 'active' | 'completed' | 'failed' | 'interrupted';
  readonly phase: 'accepted' | 'started' | null;
  readonly terminalReason: string | null;
  readonly reasonCode: string | null;
  readonly message: string | null;
};

export type NimiLocalAppConversationAction = {
  readonly actionId: string;
  readonly turnId: string;
  readonly capabilityContract: 'image.generate';
  readonly status: 'planned' | 'started' | 'completed' | 'failed';
  readonly projectionMessageId: string | null;
  readonly artifactId: string | null;
  readonly reasonCode: string | null;
  readonly message: string | null;
};

type NimiLocalAppConversationLiveChild = {
  readonly turnId: string;
  readonly name: string;
  readonly lifecycle: 'started' | 'updated' | 'completed' | 'failed';
  readonly progress: string | null;
  readonly result: string | null;
  readonly reasonCode: string | null;
};

export type NimiLocalAppConversationLiveAction = NimiLocalAppConversationLiveChild & { readonly actionId: string };
export type NimiLocalAppConversationLiveTool = NimiLocalAppConversationLiveChild & { readonly toolId: string };

export type NimiLocalAppConversationVoice = {
  readonly voiceId: string;
  readonly turnId: string;
  readonly messageId: string;
  readonly state: 'ready' | 'failed';
  readonly artifactId: string | null;
  readonly reasonCode: string | null;
  readonly message: string | null;
};

export type NimiLocalAppConversationSnapshot = {
  readonly conversationAnchorId: string;
  readonly throughSequence: string;
  readonly turns: readonly NimiLocalAppConversationTurn[];
  readonly messages: readonly NimiLocalAppConversationMessage[];
  readonly actions: readonly NimiLocalAppConversationAction[];
  readonly voices: readonly NimiLocalAppConversationVoice[];
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
    readonly parts: readonly NimiLocalAppConversationInputPart[];
  }) => Promise<unknown>;
  readonly uploadAttachment: (input: {
    readonly agentHandle: string;
    readonly conversationAnchorId: string;
    readonly mimeType: string;
    readonly displayName?: string;
    readonly bytes: readonly number[];
  }) => Promise<unknown>;
  readonly readArtifact: (input: {
    readonly agentHandle: string;
    readonly conversationAnchorId: string;
    readonly artifactId: string;
  }) => Promise<unknown>;
  readonly transcribeVoice: (input: {
    readonly agentHandle: string;
    readonly conversationAnchorId: string;
    readonly requestId: string;
    readonly mimeType: string;
    readonly audioBytes: readonly number[];
  }, options?: NimiLocalAppConversationCallOptions) => Promise<unknown>;
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
  readonly uploadAttachment: (input: NimiLocalAppConversationAttachmentUploadInput) => Promise<NimiLocalAppConversationAttachmentUploadResult>;
  readonly readArtifact: (input: NimiLocalAppConversationArtifactReadInput) => Promise<NimiLocalAppConversationArtifactReadResult>;
  readonly transcribeVoice: (input: NimiLocalAppConversationVoiceTranscriptionInput, options?: NimiLocalAppConversationCallOptions) => Promise<NimiLocalAppConversationVoiceTranscriptionResult>;
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
        ['agentHandle', 'conversationAnchorId', 'requestId', 'parts'],
        'local-app conversation send input',
      );
      assertNoAuthorityMaterial(input);
      const value = await shell.send({
        agentHandle: validateAgentHandle(input.agentHandle),
        conversationAnchorId: boundedSelector(input.conversationAnchorId, 'conversationAnchorId'),
        requestId: boundedSelector(input.requestId, 'requestId'),
        parts: conversationInputParts(input.parts),
      });
      const record = asRecord(value);
      assertExactProjectionKeys(record, ['turnId'], 'conversation send');
      return Object.freeze({ turnId: boundedProjectionSelector(record.turnId, 'turnId') });
    },
    uploadAttachment: async (input) => {
      assertExactKeys(
        input,
        input.displayName === undefined
          ? ['agentHandle', 'conversationAnchorId', 'mimeType', 'bytes']
          : ['agentHandle', 'conversationAnchorId', 'mimeType', 'displayName', 'bytes'],
        'local-app conversation attachment upload input',
      );
      assertNoAuthorityMaterial(input);
      if (!(input.bytes instanceof Uint8Array) || input.bytes.byteLength === 0
        || input.bytes.byteLength > 4 * 1024 * 1024
        || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(input.mimeType)) {
        return localAppError('Local-app conversation attachment is invalid.', 'SDK_LOCAL_APP_INPUT_INVALID', 'provide_valid_conversation_attachment');
      }
      const displayName = input.displayName === undefined
        ? undefined
        : boundedDisplayName(input.displayName);
      const value = await shell.uploadAttachment({
        agentHandle: validateAgentHandle(input.agentHandle),
        conversationAnchorId: boundedSelector(input.conversationAnchorId, 'conversationAnchorId'),
        mimeType: input.mimeType,
        ...(displayName ? { displayName } : {}),
        bytes: Object.freeze(Array.from(input.bytes)),
      });
      const record = asRecord(value);
      assertExactProjectionKeys(record, ['artifactId', 'expiresAt'], 'conversation attachment upload');
      return Object.freeze({
        artifactId: boundedProjectionSelector(record.artifactId, 'artifactId'),
        expiresAt: projectedTimestamp(record.expiresAt, 'expiresAt'),
      });
    },
    readArtifact: async (input) => {
      assertExactKeys(input, ['agentHandle', 'conversationAnchorId', 'artifactId'], 'local-app conversation artifact read input');
      assertNoAuthorityMaterial(input);
      const value = await shell.readArtifact({
        agentHandle: validateAgentHandle(input.agentHandle),
        conversationAnchorId: boundedSelector(input.conversationAnchorId, 'conversationAnchorId'),
        artifactId: boundedSelector(input.artifactId, 'artifactId'),
      });
      const record = asRecord(value);
      assertExactProjectionKeys(record, ['artifactId', 'bytes', 'mimeType', 'byteLength'], 'conversation artifact read');
      if (!Array.isArray(record.bytes) || record.bytes.length === 0 || record.bytes.length > 32 * 1024 * 1024
        || record.bytes.some((entry) => !Number.isInteger(entry) || Number(entry) < 0 || Number(entry) > 255)
        || typeof record.byteLength !== 'number' || !Number.isSafeInteger(record.byteLength)
        || record.byteLength !== record.bytes.length || typeof record.mimeType !== 'string'
        || !(record.mimeType.startsWith('audio/') || ['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(record.mimeType))) {
        return localAppProjectionError('conversation artifact read');
      }
      return Object.freeze({
        artifactId: boundedProjectionSelector(record.artifactId, 'artifactId'),
        bytes: Uint8Array.from(record.bytes as number[]),
        mimeType: record.mimeType,
        byteLength: record.byteLength,
      });
    },
    transcribeVoice: async (input, options) => {
      assertExactKeys(
        input,
        ['agentHandle', 'conversationAnchorId', 'requestId', 'mimeType', 'audioBytes'],
        'local-app conversation voice transcription input',
      );
      assertNoAuthorityMaterial(input);
      if (!(input.audioBytes instanceof Uint8Array) || input.audioBytes.byteLength === 0
        || input.audioBytes.byteLength > 6 * 1024 * 1024
        || typeof input.mimeType !== 'string' || !input.mimeType.startsWith('audio/')
        || input.mimeType.trim() !== input.mimeType || /[\u0000-\u001f\u007f]/u.test(input.mimeType)) {
        return localAppError('Local-app conversation voice input is invalid.', 'SDK_LOCAL_APP_INPUT_INVALID', 'provide_valid_voice_input');
      }
      const value = await shell.transcribeVoice({
        agentHandle: validateAgentHandle(input.agentHandle),
        conversationAnchorId: boundedSelector(input.conversationAnchorId, 'conversationAnchorId'),
        requestId: boundedSelector(input.requestId, 'requestId'),
        mimeType: input.mimeType,
        audioBytes: Object.freeze(Array.from(input.audioBytes)),
      }, options);
      const record = asRecord(value);
      assertExactProjectionKeys(record, ['text'], 'conversation voice transcription');
      return Object.freeze({ text: boundedProjectionText(record.text, 'text', 64 * 1024) });
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
      assertExactProjectionKeys(record, commonKeys, 'turn accepted event');
      return Object.freeze({ ...base, type: 'turn-accepted' });
    case 'turn-started':
      assertExactProjectionKeys(record, commonKeys, 'turn started event');
      return Object.freeze({ ...base, type: 'turn-started' });
    case 'text-delta':
      assertExactProjectionKeys(record, [...commonKeys, 'delta'], 'text delta event');
      return Object.freeze({ ...base, type: 'text-delta', delta: boundedProjectionText(record.delta, 'delta', 16 * 1024) });
    case 'reasoning-status':
      assertExactProjectionKeys(record, [...commonKeys, 'state'], 'reasoning status event');
      if (!['started', 'active', 'completed'].includes(String(record.state))) return localAppProjectionError('reasoning status event');
      return Object.freeze({ ...base, type: 'reasoning-status', state: record.state as 'started' | 'active' | 'completed' });
    case 'live-action': {
      assertExactProjectionKeys(record, [...commonKeys, 'action'], 'live action event');
      const action = projectLiveChild(record.action, 'actionId') as NimiLocalAppConversationLiveAction;
      if (action.turnId !== base.turnId) return localAppProjectionError('live action linkage');
      return Object.freeze({ ...base, type: 'live-action', action });
    }
    case 'live-tool': {
      assertExactProjectionKeys(record, [...commonKeys, 'tool'], 'live tool event');
      const tool = projectLiveChild(record.tool, 'toolId') as NimiLocalAppConversationLiveTool;
      if (tool.turnId !== base.turnId) return localAppProjectionError('live tool linkage');
      return Object.freeze({ ...base, type: 'live-tool', tool });
    }
    case 'message-committed':
      assertExactProjectionKeys(record, [...commonKeys, 'message'], 'message committed event');
      return Object.freeze({
        ...base,
        type: 'message-committed',
        message: projectMessage(record.message),
      });
    case 'action-planned':
    case 'action-started':
    case 'action-completed':
    case 'action-failed': {
      assertExactProjectionKeys(record, [...commonKeys, 'action'], `${record.type} event`);
      const action = projectAction(record.action);
      if (action.turnId !== base.turnId || action.status !== record.type.slice('action-'.length)) {
        return localAppProjectionError(`${record.type} event`);
      }
      return Object.freeze({ ...base, type: record.type, action }) as NimiLocalAppConversationEvent;
    }
    case 'artifact-ready': {
      assertExactProjectionKeys(
        record,
        [...commonKeys, 'actionId', 'capabilityContract', 'projectionMessageId', 'artifactId'],
        'artifact ready event',
      );
      if (record.capabilityContract !== 'image.generate') return localAppProjectionError('artifact ready capability');
      return Object.freeze({
        ...base,
        type: 'artifact-ready',
        actionId: boundedProjectionSelector(record.actionId, 'actionId'),
        capabilityContract: 'image.generate' as const,
        projectionMessageId: boundedProjectionSelector(record.projectionMessageId, 'projectionMessageId'),
        artifactId: boundedProjectionSelector(record.artifactId, 'artifactId'),
      });
    }
    case 'voice-ready':
    case 'voice-failed': {
      assertExactProjectionKeys(record, [...commonKeys, 'voice'], `${record.type} event`);
      const voice = projectVoice(record.voice);
      if (voice.turnId !== base.turnId || voice.state !== record.type.slice('voice-'.length)) {
        return localAppProjectionError(`${record.type} event`);
      }
      return Object.freeze({ ...base, type: record.type, voice }) as NimiLocalAppConversationEvent;
    }
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
    ['conversationAnchorId', 'throughSequence', 'turns', 'messages', 'actions', 'voices', 'truncatedBefore'],
    'conversation snapshot',
  );
  if (typeof record.throughSequence !== 'string' || !/^(0|[1-9][0-9]*)$/u.test(record.throughSequence)
    || !Array.isArray(record.turns) || record.turns.length > 201
    || !Array.isArray(record.messages) || record.messages.length > 203
    || !Array.isArray(record.actions) || record.actions.length > 201
    || !Array.isArray(record.voices) || record.voices.length > 201
    || typeof record.truncatedBefore !== 'boolean') {
    return localAppProjectionError('conversation snapshot');
  }
  let textBytes = 0;
  const messages = record.messages.map((value) => projectMessage(value, (text) => {
    textBytes += new TextEncoder().encode(text).byteLength;
    if (textBytes > 1024 * 1024 + 128 * 1024) return localAppProjectionError('conversation snapshot size');
  }));
  const turns = record.turns.map(projectTurn);
  const actions = record.actions.map(projectAction);
  const voices = record.voices.map(projectVoice);
  const turnIds = new Set(turns.map((turn) => turn.turnId));
  if (turnIds.size !== turns.length
    || messages.some((message) => !turnIds.has(message.turnId))
    || actions.some((action) => !turnIds.has(action.turnId))
    || voices.some((voice) => !turnIds.has(voice.turnId))) {
    return localAppProjectionError('conversation snapshot references');
  }
  return Object.freeze({
    conversationAnchorId: boundedProjectionSelector(record.conversationAnchorId, 'conversationAnchorId'),
    throughSequence: record.throughSequence,
    turns: Object.freeze(turns),
    messages: Object.freeze(messages),
    actions: Object.freeze(actions),
    voices: Object.freeze(voices),
    truncatedBefore: record.truncatedBefore,
  });
}

function projectMessage(
  value: unknown,
  observeText: (text: string) => void = () => {},
): NimiLocalAppConversationMessage {
  const message = asRecord(value);
  assertExactProjectionKeys(message, ['messageId', 'turnId', 'role', 'parts'], 'conversation message');
  if ((message.role !== 'user' && message.role !== 'assistant')
    || !Array.isArray(message.parts) || message.parts.length < 1 || message.parts.length > 2) {
    return localAppProjectionError('conversation message');
  }
  let textCount = 0;
  let artifactCount = 0;
  const parts = message.parts.map((value) => {
    const part = asRecord(value);
    if (!part) return localAppProjectionError('conversation message part');
    if (part.kind === 'text') {
      assertExactProjectionKeys(part, ['kind', 'text'], 'conversation text part');
      const text = boundedProjectionText(part.text, 'conversation message text', 64 * 1024);
      textCount++;
      observeText(text);
      return Object.freeze({ kind: 'text' as const, text });
    }
    if (part.kind === 'artifact-ref') {
      assertExactProjectionKeys(
        part,
        ['kind', 'artifactId', 'mediaKind', 'mimeType', 'displayName'],
        'conversation artifact part',
      );
      if (part.mediaKind !== 'image' || typeof part.mimeType !== 'string'
        || !['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(part.mimeType)
        || (part.displayName !== null && typeof part.displayName !== 'string')) {
        return localAppProjectionError('conversation artifact part');
      }
      artifactCount++;
      return Object.freeze({
        kind: 'artifact-ref' as const,
        artifactId: boundedProjectionSelector(part.artifactId, 'artifactId'),
        mediaKind: 'image' as const,
        mimeType: part.mimeType,
        displayName: part.displayName === null
          ? null
          : boundedProjectionText(part.displayName, 'displayName', 255),
      });
    }
    return localAppProjectionError('conversation message part');
  });
  if (textCount > 1 || artifactCount > 1
    || (message.role === 'assistant' && textCount === 1 && artifactCount === 1)) {
    return localAppProjectionError('conversation message cardinality');
  }
  return Object.freeze({
    messageId: boundedProjectionSelector(message.messageId, 'messageId'),
    turnId: boundedProjectionSelector(message.turnId, 'turnId'),
    role: message.role,
    parts: Object.freeze(parts),
  });
}

function projectTurn(value: unknown): NimiLocalAppConversationTurn {
  const turn = asRecord(value);
  assertExactProjectionKeys(turn, ['turnId', 'status', 'phase', 'terminalReason', 'reasonCode', 'message'], 'conversation turn');
  if (!['active', 'completed', 'failed', 'interrupted'].includes(String(turn.status))
    || (turn.phase !== null && turn.phase !== 'accepted' && turn.phase !== 'started')
    || (turn.terminalReason !== null && typeof turn.terminalReason !== 'string')
    || (turn.message !== null && typeof turn.message !== 'string')) {
    return localAppProjectionError('conversation turn');
  }
  return Object.freeze({
    turnId: boundedProjectionSelector(turn.turnId, 'turnId'),
    status: turn.status as NimiLocalAppConversationTurn['status'],
    phase: turn.phase as NimiLocalAppConversationTurn['phase'],
    terminalReason: turn.terminalReason === null ? null : boundedProjectionText(turn.terminalReason, 'terminalReason', 128),
    reasonCode: nullableReasonCode(turn.reasonCode),
    message: turn.message === null ? null : boundedProjectionText(turn.message, 'message', 1024),
  });
}

function projectAction(value: unknown): NimiLocalAppConversationAction {
  const action = asRecord(value);
  assertExactProjectionKeys(
    action,
    ['actionId', 'turnId', 'capabilityContract', 'status', 'projectionMessageId', 'artifactId', 'reasonCode', 'message'],
    'conversation action',
  );
  if (action.capabilityContract !== 'image.generate'
    || !['planned', 'started', 'completed', 'failed'].includes(String(action.status))
    || (action.projectionMessageId !== null && typeof action.projectionMessageId !== 'string')
    || (action.artifactId !== null && typeof action.artifactId !== 'string')
    || (action.message !== null && typeof action.message !== 'string')) {
    return localAppProjectionError('conversation action');
  }
  const completed = action.status === 'completed';
  const failed = action.status === 'failed';
  if (completed !== (action.projectionMessageId !== null && action.artifactId !== null)
    || (failed !== (nullableReasonCode(action.reasonCode) !== null))
    || (!failed && action.message !== null)) {
    return localAppProjectionError('conversation action terminal');
  }
  return Object.freeze({
    actionId: boundedProjectionSelector(action.actionId, 'actionId'),
    turnId: boundedProjectionSelector(action.turnId, 'turnId'),
    capabilityContract: 'image.generate',
    status: action.status as NimiLocalAppConversationAction['status'],
    projectionMessageId: nullableProjectionSelector(action.projectionMessageId, 'projectionMessageId'),
    artifactId: nullableProjectionSelector(action.artifactId, 'artifactId'),
    reasonCode: nullableReasonCode(action.reasonCode),
    message: action.message === null ? null : boundedProjectionText(action.message, 'message', 1024),
  });
}

function projectLiveChild(
  value: unknown,
  idField: 'actionId' | 'toolId',
): NimiLocalAppConversationLiveAction | NimiLocalAppConversationLiveTool {
  const child = asRecord(value);
  assertExactProjectionKeys(child, ['turnId', idField, 'name', 'lifecycle', 'progress', 'result', 'reasonCode'], 'conversation live child');
  if (!['started', 'updated', 'completed', 'failed'].includes(String(child.lifecycle))) {
    return localAppProjectionError('conversation live child lifecycle');
  }
  const progress = child.progress === null ? null : boundedProjectionText(child.progress, 'progress', 16 * 1024);
  const result = child.result === null ? null : boundedProjectionText(child.result, 'result', 16 * 1024);
  const reasonCode = nullableReasonCode(child.reasonCode);
  const valid = child.lifecycle === 'started'
    ? progress === null && result === null && reasonCode === null
    : child.lifecycle === 'updated'
      ? ((progress === null) !== (result === null)) && reasonCode === null
      : child.lifecycle === 'completed'
        ? progress === null && reasonCode === null
        : result === null && reasonCode !== null;
  if (!valid) return localAppProjectionError('conversation live child terminal');
  return Object.freeze({
    turnId: boundedProjectionSelector(child.turnId, 'turnId'),
    [idField]: boundedProjectionSelector(child[idField], idField),
    name: boundedProjectionText(child.name, 'name', 256),
    lifecycle: child.lifecycle,
    progress,
    result,
    reasonCode,
  }) as NimiLocalAppConversationLiveAction | NimiLocalAppConversationLiveTool;
}

function projectVoice(value: unknown): NimiLocalAppConversationVoice {
  const voice = asRecord(value);
  assertExactProjectionKeys(voice, ['voiceId', 'turnId', 'messageId', 'state', 'artifactId', 'reasonCode', 'message'], 'conversation voice');
  if ((voice.state !== 'ready' && voice.state !== 'failed')
    || (voice.artifactId !== null && typeof voice.artifactId !== 'string')
    || (voice.message !== null && typeof voice.message !== 'string')) {
    return localAppProjectionError('conversation voice');
  }
  if ((voice.state === 'ready') !== (voice.artifactId !== null)
    || ((voice.state === 'failed') !== (nullableReasonCode(voice.reasonCode) !== null))) {
    return localAppProjectionError('conversation voice terminal');
  }
  return Object.freeze({
    voiceId: boundedProjectionSelector(voice.voiceId, 'voiceId'),
    turnId: boundedProjectionSelector(voice.turnId, 'turnId'),
    messageId: boundedProjectionSelector(voice.messageId, 'messageId'),
    state: voice.state,
    artifactId: nullableProjectionSelector(voice.artifactId, 'artifactId'),
    reasonCode: nullableReasonCode(voice.reasonCode),
    message: voice.message === null ? null : boundedProjectionText(voice.message, 'message', 1024),
  });
}

function nullableReasonCode(value: unknown): string | null {
  if (value === null || value === '' || value === 'REASON_CODE_UNSPECIFIED') return null;
  if (typeof value !== 'string' || !/^[A-Z0-9_-]{1,128}$/u.test(value)) {
    return localAppProjectionError('conversation reasonCode');
  }
  return value;
}

export function validateAgentHandle(value: unknown): string {
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

function conversationInputParts(value: unknown): readonly NimiLocalAppConversationInputPart[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 2) {
    return localAppError('Local-app conversation parts are invalid.', 'SDK_LOCAL_APP_INPUT_INVALID', 'provide_valid_conversation_parts');
  }
  let textSeen = false;
  let artifactSeen = false;
  const parts = value.map((part, index): NimiLocalAppConversationInputPart => {
    const record = asRecord(part);
    if (!record) {
      return localAppError('Local-app conversation part is invalid.', 'SDK_LOCAL_APP_INPUT_INVALID', 'provide_valid_conversation_parts');
    }
    if (record.kind === 'text') {
      assertExactKeys(record, ['kind', 'text'], 'local-app conversation text part');
      if (textSeen || artifactSeen || index !== 0) {
        return localAppError('Local-app conversation text part is invalid.', 'SDK_LOCAL_APP_INPUT_INVALID', 'provide_valid_conversation_parts');
      }
      textSeen = true;
      return Object.freeze({ kind: 'text', text: boundedTurnText(record.text) });
    }
    if (record.kind === 'artifact-ref') {
      assertExactKeys(record, ['kind', 'artifactId'], 'local-app conversation artifact part');
      if (artifactSeen) {
        return localAppError('Local-app conversation artifact part is invalid.', 'SDK_LOCAL_APP_INPUT_INVALID', 'provide_valid_conversation_parts');
      }
      artifactSeen = true;
      return Object.freeze({ kind: 'artifact-ref', artifactId: boundedSelector(record.artifactId, 'artifactId') });
    }
    return localAppError('Local-app conversation part kind is invalid.', 'SDK_LOCAL_APP_INPUT_INVALID', 'provide_valid_conversation_parts');
  });
  return Object.freeze(parts);
}

function boundedDisplayName(value: unknown): string {
  if (typeof value !== 'string' || !value.trim() || value.trim() !== value || value.includes('\u0000')
    || new TextEncoder().encode(value).byteLength > 255) {
    return localAppError('Local-app conversation displayName is invalid.', 'SDK_LOCAL_APP_INPUT_INVALID', 'provide_valid_conversation_attachment');
  }
  return value;
}

function projectedTimestamp(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.trim() !== value || !Number.isFinite(Date.parse(value))) {
    return localAppProjectionError(`conversation ${field}`);
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
