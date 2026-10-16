import { act, StrictMode } from 'react';
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
});
