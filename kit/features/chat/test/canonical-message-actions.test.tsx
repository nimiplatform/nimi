import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CanonicalMessageActionsProvider } from '../src/components/canonical-message-actions.js';
import { CanonicalMessageBubble } from '../src/components/canonical-message-bubble.js';
import { CanonicalComposer } from '../src/components/canonical-composer.js';
import { CanonicalTranscriptView } from '../src/components/canonical-transcript-view.js';
import { LocalAppConversationQuotePreview } from '../src/components/local-app-conversation-quote-preview.js';
import { getMessageInteractionCopy } from '../src/message-interaction-copy.js';
import { useLocalAppConversationQuote, type LocalAppConversationQuote } from '../src/runtime/local-app-conversation-quote.js';
import type { NimiLocalAppConversationClient } from '@nimiplatform/kit/core/sdk-contract';
import { LocalAppConversationPlayer } from '../src/components/local-app-conversation-player.js';
import type { LocalAppConversationPlayback } from '../src/runtime/local-app-conversation-playback.js';
import { useChatComposer, type UseChatComposerResult } from '../src/hooks/use-chat-composer.js';
import type { ConversationCanonicalMessage } from '../src/types.js';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined; let container: HTMLDivElement;
const flush = () => new Promise<void>(resolve => setTimeout(resolve, 0));
async function render(node: React.ReactNode) {
  if (!container) { container = document.createElement('div'); document.body.append(container); root = createRoot(container); }
  await act(async () => { root!.render(node); await flush(); });
}
afterEach(async () => { await act(async () => { root?.unmount(); await flush(); }); container?.remove(); container = undefined as never; root = undefined; vi.restoreAllMocks(); vi.unstubAllGlobals(); document.getSelection()?.removeAllRanges(); });
const message = (overrides: Partial<ConversationCanonicalMessage> = {}): ConversationCanonicalMessage => ({ id: 'message', sessionId: 'anchor', targetId: 'agent', source: 'agent', role: 'assistant', kind: 'text', text: 'second same same', status: 'complete', createdAt: '2026-10-27', metadata: { canonicalMessageCommitted: true, canonicalTurnId: 'turn', canonicalTurnStatus: 'completed' }, ...overrides });
function View({ value, onQuote, onReturnToComposer, playback }: { value: ConversationCanonicalMessage; onQuote: () => void; onReturnToComposer?: () => void; playback?: LocalAppConversationPlayback }) {
  return <CanonicalMessageActionsProvider actions={{ scopeKey: 'scope', onQuote, onReturnToComposer, playback }} messages={[value]}>
    <article data-canonical-message-id={value.id}><CanonicalMessageBubble message={value} content={<p>{value.text}</p>} /></article>
  </CanonicalMessageActionsProvider>;
}
describe('real shared message action rendering', () => {
  it('refocuses a menu reopened while the previous exit animation still owns its mounted panel', async () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    const onQuote = vi.fn();
    await render(<CanonicalTranscriptView messages={[message()]} messageActions={{ scopeKey: 'scope', onQuote }} renderMessageContent={item => <p>{item.text}</p>} />);
    const article = container.querySelector<HTMLElement>('[role="article"]')!;
    const content = article.querySelector<HTMLElement>('[data-canonical-message-content] p')!;
    article.focus();
    const open = async () => { await act(async () => {
      // Model the right-click's native focus transfer (which JSDOM does not
      // synthesize). Only production code may move focus into the menu.
      article.focus();
      content.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 20, clientY: 20 })); await flush();
    }); };
    await open();
    const firstPanel = document.querySelector('[role="menu"]')!.closest('[data-state]')!;
    for (let cycle = 0; cycle < 3; cycle += 1) {
      expect(document.querySelector('[role="menu"]')?.contains(document.activeElement)).toBe(true);
      await act(async () => { document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })); await flush(); });
      // Real timers and the real Popover/AnimatePresence are used. Reopen while
      // the closing panel is still mounted, rather than waiting for a remount.
      expect(firstPanel.isConnected).toBe(true);
      expect(firstPanel.getAttribute('data-state')).toBe('closed');
      await open();
      const reopened = document.querySelector('[role="menu"]')!;
      expect(reopened.closest('[data-state]')).toBe(firstPanel);
      expect(reopened.contains(document.activeElement)).toBe(true);
      expect(document.activeElement?.textContent).toBe('Copy text');
    }
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 300)); });
    expect(document.querySelector('[role="menu"]')?.contains(document.activeElement)).toBe(true);
    expect(firstPanel.getAttribute('data-state')).toBe('open');
    expect(onQuote).not.toHaveBeenCalled();
  });
  it('returns focus to the existing textarea after cancel activation removes the quote preview', async () => {
    const source = { messageId: 'message', turnId: 'turn', role: 'assistant', partial: false, parts: [{ kind: 'text', text: 'Quoted text' }], quote: null };
    const conversation = () => ({ readMessage: async () => ({ conversationAnchorId: 'anchor', readWatermark: '1', message: source, quoteFormat: 'nimi.quote-text.v1', quoteText: 'Quoted text',
      window: { messages: [source], turns: [], actions: [], voices: [], truncatedBefore: false, truncatedAfter: false } }) } as unknown as NimiLocalAppConversationClient);
    let quote!: LocalAppConversationQuote;
    function Harness() {
      quote = useLocalAppConversationQuote({ scopeKey: 'scope', agentHandle: 'agent', conversationAnchorId: 'anchor', conversation });
      return <CanonicalComposer adapter={{ submit: vi.fn() }} initialText="键盘验收草稿：请保留"
        quoteSlot={<LocalAppConversationQuotePreview quote={quote} copy={getMessageInteractionCopy('zh-CN')} onReturnToComposer={() => container.querySelector('textarea')!.focus()} />} />;
    }
    await render(<Harness />);
    await act(async () => { await quote.prepare(message()); });
    const textarea = container.querySelector('textarea')!;
    const cancel = container.querySelector<HTMLButtonElement>('[aria-label="取消引用"]')!;
    cancel.focus(); expect(document.activeElement).toBe(cancel);
    await act(async () => {
      cancel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
      // JSDOM does not synthesize native Enter activation; exercise the native
      // button click path after the key, including actual controller removal.
      cancel.click(); await flush();
    });
    expect(quote.state.status).toBe('empty');
    expect(container.querySelector('[data-canonical-quote-draft]')).toBeNull();
    expect(document.activeElement).toBe(textarea);
    expect(textarea.value).toBe('键盘验收草稿：请保留');
  });
  it.each([
    ['More actions', 'F10', true], ['More actions', 'ContextMenu', false],
    ['Reply with quote', 'F10', true], ['Reply with quote', 'ContextMenu', false],
  ] as const)('opens the message menu from focused %s using %s', async (label, key, shiftKey) => {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    const onQuote = vi.fn();
    await render(<View value={message()} onQuote={onQuote} />);
    const trigger = container.querySelector<HTMLButtonElement>(`[aria-label="${label}"]`)!;
    trigger.focus(); expect(document.activeElement).toBe(trigger);
    const keyboard = new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true });
    await act(async () => { trigger.dispatchEvent(keyboard); await flush(); });
    const menu = document.querySelector('[role="menu"]');
    expect(menu).toBeTruthy(); expect(keyboard.defaultPrevented).toBe(true);
    expect(menu?.contains(document.activeElement)).toBe(true);
    expect(container.querySelector('[aria-label="More actions"]')?.getAttribute('aria-expanded')).toBe('true');
    expect(onQuote).not.toHaveBeenCalled();
  });
  it.each([
    ['assistant', 'right'],
    ['user', 'left'],
  ] as const)('anchors the %s action menu beside the message and keeps its toolbar open', async (role, side) => {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(1024);
    vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(768);
    vi.spyOn(document.documentElement, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1024, 768));
    vi.spyOn(document.body, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 1024, 768));
    await render(<View value={message({ role })} onQuote={vi.fn()} />);
    const trigger = container.querySelector<HTMLButtonElement>('[aria-label="More actions"]')!;
    const getAnchor = vi.fn(() => new DOMRect(120, 160, 28, 28));
    trigger.getBoundingClientRect = getAnchor;
    await act(async () => { trigger.click(); await flush(); });
    const menu = document.querySelector<HTMLElement>('[role="menu"]')!;
    const panel = menu.closest<HTMLElement>('[data-side]')!;
    const toolbar = container.querySelector<HTMLElement>('[data-message-toolbar]')!;
    expect(getAnchor).toHaveBeenCalled();
    expect(panel.dataset.side).toBe(side);
    expect(panel.dataset.align).toBe('center');
    expect(toolbar.classList.contains('opacity-100')).toBe(true);
    expect(toolbar.classList.contains('pointer-events-auto')).toBe(true);
    expect(Array.from(menu.querySelectorAll('[role="menuitem"]')).map(item => item.textContent)).toEqual(['Copy text', 'Reply with quote']);
    await act(async () => {
      toolbar.dispatchEvent(new MouseEvent('mouseleave', { relatedTarget: panel }));
      panel.dispatchEvent(new MouseEvent('mouseenter'));
      await flush();
    });
    expect(menu.isConnected).toBe(true);
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(toolbar.classList.contains('opacity-100')).toBe(true);
  });
  it('keeps one read-message action connected to the existing playback controller', async () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    const value = message({ metadata: { ...message().metadata, canonicalConversationAnchorId: 'anchor' } });
    const play = vi.fn(async () => {});
    const playback: LocalAppConversationPlayback = {
      state: { status: 'idle', phase: null, message: null, messageId: null, artifactId: null, position: 0, duration: 0, realtimeBlocked: false, sourceVisible: false, error: null },
      stop: vi.fn(), play, pause: vi.fn(), resume: vi.fn(async () => {}), seek: vi.fn(), retry: vi.fn(async () => {}), refresh: vi.fn(async () => {}), continueRequest: vi.fn(async () => {}), setSourceVisible: vi.fn(),
    };
    await render(<View value={value} onQuote={vi.fn()} playback={playback} />);
    await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="More actions"]')!.click(); await flush(); });
    const readActions = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).filter(button => button.textContent === 'Read aloud');
    expect(readActions).toHaveLength(1);
    await act(async () => { readActions[0]!.click(); await flush(); });
    expect(play).toHaveBeenCalledOnce();
    expect(play).toHaveBeenCalledWith(value);
  });
  it('leaves Enter/Space and content-specific menu keys to their native controls', async () => {
    const value = message();
    await render(<CanonicalMessageActionsProvider actions={{ scopeKey: 'scope', onQuote: vi.fn() }} messages={[value]}>
      <article data-canonical-message-id={value.id}><CanonicalMessageBubble message={value} content={<p><a href="https://example.invalid">Link</a><code tabIndex={0}>code</code></p>} /></article>
    </CanonicalMessageActionsProvider>);
    const more = container.querySelector<HTMLButtonElement>('[aria-label="More actions"]')!;
    for (const key of ['Enter', ' ']) {
      const event = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }); more.dispatchEvent(event); expect(event.defaultPrevented).toBe(false);
    }
    for (const target of container.querySelectorAll<HTMLElement>('a, code')) {
      target.focus(); const event = new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true, cancelable: true });
      target.dispatchEvent(event); expect(event.defaultPrevented).toBe(false);
    }
    expect(document.querySelector('[role="menu"]')).toBeNull();
  });
  it('names waiting, unplayed results, and actual playback stop actions honestly in both locales', async () => {
    for (const locale of ['zh-CN', 'en']) {
      for (const status of ['preparing', 'error', 'unknown', 'ready', 'playing', 'paused'] as const) {
        const stop = vi.fn();
        const playback: LocalAppConversationPlayback = {
          state: { status, phase: status === 'preparing' || status === 'error' ? 'generation' : null, message: message(), messageId: 'message', artifactId: null, position: 0, duration: 0, realtimeBlocked: false, sourceVisible: false, error: null },
          stop, play: vi.fn(async () => {}), pause: vi.fn(), resume: vi.fn(async () => {}), seek: vi.fn(), retry: vi.fn(async () => {}), refresh: vi.fn(async () => {}), continueRequest: vi.fn(async () => {}), setSourceVisible: vi.fn(),
        };
        await render(<LocalAppConversationPlayer playback={playback} copy={getMessageInteractionCopy(locale)} />);
        const expected = status === 'preparing' ? locale === 'en' ? 'Stop waiting' : '停止等待'
          : status === 'playing' || status === 'paused' ? locale === 'en' ? 'Stop playback' : '停止播放'
            : locale === 'en' ? 'Close' : '关闭';
        const button = container.querySelector<HTMLButtonElement>(`button[aria-label="${expected}"]`);
        expect(button).toBeTruthy(); expect(button?.title).toBe(expected);
        await act(async () => { button!.click(); }); expect(stop).toHaveBeenCalledOnce();
        if (status !== 'playing' && status !== 'paused') expect(container.querySelector('[aria-label="停止播放"], [aria-label="Stop playback"]')).toBeNull();
      }
    }
  });
  it('closes a quote menu and moves focus to the composer without reopening the action menu', async () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    const onQuote = vi.fn();
    await render(<><View value={message()} onQuote={onQuote} onReturnToComposer={() => container.querySelector('textarea')!.focus()} /><textarea aria-label="Draft" /></>);
    await act(async () => { container.querySelector<HTMLButtonElement>('[aria-label="More actions"]')!.click(); await flush(); });
    const quoteAction = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find(button => button.textContent === 'Reply with quote');
    expect(quoteAction).toBeTruthy();
    await act(async () => { quoteAction!.click(); await flush(); });
    expect(onQuote).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(container.querySelector('textarea'));
    expect(container.querySelector('[aria-label="More actions"]')?.getAttribute('aria-expanded')).toBe('false');
    const exitingMenu = document.querySelector('[role="menu"]');
    if (exitingMenu) expect(exitingMenu.closest('[data-state]')?.getAttribute('data-state')).toBe('closed');
  });
  it('uses localized LocalAgent roles rather than English presentation placeholders', async () => {
    const copy = getMessageInteractionCopy('zh-CN');
    await render(<CanonicalTranscriptView copy={copy} messages={[
      message({ id: 'own', role: 'user', senderName: 'You' }),
      message({ id: 'app', role: 'system', senderName: 'App', metadata: { canonicalOrigin: 'app' } }),
      message({ id: 'partner', senderName: '许一舟' }),
    ]} messageActions={{ scopeKey: 'scope' }} renderMessageContent={item => <p>{item.text}</p>} />);
    expect(Array.from(container.querySelectorAll('[role="article"]')).map(item => item.getAttribute('aria-label'))).toEqual(['你 — 消息操作', '应用 — 消息操作', '许一舟 — 消息操作']);
    for (const [sourceRole, label] of [['user', '你'], ['assistant', '伙伴'], ['app', '应用']] as const) {
      const quote = { state: { status: 'ready', input: null, text: '引文', sourceRole, sourcePartial: false, error: null, failure: null }, cancel: vi.fn() } as unknown as LocalAppConversationQuote;
      await render(<LocalAppConversationQuotePreview quote={quote} copy={copy} />);
      expect(container.querySelector('[data-canonical-quote-draft] p')?.textContent).toBe(label);
    }
  });
  it('preserves the reading message when earlier playback/media geometry changes', async () => {
    let resize: ResizeObserverCallback | undefined;
    vi.stubGlobal('ResizeObserver', class { constructor(callback: ResizeObserverCallback) { resize = callback; } observe() {} unobserve() {} disconnect() {} });
    await render(<CanonicalTranscriptView messages={[message({ id: 'older' }), message({ id: 'reading' })]} renderMessageContent={item => <p>{item.text}</p>} />);
    const viewport = container.querySelector<HTMLElement>('[data-canonical-transcript-root]')!;
    const rows = container.querySelectorAll<HTMLElement>('[data-canonical-message-id]');
    let earlierHeight = 100;
    Object.defineProperty(viewport, 'scrollHeight', { configurable: true, get: () => 1000 + earlierHeight });
    Object.defineProperty(viewport, 'clientHeight', { configurable: true, get: () => 400 });
    viewport.getBoundingClientRect = () => new DOMRect(0, 0, 500, 400);
    rows[0]!.getBoundingClientRect = () => new DOMRect(0, -viewport.scrollTop, 500, earlierHeight);
    rows[1]!.getBoundingClientRect = () => new DOMRect(0, earlierHeight - viewport.scrollTop, 500, 200);
    await act(async () => { viewport.dispatchEvent(new WheelEvent('wheel', { bubbles: true, deltaY: -100 })); viewport.scrollTop = 100; viewport.dispatchEvent(new Event('scroll')); });
    earlierHeight = 180;
    await act(async () => { resize?.([], {} as ResizeObserver); });
    expect(viewport.scrollTop).toBe(180);
    expect(rows[1]!.getBoundingClientRect().top).toBe(0);
  });
  it('blocks persisted active prefixes but allows stable partial text and completed text with an active media tail', async () => {
    const onQuote = vi.fn();
    for (const state of [
      { status: 'streaming', partial: true, turn: 'active', allowed: false },
      { status: 'pending', partial: true, turn: 'active', allowed: false },
      { status: 'error', partial: true, turn: 'failed', allowed: true },
      { status: 'canceled', partial: true, turn: 'interrupted', allowed: true },
      { status: 'complete', partial: false, turn: 'active', allowed: true },
    ] as const) {
      const value = message({ status: state.status, metadata: { canonicalMessageCommitted: true, canonicalTurnId: 'turn', canonicalPartial: state.partial, canonicalTurnStatus: state.turn } });
      await render(<View value={value} onQuote={onQuote} />);
      const quote = container.querySelector<HTMLButtonElement>('[aria-label="Reply with quote"]')!;
      expect(quote.disabled).toBe(!state.allowed);
      await act(async () => { quote.click(); });
    }
    expect(onQuote).toHaveBeenCalledTimes(3);
    await render(<View value={message({ metadata: { canonicalPartial: true, canonicalTurnStatus: 'failed' } })} onQuote={onQuote} />);
    expect(container.querySelector<HTMLButtonElement>('[aria-label="Reply with quote"]')!.disabled).toBe(true);
  });
  it('copies the captured selected passage after context-menu focus moves', async () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
    const writeText = vi.fn(async () => {}); Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    await render(<View value={message()} onQuote={() => {}} />);
    const node = container.querySelector('[data-canonical-message-content] p')!.firstChild!;
    const range = document.createRange(); range.setStart(node, 12); range.setEnd(node, 16); document.getSelection()!.addRange(range);
    await act(async () => { node.parentElement!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 })); await flush(); });
    const action = Array.from(document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')).find(button => button.textContent === 'Copy selected text');
    expect(action).toBeTruthy();
    await act(async () => { action!.click(); await flush(); });
    expect(writeText).toHaveBeenCalledWith('same');
  });
});

describe('composer quote preparation and pending submissions', () => {
  it('blocks send while keeping the textarea editable', async () => {
    const submit = vi.fn();
    await render(<CanonicalComposer adapter={{ submit }} text="Keep typing" submitDisabled quoteSlot={<span>Preparing quote</span>} />);
    const textarea = container.querySelector('textarea')!;
    expect(textarea.disabled).toBe(false);
    expect(container.querySelector<HTMLButtonElement>('button[type="submit"]')?.disabled).toBe(true);
    await act(async () => { textarea.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); await flush(); });
    expect(submit).not.toHaveBeenCalled();
  });
  it('does not clear text edited after a submission started', async () => {
    let complete!: () => void;
    const pending = new Promise<void>(resolve => { complete = resolve; });
    let composer!: UseChatComposerResult;
    function Harness() { composer = useChatComposer({ adapter: { submit: () => pending }, initialText: 'old input' }); return null; }
    await render(<Harness />);
    let submitted!: Promise<void>;
    await act(async () => { submitted = composer.handleSubmit(); await flush(); });
    await act(async () => { composer.setText('new input'); });
    await act(async () => { complete(); await submitted; });
    expect(composer.text).toBe('new input');
  });
});
