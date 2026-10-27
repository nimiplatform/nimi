import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CanonicalComposer } from '../src/components/canonical-composer.js';
import { getMessageInteractionCopy } from '../src/message-interaction-copy.js';

(
  globalThis as typeof globalThis & {
    IS_REACT_ACT_ENVIRONMENT?: boolean;
  }
).IS_REACT_ACT_ENVIRONMENT = true;

function flush() {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

afterEach(async () => {
  if (root) {
    await act(async () => {
      root?.unmount();
      await flush();
    });
  }
  container?.remove();
  root = null;
  container = null;
});

async function renderComposer(props: Record<string, unknown> = {}) {
  container = document.createElement('div');
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root?.render(<CanonicalComposer adapter={{ submit: vi.fn() }} {...props} />);
    await flush();
  });
  return container;
}

describe('CanonicalComposer', () => {
  it.each([
    ['idle', '录制语音消息', null],
    ['recording', '发送录音', '取消录音'],
    ['transcribing', '正在转写录音…', '取消转写'],
    ['playing', '正在播放语音回复', '停止语音回复'],
  ] as const)('localizes the %s voice controls through shared copy', async (status, primaryLabel, cancelLabel) => {
    const target = await renderComposer({ copy: getMessageInteractionCopy('zh-CN'), voiceState: { status, onToggle: vi.fn(), onCancel: vi.fn() } });
    const primary = target.querySelector<HTMLButtonElement>(`[aria-label="${primaryLabel}"]`);
    expect(primary).toBeTruthy(); expect(primary?.title).toBe(primaryLabel);
    if (cancelLabel) {
      const cancel = target.querySelector<HTMLButtonElement>(`[aria-label="${cancelLabel}"]`);
      expect(cancel?.textContent).toBe('取消'); expect(cancel?.title).toBe(cancelLabel);
    }
  });
  it('keeps the default English send label', async () => {
    const target = await renderComposer();
    const sendButton = target.querySelector('button[type="submit"]');
    expect(sendButton?.getAttribute('aria-label')).toBe('Send');
  });

  it('forwards sendLabel to the inner composer send button', async () => {
    const target = await renderComposer({ sendLabel: '发送' });
    const sendButton = target.querySelector('button[type="submit"]');
    expect(sendButton?.getAttribute('aria-label')).toBe('发送');
  });

  it('forwards copy overrides to the inner composer', async () => {
    const target = await renderComposer({
      copy: { composerCancelLabel: '取消' },
      voiceState: { status: 'recording', onToggle: vi.fn(), onCancel: vi.fn() },
    });
    expect(target.innerHTML).toContain('取消');
    expect(target.innerHTML).not.toContain('>Cancel<');
  });
});
