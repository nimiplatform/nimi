import type { NimiLocalAppClient, NimiLocalAppTextTurnInput } from '@nimiplatform/sdk/app';
import { createNimiLocalAppTextModel, type NimiAiModel } from '@nimiplatform/sdk/ai';
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

// Reads and writes of one storage's document run in order, so a save lands
// before a later one and a load (after the page reopens) sees every save
// already made.
const documentQueues = new WeakMap<LabTextConversationStorage, Promise<unknown>>();

function inDocumentOrder<T>(storage: LabTextConversationStorage, task: () => Promise<T>): Promise<T> {
  const result = (documentQueues.get(storage) ?? Promise.resolve()).then(task);
  documentQueues.set(storage, result.catch(() => undefined));
  return result;
}

export function loadLabTextConversation(
  storage: LabTextConversationStorage,
  path: string = LAB_TEXT_CONVERSATION_PATH,
): Promise<LabTextConversationDocument> {
  return inDocumentOrder(storage, async () => {
    try {
      return readLabTextConversationDocument((await storage.readJson(path)).value);
    } catch (error) {
      if (isNotFound(error)) return EMPTY_LAB_TEXT_CONVERSATION;
      throw error;
    }
  });
}

function documentBytes(document: LabTextConversationDocument): number {
  return new TextEncoder().encode(JSON.stringify(document)).byteLength;
}

/** The latest exchange alone does not fit a saved conversation. */
export class LabTextConversationTooLargeError extends Error {
  constructor(readonly bytes: number) {
    super(`The latest turn needs ${bytes} bytes; a saved conversation holds at most ${LAB_TEXT_CONVERSATION_MAX_BYTES}.`);
    this.name = 'LabTextConversationTooLargeError';
  }
}

/**
 * Drops whole exchanges from the start until the document fits its bound. The
 * latest exchange is never dropped: when it alone does not fit, the document
 * is refused rather than reduced to an empty conversation.
 */
export function boundLabTextConversation(document: LabTextConversationDocument): LabTextConversationDocument {
  let messages = [...document.messages];
  for (let bytes = documentBytes(document); bytes > LAB_TEXT_CONVERSATION_MAX_BYTES; bytes = documentBytes({ version: 1, messages })) {
    const next = messages.findIndex((message, index) => index > 0 && message.role === 'user');
    if (next < 0) throw new LabTextConversationTooLargeError(bytes);
    messages = messages.slice(next);
  }
  return { version: 1, messages };
}

/** Saves the bounded document; a refused document leaves the saved one unchanged. */
export function saveLabTextConversation(
  storage: LabTextConversationStorage,
  document: LabTextConversationDocument,
  path: string = LAB_TEXT_CONVERSATION_PATH,
): Promise<LabTextConversationDocument> {
  return inDocumentOrder(storage, async () => {
    const bounded = boundLabTextConversation(document);
    await storage.writeJson(path, JSON.parse(JSON.stringify(bounded)));
    return bounded;
  });
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

/** What one protected call carried before the new question. */
export type LabTextConversationRequest = {
  readonly messages: number;
  readonly items: number;
  readonly bytes: number;
};

/**
 * Counts the earlier messages a protected call actually carries, after Kit
 * chose its history window, and the opaque continuity inside them.
 */
export function labTextConversationRequest(input: Pick<NimiLocalAppTextTurnInput, 'messages'>): LabTextConversationRequest {
  const earlier = input.messages.slice(0, -1).filter((message) => message.role !== 'system');
  let items = 0;
  let bytes = 0;
  for (const message of earlier) {
    for (const item of message.turnItems ?? []) {
      if (item.type !== 'output' || item.output.type !== 'reasoning-continuity') continue;
      items += 1;
      bytes += item.output.carrier.payload.length;
    }
  }
  return { messages: earlier.length, items, bytes };
}

/** The protected App text model, reporting what each call carries just before it is made. */
export function createLabObservedTextModel(
  ai: Pick<NimiLocalAppClient['ai'], 'text'>,
  onRequest?: (request: LabTextConversationRequest) => void,
): NimiAiModel {
  const textClient = ai.text;
  return createNimiLocalAppTextModel({
    text: {
      streamTurn: (turn) => {
        onRequest?.(labTextConversationRequest(turn));
        return textClient.streamTurn(turn);
      },
    },
  });
}

/**
 * Names a failed turn. Runtime refuses continuity the selected route cannot
 * accept before anything is sent to a model.
 */
export function labTurnFailureNotice(
  code: string,
  detail: string,
  request: LabTextConversationRequest | null,
): LabTextConversationNotice {
  const refusedContinuity = (request?.items ?? 0) > 0
    && ['AI_TEXT_BEHAVIOR_UNSUPPORTED', 'AI_INPUT_INVALID'].includes(code.replaceAll('-', '_').toUpperCase());
  return refusedContinuity ? { type: 'continuity-refused', code } : { type: 'turn-failed', code, detail };
}

/** The typed reason a failure carries, before a transport's generic code. */
export function labErrorReason(error: unknown): string {
  const record = error && typeof error === 'object' ? error as { reasonCode?: unknown; code?: unknown; cause?: unknown } : {};
  const cause = record.cause && typeof record.cause === 'object' ? record.cause as { reasonCode?: unknown } : {};
  return [record.reasonCode, cause.reasonCode, record.code]
    .find((value): value is string => typeof value === 'string' && value.length > 0) ?? 'LAB_CONVERSATION_FAILED';
}

export async function runLabTextConversationTurn(input: {
  readonly ai: Pick<NimiLocalAppClient['ai'], 'text'>;
  readonly history: readonly ConversationTurnHistoryMessage[];
  readonly userText: string;
  readonly turnId: string;
  readonly signal: AbortSignal;
  readonly onText?: (text: string) => void;
  /** Called with what the protected call carries, just before it is made. */
  readonly onRequest?: (request: LabTextConversationRequest) => void;
}): Promise<LabTextConversationTurn> {
  const provider = createSimpleAiConversationProvider({
    runtimeAdapter: createModelConversationRuntimeAdapter({ model: createLabObservedTextModel(input.ai, input.onRequest) }),
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
    return { status: 'failed', text, reasonCode: labErrorReason(error), message: labErrorText(error) };
  }
  return { status: 'failed', text, reasonCode: 'LAB_CONVERSATION_INCOMPLETE', message: 'The turn ended without a terminal event.' };
}

export type LabTextConversationNotice =
  | { readonly type: 'turn-failed'; readonly code: string; readonly detail: string }
  | { readonly type: 'continuity-refused'; readonly code: string }
  | { readonly type: 'turn-too-large'; readonly bytes: number }
  | { readonly type: 'trimmed'; readonly messages: number }
  | { readonly type: 'save-failed'; readonly detail: string };

export type LabTextConversationState = {
  /** What the page shows; null until the saved conversation has been read. */
  readonly conversation: LabTextConversationDocument | null;
  /** The document as last read or written. */
  readonly saved: LabTextConversationDocument | null;
  readonly loadError: string;
  readonly pending: { readonly userText: string; readonly text: string } | null;
  readonly saving: boolean;
  /** The latest protected call, with the completed messages it did not return. */
  readonly lastRequest: (LabTextConversationRequest & { readonly omitted: number }) | null;
  readonly notices: readonly LabTextConversationNotice[];
};

export const INITIAL_LAB_TEXT_CONVERSATION_STATE: LabTextConversationState = Object.freeze({
  conversation: null, saved: null, loadError: '', pending: null, saving: false, lastRequest: null, notices: [],
});

export function labErrorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  const message = error && typeof error === 'object' ? (error as { message?: unknown }).message : undefined;
  return typeof message === 'string' ? message : String(error);
}

/**
 * The page's conversation session: one turn at a time, each saved before the
 * next can start. Starting over or closing the page begins a new generation;
 * work begun for an earlier one (a reply still streaming, a load, a save) may
 * finish, but it no longer changes what the page shows or writes the document.
 */
export function createLabTextConversationController(input: {
  readonly storage: LabTextConversationStorage;
  readonly ai: Pick<NimiLocalAppClient['ai'], 'text'>;
  readonly now: () => string;
  readonly createTurnId: () => string;
  readonly onState: (state: LabTextConversationState) => void;
}) {
  let state = INITIAL_LAB_TEXT_CONVERSATION_STATE;
  let generation = 0;
  let turn: AbortController | null = null;
  const set = (patch: Partial<LabTextConversationState>) => {
    state = { ...state, ...patch };
    input.onState(state);
  };

  const save = async (
    current: number,
    next: LabTextConversationDocument,
    notices: readonly LabTextConversationNotice[],
    patch: Partial<LabTextConversationState> = {},
  ) => {
    set({ ...patch, conversation: next, saving: true, notices });
    try {
      const saved = await saveLabTextConversation(input.storage, next);
      if (current !== generation) return;
      const trimmed = next.messages.length - saved.messages.length;
      set({ conversation: saved, saved, saving: false, notices: trimmed > 0 ? [...notices, { type: 'trimmed', messages: trimmed }] : notices });
    } catch (error) {
      if (current !== generation) return;
      // The reply stays on the page; the saved conversation is unchanged.
      set({
        saving: false,
        notices: [...notices, error instanceof LabTextConversationTooLargeError
          ? { type: 'turn-too-large', bytes: error.bytes }
          : { type: 'save-failed', detail: labErrorText(error) }],
      });
    }
  };

  const run = async (current: number, conversation: LabTextConversationDocument, userText: string) => {
    const history = labTextConversationHistory(conversation.messages);
    const turnId = input.createTurnId();
    const question: LabTextConversationMessage = { id: `${turnId}:user`, role: 'user', text: userText, createdAt: input.now() };
    const controller = new AbortController();
    const sent: { request: LabTextConversationRequest | null } = { request: null };
    turn = controller;
    set({ pending: { userText, text: '' }, lastRequest: null, notices: [] });
    const result = await runLabTextConversationTurn({
      ai: input.ai,
      history,
      userText,
      turnId,
      signal: controller.signal,
      onText: (text) => { if (current === generation) set({ pending: { userText, text } }); },
      onRequest: (request) => {
        sent.request = request;
        if (current === generation) set({ lastRequest: { ...request, omitted: history.length - request.messages } });
      },
    });
    if (turn === controller) turn = null;
    if (current !== generation) return;
    const answer: LabTextConversationMessage = {
      id: `${turnId}:assistant`,
      role: 'assistant',
      text: result.text,
      createdAt: input.now(),
      ...(result.status === 'completed'
        ? (result.outputItems ? { outputItems: result.outputItems } : {})
        : { status: result.status, ...(result.status === 'failed' ? { reasonCode: result.reasonCode } : {}) }),
    };
    const notices = result.status === 'failed' ? [labTurnFailureNotice(result.reasonCode, result.message, sent.request)] : [];
    await save(current, { version: 1, messages: [...conversation.messages, question, answer] }, notices, { pending: null });
  };

  return {
    getState: () => state,
    async load(): Promise<void> {
      const current = generation;
      try {
        const document = await loadLabTextConversation(input.storage);
        if (current === generation) set({ conversation: document, saved: document });
      } catch (error) {
        if (current === generation) set({ conversation: EMPTY_LAB_TEXT_CONVERSATION, loadError: labErrorText(error) });
      }
    },
    /** Starts a turn, or returns null while another turn runs or saves. */
    send(userText: string): Promise<void> | null {
      const text = userText.trim();
      const conversation = state.conversation;
      if (!text || !conversation || state.pending || state.saving || state.loadError) return null;
      return run(generation, conversation, text);
    },
    stop(): void {
      turn?.abort();
    },
    startOver(): Promise<void> {
      generation += 1;
      turn?.abort();
      turn = null;
      return save(generation, EMPTY_LAB_TEXT_CONVERSATION, [], { loadError: '', pending: null, lastRequest: null });
    },
    dispose(): void {
      generation += 1;
      turn?.abort();
      turn = null;
    },
  };
}

export type LabTextConversationController = ReturnType<typeof createLabTextConversationController>;
