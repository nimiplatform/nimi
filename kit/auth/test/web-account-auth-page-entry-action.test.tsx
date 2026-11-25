import { act, StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: string | { defaultValue?: string }) => (
      typeof options === 'string' ? options : options?.defaultValue ?? key
    ),
  }),
}));

import { WebAccountAuthPage } from '../src/components/web-account-auth-page.js';

function authAdapter() {
  return {
    checkEmail: vi.fn(),
    passwordLogin: vi.fn(),
    requestEmailOtp: vi.fn(),
    verifyEmailOtp: vi.fn(),
    verifyTwoFactor: vi.fn(),
    walletChallenge: vi.fn(),
    walletLogin: vi.fn(),
    oauthLogin: vi.fn(),
    updatePassword: vi.fn(),
    loadCurrentUser: vi.fn(),
    completeBrowserSessionLogin: vi.fn(),
  };
}

describe('WebAccountAuthPage entry action semantics', () => {
  it('allows entering email immediately when the owner starts at the email form', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(
      <WebAccountAuthPage
        initialStage="email"
        adapter={authAdapter()}
        session={{ mode: 'embedded' }}
        branding={{ networkLabel: 'Nimi', logo: '/logo.png' }}
        appearance={{ theme: 'default' }}
        background={null}
      />,
    ));
    const email = container.querySelector<HTMLInputElement>('input[type="email"]');
    expect(email?.disabled).toBe(false);
    expect(document.activeElement).toBe(email);
    act(() => root.unmount());
    container.remove();
  });

  it('reports readiness once per canonical instance under StrictMode replay', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const firstReady = vi.fn();
    const secondReady = vi.fn();
    const commonProps = {
      adapter: authAdapter(),
      session: { mode: 'embedded' as const, authStatus: 'unauthenticated' as const },
      branding: { networkLabel: 'Nimi', logo: '/logo.png', logoAltText: 'Nimi Logo' },
      appearance: { theme: 'default' as const },
    };

    act(() => {
      root.render(
        <StrictMode>
          <WebAccountAuthPage {...commonProps} onActionableReady={firstReady} />
          <WebAccountAuthPage {...commonProps} adapter={authAdapter()} onActionableReady={secondReady} />
        </StrictMode>,
      );
    });

    expect(firstReady).toHaveBeenCalledTimes(1);
    expect(secondReady).toHaveBeenCalledTimes(1);
    act(() => root.unmount());
    container.remove();
  });

  it('fires once at the logo stage and turns the compact logo into an unmarked Back control', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const onActionableReady = vi.fn();
    const onEntryAction = vi.fn();

    act(() => {
      root.render(
        <WebAccountAuthPage
          adapter={authAdapter()}
          session={{ mode: 'embedded', authStatus: 'unauthenticated' }}
          branding={{ networkLabel: 'Nimi', logo: '/logo.png', logoAltText: 'Nimi Logo' }}
          appearance={{ theme: 'default' }}
          onActionableReady={onActionableReady}
          onEntryAction={onEntryAction}
          semanticIds={{ entryAction: 'desktop-login-primary' }}
          testIds={{ logoTrigger: 'logo-control' }}
        />,
      );
    });

    const logoControl = () => container.querySelector<HTMLButtonElement>('[data-testid="logo-control"]');
    expect(onActionableReady).toHaveBeenCalledTimes(1);
    expect(logoControl()?.getAttribute('aria-label')).toBe('Sign in to Nimi');
    expect(logoControl()?.textContent).toBe('');
    expect(logoControl()?.querySelector('img')).not.toBeNull();
    expect(container.querySelector('h1')).toBeNull();
    expect(logoControl()?.dataset.nimiSemanticId).toBe('desktop-login-primary');

    act(() => logoControl()?.click());
    expect(onEntryAction).toHaveBeenCalledTimes(1);
    expect(logoControl()?.getAttribute('aria-label')).toBe('Back');
    expect(logoControl()?.hasAttribute('data-nimi-semantic-id')).toBe(false);

    const email = container.querySelector<HTMLInputElement>('input[type="email"]');
    expect(email?.getAttribute('aria-label')).toBe('Auth.emailPlaceholder');
    expect(container.querySelector('button[type="submit"]')?.getAttribute('aria-label')).toBe('Continue');
    const alternatives = container.querySelector<HTMLButtonElement>('button[aria-label="Auth.alternative"]');
    const google = container.querySelector<HTMLButtonElement>('button[aria-label="Google"]');
    const register = [...container.querySelectorAll('button')].find(button => button.textContent === 'Auth.confirmRegister');
    expect(google?.closest('[hidden]')).not.toBeNull();
    expect(register?.closest('[hidden]')).not.toBeNull();
    expect(alternatives?.getAttribute('aria-expanded')).toBe('false');
    act(() => alternatives?.click());
    expect(google?.closest('[hidden]')).toBeNull();
    expect(alternatives?.getAttribute('aria-expanded')).toBe('true');
    act(() => alternatives?.click());
    expect(google?.closest('[hidden]')).not.toBeNull();

    act(() => logoControl()?.click());
    expect(onEntryAction).toHaveBeenCalledTimes(1);
    expect(onActionableReady).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
    container.remove();
  });

  it('initializes Google with the client ID supplied by the Web adapter', async () => {
    const initialize = vi.fn();
    vi.stubGlobal('google', { accounts: { id: {
      initialize,
      prompt: (notify: (result: { isSkippedMoment: () => boolean }) => void) => {
        notify({ isSkippedMoment: () => true });
      },
    } } });
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    try {
      act(() => root.render(
        <WebAccountAuthPage
          initialStage="email"
          adapter={{ ...authAdapter(), googleClientId: 'web-client-id' }}
          session={{ mode: 'embedded' }}
          branding={{ networkLabel: 'Nimi', logo: '/logo.png' }}
          appearance={{ theme: 'default' }}
        />,
      ));
      act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Auth.alternative"]')!.click());
      await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Google"]')!.click());
      expect(initialize).toHaveBeenCalledWith(expect.objectContaining({ client_id: 'web-client-id' }));
    } finally {
      act(() => root.unmount());
      container.remove();
      vi.unstubAllGlobals();
    }
  });

  it('omits wallet entry by default and displays visible disabled reasons for Google and TikTok', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    act(() => root.render(
      <WebAccountAuthPage
        initialStage="email"
        adapter={authAdapter()}
        session={{ mode: 'embedded' }}
        branding={{ networkLabel: 'Nimi', logo: '/logo.png' }}
        copy={{ title: 'Sign in or create an account' }}
        header={<header data-testid="auth-topbar">Nimi</header>}
        alternatives={{
          googleDisabledReason: 'Coming soon',
          tikTokDisabledReason: 'Coming soon',
          showWallet: false,
        }}
        appearance={{ theme: 'default' }}
        background={null}
      />,
    ));

    expect(container.querySelector('[data-testid="auth-topbar"]')?.textContent).toBe('Nimi');
    expect(container.querySelector('h1')?.textContent).toBe('Sign in or create an account');
    expect(container.querySelector('.nimi-shell-auth-subtitle')).toBeNull();

    const alternatives = container.querySelector<HTMLButtonElement>('button[aria-label="Auth.alternative"]');
    act(() => alternatives?.click());

    const google = container.querySelector<HTMLButtonElement>('button[aria-label="Google unavailable: Coming soon"]');
    const tiktok = container.querySelector<HTMLButtonElement>('button[aria-label="TikTok unavailable: Coming soon"]');
    const wallet = container.querySelector<HTMLButtonElement>('button[aria-label="Auth.web3"]');
    expect(google?.disabled).toBe(true);
    expect(tiktok?.disabled).toBe(true);
    expect(wallet).toBeNull();
    expect(container.textContent).toContain('Google');
    expect(container.textContent).toContain('TikTok');
    expect(container.textContent).toContain('Coming soon');

    act(() => root.unmount());
    container.remove();
  });

  it('steps back from the password stage via the capsule left back button without rendering a standalone header back button', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const adapter = authAdapter();
    adapter.checkEmail.mockResolvedValue({
      exists: true,
      hasPassword: true,
      emailVerified: true,
    });

    try {
      act(() => root.render(
        <WebAccountAuthPage
          initialStage="email"
          adapter={adapter}
          session={{ mode: 'embedded' }}
          branding={{ networkLabel: 'Nimi', logo: '/logo.png' }}
          copy={{ title: 'Sign in or create an account' }}
          appearance={{ theme: 'default' }}
          background={null}
          testIds={{ logoTrigger: 'logo-control', emailInput: 'email-input', passwordInput: 'pw-input' }}
        />,
      ));

      const emailInput = container.querySelector<HTMLInputElement>('[data-testid="email-input"]')!;
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      act(() => {
        valueSetter.call(emailInput, 'halliday@nimi.ai');
        emailInput.dispatchEvent(new Event('input', { bubbles: true }));
      });

      const form = container.querySelector('form')!;
      await act(async () => {
        form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await Promise.resolve();
      });

      expect(container.querySelector('[data-testid="pw-input"]')).not.toBeNull();
      expect(container.querySelector('[data-testid="logo-control"]')?.tagName).toBe('DIV');

      const backButton = container.querySelector<HTMLButtonElement>('.nimi-shell-auth-main-capsule button[aria-label="Back"]');
      expect(backButton).not.toBeNull();

      act(() => {
        backButton?.click();
      });

      const restoredEmail = container.querySelector<HTMLInputElement>('[data-testid="email-input"]');
      expect(restoredEmail).not.toBeNull();
      expect(restoredEmail?.value).toBe('halliday@nimi.ai');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('keeps the OTP confirmation card in normal flow when an inline login error is shown', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const adapter = authAdapter();
    adapter.checkEmail.mockResolvedValue({
      entryRoute: 'login_with_password',
    });
    adapter.passwordLogin.mockRejectedValue(new Error('invalid email or password'));

    try {
      act(() => root.render(
        <WebAccountAuthPage
          initialStage="email"
          adapter={adapter}
          session={{ mode: 'embedded' }}
          branding={{ networkLabel: 'Nimi', logo: '/logo.png' }}
          appearance={{ theme: 'default' }}
          background={null}
          testIds={{ emailInput: 'email-input', passwordInput: 'pw-input', otpButton: 'otp-button' }}
        />,
      ));

      const emailInput = container.querySelector<HTMLInputElement>('[data-testid="email-input"]')!;
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      act(() => {
        valueSetter.call(emailInput, 'halliday@nimi.ai');
        emailInput.dispatchEvent(new Event('input', { bubbles: true }));
      });

      await act(async () => {
        container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await Promise.resolve();
      });

      const pwInput = container.querySelector<HTMLInputElement>('[data-testid="pw-input"]')!;
      act(() => {
        valueSetter.call(pwInput, 'wrong-password');
        pwInput.dispatchEvent(new Event('input', { bubbles: true }));
      });

      await act(async () => {
        container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await Promise.resolve();
      });

      const otpTrigger = container.querySelector<HTMLButtonElement>('[data-testid="otp-button"]')!;
      act(() => otpTrigger.click());

      const cancelButton = [...container.querySelectorAll('button')].find(button => button.textContent === 'Auth.cancel');
      const otpConfirmCard = cancelButton?.closest('div.mt-3');
      expect(otpConfirmCard).not.toBeNull();
      expect(otpConfirmCard?.classList.contains('absolute')).toBe(false);
      expect(container.textContent).toContain('邮箱或密码错误，请检查后重试。');
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('keeps the alternatives panel in normal flow and dismisses registration confirmation when opened', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const adapter = authAdapter();
    adapter.checkEmail.mockResolvedValue({
      entryRoute: 'register_with_otp',
    });

    try {
      act(() => root.render(
        <WebAccountAuthPage
          initialStage="email"
          adapter={adapter}
          session={{ mode: 'embedded' }}
          branding={{ networkLabel: 'Nimi', logo: '/logo.png' }}
          appearance={{ theme: 'default' }}
          background={null}
          testIds={{ emailInput: 'email-input', alternativeToggle: 'alt-toggle', alternativePanel: 'alt-panel' }}
        />,
      ));

      const emailInput = container.querySelector<HTMLInputElement>('[data-testid="email-input"]')!;
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      act(() => {
        valueSetter.call(emailInput, 'new-user@nimi.ai');
        emailInput.dispatchEvent(new Event('input', { bubbles: true }));
      });

      await act(async () => {
        container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await Promise.resolve();
      });

      const registerButton = () => [...container.querySelectorAll('button')].find(button => button.textContent === 'Auth.confirmRegister');
      expect(registerButton()?.closest('[hidden]')).toBeNull();

      const altToggle = container.querySelector<HTMLButtonElement>('[data-testid="alt-toggle"]')!;
      act(() => altToggle.click());

      const altPanel = container.querySelector<HTMLDivElement>('[data-testid="alt-panel"]');
      expect(altPanel).not.toBeNull();
      expect(altPanel?.hidden).toBe(false);
      expect(altPanel?.classList.contains('absolute')).toBe(false);
      expect(registerButton()?.closest('[hidden]')).not.toBeNull();
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });

  it('blocks email and alternative sign-in until the consent checkbox is checked, then preserves consent across stages', async () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const adapter = authAdapter();
    adapter.checkEmail.mockResolvedValue({
      exists: true,
      hasPassword: true,
      emailVerified: true,
    });

    function ControlledConsentAuth() {
      const [checked, setChecked] = useState(false);
      return (
        <WebAccountAuthPage
          initialStage="email"
          adapter={adapter}
          session={{ mode: 'embedded' }}
          branding={{ networkLabel: 'Nimi', logo: '/logo.png' }}
          alternatives={{ showWallet: true }}
          consent={{
            checked,
            onChange: setChecked,
            lang: 'zh',
            requiredMessage: '请先阅读并同意《服务条款》和《隐私政策》',
            label: (inputId) => (
              <>
                <label htmlFor={inputId}>我已阅读并同意</label>
                <a href="/terms.html">《服务条款》</a>
                <label htmlFor={inputId}>和</label>
                <a href="/privacy.html">《隐私政策》</a>
              </>
            ),
          }}
          appearance={{ theme: 'default' }}
          background={null}
          testIds={{
            emailInput: 'email-input',
            alternativeToggle: 'alt-toggle',
            consentCheckbox: 'consent-checkbox',
            passwordInput: 'pw-input',
          }}
        />
      );
    }

    try {
      act(() => root.render(<ControlledConsentAuth />));

      const checkbox = () => container.querySelector<HTMLInputElement>('[data-testid="consent-checkbox"]');
      expect(checkbox()?.checked).toBe(false);

      const emailInput = container.querySelector<HTMLInputElement>('[data-testid="email-input"]')!;
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
      act(() => {
        valueSetter.call(emailInput, 'halliday@nimi.ai');
        emailInput.dispatchEvent(new Event('input', { bubbles: true }));
      });

      await act(async () => {
        container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await Promise.resolve();
      });

      expect(adapter.checkEmail).not.toHaveBeenCalled();
      expect(container.querySelector('[role="alert"]')?.textContent).toBe('请先阅读并同意《服务条款》和《隐私政策》');
      expect(checkbox()?.getAttribute('aria-invalid')).toBe('true');
      expect(document.activeElement).toBe(checkbox());

      // Alternative sign-in (wallet) is also gated before consent is checked.
      act(() => container.querySelector<HTMLButtonElement>('[data-testid="alt-toggle"]')?.click());
      act(() => container.querySelector<HTMLButtonElement>('button[aria-label="Auth.web3"]')?.click());
      expect(container.querySelector('[data-testid="email-input"]')).not.toBeNull();
      expect(container.querySelector('[role="alert"]')?.textContent).toBe('请先阅读并同意《服务条款》和《隐私政策》');

      // Checking consent clears the alert and unlocks submission.
      act(() => checkbox()?.click());
      expect(checkbox()?.checked).toBe(true);
      expect(container.querySelector('[role="alert"]')).toBeNull();

      await act(async () => {
        container.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
        await Promise.resolve();
      });

      expect(adapter.checkEmail).toHaveBeenCalledWith('halliday@nimi.ai');
      expect(container.querySelector('[data-testid="pw-input"]')).not.toBeNull();
      expect(checkbox()).toBeNull();

      // Returning to email stage preserves checked state.
      act(() => container.querySelector<HTMLButtonElement>('.nimi-shell-auth-main-capsule button[aria-label="Back"]')?.click());
      expect(checkbox()?.checked).toBe(true);
    } finally {
      act(() => root.unmount());
      container.remove();
    }
  });
});
