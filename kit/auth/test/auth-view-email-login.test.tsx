import { describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | { count?: number }) =>
      typeof fallback === 'string' ? fallback : key,
  }),
}));

import { AuthViewEmailLogin } from '../src/components/auth-view-email';

describe('AuthViewEmailLogin password visibility', () => {
  it('renders an eye toggle that flips the input type from password to text', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);

    act(() => {
      root.render(
        <AuthViewEmailLogin
          email="halliday@nimi.ai"
          password="hunter2!!"
          pending={false}
          onPasswordChange={() => {}}
          onSubmit={(event) => event.preventDefault()}
          onUseEmailCodeInstead={() => {}}
          testIds={{ passwordInput: 'pw-input' }}
        />,
      );
    });

    const input = container.querySelector<HTMLInputElement>('[data-testid="pw-input"]');
    expect(input).toBeTruthy();
    expect(input?.type).toBe('password');

    const toggle = container.querySelector<HTMLButtonElement>('button[aria-pressed]');
    expect(toggle).toBeTruthy();
    expect(toggle?.getAttribute('aria-pressed')).toBe('false');

    act(() => {
      toggle?.click();
    });

    const inputAfter = container.querySelector<HTMLInputElement>('[data-testid="pw-input"]');
    expect(inputAfter?.type).toBe('text');
    const toggleAfter = container.querySelector<HTMLButtonElement>('button[aria-pressed]');
    expect(toggleAfter?.getAttribute('aria-pressed')).toBe('true');

    act(() => {
      root.unmount();
    });
    container.remove();
  });
});
