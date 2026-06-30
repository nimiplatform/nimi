import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { NIMI_REALM_OAUTH_PROVIDER } from '@nimiplatform/kit/core/sdk-contract';
import {
  AuthViewMain,
  resolveSocialOauthConfig,
  toOauthProvider,
} from '@nimiplatform/kit/auth';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback || key,
  }),
}));

const desktopOAuthBridge = {
  hasShellHostInvoke: () => true,
  oauthListenForCode: async () => ({ callbackUrl: '' }),
  oauthTokenExchange: async () => ({ accessToken: '', raw: {} }),
  openExternalUrl: async () => ({ opened: true }),
  focusMainWindow: async () => undefined,
};

describe('social OAuth config', () => {
  it('maps provider enum values correctly', () => {
    expect(toOauthProvider('TWITTER')).toBe(NIMI_REALM_OAUTH_PROVIDER.TWITTER);
    expect(toOauthProvider('TIKTOK')).toBe(NIMI_REALM_OAUTH_PROVIDER.TIKTOK);
  });

  it('is disabled with an explicit reason when client id is missing', () => {
    const previousClientId = process.env.VITE_NIMI_TWITTER_CLIENT_ID;
    delete process.env.VITE_NIMI_TWITTER_CLIENT_ID;
    try {
      const config = resolveSocialOauthConfig('TWITTER', desktopOAuthBridge);
      expect(config.enabled).toBe(false);
      expect(config.disabledReason).toMatch(/Missing TWITTER OAuth client ID/);
    } finally {
      process.env.VITE_NIMI_TWITTER_CLIENT_ID = previousClientId;
    }
  });

  it('is enabled when Tauri invoke and env config are present', () => {
    const previousClientId = process.env.VITE_NIMI_TIKTOK_CLIENT_ID;
    const previousScope = process.env.VITE_NIMI_TIKTOK_SCOPE;
    process.env.VITE_NIMI_TIKTOK_CLIENT_ID = 'tiktok-client-id';
    process.env.VITE_NIMI_TIKTOK_SCOPE = 'user.info.basic';
    try {
      const config = resolveSocialOauthConfig('TIKTOK', desktopOAuthBridge);
      expect(config.enabled).toBe(true);
      expect(config.clientId).toBe('tiktok-client-id');
    } finally {
      process.env.VITE_NIMI_TIKTOK_CLIENT_ID = previousClientId;
      process.env.VITE_NIMI_TIKTOK_SCOPE = previousScope;
    }
  });
});

describe('AuthViewMain alternatives', () => {
  it('renders google, twitter, tiktok, and web3 entry points', () => {
    const markup = renderToStaticMarkup(
      <AuthViewMain
        email=""
        pending={false}
        showAlternatives
        googleDisabledReason="missing google"
        twitterDisabledReason="missing twitter"
        tikTokDisabledReason="missing tiktok"
        onEmailChange={() => undefined}
        onContinue={() => undefined}
        onAlternativeToggle={() => undefined}
        onGoogleLogin={() => undefined}
        onTwitterLogin={() => undefined}
        onTikTokLogin={() => undefined}
        onWeb3Login={() => undefined}
      />,
    );

    expect(markup).toContain('aria-label="Google unavailable: missing google"');
    expect(markup).toContain('aria-label="Twitter unavailable: missing twitter"');
    expect(markup).toContain('aria-label="TikTok unavailable: missing tiktok"');
    expect(markup).toContain('aria-label="Auth.web3"');
  });
});
