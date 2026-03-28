import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mocks ──────────────────────────────────────────────────

const mockHasTauriInvoke = vi.fn<() => boolean>();
const mockInvokeChecked = vi.fn();

vi.mock('./env.js', () => ({
  hasTauriInvoke: (...args: unknown[]) => mockHasTauriInvoke(...(args as [])),
}));

vi.mock('./invoke.js', () => ({
  invokeChecked: (...args: unknown[]) => mockInvokeChecked(...args),
}));

const { getRuntimeDefaults } = await import('./runtime-defaults.js');

// ── Helpers ────────────────────────────────────────────────

function stubEnv(env: Record<string, string>) {
  // readEnv reads import.meta.env first, then process.env.
  // In vitest jsdom, import.meta.env is a plain object we can mutate at runtime.
  const metaEnv = (import.meta as { env?: Record<string, string> }).env ?? {};
  Object.keys(metaEnv).forEach((key) => delete metaEnv[key]);
  Object.assign(metaEnv, env);
  vi.stubGlobal('process', { env: { ...env } });
}

function clearEnv() {
  const metaEnv = (import.meta as { env?: Record<string, string> }).env ?? {};
  Object.keys(metaEnv).forEach((key) => delete metaEnv[key]);
  vi.stubGlobal('process', { env: {} });
}

// ── Tests ──────────────────────────────────────────────────

describe('getRuntimeDefaults', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearEnv();
  });

  describe('when Tauri is not available (fallback path)', () => {
    beforeEach(() => {
      mockHasTauriInvoke.mockReturnValue(false);
    });

    it('returns fallback defaults with http://localhost:3002 as realmBaseUrl', async () => {
      const defaults = await getRuntimeDefaults();

      expect(defaults.realm.realmBaseUrl).toBe('http://localhost:3002');
      expect(defaults.realm.jwtAudience).toBe('nimi-runtime');
      expect(defaults.runtime.localProviderEndpoint).toBe('http://127.0.0.1:1234/v1');
      expect(defaults.runtime.targetType).toBe('AGENT');
      expect(defaults.runtime.userConfirmedUpload).toBe(false);

      // invokeChecked should not have been called
      expect(mockInvokeChecked).not.toHaveBeenCalled();
    });

    it('reads NIMI_REALM_URL env override', async () => {
      stubEnv({ NIMI_REALM_URL: 'https://api.example.com' });

      const defaults = await getRuntimeDefaults();

      expect(defaults.realm.realmBaseUrl).toBe('https://api.example.com');
    });

    it('derives jwksUrl from realmBaseUrl by default', async () => {
      const defaults = await getRuntimeDefaults();

      expect(defaults.realm.jwksUrl).toBe('http://localhost:3002/api/auth/jwks');
    });

    it('derives jwksUrl from overridden realmBaseUrl', async () => {
      stubEnv({ NIMI_REALM_URL: 'https://api.example.com' });

      const defaults = await getRuntimeDefaults();

      expect(defaults.realm.jwksUrl).toBe('https://api.example.com/api/auth/jwks');
    });
  });

  describe('when Tauri is available (invoke path)', () => {
    beforeEach(() => {
      mockHasTauriInvoke.mockReturnValue(true);
    });

    it('calls invokeChecked with runtime_defaults command', async () => {
      mockInvokeChecked.mockResolvedValue({
        realm: {
          realmBaseUrl: 'http://localhost:3002',
          realtimeUrl: 'ws://localhost:3003',
          accessToken: 'tauri-token',
          jwksUrl: 'http://localhost:3002/api/auth/jwks',
          jwtIssuer: 'http://localhost:3002',
          jwtAudience: 'nimi-runtime',
        },
        runtime: {
          localProviderEndpoint: 'http://127.0.0.1:1234/v1',
          localProviderModel: 'local-model',
          localOpenAiEndpoint: 'http://127.0.0.1:1234/v1',
          connectorId: '',
          targetType: 'AGENT',
          targetAccountId: '',
          agentId: '',
          worldId: '',
          provider: '',
          userConfirmedUpload: false,
        },
      });

      const defaults = await getRuntimeDefaults();

      expect(mockInvokeChecked).toHaveBeenCalledWith(
        'runtime_defaults',
        {},
        expect.any(Function),
      );
      expect(defaults.realm.accessToken).toBe('');
    });

    it('does not forward env or Tauri access tokens into renderer defaults', async () => {
      mockInvokeChecked.mockResolvedValue({
        realm: {
          realmBaseUrl: 'http://localhost:3002',
          realtimeUrl: '',
          accessToken: 'tauri-token',
          jwksUrl: 'http://localhost:3002/api/auth/jwks',
          jwtIssuer: 'http://localhost:3002',
          jwtAudience: 'nimi-runtime',
        },
        runtime: {
          localProviderEndpoint: 'http://127.0.0.1:1234/v1',
          localProviderModel: 'local-model',
          localOpenAiEndpoint: 'http://127.0.0.1:1234/v1',
          connectorId: '',
          targetType: 'AGENT',
          targetAccountId: '',
          agentId: '',
          worldId: '',
          provider: '',
          userConfirmedUpload: false,
        },
      });

      stubEnv({
        NIMI_REALM_URL: 'https://prod.example.com',
        NIMI_ACCESS_TOKEN: 'env-override-token',
      });

      const defaults = await getRuntimeDefaults();

      expect(defaults.realm.realmBaseUrl).toBe('https://prod.example.com');
      expect(defaults.realm.accessToken).toBe('');
    });
  });
});
