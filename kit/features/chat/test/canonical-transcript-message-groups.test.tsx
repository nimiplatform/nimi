import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { TranscriptMessageGroups } from '../src/components/canonical-transcript-message-groups.js';
import type { ConversationCanonicalMessage } from '../src/types.js';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

it('real virtualizer range and measurement updates retain message slots while changed inputs still render', async () => {
  // JSDOM has no layout. Supply deterministic DOM geometry/observer delivery,
  // while using the actual useVirtualizer, range, measurement and scroll code.
  const observers = new Set<LayoutObserver>();
  class LayoutObserver implements ResizeObserver {
    readonly targets = new Set<Element>();
    constructor(readonly callback: ResizeObserverCallback) { observers.add(this); }
    observe(target: Element) { this.targets.add(target); }
    unobserve(target: Element) { this.targets.delete(target); }
    disconnect() { this.targets.clear(); observers.delete(this); }
    deliver(target: Element, blockSize: number) {
      if (!this.targets.has(target)) return;
      this.callback([{ target, borderBoxSize: [{ inlineSize: 640, blockSize }] } as ResizeObserverEntry], this);
    }
  }
  vi.stubGlobal('ResizeObserver', LayoutObserver);
  expect(window.ResizeObserver).toBe(LayoutObserver);
  const measured = new WeakMap<Element, number>();
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute('data-index') ? measured.get(this) ?? 80 : 0;
  });
  const viewport = document.createElement('div');
  const container = document.createElement('div');
  viewport.appendChild(container);
  document.body.appendChild(viewport);
  Object.defineProperties(viewport, {
    clientHeight: { configurable: true, get: () => 240 },
    clientWidth: { configurable: true, get: () => 640 },
    scrollHeight: { configurable: true, get: () => Number.parseFloat((container.firstElementChild as HTMLElement | null)?.style.height || '0') },
    scrollTo: { configurable: true, value: (options: ScrollToOptions | number, top?: number) => {
      viewport.scrollTop = typeof options === 'number' ? top ?? 0 : options.top ?? viewport.scrollTop;
    } },
  });
  const scrollRef = { current: viewport };
  const root = createRoot(container);
  let messages: ConversationCanonicalMessage[] = Array.from({ length: 80 }, (_, index) => ({
    id: `m${index}`, sessionId: 'conversation', targetId: 'target', source: 'agent', role: 'agent',
    text: `message ${index}`, kind: 'text', status: 'complete', createdAt: '',
  }));
  const calls = { avatar: new Map<string, number>(), content: new Map<string, number>(), accessory: new Map<string, number>() };
  const record = (slot: keyof typeof calls, id: string) => calls[slot].set(id, (calls[slot].get(id) ?? 0) + 1);
  const slots = {
    renderMessageAvatar(message: ConversationCanonicalMessage) { record('avatar', message.id); return <span>avatar</span>; },
    renderMessageContent(message: ConversationCanonicalMessage) {
      record('content', message.id);
      return <span data-message-content={message.id}>{message.text}</span>;
    },
    renderMessageAccessory(message: ConversationCanonicalMessage) { record('accessory', message.id); return <span>accessory</span>; },
  };
  const visible = () => [...container.querySelectorAll<HTMLElement>('[data-message-content]')].map(node => node.dataset.messageContent!);
  const row = (id: string) => container.querySelector(`[data-message-content="${id}"]`)!.closest<HTMLElement>('[data-index]')!;
  const counts = () => ({ avatar: new Map(calls.avatar), content: new Map(calls.content), accessory: new Map(calls.accessory) });
  const unchanged = (ids: readonly string[], previous: typeof calls) => {
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) for (const slot of ['avatar', 'content', 'accessory'] as const) {
      expect(calls[slot].get(id), `${slot} of ${id} rerendered for layout-only work`).toBe(previous[slot].get(id));
    }
  };
  try {
    await act(async () => root.render(<TranscriptMessageGroups messages={messages} scrollRef={scrollRef} {...slots} />));
    const initial = visible();
    expect(initial.length).toBeGreaterThan(1);
    expect(initial.length, 'the actual virtualizer must select a window').toBeLessThan(messages.length);
    const previousCounts = counts();
    const first = row(initial[0]!);
    const following = row(initial[1]!);
    const previousPosition = following.style.transform;
    const previousSize = (container.firstElementChild as HTMLElement).style.height;
    expect([...observers].some(observer => observer.targets.has(first))).toBe(true);
    await act(async () => {
      measured.set(first, 120);
      for (const observer of observers) observer.deliver(first, 120);
    });
    expect(following.style.transform, 'real measurements still move layout wrappers').not.toBe(previousPosition);
    expect((container.firstElementChild as HTMLElement).style.height).not.toBe(previousSize);
    unchanged(visible().filter(id => initial.includes(id)), previousCounts);

    const beforeScroll = visible();
    const beforeScrollCounts = counts();
    await act(async () => {
      viewport.scrollTop = 160;
      viewport.dispatchEvent(new Event('scroll'));
    });
    const afterScroll = visible();
    expect(afterScroll.some(id => !beforeScroll.includes(id)), 'real scrolling must admit new rows').toBe(true);
    unchanged(afterScroll.filter(id => beforeScroll.includes(id)), beforeScrollCounts);

    const beforeProps = counts();
    const updatedAvatar = (message: ConversationCanonicalMessage) => { record('avatar', message.id); return <span>updated avatar</span>; };
    await act(async () => root.render(<TranscriptMessageGroups messages={messages} scrollRef={scrollRef} {...slots} renderMessageAvatar={updatedAvatar} />));
    expect(container.textContent).toContain('updated avatar');
    for (const id of visible()) expect(calls.content.get(id)).toBe((beforeProps.content.get(id) ?? 0) + 1);

    const keptId = visible()[2]!;
    const keptNode = row(keptId);
    const previousIndex = Number(keptNode.dataset.index);
    messages = [messages[0]!, { ...messages[0]!, id: 'late-media', kind: 'image', text: 'late media' }, ...messages.slice(1)];
    await act(async () => root.render(<TranscriptMessageGroups messages={messages} scrollRef={scrollRef} {...slots} renderMessageAvatar={updatedAvatar} />));
    expect(row(keptId), 'late insertion keeps row identity by message key').toBe(keptNode);
    expect(Number(row(keptId).dataset.index)).toBe(previousIndex + 1);
    messages = messages.map(message => message.id === keptId ? { ...message, kind: 'streaming', text: 'new streamed text', status: 'streaming' } : message);
    await act(async () => root.render(<TranscriptMessageGroups messages={messages} scrollRef={scrollRef} {...slots} renderMessageAvatar={updatedAvatar} />));
    expect(row(keptId).textContent).toContain('new streamed text');
  } finally {
    await act(async () => root.unmount());
    viewport.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  }
});
