import { afterEach, describe, expect, it, vi } from 'vitest';

import { getRuntimeDefaults, parseRuntimeDefaults } from '../shell/renderer/src/bridge/index.js';

const VALID_RUNTIME_DEFAULTS = {
  realm: {
    realmBaseUrl: 'https://realm.example.com',
    realtimeUrl: '',
    accessToken: '',
    jwksUrl: 'https://realm.example.com/api/auth/jwks',
    revocationUrl: 'https://realm.example.com/api/auth/sessions/introspect',
    jwtIssuer: 'https://realm.example.com',
    jwtAudience: 'nimi-runtime',
  },
  runtime: {
    targetType: '',
    targetAccountId: '',
    agentId: '',
    worldId: '',
    userConfirmedUpload: false,
  },
};

describe('parseRuntimeDefaults', () => {
  it('accepts split payloads and empty local bindings', () => {
    const parsed = parseRuntimeDefaults(VALID_RUNTIME_DEFAULTS);
    expect(parsed.realm.revocationUrl).toBe('https://realm.example.com/api/auth/sessions/introspect');
    expect(parsed.runtime.targetType).toBe('');
    expect(parsed.runtime.userConfirmedUpload).toBe(false);
  });

  it('fails closed on empty required realm fields', () => {
    expect(() =>
      parseRuntimeDefaults({
        ...VALID_RUNTIME_DEFAULTS,
        realm: {
          ...VALID_RUNTIME_DEFAULTS.realm,
          revocationUrl: '',
        },
      }),
    ).toThrow(/realm\.revocationUrl/);
  });

  it('rejects legacy flat payloads', () => {
    expect(() =>
      parseRuntimeDefaults({
        realmBaseUrl: 'https://realm.example.com',
        realtimeUrl: '',
        accessToken: '',
      }),
    ).toThrow(/runtime_defaults realm payload is invalid/);
  });
});

describe('getRuntimeDefaults', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    window.history.replaceState(null, '', '/');
  });

  it('uses the browser origin as the web shell Realm fallback outside Tauri', async () => {
    vi.stubEnv('VITE_NIMI_SHELL_MODE', 'web');
    window.history.replaceState(null, '', '/app');
    const origin = window.location.origin;

    const defaults = await getRuntimeDefaults();

    expect(defaults.realm.realmBaseUrl).toBe(origin);
    expect(defaults.realm.jwksUrl).toBe(`${origin}/api/auth/jwks`);
    expect(defaults.realm.revocationUrl).toBe(
      `${origin}/api/auth/sessions/introspect`,
    );
    expect(defaults.realm.jwtIssuer).toBe(origin);
  });
});
