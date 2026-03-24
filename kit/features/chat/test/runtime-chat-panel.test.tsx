import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RuntimeChatPanel } from '../src/ui.js';
import type { UseRuntimeChatSessionResult } from '../src/runtime.js';

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

function dispatchTextareaValue(element: HTMLTextAreaElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value');
  descriptor?.set?.call(element, value);
  element.dispatchEvent(new Event('input', { bubbles: true }));
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

function makeSession(overrides: Partial<UseRuntimeChatSessionResult> = {}): UseRuntimeChatSessionResult {
  return {
    messages: [],
    isStreaming: false,
    canCancel: false,
    error: null,
    sendPrompt: vi.fn(async () => {}),
    cancelCurrent: vi.fn(),
    resetMessages: vi.fn(),
    setMessages: vi.fn(),
    clearError: vi.fn(),
    ...overrides,
  };
}

describe('RuntimeChatPanel', () => {
  it('sends prompt content through the session', async () => {
    const session = makeSession();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<RuntimeChatPanel session={session} />);
      await flush();
    });

    const textarea = container.querySelector('textarea');
    expect(textarea).toBeTruthy();
    await act(async () => {
      dispatchTextareaValue(textarea as HTMLTextAreaElement, 'hello panel');
      await flush();
    });

    await act(async () => {
      const buttons = Array.from(container?.querySelectorAll('button') || []);
      buttons[buttons.length - 1]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(session.sendPrompt).toHaveBeenCalledWith('hello panel');
  });

  it('switches the primary action to cancel while streaming', async () => {
    const session = makeSession({
      isStreaming: true,
      canCancel: true,
      messages: [{
        id: 'assistant-1',
        role: 'assistant',
        content: 'Partial reply',
        timestamp: new Date().toISOString(),
        status: 'streaming',
      }],
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<RuntimeChatPanel session={session} cancelLabel="Stop" />);
      await flush();
    });

    expect(container.textContent).toContain('Stop');

    await act(async () => {
      const buttons = Array.from(container?.querySelectorAll('button') || []);
      buttons[buttons.length - 1]?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      await flush();
    });

    expect(session.cancelCurrent).toHaveBeenCalledTimes(1);
  });

  it('renders default status text for canceled assistant messages', async () => {
    const session = makeSession({
      messages: [{
        id: 'assistant-2',
        role: 'assistant',
        content: 'Partial reply',
        timestamp: new Date().toISOString(),
        status: 'canceled',
      }],
    });
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(<RuntimeChatPanel session={session} />);
      await flush();
    });

    expect(container.textContent).toContain('Canceled');
  });
});
