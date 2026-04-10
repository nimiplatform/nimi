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
});
