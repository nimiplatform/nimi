import { describe, expect, it } from 'vitest';

import { parseRuntimeDefaults } from '../shell/renderer/src/bridge/index.js';

const VALID_RUNTIME_DEFAULTS = {
  realm: {
    realmBaseUrl: 'https://realm.example.com',
    realtimeUrl: '',
    accessToken: '',
    jwksUrl: 'https://realm.example.com/api/auth/jwks',
    revocationUrl: 'https://realm.example.com/api/auth/revocation',
    jwtIssuer: 'https://realm.example.com',
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
};

describe('parseRuntimeDefaults', () => {
  it('accepts split payloads and empty local bindings', () => {
    const parsed = parseRuntimeDefaults(VALID_RUNTIME_DEFAULTS);
    expect(parsed.realm.revocationUrl).toBe('https://realm.example.com/api/auth/revocation');
    expect(parsed.runtime.connectorId).toBe('');
    expect(parsed.runtime.localProviderEndpoint).toBe('');
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
