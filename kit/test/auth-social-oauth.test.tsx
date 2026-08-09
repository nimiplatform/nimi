import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { NIMI_REALM_OAUTH_PROVIDER } from '@nimiplatform/kit/core/sdk-contract';
import {
  AuthViewMain,
  resolveSocialOauthConfig,
  startSocialOauth,
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
    expect(toOauthProvider('TIKTOK')).toBe(NIMI_REALM_OAUTH_PROVIDER.TIKTOK);
  });

  it('is disabled with an explicit reason when client id is missing', () => {
    const previousClientId = process.env.VITE_NIMI_TIKTOK_CLIENT_ID;
    delete process.env.VITE_NIMI_TIKTOK_CLIENT_ID;
    try {
      const config = resolveSocialOauthConfig('TIKTOK', desktopOAuthBridge);
      expect(config.enabled).toBe(false);
      expect(config.disabledReason).toMatch(/Missing TIKTOK OAuth client ID/);
    } finally {
      process.env.VITE_NIMI_TIKTOK_CLIENT_ID = previousClientId;
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

  it('returns the TikTok authorization proof for Realm without a shell token exchange', async () => {
    const previousClientId = process.env.VITE_NIMI_TIKTOK_CLIENT_ID;
    process.env.VITE_NIMI_TIKTOK_CLIENT_ID = 'tiktok-client-id';
    const oauthTokenExchange = vi.fn(async () => ({ accessToken: 'unexpected', raw: {} }));
    let resolveCallback: ((value: {
      callbackUrl: string;
      code: string;
      state: string;
    }) => void) | undefined;
    try {
      const bridge = {
        hasShellHostInvoke: () => true,
        oauthListenForCode: async () => new Promise((resolve) => {
          resolveCallback = resolve;
        }),
        oauthTokenExchange,
        openExternalUrl: async (value) => {
          const authorizeUrl = new URL(value);
          const redirectUri = authorizeUrl.searchParams.get('redirect_uri') || '';
          const state = authorizeUrl.searchParams.get('state') || '';
          resolveCallback?.({
            callbackUrl: `${redirectUri}?code=authorization-code&state=${encodeURIComponent(state)}`,
            code: 'authorization-code',
            state,
          });
          return { opened: true };
        },
        focusMainWindow: async () => undefined,
      };
      const result = await startSocialOauth('TIKTOK', bridge);

      expect(result).toMatchObject({
        provider: NIMI_REALM_OAUTH_PROVIDER.TIKTOK,
        code: 'authorization-code',
      });
      expect(result.redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:/);
      expect(result.codeVerifier).not.toBe('');
      expect(oauthTokenExchange).not.toHaveBeenCalled();
    } finally {
      process.env.VITE_NIMI_TIKTOK_CLIENT_ID = previousClientId;
    }
  });
});

describe('AuthViewMain alternatives', () => {
  it('renders google, tiktok, and web3 entry points', () => {
    const markup = renderToStaticMarkup(
      <AuthViewMain
        email=""
        pending={false}
        showAlternatives
        googleDisabledReason="missing google"
        tikTokDisabledReason="missing tiktok"
        onEmailChange={() => undefined}
        onContinue={() => undefined}
        onAlternativeToggle={() => undefined}
        onGoogleLogin={() => undefined}
        onTikTokLogin={() => undefined}
        onWeb3Login={() => undefined}
      />,
    );

    expect(markup).toContain('aria-label="Google unavailable: missing google"');
    expect(markup).toContain('aria-label="TikTok unavailable: missing tiktok"');
    expect(markup).not.toContain('Twitter');
    expect(markup).toContain('aria-label="Auth.web3"');
  });
});
