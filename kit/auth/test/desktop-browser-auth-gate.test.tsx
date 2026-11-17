import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

const { performDesktopBrowserAuth } = vi.hoisted(() => ({
  performDesktopBrowserAuth: vi.fn(),
}));

vi.mock('../src/logic/desktop-browser-auth.js', () => ({
  performDesktopBrowserAuth,
  isDesktopBrowserAuthWaitEnded: (error: unknown) => (error as { name?: string } | null)?.name === 'DesktopBrowserAuthWaitEndedError',
}));

import { DesktopBrowserAuthGate } from '../src/components/desktop-browser-auth-gate.js';

function renderGate(notice?: string, withLogo = true) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const onEntryAction = vi.fn();
  const onAuthenticated = vi.fn();

  act(() => {
    root.render(
      <DesktopBrowserAuthGate
        bridge={{} as never}
        runtimeAccountBroker={{} as never}
        logo={withLogo ? <img src="/logo.png" alt="Nimi" /> : undefined}
        title="在浏览器中安全登录 Nimi"
        description="凭据只在网页中输入"
        continueLabel="继续登录"
        pendingMessage="请在浏览器中完成登录"
        retryLabel="重试"
        notice={notice}
        onAuthenticated={onAuthenticated}
        onEntryAction={onEntryAction}
        actionTestId="login-action"
      />,
    );
  });

  return { container, root, onEntryAction, onAuthenticated };
}

describe('DesktopBrowserAuthGate presentation', () => {
  it('keeps sign-in and retry reachable when the optional logo is omitted', async () => {
    performDesktopBrowserAuth.mockRejectedValue(new Error('Browser unavailable'));
    const { container, root, onEntryAction } = renderGate(undefined, false);
    const action = container.querySelector<HTMLButtonElement>('[data-testid="login-action"]')!;
    expect(action.textContent).toBe('继续登录');
    await act(async () => { action.click(); });
    expect(onEntryAction).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="alert"]')).not.toBeNull();
    expect(action.textContent).toBe('重试');
    await act(async () => { action.click(); });
    expect(onEntryAction).toHaveBeenCalledTimes(2);
    act(() => root.unmount());
    container.remove();
  });

  it('makes the logo the single keyboard-reachable action and shows no loading dots while idle', () => {
    const { container, root } = renderGate();
    const action = container.querySelector<HTMLButtonElement>('[data-testid="login-action"]');

    expect(container.querySelector('.nimi-shell-auth-brand-surface')).not.toBeNull();
    expect(container.querySelector('h1')?.textContent).toBe('Nimi');
    expect(action?.tagName).toBe('BUTTON');
    expect(action?.getAttribute('aria-label')).toBe('继续登录');
    expect(action?.querySelector('img')).not.toBeNull();
    expect(container.querySelectorAll('button')).toHaveLength(1);
    expect(container.querySelectorAll('.nimi-shell-auth-dot')).toHaveLength(0);

    act(() => root.unmount());
    container.remove();
  });

  it('waits with dots, can reopen the same authorization URL, and ends the local wait without an error', async () => {
    let options: { signal?: AbortSignal; onBrowserOpened?: (reopen: () => Promise<boolean>) => void } = {};
    const reopen = vi.fn(async () => true);
    performDesktopBrowserAuth.mockImplementation((_bridge: unknown, received: typeof options) => {
      options = received;
      received.onBrowserOpened?.(reopen);
      return new Promise((_resolve, reject) => {
        received.signal?.addEventListener('abort', () => {
          const ended = new Error('ended');
          ended.name = 'DesktopBrowserAuthWaitEndedError';
          reject(ended);
        });
      });
    });
    const { container, root, onEntryAction } = renderGate('请在浏览器中完成登录，本窗口会自动继续。');
    const action = container.querySelector<HTMLButtonElement>('[data-testid="login-action"]');

    await act(async () => {
      action?.click();
      await Promise.resolve();
    });

    expect(onEntryAction).toHaveBeenCalledTimes(1);
    expect(container.querySelector('[role="status"]')?.textContent).toContain('请在浏览器中完成登录');
    expect(container.querySelectorAll('.nimi-shell-auth-dot')).toHaveLength(3);
    expect(container.textContent).not.toContain('本窗口会自动继续');
    const reopenButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === '重新打开浏览器');
    await act(async () => { reopenButton?.click(); await Promise.resolve(); });
    expect(reopen).toHaveBeenCalledTimes(1);

    const endButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent === '结束等待');
    await act(async () => { endButton?.click(); await Promise.resolve(); await Promise.resolve(); });
    expect(options.signal?.aborted).toBe(true);
    expect(container.querySelector('[role="alert"]')).toBeNull();
    expect(container.querySelector('[data-testid="login-action"]')?.getAttribute('aria-label')).toBe('继续登录');
    expect(container.textContent).toContain('已结束等待');

    act(() => root.unmount());
    container.remove();
  });

  it('re-enables sign-in immediately and keeps the next wait when a retired completion settles', async () => {
    const waits: { signal: AbortSignal; resolve: (value: { user: { id: string } }) => void }[] = [];
    performDesktopBrowserAuth.mockImplementation((_bridge: unknown, input: { signal: AbortSignal }) =>
      new Promise(resolve => waits.push({ signal: input.signal, resolve })));
    const { container, root, onAuthenticated } = renderGate();
    try {
      const action = container.querySelector<HTMLButtonElement>('[data-testid="login-action"]')!;
      const end = () => [...container.querySelectorAll('button')].find(button => button.textContent === '结束等待')!;
      await act(async () => action.click());
      await act(async () => end().click());
      expect(action.disabled).toBe(false);
      expect(waits[0]?.signal.aborted).toBe(true);
      await act(async () => action.click());
      await act(async () => waits[0]?.resolve({ user: { id: 'previous' } }));
      expect(onAuthenticated).not.toHaveBeenCalled();
      expect(action.disabled).toBe(true);
      expect(waits[1]?.signal.aborted).toBe(false);
      await act(async () => waits[1]?.resolve({ user: { id: 'current' } }));
      expect(onAuthenticated).toHaveBeenCalledExactlyOnceWith({ id: 'current' });
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

});
