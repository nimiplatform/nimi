// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { useAppStore } from '../../app-shell/app-store.js';

const desktopShellAuthPageSpy = vi.fn();

vi.mock('@nimiplatform/nimi-kit/auth', () => ({
  DesktopShellAuthPage: (props: unknown) => {
    desktopShellAuthPageSpy(props);
    return <div data-testid="desktop-shell-auth-page" />;
  },
  buildDesktopWebAuthLaunchUrl: vi.fn(),
  resolveDesktopCallbackRequestFromLocation: vi.fn(() => null),
}));

vi.mock('./parentos-auth-adapter.js', () => ({
  createParentOSDesktopBrowserAuthAdapter: vi.fn(() => ({
    applyToken: vi.fn(),
    loadCurrentUser: vi.fn(),
  })),
}));

vi.mock('../../bridge/index.js', () => ({
  parentosTauriOAuthBridge: {
    hasTauriInvoke: vi.fn(() => true),
    oauthListenForCode: vi.fn(),
    oauthTokenExchange: vi.fn(),
    openExternalUrl: vi.fn(),
    focusMainWindow: vi.fn(),
  },
}));

import { ParentOSLoginPage } from './parentos-login-page.js';

describe('ParentOSLoginPage', () => {
  beforeEach(() => {
    desktopShellAuthPageSpy.mockClear();
    useAppStore.setState({
      runtimeDefaults: {
        webBaseUrl: 'http://localhost:3000',
        realm: {
          realmBaseUrl: 'http://localhost:3002',
          realtimeUrl: '',
          accessToken: '',
          jwksUrl: 'http://localhost:3002/api/auth/jwks',
          revocationUrl: 'http://localhost:3002/api/auth/revocation',
          jwtIssuer: 'http://localhost:3002',
          jwtAudience: 'nimi-runtime',
        },
        runtime: {
          localProviderEndpoint: '',
          localProviderModel: '',
          localOpenAiEndpoint: '',
          connectorId: '',
          targetType: '',
          targetAccountId: '',
          agentId: '',
          worldId: '',
          provider: '',
          userConfirmedUpload: false,
        },
      },
    });
  });

  afterEach(() => {
    useAppStore.setState({ runtimeDefaults: null });
  });

  it('passes the configured web auth base URL into desktop browser auth', () => {
    render(<ParentOSLoginPage />);

    expect(desktopShellAuthPageSpy).toHaveBeenCalledTimes(1);
    const props = desktopShellAuthPageSpy.mock.calls[0]?.[0] as {
      desktopBrowserAuth?: { baseUrl?: string };
    };
    expect(props.desktopBrowserAuth?.baseUrl).toBe('http://localhost:3000');
  });
});
