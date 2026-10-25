import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CanonicalMessageBubble, type CanonicalMessageBubbleProps } from '../src/components/canonical-message-bubble.js';
import type { ConversationCanonicalMessage } from '../src/types.js';

const renders = vi.hoisted(() => ({ markdown: 0, rp: 0, failMarkdown: null as string | null }));
// Count actual rendering, keeping the real Markdown/RP implementation and DOM.
vi.mock('../src/components/chat-markdown-renderer.js', async importOriginal => {
  const original = await importOriginal<typeof import('../src/components/chat-markdown-renderer.js')>();
  return { ...original, ChatMarkdownRenderer(props: React.ComponentProps<typeof original.ChatMarkdownRenderer>) {
    renders.markdown++;
    if (props.content === renders.failMarkdown) throw new Error('scripted Markdown render failure');
    return <original.ChatMarkdownRenderer {...props} />;
  } };
});
vi.mock('../src/components/rp-content-renderer.js', async importOriginal => {
  const original = await importOriginal<typeof import('../src/components/rp-content-renderer.js')>();
  return { ...original, RpContentRenderer(props: React.ComponentProps<typeof original.RpContentRenderer>) {
    renders.rp++;
    return <original.RpContentRenderer {...props} />;
  } };
});

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let container: HTMLDivElement | null = null;
let frame = 0;
const message = (text: string, kind: ConversationCanonicalMessage['kind'] = 'text'): ConversationCanonicalMessage => ({
  id: 'message', sessionId: 'conversation', targetId: 'target', source: 'agent', role: 'agent', kind,
  text, createdAt: '2026-10-25T00:00:00Z', status: kind === 'streaming' ? 'streaming' : 'complete',
});
async function show(props: CanonicalMessageBubbleProps) {
  if (!root) {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
  }
  frame++;
  await act(async () => root!.render(<CanonicalMessageBubble {...props}
    avatar={<span>avatar {frame}</span>} accessory={<span>accessory {frame}</span>} showTimestamp={false} />));
  await act(async () => { await vi.dynamicImportSettled(); });
  expect(container!.textContent).toContain(`accessory ${frame}`);
}

async function waitForContent(assertion: () => void) {
  // An async mock's original import and React's lazy retry may outlive the
  // import queue under suite contention. Wait for the rendered result itself.
  await vi.waitFor(async () => {
    await act(async () => { await vi.dynamicImportSettled(); });
    assertion();
  }, { timeout: 5_000 });
}

afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove();
  root = null; container = null; frame = 0;
  renders.markdown = 0; renders.rp = 0; renders.failMarkdown = null;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('canonical message content memoization', () => {
  it('ignores avatar/accessory and unrelated copy changes, but observes both current Markdown labels', async () => {
    const current = message('**Rendered Markdown**\n\n```js\nconst value = 1;\n```');
    const copy = { markdownCopyLabel: 'Copy initial', markdownCopiedLabel: 'Copied initial', bubbleStreamingLabel: 'Sending' };
    await show({ message: current, copy });
    await waitForContent(() => expect(container!.querySelector('strong')?.textContent).toBe('Rendered Markdown'));
    expect(container!.querySelector('button')?.textContent).toContain('Copy initial');
    const initial = renders.markdown;
    expect(initial).toBeGreaterThan(0);
    await show({ message: current, copy: { ...copy } });
    expect(renders.markdown).toBe(initial);
    copy.bubbleStreamingLabel = 'Unrelated sending label';
    await show({ message: current, copy });
    expect(renders.markdown).toBe(initial);

    // Keep the same incoming copy object while the parent changes its nodes.
    copy.markdownCopyLabel = 'Copier';
    await show({ message: current, copy });
    expect(renders.markdown).toBe(initial + 1);
    expect(container!.querySelector('button')?.textContent).toContain('Copier');
    copy.markdownCopiedLabel = 'Copié';
    await show({ message: current, copy });
    expect(renders.markdown).toBe(initial + 2);
    vi.useFakeTimers();
    vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn(async () => undefined) } });
    await act(async () => container!.querySelector('button')!.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(container!.querySelector('button')?.textContent).toContain('Copié');
    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
  });

  it('renders changing stream text and RP content while retaining stable unchanged subtrees', async () => {
    const first = message('stream **first**', 'streaming');
    await show({ message: first });
    await waitForContent(() => expect(container!.querySelector('strong')?.textContent).toBe('first'));
    const initial = renders.markdown;
    await show({ message: first });
    expect(renders.markdown).toBe(initial);
    await show({ message: { ...first, text: 'stream **second**' } });
    expect(renders.markdown).toBe(initial + 1);
    expect(container!.querySelector('strong')?.textContent).toBe('second');

    const roleplay = message('（轻声）Hello **there**');
    await show({ message: roleplay });
    await waitForContent(() => {
      expect(renders.rp).toBeGreaterThan(0);
      expect(container!.querySelector('strong')?.textContent).toBe('there');
    });
    const rp = renders.rp;
    const markdown = renders.markdown;
    expect(rp).toBeGreaterThan(0);
    expect(container!.textContent).toContain('轻声');
    expect(container!.querySelector('strong')?.textContent).toBe('there');
    await show({ message: roleplay });
    expect(renders.rp).toBe(rp);
    expect(renders.markdown).toBe(markdown);
    await show({ message: { ...roleplay, text: '（点头）Hello **again**' } });
    expect(renders.rp).toBe(rp + 1);
    expect(container!.querySelector('strong')?.textContent).toBe('again');
  });

  it('keeps plaintext fallback and resets the boundary when content changes', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    renders.failMarkdown = '**unrenderable**';
    await show({ message: message(renders.failMarkdown) });
    await waitForContent(() => expect(renders.markdown).toBeGreaterThan(0));
    expect(container!.textContent).toContain('**unrenderable**');
    expect(container!.querySelector('strong')).toBeNull();
    renders.failMarkdown = null;
    await show({ message: message('**recovered**') });
    await waitForContent(() => expect(container!.querySelector('strong')?.textContent).toBe('recovered'));
  });
});
