import { useLayoutEffect, useRef, useSyncExternalStore } from 'react';
import type { NimiLocalAppAgentHandle, NimiLocalAppConversationClient, NimiLocalAppConversationMessageReadResult, NimiLocalAppConversationQuoteInput } from '@nimiplatform/kit/core/sdk-contract';
import type { CanonicalConversationProjection } from '../headless/local-app-conversation-projection.js';
import { isLocalAppConversationAccessDenied } from '../headless/local-app-conversation-access.js';

export type ConversationReadPosition = { messageId: string; offset: number };
export type ConversationPositionRequest = {
  messageId: string | null;
  offset: number;
  requestKey: number;
  quote?: NimiLocalAppConversationQuoteInput;
  /** Passive page restoration keeps focus on the navigation control. */
  focus?: boolean;
};
export type LocalAppConversationHistoryOptions = {
  scopeKey: string;
  agentHandle: string | null;
  conversationAnchorId: string | null;
  conversation: () => NimiLocalAppConversationClient;
  liveProjection: CanonicalConversationProjection | null;
  capturePosition?: () => ConversationReadPosition | null;
  accessDenied?: boolean;
  onAccessDenied?: (error: unknown) => void;
};
type HistoryState = {
  status: 'live' | 'loading' | 'history' | 'error';
  error: unknown;
  result: NimiLocalAppConversationMessageReadResult | null;
  positionRequest: ConversationPositionRequest | null;
  returnPosition: ConversationReadPosition | null;
  accessDenied: boolean;
};

/** A view window only: never seed a live observer/reducer from its read watermark. */
export function projectConversationHistoryWindow(live: CanonicalConversationProjection | null, result: NimiLocalAppConversationMessageReadResult | null): CanonicalConversationProjection | null {
  if (!live || !result || live.conversationAnchorId !== result.conversationAnchorId) return live;
  const preferLive = BigInt(live.throughSequence) >= BigInt(result.readWatermark);
  const turnsInWindow = new Set(result.window.turns.map(turn => turn.turnId));
  const merge = <T extends { readonly turnId: string },>(historical: readonly T[], latest: readonly T[], key: (value: T) => string, includeNew = false) => {
    if (!preferLive) return historical;
    const values = historical.map(value => latest.find(item => key(item) === key(value)) || value);
    if (includeNew) for (const item of latest) {
      if (turnsInWindow.has(item.turnId) && !values.some(value => key(value) === key(item))) values.push(item);
    }
    return values;
  };
  return {
    ...live,
    messages: merge(result.window.messages, live.messages, value => value.messageId, true),
    turns: merge(result.window.turns, live.turns, value => value.turnId),
    actions: merge(result.window.actions, live.actions, value => JSON.stringify([value.turnId, value.actionId]), true),
    voices: merge(result.window.voices, live.voices, value => value.voiceId, true),
    truncatedBefore: result.window.truncatedBefore,
    liveActions: [], liveTools: [], transientByTurn: {},
  };
}

// @nimi-authority: rule.nimi.runtime.conversation-message-interaction.message-read
export function createLocalAppConversationHistory(initial: LocalAppConversationHistoryOptions) {
  let options = initial;
  let epoch = 0;
  let key = 0;
  let disposed = false;
  let lastIntent: { messageId: string; returning?: ConversationReadPosition; quote?: NimiLocalAppConversationQuoteInput } | null = null;
  let state: HistoryState = { status: 'live', error: null, result: null, positionRequest: null, returnPosition: null, accessDenied: Boolean(initial.accessDenied) };
  const listeners = new Set<() => void>();
  const publish = (update: Partial<HistoryState>) => { state = { ...state, ...update }; listeners.forEach(listener => listener()); };
  const invalidateAccess = (error: unknown) => { epoch += 1; lastIntent = null; publish({ accessDenied: true, status: 'error', result: null, positionRequest: null, returnPosition: null, error }); };
  const cancelNavigation = () => { epoch += 1; publish({ positionRequest: null, ...(state.status === 'loading' ? { status: state.result ? 'history' as const : 'live' as const, error: null } : {}) }); };
  const returnToLatest = () => { epoch += 1; publish({ status: 'live', result: null, error: null, returnPosition: null, positionRequest: { messageId: null, offset: 0, requestKey: ++key } }); };
  const locate = async (messageId: string, returning?: ConversationReadPosition, quote?: NimiLocalAppConversationQuoteInput) => {
    if (state.accessDenied || !options.agentHandle || !options.conversationAnchorId) return;
    const generation = ++epoch;
    lastIntent = { messageId, returning, quote };
    if (!returning && !state.returnPosition) publish({ returnPosition: options.capturePosition?.() || null });
    const liveContains = options.liveProjection?.messages.some(item => item.messageId === messageId);
    if (liveContains) {
      publish({ status: 'live', result: null, error: null, ...(returning ? { returnPosition: null } : {}), positionRequest: { messageId, offset: returning?.offset || 0, requestKey: ++key, quote } });
      return;
    }
    publish({ status: 'loading', error: null });
    try {
      const result = await options.conversation().readMessage({ agentHandle: options.agentHandle as NimiLocalAppAgentHandle, conversationAnchorId: options.conversationAnchorId, messageId });
      if (disposed || generation !== epoch) return;
      publish({ status: 'history', result: { ...result, quoteText: null, quoteFormat: null }, error: null,
        ...(returning ? { returnPosition: null } : {}), positionRequest: { messageId, offset: returning?.offset || 0, requestKey: ++key, quote } });
    } catch (error) { if (!disposed && generation === epoch) {
      if (isLocalAppConversationAccessDenied(error)) { invalidateAccess(error); options.onAccessDenied?.(error); }
      else publish({ status: 'error', error });
    } }
  };
  const returnToPrevious = async () => { const position = state.returnPosition; if (position) await locate(position.messageId, position); else returnToLatest(); };
  return {
    locate: (messageId: string, quote?: NimiLocalAppConversationQuoteInput) => locate(messageId, undefined, quote), returnToPrevious, returnToLatest, cancelNavigation,
    retry: () => { const request = lastIntent; return state.status === 'error' && request ? locate(request.messageId, request.returning, request.quote) : Promise.resolve(); },
    getSnapshot: () => state,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    update(next: LocalAppConversationHistoryOptions) {
      const changed = next.scopeKey !== options.scopeKey || next.agentHandle !== options.agentHandle || next.conversationAnchorId !== options.conversationAnchorId;
      const accessRestored = Boolean(options.accessDenied) && !next.accessDenied;
      options = next; disposed = false;
      if (next.accessDenied) { if (!state.accessDenied || state.result) invalidateAccess(null); return; }
      if (changed || accessRestored) { epoch += 1; lastIntent = null; publish({ accessDenied: false, status: 'live', result: null, error: null, returnPosition: null, positionRequest: null }); }
    },
    dispose() { disposed = true; epoch += 1; listeners.clear(); },
  };
}

export function useLocalAppConversationHistory(options: LocalAppConversationHistoryOptions) {
  const controllerRef = useRef<ReturnType<typeof createLocalAppConversationHistory> | null>(null);
  if (!controllerRef.current) controllerRef.current = createLocalAppConversationHistory(options);
  const controller = controllerRef.current;
  useLayoutEffect(() => { controller.update(options); });
  useLayoutEffect(() => () => controller.dispose(), [controller]);
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  return { projection: state.accessDenied || options.accessDenied ? null : projectConversationHistoryWindow(options.liveProjection, state.result), accessDenied: state.accessDenied || Boolean(options.accessDenied), status: state.status, error: state.error,
    positionRequest: state.positionRequest, returnPosition: state.returnPosition,
    locate: controller.locate, retry: controller.retry, returnToPrevious: controller.returnToPrevious, returnToLatest: controller.returnToLatest, cancelNavigation: controller.cancelNavigation };
}
