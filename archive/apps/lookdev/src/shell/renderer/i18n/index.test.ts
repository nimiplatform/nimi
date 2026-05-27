import { beforeEach, describe, expect, it } from 'vitest';

describe('lookdev i18n', () => {
  beforeEach(async () => {
    localStorage.clear();
    const mod = await import('./index.js');
    await mod.changeLocale('zh');
  });

  it('defaults to zh when no locale is stored', async () => {
    localStorage.clear();
    const mod = await import('./index.js');

    expect(mod.getCurrentLocale()).toBe('zh');
    expect(document.documentElement.lang).toBe('zh-CN');
  });

  it('changes locale and persists selection', async () => {
    const mod = await import('./index.js');

    await mod.changeLocale('en');

    expect(mod.getCurrentLocale()).toBe('en');
    expect(localStorage.getItem(mod.LOCALE_STORAGE_KEY)).toBe('en');
    expect(document.documentElement.lang).toBe('en');
  });

  it('falls back to zh when storage contains an unsupported locale', async () => {
    localStorage.setItem('lookdev.shell.locale', 'jp');
    const mod = await import('./index.js');

    expect(mod.getCurrentLocale()).toBe('zh');
    expect(mod.getLocaleLabel('en')).toBe('English');
    expect(mod.getLocaleLabel('zh')).toBe('简体中文');
  });
});
