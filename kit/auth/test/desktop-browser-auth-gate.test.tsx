import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

const { performDesktopBrowserAuth } = vi.hoisted(() => ({
  performDesktopBrowserAuth: vi.fn(),
}));

vi.mock('../src/logic/desktop-browser-auth.js', () => ({
  performDesktopBrowserAuth,
}));

vi.mock('../src/components/auth-visual-background.js', () => ({
  AuthVisualBackground: ({ profile }: { profile: string }) => (
    <div data-testid="auth-visual-background" data-profile={profile} />
  ),
}));

import { DesktopBrowserAuthGate } from '../src/components/desktop-browser-auth-gate.js';

function renderGate(notice?: string) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  const onEntryAction = vi.fn();

  act(() => {
    root.render(
      <DesktopBrowserAuthGate
        bridge={{} as never}
        runtimeAccountBroker={{} as never}
        logo={<img src="/logo.png" alt="Nimi" />}
        title="在浏览器中安全登录 Nimi"
        description="凭据只在网页中输入"
        continueLabel="继续登录"
        pendingMessage="请在浏览器中完成登录"
        retryLabel="重试"
        notice={notice}
        onAuthenticated={vi.fn()}
        onEntryAction={onEntryAction}
        actionTestId="login-action"
      />,
    );
  });

  return { container, root, onEntryAction };
}

describe('DesktopBrowserAuthGate presentation', () => {
  it('keeps the established Nimi logo interaction and ambient visual shell', () => {
    const { container, root } = renderGate();
    const action = container.querySelector<HTMLButtonElement>('[data-testid="login-action"]');
    const hint = Array.from(container.querySelectorAll('p')).find((element) => element.textContent === '继续登录');

    expect(container.querySelector('.nimi-shell-auth-brand-surface')).not.toBeNull();
    expect(container.querySelector('[data-testid="auth-visual-background"]')?.getAttribute('data-profile')).toBe('desktop');
    expect(container.querySelector('h1')?.textContent).toBe('Nimi');
    expect(action?.querySelector('.h-32.w-32')).not.toBeNull();
    expect(hint?.className).toContain('opacity-0');

    act(() => action?.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
    expect(hint?.className).toContain('opacity-100');

    act(() => root.unmount());
    container.remove();
  });

  it('keeps the browser handoff on the logo and projects pending state in place', async () => {
    performDesktopBrowserAuth.mockReturnValue(new Promise(() => undefined));
    const { container, root, onEntryAction } = renderGate('请在浏览器中完成登录，本窗口会自动继续。');
    const action = container.querySelector<HTMLButtonElement>('[data-testid="login-action"]');

    await act(async () => {
      action?.click();
      await Promise.resolve();
    });

    expect(onEntryAction).toHaveBeenCalledTimes(1);
    expect(action?.disabled).toBe(true);
    expect(container.querySelector('[role="status"]')?.textContent).toContain('请在浏览器中完成登录');
    expect(container.textContent).not.toContain('本窗口会自动继续');

    act(() => root.unmount());
    container.remove();
  });
});
