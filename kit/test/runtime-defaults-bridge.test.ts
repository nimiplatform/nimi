import { afterEach, describe, expect, it } from 'vitest';
import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';

import {
  getRuntimeDefaults,
  parseOptionalJsonObject,
  parseOptionalNumber,
  parseOptionalString,
  parseRequiredString,
  parseRuntimeDefaults,
} from '../shell/renderer/src/bridge/index.js';

type TestGlobal = typeof globalThis & {
  __NIMI_TAURI_TEST__?: {
    invoke?: (command: string, payload?: unknown) => Promise<unknown>;
  };
};

const testGlobal = globalThis as TestGlobal;

const VALID_RUNTIME_DEFAULTS = {
  realm: {
    realmBaseUrl: 'https://realm.example.com',
    realtimeUrl: '',
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
    const parsed = parseRuntimeDefaults({
      ...VALID_RUNTIME_DEFAULTS,
      realm: {
        ...VALID_RUNTIME_DEFAULTS.realm,
        accessToken: 'forged-renderer-token',
      },
    });
    expect(parsed.realm.revocationUrl).toBe('https://realm.example.com/api/auth/sessions/introspect');
    expect(parsed.realm).not.toHaveProperty('accessToken');
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
    ).toThrow(/runtimeDefaults\.get realm payload is invalid/);
  });
});

describe('shell bridge JSON helpers', () => {
  it('projects reusable shell JSON records and scalar fields', () => {
    expect(parseOptionalJsonObject({ ok: true })?.ok).toBe(true);
    expect(parseOptionalJsonObject(null)).toBeUndefined();
    expect(parseOptionalJsonObject([])).toBeUndefined();
    expect(parseOptionalString(' value ')).toBe('value');
    expect(parseOptionalString('')).toBeUndefined();
    expect(parseOptionalNumber('12')).toBe(12);
    expect(parseOptionalNumber('not-a-number')).toBeUndefined();
    expect(parseRequiredString('abc', 'field', 'shell')).toBe('abc');
    expect(() => parseRequiredString('', 'field', 'shell')).toThrow(/shell: field is required/);
  });
});

describe('getRuntimeDefaults', () => {
  afterEach(() => {
    delete testGlobal.__NIMI_TAURI_TEST__;
  });

  it('fails closed outside a standard shell host', async () => {
    await expect(getRuntimeDefaults()).rejects.toMatchObject({
      code: 'capability-unavailable',
      reasonCode: 'renderer-standard-shell-host-unavailable',
    });
  });

  it('loads defaults through the standard runtime-defaults capability command', async () => {
    const calls: Array<{ command: string; payload: unknown }> = [];
    testGlobal.__NIMI_TAURI_TEST__ = {
      invoke: async (command, payload) => {
        calls.push({ command, payload });
        return VALID_RUNTIME_DEFAULTS;
      },
    };
    const defaults = await getRuntimeDefaults();

    expect(defaults.realm.realmBaseUrl).toBe('https://realm.example.com');
    expect(calls).toEqual([
      { command: NIMI_STANDARD_SHELL_COMMANDS['runtime-defaults.get'], payload: {} },
    ]);
  });
});
