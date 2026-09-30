import type { NimiLocalAppClient } from '@nimiplatform/sdk/app';
import { createNimiLocalAppTextModel } from '@nimiplatform/sdk/ai';
import type {
  ConversationAssistantOutputItem,
  ConversationTurnHistoryMessage,
} from '@nimiplatform/kit/features/chat/headless';
import {
  createModelConversationRuntimeAdapter,
  createSimpleAiConversationProvider,
} from '@nimiplatform/kit/features/chat/runtime';

// One App-owned conversation document. The App is the session owner: it keeps
// each completed turn's ordered output exactly as Kit reported it, and the
// Kit provider replays it on the next turn.
export const LAB_TEXT_CONVERSATION_PATH = 'lab-text-conversation.json';
// App JSON storage admits documents up to 256 KiB; the oldest turns give way
// first when a conversation outgrows this bound.
export const LAB_TEXT_CONVERSATION_MAX_BYTES = 240 * 1024;

export type LabTextConversationMessage = {
  readonly id: string;
  readonly role: 'user' | 'assistant';
  readonly text: string;
  readonly createdAt: string;
  /** Absent for a completed turn. */
  readonly status?: 'failed' | 'stopped';
  readonly reasonCode?: string;
  readonly outputItems?: readonly ConversationAssistantOutputItem[];
};

export type LabTextConversationDocument = {
  readonly version: 1;
  readonly messages: readonly LabTextConversationMessage[];
};

export type LabTextConversationStorage = Pick<NimiLocalAppClient['storage'], 'readJson' | 'writeJson'>;

export type LabTextConversationTurn =
  | { readonly status: 'completed'; readonly text: string; readonly outputItems?: readonly ConversationAssistantOutputItem[] }
  | { readonly status: 'failed'; readonly text: string; readonly reasonCode: string; readonly message: string }
  | { readonly status: 'stopped'; readonly text: string };

export const EMPTY_LAB_TEXT_CONVERSATION: LabTextConversationDocument = Object.freeze({ version: 1, messages: [] });

function invalidDocument(detail: string): never {
  throw new Error(`The saved conversation is invalid: ${detail}.`);
}

function isNotFound(error: unknown): boolean {
  const record = error && typeof error === 'object' ? error as { reasonCode?: unknown; code?: unknown } : {};
  return [record.reasonCode, record.code].some((value) => typeof value === 'string'
    && ['not-found', 'app_storage_entry_not_found'].includes(value.toLowerCase()));
}

function readOutputItems(value: unknown): readonly ConversationAssistantOutputItem[] {
  if (!Array.isArray(value) || value.length === 0) return invalidDocument('outputItems');
  return value.map((item): ConversationAssistantOutputItem => {
    const record = item && typeof item === 'object' ? item as Record<string, unknown> : null;
    if (record?.type === 'text' && typeof record.text === 'string') {
      return { type: 'text', text: record.text };
    }
    if (record?.type === 'reasoning-continuity' && typeof record.kind === 'string'
      && typeof record.version === 'number' && typeof record.payloadBase64 === 'string') {
      return { type: 'reasoning-continuity', kind: record.kind, version: record.version, payloadBase64: record.payloadBase64 };
    }
    return invalidDocument('output item');
  });
}

// The Kit provider validates carriers again before dispatch; this only keeps
// a damaged document from being shown or extended as if it were intact.
export function readLabTextConversationDocument(value: unknown): LabTextConversationDocument {
  const record = value && typeof value === 'object' ? value as Record<string, unknown> : null;
  if (record?.version !== 1 || !Array.isArray(record.messages)) return invalidDocument('version');
  const messages = record.messages.map((entry): LabTextConversationMessage => {
    const message = entry && typeof entry === 'object' ? entry as Record<string, unknown> : null;
    if (!message || typeof message.id !== 'string' || !message.id
      || (message.role !== 'user' && message.role !== 'assistant')
      || typeof message.text !== 'string' || typeof message.createdAt !== 'string') {
      return invalidDocument('message');
    }
    if (message.status !== undefined && message.status !== 'failed' && message.status !== 'stopped') return invalidDocument('status');
    if (message.outputItems !== undefined && (message.role !== 'assistant' || message.status !== undefined)) {
      return invalidDocument('outputItems outside a completed reply');
    }
    return {
      id: message.id,
      role: message.role,
      text: message.text,
      createdAt: message.createdAt,
      ...(message.status ? { status: message.status } : {}),
      ...(typeof message.reasonCode === 'string' ? { reasonCode: message.reasonCode } : {}),
      ...(message.outputItems !== undefined ? { outputItems: readOutputItems(message.outputItems) } : {}),
    };
  });
  return { version: 1, messages };
}

export async function loadLabTextConversation(storage: LabTextConversationStorage): Promise<LabTextConversationDocument> {
  try {
    return readLabTextConversationDocument((await storage.readJson(LAB_TEXT_CONVERSATION_PATH)).value);
  } catch (error) {
    if (isNotFound(error)) return EMPTY_LAB_TEXT_CONVERSATION;
    throw error;
  }
}

function documentBytes(document: LabTextConversationDocument): number {
  return new TextEncoder().encode(JSON.stringify(document)).byteLength;
}

/** Drops whole exchanges from the start until the document fits its bound. */
export function boundLabTextConversation(document: LabTextConversationDocument): LabTextConversationDocument {
  let messages = [...document.messages];
  while (messages.length > 0 && documentBytes({ version: 1, messages }) > LAB_TEXT_CONVERSATION_MAX_BYTES) {
    const next = messages.findIndex((message, index) => index > 0 && message.role === 'user');
    messages = next < 0 ? [] : messages.slice(next);
  }
  return { version: 1, messages };
}

export async function saveLabTextConversation(
  storage: LabTextConversationStorage,
  document: LabTextConversationDocument,
): Promise<LabTextConversationDocument> {
  const bounded = boundLabTextConversation(document);
  await storage.writeJson(LAB_TEXT_CONVERSATION_PATH, JSON.parse(JSON.stringify(bounded)));
  return bounded;
}

/**
 * The model sees only completed exchanges. A reply that failed or was stopped
 * is kept for the reader but is not a completed model step, so neither it nor
 * the message that asked for it is replayed.
 */
export function labTextConversationHistory(
  messages: readonly LabTextConversationMessage[],
): ConversationTurnHistoryMessage[] {
  const history: ConversationTurnHistoryMessage[] = [];
  for (let index = 0; index < messages.length; index += 1) {
    const question = messages[index];
    const answer = messages[index + 1];
    if (question?.role !== 'user' || answer?.role !== 'assistant') continue;
    index += 1;
    if (answer.status !== undefined) continue;
    history.push({ id: question.id, role: 'user', text: question.text });
    history.push({
      id: answer.id,
      role: 'assistant',
      text: answer.text,
      ...(answer.outputItems ? { outputItems: answer.outputItems } : {}),
    });
  }
  return history;
}

/** Counts the opaque continuity a history would return, without decoding it. */
export function labTextConversationContinuity(
  messages: readonly Pick<LabTextConversationMessage, 'outputItems'>[],
): { readonly items: number; readonly bytes: number } {
  let items = 0;
  let bytes = 0;
  for (const message of messages) {
    for (const item of message.outputItems ?? []) {
      if (item.type !== 'reasoning-continuity') continue;
      items += 1;
      const padding = item.payloadBase64.endsWith('==') ? 2 : item.payloadBase64.endsWith('=') ? 1 : 0;
      bytes += (item.payloadBase64.length / 4) * 3 - padding;
    }
  }
  return { items, bytes };
}

export async function runLabTextConversationTurn(input: {
  readonly ai: NimiLocalAppClient['ai'];
  readonly history: readonly ConversationTurnHistoryMessage[];
  readonly userText: string;
  readonly turnId: string;
  readonly signal: AbortSignal;
  readonly onText?: (text: string) => void;
}): Promise<LabTextConversationTurn> {
  const provider = createSimpleAiConversationProvider({
    runtimeAdapter: createModelConversationRuntimeAdapter({ model: createNimiLocalAppTextModel(input.ai) }),
  });
  let text = '';
  try {
    for await (const event of provider.runTurn({
      modeId: 'simple-ai',
      threadId: 'lab-text-conversation',
      turnId: input.turnId,
      userMessage: { id: `${input.turnId}:user`, text: input.userText },
      history: input.history,
      signal: input.signal,
    })) {
      if (event.type === 'text-delta') {
        text += event.textDelta;
        input.onText?.(text);
      } else if (event.type === 'turn-completed') {
        return { status: 'completed', text: event.outputText, ...(event.outputItems ? { outputItems: event.outputItems } : {}) };
      } else if (event.type === 'turn-failed') {
        return { status: 'failed', text: event.outputText ?? text, reasonCode: event.error.code, message: event.error.message };
      } else if (event.type === 'turn-canceled') {
        return { status: 'stopped', text: event.outputText ?? text };
      }
    }
  } catch (error) {
    if (input.signal.aborted) return { status: 'stopped', text };
    const record = error && typeof error === 'object' ? error as { reasonCode?: unknown; code?: unknown; message?: unknown } : {};
    const reasonCode = [record.reasonCode, record.code].find((value): value is string => typeof value === 'string') ?? 'LAB_CONVERSATION_FAILED';
    return { status: 'failed', text, reasonCode, message: typeof record.message === 'string' ? record.message : String(error) };
  }
  return { status: 'failed', text, reasonCode: 'LAB_CONVERSATION_INCOMPLETE', message: 'The turn ended without a terminal event.' };
}
