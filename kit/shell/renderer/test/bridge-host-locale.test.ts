import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NIMI_HOST_LOCALES,
  NimiHostLocaleParseError,
  createNimiClient,
  isNimiHostLocale,
  parseNimiHostLocale,
  parseNimiHostLocaleResult,
  readNimiHostLocale,
  resolveNimiStartupLocale,
} from '@nimiplatform/kit/core/sdk-contract';
import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';
import {
  BridgeError,
  createNimiLocalAppStandardShellSurface,
  getShellHostLocale,
} from '../src/bridge/index.js';

describe('renderer host locale bridge', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    delete (globalThis as { __NIMI_ELECTRON_TEST__?: unknown }).__NIMI_ELECTRON_TEST__;
    delete (globalThis as { __NIMI_ELECTRON_RUNTIME__?: unknown }).__NIMI_ELECTRON_RUNTIME__;
  });

  it('returns null cleanly outside Electron or when invoke hook is absent', async () => {
    await expect(getShellHostLocale()).resolves.toBeNull();

    vi.stubGlobal('__NIMI_ELECTRON_RUNTIME__', {
      listen: () => () => undefined,
    });
    await expect(getShellHostLocale()).resolves.toBeNull();
  });

  it('invokes shell-ui.hostLocaleGet with an empty payload and returns validated locales', async () => {
    const calls: Array<{ command: string; payload: unknown }> = [];
    let response: unknown = { locale: 'en' };
    vi.stubGlobal('__NIMI_ELECTRON_RUNTIME__', {
      invoke: async (command: string, payload: unknown) => {
        calls.push({ command, payload });
        return response;
      },
    });

    await expect(getShellHostLocale()).resolves.toBe('en');

    response = { locale: 'zh' };
    await expect(getShellHostLocale()).resolves.toBe('zh');

    response = { locale: null };
    await expect(getShellHostLocale()).resolves.toBeNull();

    expect(calls).toEqual([
      { command: NIMI_STANDARD_SHELL_COMMANDS['shell-ui.hostLocaleGet'], payload: {} },
      { command: NIMI_STANDARD_SHELL_COMMANDS['shell-ui.hostLocaleGet'], payload: {} },
      { command: NIMI_STANDARD_SHELL_COMMANDS['shell-ui.hostLocaleGet'], payload: {} },
    ]);
  });

  it('fails closed when the host returns malformed locale envelopes', async () => {
    let response: unknown;
    vi.stubGlobal('__NIMI_ELECTRON_RUNTIME__', {
      invoke: async () => response,
    });

    for (const malformed of [
      null,
      undefined,
      'en',
      {},
      { locale: 'fr' },
      { locale: 'EN' },
      { locale: 'en-US' },
      { locale: 'en', path: '/private/host-locale.v1.json' },
    ]) {
      response = malformed;
      await expect(getShellHostLocale()).rejects.toMatchObject({
        name: 'BridgeError',
        code: 'invalid-payload',
        reasonCode: 'renderer-standard-shell-result-invalid',
        source: 'renderer',
      });
    }
  });

  it('propagates structured host bridge errors', async () => {
    vi.stubGlobal('__NIMI_ELECTRON_RUNTIME__', {
      invoke: async () => {
        throw {
          message: 'Host locale unavailable',
          code: 'capability-unavailable',
          reasonCode: 'electron-standard-capability-unavailable',
          actionHint: 'provide_electron_standard_shell_capability_handler',
          source: 'electron',
        };
      },
    });

    await expect(getShellHostLocale()).rejects.toBeInstanceOf(BridgeError);
    await expect(getShellHostLocale()).rejects.toMatchObject({
      code: 'capability-unavailable',
      reasonCode: 'electron-standard-capability-unavailable',
      source: 'electron',
    });
  });

  it('injects host.getLocale into createNimiLocalAppStandardShellSurface and wires cleanly into createNimiClient', async () => {
    const surface = createNimiLocalAppStandardShellSurface();
    expect(surface.host.getLocale).toBe(getShellHostLocale);

    const client = createNimiClient({
      localApp: { standardShell: surface },
    });
    await expect(client.host.getLocale()).resolves.toBeNull();

    vi.stubGlobal('__NIMI_ELECTRON_RUNTIME__', {
      invoke: async (command: string, payload: unknown) => {
        expect(command).toBe(NIMI_STANDARD_SHELL_COMMANDS['shell-ui.hostLocaleGet']);
        expect(payload).toEqual({});
        return { locale: 'en' };
      },
    });
    await expect(client.host.getLocale()).resolves.toBe('en');

    const resolved = resolveNimiStartupLocale({
      supportedLocales: NIMI_HOST_LOCALES,
      storedLocale: null,
      hostLocale: await readNimiHostLocale(surface.host),
      navigatorLanguage: 'zh-CN',
      fallback: 'zh',
    });
    expect(resolved).toBe('en');
    expect(isNimiHostLocale(resolved)).toBe(true);
    expect(parseNimiHostLocale(resolved)).toBe('en');
    expect(parseNimiHostLocaleResult({ locale: resolved })).toEqual({ locale: 'en' });
    expect(() => parseNimiHostLocale('fr')).toThrow(NimiHostLocaleParseError);
  });
});
