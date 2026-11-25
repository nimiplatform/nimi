import { describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createRoot } from 'react-dom/client';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string | { count?: number; defaultValue?: string }) =>
      typeof fallback === 'string' ? fallback : fallback?.defaultValue ?? key,
  }),
}));

import { AuthViewEmailLogin, AuthViewEmailOtpVerify } from '../src/components/auth-view-email';

describe('AuthViewEmailLogin password visibility', () => {
  it('exposes password recovery and only mounts OTP confirmation actions after they are requested', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const sendCode = vi.fn();
    try {
      act(() => root.render(<AuthViewEmailLogin email="test@example.invalid" password="" pending={false}
        onPasswordChange={() => {}} onSubmit={event => event.preventDefault()} onUseEmailCodeInstead={sendCode}
        passwordRecoveryLink={<a href="/account/recovery">Forgot password?</a>} />));
      const trigger = container.querySelector<HTMLButtonElement>('button[aria-expanded]')!;
      const cancel = () => [...container.querySelectorAll('button')].find(button => button.textContent === 'Auth.cancel');
      expect(container.querySelector('a')?.getAttribute('href')).toBe('/account/recovery');
      expect(cancel()).toBeUndefined();
      act(() => trigger.click());
      expect(document.activeElement).toBe(cancel());
      const otpConfirmCard = cancel()?.closest('div.mt-3');
      expect(otpConfirmCard).not.toBeNull();
      expect(otpConfirmCard?.classList.contains('absolute')).toBe(false);
      act(() => trigger.click());
      expect(cancel()).toBeUndefined();
      act(() => trigger.click());
      expect(document.activeElement).toBe(cancel());
      act(() => cancel()!.click());
      expect(cancel()).toBeUndefined();
      expect(document.activeElement).toBe(trigger);
      expect(sendCode).not.toHaveBeenCalled();
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('closes the OTP confirmation card when submitting the password form', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const onSubmit = vi.fn((event: { preventDefault: () => void }) => event.preventDefault());

    try {
      act(() => root.render(
        <AuthViewEmailLogin
          email="halliday@nimi.ai"
          password="wrong-password"
          pending={false}
          onPasswordChange={() => {}}
          onSubmit={onSubmit}
          onUseEmailCodeInstead={() => {}}
        />,
      ));

      const trigger = container.querySelector<HTMLButtonElement>('button[aria-expanded]')!;
      const cancel = () => [...container.querySelectorAll('button')].find(button => button.textContent === 'Auth.cancel');
      act(() => trigger.click());
      expect(cancel()).toBeDefined();

      const form = container.querySelector('form')!;
      act(() => {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      });

      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(cancel()).toBeUndefined();
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

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
    expect(input?.parentElement?.classList.contains('nimi-shell-auth-main-capsule')).toBe(true);
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

  it('renders the back arrow inside the password capsule left slot and keeps email OTP in secondary actions', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const onBack = vi.fn();

    try {
      act(() => {
        root.render(
          <AuthViewEmailLogin
            email="halliday@nimi.ai"
            password=""
            pending={false}
            onPasswordChange={() => {}}
            onSubmit={(event) => event.preventDefault()}
            onUseEmailCodeInstead={() => {}}
            onBack={onBack}
            passwordRecoveryLink={<a href="/account/recovery">Forgot password?</a>}
          />,
        );
      });

      const capsule = container.querySelector('.nimi-shell-auth-main-capsule');
      const backButton = capsule?.querySelector<HTMLButtonElement>('button[aria-label="Back"]');
      expect(backButton).not.toBeNull();
      expect(container.querySelector('.nimi-shell-auth-secondary-actions')?.textContent).toContain('Auth.useEmailCodeInstead');
      expect(container.querySelector('.nimi-shell-auth-secondary-actions a')?.getAttribute('href')).toBe('/account/recovery');

      act(() => {
        backButton?.click();
      });
      expect(onBack).toHaveBeenCalledTimes(1);
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('renders a back action in the OTP secondary actions row when onBack is provided', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const onBack = vi.fn();

    try {
      act(() => {
        root.render(
          <AuthViewEmailOtpVerify
            email="halliday@nimi.ai"
            otpCode=""
            otpResendCountdown={0}
            pending={false}
            onOtpCodeChange={() => {}}
            onSubmit={(event) => event.preventDefault()}
            onResendOtp={() => {}}
            onBack={onBack}
          />,
        );
      });

      const secondaryButtons = [...container.querySelectorAll<HTMLButtonElement>('.nimi-shell-auth-secondary-actions button')];
      const backButton = secondaryButtons.find((button) => button.textContent === 'Back');
      expect(backButton).toBeDefined();

      act(() => {
        backButton?.click();
      });
      expect(onBack).toHaveBeenCalledTimes(1);
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});
