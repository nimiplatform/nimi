import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/logic/social-oauth.js', () => ({
  resolveProviderLabel: () => 'TikTok',
  startSocialOauth: vi.fn(async () => ({
    provider: 'TIKTOK',
    code: 'provider-code',
    codeVerifier: 'pkce-verifier',
    redirectUri: 'https://web.nimi.test/account/oauth/callback',
  })),
}));

import { createNimiError, ReasonCode } from '@nimiplatform/kit/core/sdk-contract';
import {
  handleSocialOAuthLogin,
  type OAuthLoginInput,
} from '../src/index.js';

function createInput(overrides: Partial<OAuthLoginInput> = {}): OAuthLoginInput {
  return {
    provider: 'TIKTOK',
    bridge: {} as OAuthLoginInput['bridge'],
    oauthLogin: vi.fn(async () => ({ loginState: 'ok' })),
    completeBrowserSessionLogin: vi.fn(async () => ({ id: 'current-user' })),
    onSuccess: vi.fn(),
    onError: vi.fn(),
    ...overrides,
  };
}

describe('handleSocialOAuthLogin browser-session completion', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('signals success once without a bearer payload after current-user refresh', async () => {
    const input = createInput();

    await handleSocialOAuthLogin(input);

    expect(input.completeBrowserSessionLogin).toHaveBeenCalledTimes(1);
    expect(input.onSuccess).toHaveBeenCalledTimes(1);
    expect(vi.mocked(input.onSuccess).mock.calls[0]).toEqual([]);
    expect(input.onError).not.toHaveBeenCalled();
    expect(vi.mocked(input.completeBrowserSessionLogin).mock.invocationCallOrder[0])
      .toBeLessThan(vi.mocked(input.onSuccess).mock.invocationCallOrder[0]!);
  });

  it('fails closed on an access-token response without refreshing or succeeding', async () => {
    const input = createInput({
      oauthLogin: vi.fn(async () => ({
        loginState: 'ok',
        tokens: {
          accessToken: 'raw-access-secret',
          expiresIn: 3600,
          tokenType: 'Bearer',
        },
      })),
    });

    await handleSocialOAuthLogin(input);

    expect(input.completeBrowserSessionLogin).not.toHaveBeenCalled();
    expect(input.onSuccess).not.toHaveBeenCalled();
    expect(input.onError).toHaveBeenCalledTimes(1);
    expect(vi.mocked(input.onError).mock.calls[0]?.[0]).not.toContain('raw-access-secret');
  });

  it('fails closed when token mode contains only a refresh token', async () => {
    const input = createInput({
      oauthLogin: vi.fn(async () => ({
        loginState: 'ok',
        tokens: { refreshToken: 'raw-refresh-secret' },
      })),
    });

    await handleSocialOAuthLogin(input);

    expect(input.completeBrowserSessionLogin).not.toHaveBeenCalled();
    expect(input.onSuccess).not.toHaveBeenCalled();
    expect(input.onError).toHaveBeenCalledTimes(1);
    expect(vi.mocked(input.onError).mock.calls[0]?.[0]).not.toContain('raw-refresh-secret');
  });

  it('rejects a malformed login response without pseudo-success', async () => {
    const input = createInput({ oauthLogin: vi.fn(async () => ({})) });

    await handleSocialOAuthLogin(input);

    expect(input.completeBrowserSessionLogin).not.toHaveBeenCalled();
    expect(input.onSuccess).not.toHaveBeenCalled();
    expect(input.onError).toHaveBeenCalledTimes(1);
  });

  it('rejects an unconfirmed current-session projection without pseudo-success', async () => {
    const input = createInput({ completeBrowserSessionLogin: vi.fn(async () => null) });

    await handleSocialOAuthLogin(input);

    expect(input.completeBrowserSessionLogin).toHaveBeenCalledTimes(1);
    expect(input.onSuccess).not.toHaveBeenCalled();
    expect(input.onError).toHaveBeenCalledTimes(1);
  });

  it('preserves typed client failure mapping without exposing attached credentials', async () => {
    const failure = Object.assign(createNimiError({
      message: 'Realm provider request failed',
      reasonCode: ReasonCode.AUTH_DENIED,
      actionHint: 'retry_provider_login',
      source: 'sdk',
    }), {
      accessToken: 'attached-access-secret',
      refreshToken: 'attached-refresh-secret',
    });
    const input = createInput({ oauthLogin: vi.fn(async () => { throw failure; }) });

    await handleSocialOAuthLogin(input);

    expect(input.onSuccess).not.toHaveBeenCalled();
    expect(input.onError).toHaveBeenCalledWith('Authentication failed. Please try again.');
    expect(vi.mocked(input.onError).mock.calls[0]?.[0]).not.toContain('attached-access-secret');
    expect(vi.mocked(input.onError).mock.calls[0]?.[0]).not.toContain('attached-refresh-secret');
  });
});
