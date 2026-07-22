import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: string | { defaultValue?: string }) => (
      typeof options === 'string' ? options : options?.defaultValue ?? key
    ),
  }),
}));

import { ShellAuthPage } from '../src/components/shell-auth-page.js';

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
    applyToken: vi.fn(),
  };
}

describe('ShellAuthPage entry action semantics', () => {
  it('fires once at the logo stage and turns the compact logo into an unmarked Back control', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const onActionableReady = vi.fn();
    const onEntryAction = vi.fn();

    act(() => {
      root.render(
        <ShellAuthPage
          adapter={authAdapter()}
          session={{ mode: 'embedded', authStatus: 'unauthenticated' }}
          branding={{ networkLabel: 'Nimi', logo: '/logo.png', logoAltText: 'Nimi Logo' }}
          appearance={{ theme: 'desktop' }}
          onActionableReady={onActionableReady}
          onEntryAction={onEntryAction}
          semanticIds={{ entryAction: 'desktop-login-primary' }}
          testIds={{ logoTrigger: 'logo-control' }}
        />,
      );
    });

    const logoControl = () => container.querySelector<HTMLButtonElement>('[data-testid="logo-control"]');
    expect(onActionableReady).toHaveBeenCalledTimes(1);
    expect(logoControl()?.getAttribute('aria-label')).toBe('Nimi Logo');
    expect(logoControl()?.dataset.nimiSemanticId).toBe('desktop-login-primary');

    act(() => logoControl()?.click());
    expect(onEntryAction).toHaveBeenCalledTimes(1);
    expect(logoControl()?.getAttribute('aria-label')).toBe('Back');
    expect(logoControl()?.hasAttribute('data-nimi-semantic-id')).toBe(false);

    act(() => logoControl()?.click());
    expect(onEntryAction).toHaveBeenCalledTimes(1);
    expect(onActionableReady).toHaveBeenCalledTimes(1);

    act(() => root.unmount());
    container.remove();
  });
});
