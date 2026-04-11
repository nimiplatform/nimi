import { beforeEach, describe, expect, it, vi } from 'vitest';

const invokeCheckedMock = vi.fn();

vi.mock('./index.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./index.js')>();
  return {
    ...actual,
    invokeChecked: (...args: unknown[]) => invokeCheckedMock(...args),
  };
});

import { parseRuntimeDefaults } from './index.js';
import { sqliteGetSession } from './sqlite-bridge.js';

const VALID_RUNTIME_DEFAULTS = {
  realm: {
    realmBaseUrl: 'https://realm.example.com',
    realtimeUrl: '',
    accessToken: '',
    jwksUrl: 'https://realm.example.com/api/auth/jwks',
    revocationUrl: '',
    jwtIssuer: 'https://realm.example.com',
    jwtAudience: 'nimi-runtime',
  },
  runtime: {
    localProviderEndpoint: '',
    localProviderModel: '',
    localOpenAiEndpoint: '',
    credentialRefId: '',
    targetType: '',
    targetAccountId: '',
    agentId: '',
    worldId: '',
    provider: '',
    userConfirmedUpload: false,
  },
};

describe('runtime defaults bridge', () => {
  it('fails closed on missing required runtime defaults fields', () => {
    expect(() =>
      parseRuntimeDefaults({
        ...VALID_RUNTIME_DEFAULTS,
        realm: {
          ...VALID_RUNTIME_DEFAULTS.realm,
          realmBaseUrl: '',
        },
      }),
    ).toThrow(/realmBaseUrl/);
  });

});

describe('sqlite bridge strict parsing', () => {
  beforeEach(() => {
    invokeCheckedMock.mockReset();
  });

  it('throws when session payload is missing required fields', async () => {
    invokeCheckedMock.mockImplementationOnce(
      async (_command: string, _payload: unknown, parseResult: (value: unknown) => unknown) =>
        parseResult({
          id: 'session-1',
          learnerId: 'learner-1',
          learnerProfileVersion: 1,
          worldId: 'world-1',
          agentId: 'agent-1',
          contentType: 'history',
          truthMode: 'factual',
          sessionStatus: 'active',
          chapterIndex: 1,
          rhythmCounter: 0,
          trunkEventIndex: 0,
          startedAt: '2026-04-01T00:00:00.000Z',
          updatedAt: '2026-04-01T00:00:00.000Z',
          completedAt: null,
        }),
    );

    await expect(sqliteGetSession('session-1')).rejects.toThrow(/sceneType/);
  });
});
