import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NIMI_STANDARD_SHELL_COMMANDS } from '@nimiplatform/kit/shell/capabilities';
import {
  LOCALE_STORAGE_KEY,
  applyStartupHostLocaleOnce,
  changeLocale,
  getCurrentLocale,
  i18n,
  t,
} from './index.js';

function setNavigatorLanguage(language: string): void {
  Object.defineProperty(window.navigator, 'language', {
    configurable: true,
    value: language,
  });
}

const originalNavigatorLanguage = Object.getOwnPropertyDescriptor(window.navigator, 'language');

beforeEach(async () => {
  window.localStorage.clear();
  document.title = '';
  document.documentElement.lang = '';
  delete (globalThis as { __NIMI_ELECTRON_RUNTIME__?: unknown }).__NIMI_ELECTRON_RUNTIME__;
  delete (globalThis as { __NIMI_ELECTRON_TEST__?: unknown }).__NIMI_ELECTRON_TEST__;
  await changeLocale('en');
  window.localStorage.clear();
  document.title = '';
});

afterEach(async () => {
  delete (globalThis as { __NIMI_ELECTRON_RUNTIME__?: unknown }).__NIMI_ELECTRON_RUNTIME__;
  delete (globalThis as { __NIMI_ELECTRON_TEST__?: unknown }).__NIMI_ELECTRON_TEST__;
  if (originalNavigatorLanguage) {
    Object.defineProperty(window.navigator, 'language', originalNavigatorLanguage);
  }
  await changeLocale('en');
  window.localStorage.clear();
  vi.restoreAllMocks();
});

describe('Avatar read-once startup Host locale adoption (W0-01 / FIX-017)', () => {
  it('keeps synchronous i18n initialization ready before async host locale check', () => {
    expect(i18n.isInitialized).toBe(true);
    expect(t('Avatar.shell.document_title')).toBe('Nimi Avatar');
  });

  it('resolves EN Home on zh-CN navigator to en without persisting to localStorage', async () => {
    setNavigatorLanguage('zh-CN');
    await i18n.changeLanguage('zh');
    document.documentElement.lang = 'zh-CN';
    const setItemSpy = vi.spyOn(window.localStorage, 'setItem');
    const getLocale = vi.fn(async () => 'en');

    const resolved = await applyStartupHostLocaleOnce({ getLocale });

    expect(resolved).toBe('en');
    expect(getCurrentLocale()).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    expect(document.title).toBe('Nimi Avatar');
    expect(t('Avatar.degraded.degraded_launch_context_invalid.title')).toBe('Open the avatar from Nimi Home');
    expect(getLocale).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull();
    expect(setItemSpy).not.toHaveBeenCalled();
  });

  it('resolves ZH Home on en-US navigator to zh without persisting to localStorage', async () => {
    setNavigatorLanguage('en-US');
    const setItemSpy = vi.spyOn(window.localStorage, 'setItem');
    const getLocale = vi.fn(async () => ({ locale: 'zh' }));

    const resolved = await applyStartupHostLocaleOnce({ getLocale });

    expect(resolved).toBe('zh');
    expect(getCurrentLocale()).toBe('zh');
    expect(document.documentElement.lang).toBe('zh-CN');
    expect(document.title).toBe('Nimi Avatar');
    expect(t('Avatar.degraded.degraded_launch_context_invalid.title')).toBe('请从 Nimi Home 启动伙伴形象');
    expect(getLocale).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull();
    expect(setItemSpy).not.toHaveBeenCalled();
  });

  it('lets explicit stored override win over Host locale without calling host IPC', async () => {
    setNavigatorLanguage('en-US');
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'zh');
    const getLocaleEn = vi.fn(async () => 'en');

    const resolvedZh = await applyStartupHostLocaleOnce({ getLocale: getLocaleEn });
    expect(resolvedZh).toBe('zh');
    expect(getCurrentLocale()).toBe('zh');
    expect(document.documentElement.lang).toBe('zh-CN');
    expect(document.title).toBe('Nimi Avatar');
    expect(getLocaleEn).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('zh');

    setNavigatorLanguage('zh-CN');
    window.localStorage.setItem(LOCALE_STORAGE_KEY, 'en');
    const getLocaleZh = vi.fn(async () => 'zh');

    const resolvedEn = await applyStartupHostLocaleOnce({ getLocale: getLocaleZh });
    expect(resolvedEn).toBe('en');
    expect(getCurrentLocale()).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    expect(document.title).toBe('Nimi Avatar');
    expect(getLocaleZh).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('en');
  });

  it('falls back cleanly to navigator language and en fallback when Host locale is null', async () => {
    setNavigatorLanguage('zh-CN');
    const getNullZh = vi.fn(async () => null);

    const resolvedZh = await applyStartupHostLocaleOnce({ getLocale: getNullZh });
    expect(resolvedZh).toBe('zh');
    expect(getCurrentLocale()).toBe('zh');
    expect(document.documentElement.lang).toBe('zh-CN');
    expect(document.title).toBe('Nimi Avatar');
    expect(getNullZh).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull();

    setNavigatorLanguage('fr-FR');
    const getNullFallback = vi.fn(async () => null);

    const resolvedFallback = await applyStartupHostLocaleOnce({ getLocale: getNullFallback });
    expect(resolvedFallback).toBe('en');
    expect(getCurrentLocale()).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    expect(document.title).toBe('Nimi Avatar');
    expect(getNullFallback).toHaveBeenCalledTimes(1);
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull();
  });

  it('uses the default Kit shell-ui.hostLocaleGet bridge and handles non-Electron cleanly', async () => {
    const calls: Array<{ command: string; payload: unknown }> = [];
    (globalThis as { __NIMI_ELECTRON_RUNTIME__?: unknown }).__NIMI_ELECTRON_RUNTIME__ = {
      invoke: async (command: string, payload: unknown) => {
        calls.push({ command, payload });
        return { locale: 'en' };
      },
    };
    setNavigatorLanguage('zh-CN');
    await i18n.changeLanguage('zh');

    const resolved = await applyStartupHostLocaleOnce();
    expect(resolved).toBe('en');
    expect(getCurrentLocale()).toBe('en');
    expect(document.documentElement.lang).toBe('en');
    expect(calls).toEqual([
      { command: NIMI_STANDARD_SHELL_COMMANDS['shell-ui.hostLocaleGet'], payload: {} },
    ]);
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull();

    // Outside Electron, getShellHostLocale() resolves null and falls back to navigator.
    delete (globalThis as { __NIMI_ELECTRON_RUNTIME__?: unknown }).__NIMI_ELECTRON_RUNTIME__;
    setNavigatorLanguage('zh-CN');
    const fallbackResolved = await applyStartupHostLocaleOnce();
    expect(fallbackResolved).toBe('zh');
    expect(getCurrentLocale()).toBe('zh');
    expect(document.documentElement.lang).toBe('zh-CN');
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull();
  });

  it('does not clobber a manual changeLocale that occurs while host locale is still in flight', async () => {
    setNavigatorLanguage('en-US');
    let resolveHost: ((value: unknown) => void) | undefined;
    const pendingHost = new Promise<unknown>((resolve) => {
      resolveHost = resolve;
    });

    const startupPromise = applyStartupHostLocaleOnce({
      getLocale: () => pendingHost,
    });

    await changeLocale('zh');
    resolveHost?.('en');

    const resolved = await startupPromise;
    expect(resolved).toBe('zh');
    expect(getCurrentLocale()).toBe('zh');
    expect(document.documentElement.lang).toBe('zh-CN');
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBe('zh');
  });

  it('fails closed on carrier errors without writing localStorage and main.tsx catches startup read errors cleanly', async () => {
    setNavigatorLanguage('en-US');
    await expect(
      applyStartupHostLocaleOnce({
        getLocale: async () => {
          throw new Error('host locale unavailable');
        },
      }),
    ).rejects.toThrow('host locale unavailable');
    expect(window.localStorage.getItem(LOCALE_STORAGE_KEY)).toBeNull();

    const here = path.dirname(fileURLToPath(import.meta.url));
    const mainSource = readFileSync(path.resolve(here, '../main.tsx'), 'utf8');
    expect(mainSource).toMatch(/import\s+'\.\/i18n\/index\.js';/);
    expect(mainSource).toMatch(/applyStartupHostLocaleOnce\(\)\.catch\(\(\)\s*=>\s*undefined\)/);
    expect(mainSource.indexOf('applyStartupHostLocaleOnce()')).toBeLessThan(
      mainSource.indexOf('root.render(<AvatarThemeRoot />)'),
    );
  });
});
