import { createContext, useContext, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react';
import { Copy, MoreHorizontal, Pause, Play, Reply } from 'lucide-react';
import { ActionMenu, IconButton, Popover, PopoverAnchor, PopoverContent, type NimiMenuItem } from '@nimiplatform/kit/ui';
import { collectFocusableElements, FOCUS_RING_CLASS_NAME } from '@nimiplatform/kit/ui/a11y';
import type { ConversationCanonicalMessage } from '../types.js';
import { resolveChatCopy, type ChatCopy } from '../copy.js';
import type { LocalAppConversationPlayback } from '../runtime/local-app-conversation-playback.js';
import { resolveLocalAppConversationVoiceRequest } from '../headless/local-app-conversation-voice.js';
import { captureMessageSelection, highlightMessageQuote, readMessageText, type CanonicalMessageSelection } from './message-text-selection.js';
import { LocalAppConversationPlayer } from './local-app-conversation-player.js';
import type { NimiLocalAppConversationQuote } from '@nimiplatform/kit/core/sdk-contract';
import type { ConversationPositionRequest } from '../runtime/local-app-conversation-history.js';
import { canQuoteCanonicalMessage } from '../headless/canonical-message-quotation.js';

export type CanonicalMessageActions = {
  scopeKey: string;
  playback?: LocalAppConversationPlayback;
  onQuote?: (message: ConversationCanonicalMessage, selection: CanonicalMessageSelection | null) => void | Promise<void>;
  canQuote?: (message: ConversationCanonicalMessage) => boolean;
  onReturnToComposer?: () => void;
  onOpenVoiceSettings?: () => void;
  onLocateMessage?: (messageId: string, quote?: NimiLocalAppConversationQuote) => void | Promise<void>;
};
type OpenMessageMenu = {
  focusSequence: number;
  messageId: string;
  scopeKey: string;
  trigger: HTMLElement;
  anchor: DOMRect;
  selection: ReturnType<typeof captureMessageSelection>;
  text: string;
  selectionMapped: boolean;
  outsideSelectionText: string;
};
type MessageActionContext = {
  actions: CanonicalMessageActions;
  copy: Required<ChatCopy>;
  openMessageId: string | null;
  menuId: string;
  open: (message: ConversationCanonicalMessage, trigger: HTMLElement, point?: { x: number; y: number }) => void;
  quote: (message: ConversationCanonicalMessage, trigger: HTMLElement) => void;
  quoteAllowed: (message: ConversationCanonicalMessage) => boolean;
};
const MessageActionsContext = createContext<MessageActionContext | null>(null);
function messageContent(element: HTMLElement) {
  return element.closest<HTMLElement>('[data-canonical-message-id]')?.querySelector<HTMLElement>('[data-canonical-message-content]') || null;
}
const specializedTarget = (target: EventTarget | null) => target instanceof Element && Boolean(target.closest('a, button, input, textarea, code, pre, img, video, audio, [data-chat-native-context]'));

export function useCanonicalMessageActionContext() { return useContext(MessageActionsContext); }

// @nimi-authority: rule.nimi.platform.chat-message-interaction.shared-actions
export function CanonicalMessageActionsProvider({ actions, messages, copy, children, positionRequest }: {
  actions: CanonicalMessageActions;
  messages: readonly ConversationCanonicalMessage[];
  copy?: ChatCopy;
  children: ReactNode;
  positionRequest?: ConversationPositionRequest | null;
}) {
  const labels = useMemo(() => resolveChatCopy(copy), [copy]);
  const [menu, setMenu] = useState<OpenMessageMenu | null>(null);
  const [feedback, setFeedback] = useState('');
  const restoreFocus = useRef(true);
  const tabExit = useRef<'forward' | 'backward' | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const focusSequence = useRef(0);
  const latest = useRef({ actions, messages, menu }); latest.current = { actions, messages, menu };
  const lastMenu = useRef<OpenMessageMenu | null>(null);
  if (menu) lastMenu.current = menu;
  const currentMessage = menu ? messages.find(item => item.id === menu.messageId) : null;
  const quoteAllowed = (message: ConversationCanonicalMessage) => Boolean(actions.onQuote)
    && canQuoteCanonicalMessage(message) && (actions.canQuote?.(message) ?? true);
  const capture = (message: ConversationCanonicalMessage, trigger: HTMLElement, point?: { x: number; y: number }): OpenMessageMenu | null => {
    const body = messageContent(trigger);
    if (!body) return null;
    return { focusSequence: ++focusSequence.current, messageId: message.id, scopeKey: actions.scopeKey, trigger,
      anchor: point ? new DOMRect(point.x, point.y, 0, 0) : trigger.getBoundingClientRect(),
      selection: captureMessageSelection(body), text: readMessageText(body).text,
      selectionMapped: !body.querySelector('[data-chat-quote-pending]'), outsideSelectionText: document.getSelection()?.toString() || '' };
  };
  const open = (message: ConversationCanonicalMessage, trigger: HTMLElement, point?: { x: number; y: number }) => {
    const next = capture(message, trigger, point);
    if (next) { restoreFocus.current = true; tabExit.current = null; setMenu(next); }
  };
  const validate = (entry: OpenMessageMenu) => entry.scopeKey === latest.current.actions.scopeKey
    ? latest.current.messages.find(item => item.id === entry.messageId) : null;
  const quoteEntry = (entry: OpenMessageMenu) => {
    const message = validate(entry);
    if (!message || !quoteAllowed(message)) return;
    if (entry.selection.kind === 'outside') { setFeedback(labels.messageSelectionMultipleLabel); return; }
    if (entry.selection.kind === 'selected' && !entry.selectionMapped) { setFeedback(labels.messageQuotePendingLabel); return; }
    restoreFocus.current = false;
    void actions.onQuote?.(message, entry.selection.kind === 'selected' ? entry.selection.selection : null);
    setMenu(null);
    actions.onReturnToComposer?.();
  };
  const quote = (message: ConversationCanonicalMessage, trigger: HTMLElement) => { const entry = capture(message, trigger); if (entry) quoteEntry(entry); };
  useEffect(() => { setMenu(null); setFeedback(''); }, [actions.scopeKey]);
  useEffect(() => {
    let selected: { messageId: string; node: Node; selection: CanonicalMessageSelection } | null = null;
    let restoring = false;
    const remember = () => {
      if (restoring) return;
      const selection = document.getSelection();
      if (selected && !selected.node.isConnected) return;
      const anchor = selection?.anchorNode;
      const row = anchor?.parentElement?.closest<HTMLElement>('[data-canonical-message-id]');
      const body = row?.querySelector<HTMLElement>('[data-canonical-message-content]');
      if (!row || !body || !rootRef.current?.contains(row)) { selected = null; return; }
      const captured = captureMessageSelection(body);
      selected = captured.kind === 'selected' && anchor ? { messageId: row.dataset.canonicalMessageId!, node: anchor, selection: captured.selection } : null;
    };
    const mutation = new MutationObserver(() => {
      if (!selected || selected.node.isConnected) return;
      const row = Array.from(rootRef.current?.querySelectorAll<HTMLElement>('[data-canonical-message-id]') || []).find(item => item.dataset.canonicalMessageId === selected!.messageId);
      const body = row?.querySelector<HTMLElement>('[data-canonical-message-content]');
      if (body?.querySelector('[data-chat-quote-pending]')) return;
      restoring = true;
      const restored = body && readMessageText(body).text === selected.selection.sourceText && highlightMessageQuote(body, selected.selection);
      restoring = false;
      if (restored) { selected = null; remember(); }
      else { selected = null; setMenu(null); setFeedback(labels.messageSelectionChangedLabel); }
    });
    document.addEventListener('selectionchange', remember);
    if (rootRef.current) mutation.observe(rootRef.current, { childList: true, subtree: true });
    return () => { mutation.disconnect(); document.removeEventListener('selectionchange', remember); };
  }, [actions.scopeKey, labels.messageSelectionChangedLabel]);
  useEffect(() => { if (menu && !currentMessage) setMenu(null); }, [currentMessage, menu]);
  useEffect(() => {
    if (!feedback) return;
    const timer = setTimeout(() => setFeedback(''), 3000); return () => clearTimeout(timer);
  }, [feedback]);
  useEffect(() => {
    if (!menu) return;
    const onScroll = () => {
      const row = menu.trigger.closest<HTMLElement>('[data-canonical-message-id]');
      const viewport = row?.closest<HTMLElement>('[data-canonical-transcript-root]');
      if (!row?.isConnected || !viewport) { setMenu(null); return; }
      const bounds = row.getBoundingClientRect(); const visible = viewport.getBoundingClientRect();
      if (bounds.bottom <= visible.top || bounds.top >= visible.bottom) setMenu(null);
    };
    const mutation = new MutationObserver(() => { if (!menu.trigger.isConnected) setMenu(null); });
    if (rootRef.current) mutation.observe(rootRef.current, { childList: true, subtree: true });
    window.addEventListener('scroll', onScroll, true); return () => { window.removeEventListener('scroll', onScroll, true); mutation.disconnect(); };
  }, [menu]);
  const playingMessageId = actions.playback?.state.messageId;
  const setSourceVisible = actions.playback?.setSourceVisible;
  useEffect(() => {
    if (!setSourceVisible) return;
    let observed: HTMLElement | null = null;
    let intersection: IntersectionObserver | null = null;
    const observe = () => {
      const row = Array.from(rootRef.current?.querySelectorAll<HTMLElement>('[data-canonical-message-id]') || []).find(item => item.dataset.canonicalMessageId === playingMessageId) || null;
      if (row === observed) return;
      intersection?.disconnect(); observed = row;
      if (!row) { setSourceVisible(false); return; }
      if (typeof IntersectionObserver === 'undefined') { setSourceVisible(true); return; }
      intersection = new IntersectionObserver(entries => { setSourceVisible(Boolean(entries[0]?.isIntersecting)); }, { root: row.closest('[data-canonical-transcript-root]') });
      intersection.observe(row);
    };
    setSourceVisible(false); observe();
    const mutation = new MutationObserver(observe);
    if (rootRef.current) mutation.observe(rootRef.current, { childList: true, subtree: true });
    return () => { mutation.disconnect(); intersection?.disconnect(); setSourceVisible(false); };
  }, [playingMessageId, setSourceVisible]);
  useEffect(() => {
    if (!positionRequest?.quote || !rootRef.current) return;
    const request = positionRequest;
    let done = false;
    const highlight = () => {
      if (done) return;
      const row = Array.from(rootRef.current?.querySelectorAll<HTMLElement>('[data-canonical-message-id]') || []).find(item => item.dataset.canonicalMessageId === request.messageId);
      const body = row?.querySelector<HTMLElement>('[data-canonical-message-content]');
      if (!body || body.querySelector('[data-chat-quote-pending]')) return;
      // Expand a collapsed code source before mapping a range into its text nodes.
      body.querySelectorAll<HTMLButtonElement>('[data-chat-code-expand="true"]').forEach(button => button.click());
      done = highlightMessageQuote(body, request.quote!);
    };
    const observer = new MutationObserver(highlight); observer.observe(rootRef.current, { childList: true, subtree: true });
    highlight();
    return () => observer.disconnect();
  }, [positionRequest?.requestKey, positionRequest?.messageId, actions.scopeKey]);
  const items: NimiMenuItem[] = [];
  if (menu && currentMessage && menu.text && ['text', 'streaming'].includes(currentMessage.kind || 'text')) {
    items.push({ id: 'copy', label: menu.selection.kind !== 'none' ? labels.messageCopySelectionLabel : labels.messageCopyLabel, icon: <Copy size={16} />,
      onSelect: () => {
        if (!validate(menu)) return;
        const value = menu.selection.kind === 'selected' ? menu.selection.selection.text : menu.selection.kind === 'outside' ? menu.outsideSelectionText : menu.text;
        if (!value) return;
        const scopeKey = menu.scopeKey;
        if (!navigator.clipboard?.writeText) { setFeedback(labels.messageCopyFailedLabel); return; }
        void (async () => {
          try { await navigator.clipboard.writeText(value); if (scopeKey === latest.current.actions.scopeKey) setFeedback(labels.messageCopiedLabel); }
          catch { if (scopeKey === latest.current.actions.scopeKey) setFeedback(labels.messageCopyFailedLabel); }
        })();
      } });
    if (actions.onQuote) items.push({ id: 'quote', label: labels.messageQuoteLabel, icon: <Reply size={16} />,
      disabled: !quoteAllowed(currentMessage) || menu.selection.kind === 'outside' || (menu.selection.kind === 'selected' && !menu.selectionMapped),
      disabledReason: menu.selection.kind === 'outside' ? labels.messageSelectionMultipleLabel : labels.messageQuotePendingLabel,
      onSelect: () => quoteEntry(menu) });
    const playback = actions.playback;
    const eligible = resolveLocalAppConversationVoiceRequest({ message: currentMessage, agentHandle: currentMessage.targetId, activeConversationAnchorId: currentMessage.sessionId });
    if (playback && eligible) {
      const matching = playback.state.messageId === currentMessage.id;
      const playing = matching && playback.state.status === 'playing';
      const paused = matching && playback.state.status === 'paused';
      const pending = matching && playback.state.status === 'preparing';
      const unknown = matching && playback.state.status === 'unknown';
      const failed = matching && playback.state.status === 'error';
      items.push({ id: 'voice', label: playing ? labels.voicePauseLabel : paused ? labels.voiceResumeLabel : pending ? labels.voicePreparingLabel
        : unknown ? labels.voiceRefreshLabel : failed ? playback.state.phase === 'generation' ? labels.voiceRegenerateLabel : labels.voiceRetryPlaybackLabel
          : currentMessage.metadata?.canonicalVoiceState === 'ready' || (matching && playback.state.artifactId) ? labels.voicePlayLabel : labels.voiceReadLabel,
      icon: playing ? <Pause size={16} /> : <Play size={16} />,
      disabled: playback.state.realtimeBlocked || pending,
      disabledReason: playback.state.realtimeBlocked ? labels.voiceRealtimeBlockedLabel : labels.voicePreparingLabel,
      onSelect: () => {
        const message = validate(menu); if (!message) return;
        if (playing) playback.pause(); else if (paused) void playback.resume(); else if (unknown) void playback.refresh();
        else if (failed) void playback.retry(); else void playback.play(message);
      } });
    }
  }
  return <MessageActionsContext.Provider value={{ actions, copy: labels, openMessageId: menu?.messageId || null, menuId, open, quote, quoteAllowed }}>
    <div ref={rootRef} className="contents">{children}</div>
    <span role="status" aria-live="polite" className="sr-only">{feedback}</span>
    {feedback ? <div className="pointer-events-none absolute bottom-3 left-1/2 z-20 -translate-x-1/2 rounded-[var(--nimi-radius-sm)] bg-[var(--nimi-surface-overlay)] px-3 py-2 text-sm text-[var(--nimi-text-primary)] shadow-[var(--nimi-elevation-floating)]">{feedback}</div> : null}
    <Popover open={Boolean(menu && items.length)} onOpenChange={open => { if (!open) setMenu(null); }}>
      <PopoverAnchor virtualRef={{ current: { getBoundingClientRect: () => menu?.anchor || new DOMRect() } }} />
      <PopoverContent align="start" side="bottom" className="max-h-[min(24rem,calc(100vh-2rem))] max-w-[min(20rem,calc(100vw-2rem))] overflow-y-auto p-1"
        onCloseAutoFocus={event => {
          event.preventDefault();
          // A close callback from an interrupted exit must not steal focus
          // from a newer logical open that reuses the same presence subtree.
          if (latest.current.menu || !restoreFocus.current) return;
          const source = lastMenu.current;
          if (tabExit.current && source) {
            const origin = source.trigger.matches('button,[tabindex="0"]') ? source.trigger : source.trigger.closest<HTMLElement>('[data-canonical-message-id]');
            const focusable = collectFocusableElements(document.body).filter(item => !item.closest('[role="menu"]'));
            const index = origin ? focusable.indexOf(origin) : -1;
            const next = focusable[index + (tabExit.current === 'backward' ? -1 : 1)];
            if (next) next.focus({ preventScroll: true }); else actions.onReturnToComposer?.();
            return;
          }
          if (source?.trigger.isConnected) source.trigger.focus({ preventScroll: true });
          else {
            const row = Array.from(rootRef.current?.querySelectorAll<HTMLElement>('[data-canonical-message-id]') || []).find(item => item.dataset.canonicalMessageId === source?.messageId);
            if (row) row.focus({ preventScroll: true }); else actions.onReturnToComposer?.();
          }
        }}>
        <ActionMenu id={menuId} ariaLabel={labels.messageActionsLabel} items={items} focusRequestKey={menu?.focusSequence} onRequestClose={(reason, backward) => { tabExit.current = reason === 'tab' ? backward ? 'backward' : 'forward' : null; setMenu(null); }} />
      </PopoverContent>
    </Popover>
  </MessageActionsContext.Provider>;
}

export function CanonicalMessageActionToolbar({ message }: { message: ConversationCanonicalMessage }) {
  const context = useContext(MessageActionsContext);
  if (!context || !message.text || !['text', 'streaming'].includes(message.kind || 'text')) return null;
  const openFromMenuKey = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
    event.preventDefault(); event.stopPropagation();
    context.open(message, event.currentTarget);
  };
  const openFromContextMenu = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault(); event.stopPropagation();
    context.open(message, event.currentTarget);
  };
  return <div data-chat-copy-ignore data-message-toolbar className="absolute -top-4 right-1 z-10 flex items-center gap-0.5 rounded-[var(--nimi-radius-sm)] bg-[var(--nimi-surface-overlay)] p-0.5 opacity-0 shadow-[var(--nimi-elevation-raised)] transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 [@media(hover:none)]:opacity-100">
    {context.actions.onQuote ? <IconButton tone="ghost" size="sm" aria-label={context.copy.messageQuoteLabel} icon={<Reply size={16} />} disabled={!context.quoteAllowed(message)}
      className={`[@media(hover:none)]:hidden ${FOCUS_RING_CLASS_NAME}`} onKeyDown={openFromMenuKey} onContextMenu={openFromContextMenu}
      onMouseDown={event => event.preventDefault()} onClick={event => context.quote(message, event.currentTarget)} /> : null}
    <IconButton tone="ghost" size="sm" aria-label={context.copy.messageMoreLabel} aria-haspopup="menu" aria-expanded={context.openMessageId === message.id} aria-controls={context.openMessageId === message.id ? context.menuId : undefined}
      icon={<MoreHorizontal size={16} />} onKeyDown={openFromMenuKey} onContextMenu={openFromContextMenu}
      onMouseDown={event => event.preventDefault()} onClick={event => context.open(message, event.currentTarget)} />
  </div>;
}

export function handleCanonicalMessageContextMenu(context: MessageActionContext | null, message: ConversationCanonicalMessage, event: MouseEvent<HTMLDivElement>) {
  if (!context || specializedTarget(event.target) || !message.text || !['text', 'streaming'].includes(message.kind || 'text')) return false;
  event.preventDefault(); event.stopPropagation();
  context.open(message, event.currentTarget, { x: event.clientX, y: event.clientY }); return true;
}

export function CanonicalMessageInlinePlayer({ message }: { message: ConversationCanonicalMessage }) {
  const context = useContext(MessageActionsContext);
  if (!context?.actions.playback || context.actions.playback.state.messageId !== message.id) return null;
  return <LocalAppConversationPlayer placement="inline" playback={context.actions.playback} copy={context.copy} onOpenSettings={context.actions.onOpenVoiceSettings} className="mt-2" />;
}

export function CanonicalMessageQuote({ message }: { message: ConversationCanonicalMessage }) {
  const context = useContext(MessageActionsContext);
  const quote = message.metadata?.canonicalQuote as NimiLocalAppConversationQuote | null | undefined;
  if (!context || !quote) return null;
  return <button type="button" data-chat-copy-ignore disabled={!context.actions.onLocateMessage} title={!context.actions.onLocateMessage ? context.copy.historyFailedLabel : undefined} onClick={() => { void context.actions.onLocateMessage?.(quote.sourceMessageId, quote); }}
    aria-label={context.copy.quoteSourceLabel} className={`mb-2 block w-full rounded-[var(--nimi-radius-sm)] bg-[var(--nimi-surface-panel)] px-3 py-2 text-left text-[var(--nimi-text-secondary)] ${FOCUS_RING_CLASS_NAME}`}>
    <span className="block text-xs">{quote.sourceRole === 'assistant' ? context.copy.bubbleAssistantLabel : quote.sourceRole === 'app' ? context.copy.quoteAppSourceLabel : context.copy.bubbleUserLabel}{quote.sourcePartial ? ` · ${context.copy.quotePartialLabel}` : ''}</span>
    <span className="line-clamp-2 whitespace-pre-wrap text-sm">{quote.text}</span>
  </button>;
}
