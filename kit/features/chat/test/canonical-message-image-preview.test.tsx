import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { CanonicalMessageBubble } from '../src/components/canonical-message-bubble.js';
import type { ConversationCanonicalMessage } from '../src/types.js';

const renders = vi.hoisted(() => ({ dialog: 0 }));
// Count the expensive boundary but keep the real Dialog, portal, focus and motion.
vi.mock('@nimiplatform/kit/ui', async importOriginal => {
  const original = await importOriginal<typeof import('@nimiplatform/kit/ui')>();
  return { ...original, Dialog(props: React.ComponentProps<typeof original.Dialog>) {
    renders.dialog++;
    return <original.Dialog {...props} />;
  } };
});
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let container: HTMLDivElement | null = null;
const copy = { bubbleOpenImagePreviewLabel: 'Open picture', bubbleCloseImagePreviewLabel: 'Close picture', bubbleImagePreviewTitle: 'Picture preview' };
const message = (kind: ConversationCanonicalMessage['kind']): ConversationCanonicalMessage => ({
  id: `message-${kind}`, sessionId: 'conversation', targetId: 'target', source: 'agent', role: 'agent',
  kind, text: 'Caption', createdAt: '2026-10-25T00:00:00Z',
  metadata: { mediaUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7' },
});
async function show(kind: ConversationCanonicalMessage['kind'], metadata: Record<string, unknown> = {}) {
  if (!root) {
    container = document.createElement('div'); document.body.appendChild(container);
    root = createRoot(container);
  }
  const value = message(kind);
  await act(async () => root!.render(<CanonicalMessageBubble key={kind} message={{ ...value, metadata: { ...value.metadata, ...metadata } }} copy={copy} />));
}
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  container?.remove(); root = null; container = null; renders.dialog = 0;
});

it('does not mount an image dialog for text, stream, voice, video or pending messages', async () => {
  for (const kind of ['text', 'streaming', 'voice', 'video', 'image-pending', 'video-pending'] as const) {
    await show(kind);
    expect(renders.dialog).toBe(0);
    expect(container!.querySelector('[aria-label="Open picture"]')).toBeNull();
  }
});

it('keeps real image preview opening, close motion, focus return and reopening', async () => {
  await show('image');
  const trigger = container!.querySelector('[aria-label="Open picture"]') as HTMLButtonElement;
  expect(trigger).toBeTruthy();
  await act(async () => { trigger.focus(); trigger.click(); });
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Picture preview');
  const close = document.querySelector('[aria-label="Close picture"]') as HTMLButtonElement;
  await act(async () => { close.click(); });
  await vi.waitFor(async () => {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });
  await act(async () => { trigger.click(); });
  expect(document.querySelector('[role="dialog"] img')?.getAttribute('alt')).toBe('Caption');
});

it('opens originals through the consumer host and reauthorizes expired grants without an image fallback', async () => {
  const delivery = { resourceId: 'image-1', contentVersion: 'a'.repeat(64), publicationGeneration: 1,
    policyVersion: 'v1', expiresAt: '2099-01-01T00:00:00Z', images: [], previewUrl: null, video: null,
    originalUrl: 'https://media.example/original?grant=initial' };
  const openMediaOriginal = vi.fn(async (_url: string) => undefined);
  const refreshMedia = vi.fn(async () => ({ ...delivery, originalUrl: 'https://media.example/original?grant=renewed' }));
  await show('image', { mediaDelivery: delivery, openMediaOriginal, refreshMedia });
  await act(async () => (container!.querySelector('[aria-label="Open picture"]') as HTMLButtonElement).click());
  const download = () => document.querySelector('[role="dialog"] a') as HTMLAnchorElement;
  await act(async () => download().click());
  expect(openMediaOriginal).toHaveBeenLastCalledWith(delivery.originalUrl);
  expect(refreshMedia).not.toHaveBeenCalled();
  await show('image', { mediaDelivery: { ...delivery, expiresAt: '2000-01-01T00:00:00Z' }, openMediaOriginal, refreshMedia });
  await act(async () => download().click());
  expect(openMediaOriginal).toHaveBeenLastCalledWith('https://media.example/original?grant=renewed');
  refreshMedia.mockRejectedValueOnce(new Error('Access revoked'));
  await act(async () => download().click());
  expect(openMediaOriginal).toHaveBeenCalledTimes(2);
  expect(document.querySelector('[role="dialog"] [role="alert"]')?.textContent).toContain('Could not download');
});
