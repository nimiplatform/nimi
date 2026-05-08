/** @vitest-environment jsdom */
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
import { hasParentPin, setParentPin, verifyParentPin } from './parent-pin.js';
import { sqliteGetSession } from './sqlite-bridge.js';

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

    expect(() =>
      parseRuntimeDefaults({
        ...VALID_RUNTIME_DEFAULTS,
        realm: {
          ...VALID_RUNTIME_DEFAULTS.realm,
          revocationUrl: '',
        },
      }),
    ).toThrow(/revocationUrl/);
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

describe('parent PIN bridge', () => {
  beforeEach(() => {
    invokeCheckedMock.mockReset();
    localStorage.clear();
  });

  it('uses Tauri commands instead of renderer-readable localStorage', async () => {
    invokeCheckedMock
      .mockImplementationOnce(async (_command: string, _payload: unknown, parseResult: (value: unknown) => unknown) =>
        parseResult(true),
      )
      .mockImplementationOnce(async () => undefined)
      .mockImplementationOnce(async (_command: string, _payload: unknown, parseResult: (value: unknown) => unknown) =>
        parseResult(false),
      );

    await expect(hasParentPin()).resolves.toBe(true);
    await expect(setParentPin('1234')).resolves.toBeUndefined();
    await expect(verifyParentPin('9999')).resolves.toBe(false);

    expect(invokeCheckedMock).toHaveBeenNthCalledWith(1, 'parent_pin_exists', {}, expect.any(Function));
    expect(invokeCheckedMock).toHaveBeenNthCalledWith(2, 'parent_pin_set', { pin: '1234' }, expect.any(Function));
    expect(invokeCheckedMock).toHaveBeenNthCalledWith(3, 'parent_pin_verify', { pin: '9999' }, expect.any(Function));
    expect(localStorage.length).toBe(0);
  });

  it('fails closed on malformed Tauri responses', async () => {
    invokeCheckedMock.mockImplementationOnce(
      async (_command: string, _payload: unknown, parseResult: (value: unknown) => unknown) =>
        parseResult('yes'),
    );

    await expect(hasParentPin()).rejects.toThrow(/expected boolean/);
  });
});
