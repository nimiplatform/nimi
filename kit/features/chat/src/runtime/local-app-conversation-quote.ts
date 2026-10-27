import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import { extractNimiErrorFields, validateNimiLocalAppConversationQuoteInput, type NimiLocalAppConversationClient, type NimiLocalAppAgentHandle, type NimiLocalAppConversationQuoteInput } from '@nimiplatform/kit/core/sdk-contract';
import type { ConversationCanonicalMessage } from '../types.js';
import type { CanonicalMessageSelection } from '../components/message-text-selection.js';
import { isLocalAppConversationAccessDenied } from '../headless/local-app-conversation-access.js';

export type AgentQuoteDraft = {
  readonly conversationAnchorId: string;
  readonly input: NimiLocalAppConversationQuoteInput;
  readonly preview: { readonly text: string; readonly sourceRole: 'user' | 'assistant' | 'app'; readonly sourcePartial: boolean };
};
export type AgentQuoteDraftRef = { current: AgentQuoteDraft | null; readonly revision: number };
export type LocalAppConversationQuoteState = {
  status: 'empty' | 'preparing' | 'ready' | 'error';
  input: NimiLocalAppConversationQuoteInput | null;
  text: string;
  sourceRole: 'user' | 'assistant' | 'app';
  sourcePartial: boolean;
  error: unknown;
  failure: 'too-long' | 'selection-changed' | 'unavailable' | 'access' | 'read' | null;
};
export type LocalAppConversationQuoteOptions = {
  scopeKey: string;
  agentHandle: string | null;
  conversationAnchorId: string | null;
  conversation: () => NimiLocalAppConversationClient;
  onError?: (error: unknown) => void;
  accessDenied?: boolean;
  onAccessDenied?: (error: unknown) => void;
};
const emptyState = (): LocalAppConversationQuoteState => ({ status: 'empty', input: null, text: '', sourceRole: 'assistant', sourcePartial: false, error: null, failure: null });
class QuotePreparationError extends Error {
  constructor(readonly failure: NonNullable<LocalAppConversationQuoteState['failure']>) { super(`Quotation preparation failed: ${failure}`); }
}

// @nimi-authority: rule.nimi.platform.chat-message-interaction.shared-actions
// @nimi-authority: rule.nimi.runtime.conversation-message-interaction.quote-input
export function createLocalAppConversationQuote(initial: LocalAppConversationQuoteOptions) {
  let options = initial;
  let state = emptyState();
  let draft: AgentQuoteDraft | null = null;
  let revision = 0;
  let epoch = 0;
  let disposed = false;
  let accessDenied = Boolean(initial.accessDenied);
  let lastPreparation: { messageId: string; selection: CanonicalMessageSelection | null; restored?: AgentQuoteDraft } | null = null;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach(listener => listener());
  const set = (next: LocalAppConversationQuoteState) => { state = next; notify(); };
  const cancel = () => { epoch += 1; revision += 1; draft = null; lastPreparation = null; set(emptyState()); };
  const invalidateAccess = (error: unknown) => {
    accessDenied = true; epoch += 1;
    if (draft) draft = { ...draft, preview: { ...draft.preview, text: '' } };
    else if (lastPreparation?.selection && options.conversationAnchorId) draft = {
      conversationAnchorId: options.conversationAnchorId,
      input: { sourceMessageId: lastPreparation.messageId, format: 'nimi.quote-text.v1', startByte: lastPreparation.selection.startByte, endByte: lastPreparation.selection.endByte },
      preview: { text: '', sourceRole: 'assistant', sourcePartial: false },
    };
    if (lastPreparation) lastPreparation = { messageId: lastPreparation.messageId, selection: null, ...(draft ? { restored: draft } : {}) };
    if (state.status !== 'empty' || draft) set({ ...emptyState(), status: 'error', failure: 'access', input: draft?.input || state.input, error });
  };
  const prepareSource = async (messageId: string, selection: CanonicalMessageSelection | null, restored?: AgentQuoteDraft) => {
    const generation = ++epoch;
    lastPreparation = { messageId, selection, restored };
    revision += 1;
    draft = restored || null;
    set({ ...emptyState(), status: 'preparing', input: restored?.input || null });
    try {
      if (accessDenied || !options.agentHandle || !options.conversationAnchorId) throw new QuotePreparationError('access');
      if (restored && restored.conversationAnchorId !== options.conversationAnchorId) throw new QuotePreparationError('unavailable');
      const result = await options.conversation().readMessage({ agentHandle: options.agentHandle as NimiLocalAppAgentHandle, conversationAnchorId: options.conversationAnchorId, messageId });
      if (disposed || generation !== epoch) return;
      if (result.quoteFormat !== 'nimi.quote-text.v1' || !result.quoteText) throw new QuotePreparationError('unavailable');
      if (selection && selection.sourceText !== result.quoteText) throw new QuotePreparationError('selection-changed');
      const bytes = new TextEncoder().encode(result.quoteText);
      const candidate = restored?.input || {
        sourceMessageId: messageId, format: result.quoteFormat,
        startByte: selection?.startByte ?? 0, endByte: selection?.endByte ?? bytes.byteLength,
      };
      if (candidate.endByte - candidate.startByte > 16384) throw new QuotePreparationError('too-long');
      const input = validateNimiLocalAppConversationQuoteInput(candidate);
      if (input.endByte > bytes.byteLength) throw new QuotePreparationError('selection-changed');
      let text: string;
      try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.slice(input.startByte, input.endByte)); }
      catch { throw new QuotePreparationError('selection-changed'); }
      if (!text || [...text].length > 4096) throw new QuotePreparationError('too-long');
      if (restored?.preview.text && restored.preview.text !== text) throw new QuotePreparationError('selection-changed');
      const role = result.message.role;
      if (role !== 'user' && role !== 'assistant' && role !== 'app') throw new QuotePreparationError('unavailable');
      draft = { conversationAnchorId: result.conversationAnchorId, input, preview: { text, sourceRole: role, sourcePartial: result.message.partial } };
      set({ status: 'ready', input, ...draft.preview, error: null, failure: null });
    } catch (error) {
      if (disposed || generation !== epoch) return;
      if (isLocalAppConversationAccessDenied(error) || (error instanceof QuotePreparationError && error.failure === 'access')) {
        invalidateAccess(error); if (isLocalAppConversationAccessDenied(error)) options.onAccessDenied?.(error); options.onError?.(error); return;
      }
      const code = extractNimiErrorFields(error).code;
      const failure = error instanceof QuotePreparationError ? error.failure : code === 'permission-denied' || code === 'unauthenticated' ? 'access' : 'read';
      if (failure === 'access') { invalidateAccess(error); options.onError?.(error); return; }
      set({ ...emptyState(), status: 'error', input: restored?.input || null, error, failure });
      options.onError?.(error);
    }
  };
  const draftRef: AgentQuoteDraftRef = {
    get current() { return draft; },
    set current(value) { if (!value) cancel(); else void prepareSource(value.input.sourceMessageId, null, value); },
    get revision() { return revision; },
  };
  const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
  return {
    draftRef, subscribe, cancel,
    retry: () => { const request = lastPreparation; return request ? prepareSource(request.messageId, request.selection, request.restored) : Promise.resolve(); },
    prepare: (message: ConversationCanonicalMessage, selection: CanonicalMessageSelection | null = null) => prepareSource(message.id, selection),
    getSnapshot: () => state,
    update(next: LocalAppConversationQuoteOptions) {
      const scopeChanged = next.scopeKey !== options.scopeKey || next.conversationAnchorId !== options.conversationAnchorId;
      const handleChanged = next.agentHandle !== options.agentHandle;
      const accessRestored = Boolean(options.accessDenied) && !next.accessDenied;
      options = next; disposed = false;
      if (scopeChanged) { accessDenied = Boolean(next.accessDenied); cancel(); }
      if (next.accessDenied) { if (!accessDenied) invalidateAccess(new QuotePreparationError('access')); return; }
      if (scopeChanged) return;
      if (accessRestored || (handleChanged && next.agentHandle)) accessDenied = false;
      if (accessRestored && lastPreparation) { const request = lastPreparation; void prepareSource(request.messageId, request.selection, request.restored); }
      else if (handleChanged && draft) {
        const retained = next.agentHandle ? draft : { ...draft, preview: { ...draft.preview, text: '' } };
        void prepareSource(retained.input.sourceMessageId, null, retained);
      } else if (handleChanged) cancel();
    },
    dispose() { disposed = true; epoch += 1; listeners.clear(); },
  };
}

export type LocalAppConversationQuote = {
  state: LocalAppConversationQuoteState;
  prepare: (message: ConversationCanonicalMessage, selection?: CanonicalMessageSelection | null) => Promise<void>;
  cancel: () => void;
  retry: () => Promise<void>;
  draftRef: AgentQuoteDraftRef;
  subscribe: (listener: () => void) => () => void;
  revision: number;
};
export function useLocalAppConversationQuote(options: LocalAppConversationQuoteOptions): LocalAppConversationQuote {
  const controllerRef = useRef<ReturnType<typeof createLocalAppConversationQuote> | null>(null);
  if (!controllerRef.current) controllerRef.current = createLocalAppConversationQuote(options);
  const controller = controllerRef.current;
  useLayoutEffect(() => { controller.update(options); });
  useLayoutEffect(() => () => controller.dispose(), [controller]);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  return { state, prepare: controller.prepare, cancel: controller.cancel, retry: controller.retry, draftRef: controller.draftRef, subscribe: controller.subscribe, revision: controller.draftRef.revision };
}
