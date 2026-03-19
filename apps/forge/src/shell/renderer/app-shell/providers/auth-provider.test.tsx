import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { AuthProvider } from './auth-provider.js';
import { useAppStore } from './app-store.js';
import { i18n, initI18n } from '@renderer/i18n/index.js';

vi.mock('@renderer/infra/bootstrap/forge-bootstrap.js', () => ({
  runForgeBootstrap: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@runtime/platform-client.js', () => ({
  getPlatformClient: () => ({
    realm: {
      clearAuth: vi.fn(),
    },
  }),
}));

describe('AuthProvider', () => {
  beforeAll(async () => {
    await initI18n('en');
  });

  beforeEach(() => {
    useAppStore.setState((state) => ({
      ...state,
      auth: {
        status: 'unauthenticated',
        user: null,
        token: '',
        refreshToken: '',
      },
      bootstrapReady: true,
      bootstrapError: null,
    }));
  });

  it('renders the shared Forge login page when auth is required', () => {
    render(
      <I18nextProvider i18n={i18n}>
        <AuthProvider>
          <div>secured</div>
        </AuthProvider>
      </I18nextProvider>,
    );

    expect(screen.getByTestId('forge-login-page').getAttribute('data-auth-mode')).toBe('desktop-browser');
    expect(screen.getByText('Sign in to Forge')).toBeTruthy();
    expect(screen.getByText('Click the mark to authorize in your browser.')).toBeTruthy();
  });
});
