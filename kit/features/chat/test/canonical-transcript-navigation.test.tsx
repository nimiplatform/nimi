import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { CanonicalTranscriptView } from '../src/components/canonical-transcript-view.js';
import type { ConversationCanonicalMessage } from '../src/types.js';
import type { ConversationPositionRequest } from '../src/runtime/local-app-conversation-history.js';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('restores an initial short transcript position without tail pinning or taking navigation focus', async () => {
  const container = document.createElement('div'); document.body.append(container);
  const navigation = document.createElement('button'); document.body.append(navigation); navigation.focus();
  const offsets = new WeakMap<HTMLElement, number>();
  vi.spyOn(HTMLElement.prototype, 'scrollTop', 'get').mockImplementation(function (this: HTMLElement) { return offsets.get(this) ?? 0; });
  vi.spyOn(HTMLElement.prototype, 'scrollTop', 'set').mockImplementation(function (this: HTMLElement, value: number) { offsets.set(this, value); });
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    const viewport = container.querySelector<HTMLElement>('[data-canonical-transcript-root]');
    const messageId = this.dataset.canonicalMessageId;
    return new DOMRect(0, messageId ? Number(messageId.slice(1)) * 100 - (viewport?.scrollTop ?? 0) : 0, 640, messageId ? 100 : 400);
  });
  const messages: ConversationCanonicalMessage[] = Array.from({ length: 10 }, (_, index) => ({
    id: `m${index}`, sessionId: 'human-chat', targetId: 'person', source: 'human', role: 'assistant', kind: 'text', status: 'complete', text: `message ${index}`, createdAt: '',
  }));
  const root = createRoot(container);
  try {
    await act(async () => root.render(<CanonicalTranscriptView messages={messages} activeConversationId="human-chat"
      positionRequest={{ messageId: 'm3', offset: 12, requestKey: 0, focus: false }} />));
    await act(async () => { await new Promise(resolve => requestAnimationFrame(resolve)); });
    expect(container.querySelector<HTMLElement>('[data-canonical-transcript-root]')!.scrollTop).toBe(312);
    expect(document.activeElement).toBe(navigation);
  } finally { await act(async () => root.unmount()); container.remove(); navigation.remove(); vi.restoreAllMocks(); }
});

it('returns a short historical window to the actual virtualized live tail and preserves the newest navigation intent', async () => {
  // JSDOM supplies no layout. Model browser geometry and observer/event delivery,
  // keeping the real TanStack range/measurement/reconciliation implementation.
  // The test never writes a desired scrollTop: only production navigation does.
  const observers = new Set<LayoutObserver>();
  class LayoutObserver implements ResizeObserver {
    targets = new Set<Element>();
    constructor(readonly callback: ResizeObserverCallback) { observers.add(this); }
    observe(target: Element) { this.targets.add(target); }
    unobserve(target: Element) { this.targets.delete(target); }
    disconnect() { this.targets.clear(); observers.delete(this); }
    deliver() {
      const entries = [...this.targets].filter(target => target.isConnected).map(target => {
        const height = target instanceof HTMLElement ? target.offsetHeight : 0;
        const size = { inlineSize: 640, blockSize: height };
        return { target, contentRect: new DOMRectReadOnly(0, 0, 640, height), borderBoxSize: [size], contentBoxSize: [size], devicePixelContentBoxSize: [size] } as ResizeObserverEntry;
      });
      if (entries.length) this.callback(entries, this);
    }
  }
  vi.stubGlobal('ResizeObserver', LayoutObserver);
  let viewport: HTMLElement | null = null;
  let lateHeight = 0;
  const virtualContainer = () => Array.from(viewport?.querySelectorAll<HTMLElement>('div[style]') || []).find(element => element.style.position === 'relative' && element.style.height);
  const height = () => Number.parseFloat(virtualContainer()?.style.height || '') || (viewport?.querySelectorAll('[data-canonical-message-id]').length || 0) * 116;
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    if (this.hasAttribute('data-canonical-transcript-root')) return 400;
    if (this.hasAttribute('data-index')) return 100 + lateHeight + Number.parseFloat(this.style.paddingTop || '0');
    if (this.hasAttribute('data-canonical-transcript-width')) return height() + 80;
    return 100;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(640);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    if (this === viewport) return new DOMRect(0, 0, 640, 400);
    const article = this.closest<HTMLElement>('[data-canonical-message-id]');
    const measuredRow = this.closest<HTMLElement>('[data-index]');
    if (measuredRow) {
      const start = Number.parseFloat(measuredRow.style.transform.match(/translateY\(([-\d.]+)px\)/)?.[1] || '0');
      return new DOMRect(0, start + Number.parseFloat(measuredRow.style.paddingTop || '0') - (viewport?.scrollTop || 0), 640, 100 + lateHeight);
    }
    if (article && viewport) {
      const index = [...viewport.querySelectorAll('[data-canonical-message-id]')].indexOf(article);
      return new DOMRect(0, index * 116 - viewport.scrollTop, 640, 100);
    }
    return new DOMRect(0, 0, 640, this.offsetHeight);
  });
  const messages: ConversationCanonicalMessage[] = Array.from({ length: 213 }, (_, index) => ({
    id: `m${index}`, sessionId: 'anchor', targetId: 'agent', source: 'agent', role: 'assistant', kind: 'text', status: 'complete', text: `message ${index}`, createdAt: '',
    metadata: { canonicalMessageCommitted: true },
  }));
  const container = document.createElement('div'); document.body.append(container); const root = createRoot(container);
  let pendingScroll = false;
  const render = async (items: readonly ConversationCanonicalMessage[], positionRequest?: ConversationPositionRequest) => {
    await act(async () => root.render(<CanonicalTranscriptView activeConversationId="anchor" messages={items} positionRequest={positionRequest}
      messageActions={{ scopeKey: 'scope' }} renderMessageContent={message => <div style={{ height: 100 }}>{message.text}</div>} />));
  };
  const dispatchScroll = () => { if (pendingScroll) { pendingScroll = false; viewport!.dispatchEvent(new Event('scroll')); } };
  const settle = async (resizeFirst: boolean) => {
    for (let round = 0; round < 8; round += 1) await act(async () => {
      if (!resizeFirst) dispatchScroll();
      for (const observer of [...observers]) observer.deliver();
      if (resizeFirst) dispatchScroll();
      await new Promise(resolve => setTimeout(resolve, 20));
    });
  };
  try {
    await render(messages.slice(0, 10));
    viewport = container.querySelector<HTMLElement>('[data-canonical-transcript-root]')!;
    let offset = 0;
    Object.defineProperties(viewport, {
      clientHeight: { configurable: true, get: () => 400 },
      clientWidth: { configurable: true, get: () => 640 },
      scrollHeight: { configurable: true, get: () => height() + 80 },
      scrollTop: { configurable: true, get: () => offset, set: (value: number) => {
        const next = Math.max(0, Math.min(value, viewport!.scrollHeight - viewport!.clientHeight));
        if (next !== offset) { offset = next; pendingScroll = true; }
      } },
      scrollTo: { configurable: true, value: (options: ScrollToOptions | number, top?: number) => { viewport!.scrollTop = typeof options === 'number' ? top || 0 : options.top ?? viewport!.scrollTop; } },
    });
    await settle(false);
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 140)); });
    await render(messages.slice(0, 10), { messageId: 'm5', offset: 0, requestKey: 1 });
    await settle(false);
    expect(viewport.scrollTop).toBeGreaterThan(0);
    expect(viewport.scrollTop).toBeLessThan(viewport.scrollHeight - viewport.clientHeight - 80);

    await render(messages, { messageId: null, offset: 0, requestKey: 2 });
    // The original failure delivered virtual measurements before the scroll
    // event and let the old reading anchor/indexed command win.
    await settle(true);
    expect(viewport.scrollTop).toBeGreaterThanOrEqual(viewport.scrollHeight - viewport.clientHeight - 1);
    const penultimate = viewport.querySelector<HTMLElement>('[data-canonical-message-id="m211"]');
    expect(penultimate, 'the live tail must be mounted, not only an extra pinned final row').toBeTruthy();
    expect(penultimate!.getBoundingClientRect().top).toBeLessThan(viewport.clientHeight);
    expect(penultimate!.getBoundingClientRect().bottom).toBeGreaterThan(0);
    expect(viewport.querySelector<HTMLElement>('[data-canonical-message-id="m212"]')?.tabIndex).toBe(0);

    lateHeight = 40;
    await settle(true);
    expect(viewport.scrollTop).toBeGreaterThanOrEqual(viewport.scrollHeight - viewport.clientHeight - 1);

    await render(messages, { messageId: 'm2', offset: 0, requestKey: 3 });
    await settle(false);
    expect(viewport.querySelector('[data-canonical-message-id="m2"]')).toBeTruthy();
    expect(viewport.scrollTop).toBeLessThan(viewport.scrollHeight - viewport.clientHeight - 400);
  } finally {
    await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals();
  }
});
