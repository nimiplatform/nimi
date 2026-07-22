import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';

const shellAuthPageSpy = vi.fn();

vi.mock('../src/components/shell-auth-page.js', () => ({
  ShellAuthPage: (props: unknown) => {
    shellAuthPageSpy(props);
    return null;
  },
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (_key: string, fallback?: string) => fallback || '',
  }),
}));

import { DesktopShellAuthPage } from '../src/components/desktop-shell-auth-page';

describe('DesktopShellAuthPage', () => {
  it('keeps the desktop auth shell pointer-interactive', () => {
    shellAuthPageSpy.mockClear();

    renderToStaticMarkup(
      <DesktopShellAuthPage
        adapter={{
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
        }}
        session={{
          mode: 'desktop-browser',
          authStatus: 'unauthenticated',
        }}
      />,
    );

    const props = shellAuthPageSpy.mock.calls[0]?.[0] as {
      appearance?: { shellClassName?: string };
    };

    expect(props.appearance?.shellClassName).toContain('justify-center');
    expect(props.appearance?.shellClassName).not.toContain('pointer-events-none');
  });

  it('lets host shells provide the current Nimi logo asset', () => {
    shellAuthPageSpy.mockClear();
    const onActionableReady = vi.fn();
    const onEntryAction = vi.fn();

    renderToStaticMarkup(
      <DesktopShellAuthPage
        adapter={{
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
        }}
        logo="/current-nimi-logo.png"
        logoAltText="Current Nimi logo"
        onActionableReady={onActionableReady}
        onEntryAction={onEntryAction}
        semanticIds={{ entryAction: 'desktop-login-primary' }}
        session={{
          mode: 'embedded',
          authStatus: 'unauthenticated',
        }}
      />,
    );

    const props = shellAuthPageSpy.mock.calls[0]?.[0] as {
      branding?: { logo?: unknown; logoAltText?: string };
      onActionableReady?: () => void;
      onEntryAction?: () => void;
      semanticIds?: { entryAction?: string };
    };

    expect(props.branding?.logo).toBe('/current-nimi-logo.png');
    expect(props.branding?.logoAltText).toBe('Current Nimi logo');
    expect(props.onActionableReady).toBe(onActionableReady);
    expect(props.onEntryAction).toBe(onEntryAction);
    expect(props.semanticIds?.entryAction).toBe('desktop-login-primary');
  });

  it('keeps scoped theme routing enabled', () => {
    const shellAuthPageSource = readFileSync(
      path.join(process.cwd(), 'auth/src/components/shell-auth-page.tsx'),
      'utf8',
    );

    expect(shellAuthPageSource).toContain('data-shell-auth-theme={appearance.theme}');
  });

  it('keeps the desktop scoped palette on canonical ambient mesh tokens', () => {
    const shellAuthThemeSource = readFileSync(
      path.join(process.cwd(), 'auth/src/theme/auth-theme.css'),
      'utf8',
    );

    expect(shellAuthThemeSource).toContain(".nimi-shell-auth-root[data-shell-auth-theme='desktop']");
    expect(shellAuthThemeSource).toContain('var(--nimi-ambient-mesh-base-start)');
    expect(shellAuthThemeSource).not.toMatch(/relay-dark/u);
  });
});
