import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  NIMI_HOST_LOCALES,
  NimiHostLocaleParseError,
  isNimiHostLocale,
  parseNimiHostLocale,
  parseNimiHostLocaleResult,
  readNimiHostLocale,
  resolveNimiStartupLocale,
  type NimiHostLocale,
  type NimiHostLocaleResult,
  type NimiHostLocaleSource,
} from './index.js';

describe('host locale contract', () => {
  it('admits only canonical host locales in parseNimiHostLocale and isNimiHostLocale', () => {
    assert.deepEqual(NIMI_HOST_LOCALES, ['en', 'zh']);
    for (const locale of NIMI_HOST_LOCALES) {
      assert.equal(isNimiHostLocale(locale), true);
      assert.equal(parseNimiHostLocale(locale), locale);
    }

    for (const invalid of [
      null,
      undefined,
      '',
      ' ',
      'EN',
      'ZH',
      ' en ',
      'en-US',
      'zh-CN',
      'ja',
      'fr',
      0,
      true,
      [],
      { locale: 'en' },
    ]) {
      assert.equal(isNimiHostLocale(invalid), false);
      assert.throws(
        () => parseNimiHostLocale(invalid),
        (error: unknown) => error instanceof NimiHostLocaleParseError && error.reasonCode === 'SDK_HOST_LOCALE_INVALID',
      );
    }
  });

  it('strictly validates host locale result envelopes and freezes outputs', () => {
    const enResult: NimiHostLocaleResult = parseNimiHostLocaleResult({ locale: 'en' });
    const zhResult = parseNimiHostLocaleResult({ locale: 'zh' });
    const nullResult = parseNimiHostLocaleResult({ locale: null });
    const nullProtoResult = parseNimiHostLocaleResult(Object.assign(Object.create(null), { locale: 'en' }));

    assert.deepEqual(enResult, { locale: 'en' });
    assert.deepEqual(zhResult, { locale: 'zh' });
    assert.deepEqual(nullResult, { locale: null });
    assert.deepEqual(nullProtoResult, { locale: 'en' });
    assert.equal(Object.isFrozen(enResult), true);
    assert.equal(Object.isFrozen(nullResult), true);

    class FakeEnvelope {
      locale = 'en';
    }
    const hiddenExtra = { locale: 'en' };
    Object.defineProperty(hiddenExtra, 'path', { value: '/private/host-locale.v1.json', enumerable: false });
    const symbolExtra = { locale: 'en', [Symbol('extra')]: true };

    for (const malformed of [
      null,
      undefined,
      'en',
      'zh',
      123,
      true,
      [],
      {},
      { locale: undefined },
      { locale: '' },
      { locale: 'EN' },
      { locale: 'en-US' },
      { locale: 'zh-CN' },
      { locale: 'fr' },
      { locale: 'en', extra: true },
      { locale: null, path: '/Users/alice/.nimi/run/desktop/host-locale.v1.json' },
      { locale: 'en', schemaVersion: 1 },
      new FakeEnvelope(),
      hiddenExtra,
      symbolExtra,
    ]) {
      assert.throws(
        () => parseNimiHostLocaleResult(malformed),
        (error: unknown) => error instanceof NimiHostLocaleParseError && error.reasonCode === 'SDK_HOST_LOCALE_INVALID',
      );
    }
  });

  it('readNimiHostLocale soft-returns null when no source exists and reads once when provided', async () => {
    assert.equal(await readNimiHostLocale(), null);
    assert.equal(await readNimiHostLocale(undefined), null);
    assert.equal(await readNimiHostLocale(null), null);

    let calls = 0;
    const directSource: NimiHostLocaleSource = {
      async getLocale() {
        calls += 1;
        return 'en';
      },
    };
    const locale: NimiHostLocale | null = await readNimiHostLocale(directSource);
    assert.equal(locale, 'en');
    assert.equal(calls, 1);

    assert.equal(await readNimiHostLocale({ async getLocale() { return 'zh'; } }), 'zh');
    assert.equal(await readNimiHostLocale({ async getLocale() { return null; } }), null);
    assert.equal(await readNimiHostLocale({ async getLocale() { return { locale: 'en' }; } }), 'en');
    assert.equal(await readNimiHostLocale({ async getLocale() { return { locale: 'zh' }; } }), 'zh');
    assert.equal(await readNimiHostLocale({ async getLocale() { return { locale: null }; } }), null);
  });

  it('readNimiHostLocale fails closed on malformed sources or envelopes and propagates carrier errors', async () => {
    for (const invalidSource of [{}, [], 'en', 42, { getLocale: 'en' }]) {
      await assert.rejects(
        () => readNimiHostLocale(invalidSource as unknown as NimiHostLocaleSource),
        (error: unknown) => error instanceof NimiHostLocaleParseError && error.reasonCode === 'SDK_HOST_LOCALE_INVALID',
      );
    }

    for (const invalidValue of [
      undefined,
      '',
      'EN',
      'en-US',
      'zh-CN',
      'fr',
      123,
      [],
      {},
      { locale: undefined },
      { locale: 'ja' },
      { locale: 'en', extra: 1 },
    ]) {
      await assert.rejects(
        () => readNimiHostLocale({ async getLocale() { return invalidValue; } }),
        (error: unknown) => error instanceof NimiHostLocaleParseError && error.reasonCode === 'SDK_HOST_LOCALE_INVALID',
      );
    }

    const carrierError = new Error('host carrier unavailable');
    await assert.rejects(
      () => readNimiHostLocale({ async getLocale() { throw carrierError; } }),
      (error: unknown) => error === carrierError,
    );
  });

  it('resolveNimiStartupLocale enforces storedLocale > hostLocale > navigatorLanguage > fallback', () => {
    const supported = ['en', 'zh'] as const;

    // 1. Explicit App stored override wins over Host locale and navigatorLanguage.
    assert.equal(resolveNimiStartupLocale({
      supportedLocales: supported,
      storedLocale: 'zh',
      hostLocale: 'en',
      navigatorLanguage: 'en-US',
      fallback: 'en',
    }), 'zh');
    assert.equal(resolveNimiStartupLocale({
      supportedLocales: supported,
      storedLocale: 'en',
      hostLocale: 'zh',
      navigatorLanguage: 'zh-CN',
      fallback: 'zh',
    }), 'en');

    // 2. Host startup locale wins over OS navigatorLanguage when no App override is saved.
    assert.equal(resolveNimiStartupLocale({
      supportedLocales: supported,
      storedLocale: null,
      hostLocale: 'en',
      navigatorLanguage: 'zh-CN',
      fallback: 'en',
    }), 'en');
    assert.equal(resolveNimiStartupLocale({
      supportedLocales: supported,
      storedLocale: undefined,
      hostLocale: 'zh',
      navigatorLanguage: 'en-US',
      fallback: 'en',
    }), 'zh');

    // 3. navigatorLanguage applies when both storedLocale and hostLocale are absent/unmatched.
    assert.equal(resolveNimiStartupLocale({
      supportedLocales: supported,
      storedLocale: null,
      hostLocale: null,
      navigatorLanguage: 'zh-CN',
      fallback: 'en',
    }), 'zh');
    assert.equal(resolveNimiStartupLocale({
      supportedLocales: supported,
      storedLocale: null,
      hostLocale: null,
      navigatorLanguage: 'zh_Hans_CN',
      fallback: 'en',
    }), 'zh');
    assert.equal(resolveNimiStartupLocale({
      supportedLocales: supported,
      storedLocale: null,
      hostLocale: null,
      navigatorLanguage: 'en-GB',
      fallback: 'zh',
    }), 'en');

    // 4. Fallback applies when nothing matches.
    assert.equal(resolveNimiStartupLocale({
      supportedLocales: supported,
      storedLocale: null,
      hostLocale: null,
      navigatorLanguage: 'fr-FR',
      fallback: 'en',
    }), 'en');
    assert.equal(resolveNimiStartupLocale({
      supportedLocales: supported,
      fallback: 'zh',
    }), 'zh');
  });

  it('resolveNimiStartupLocale skips unsupported candidates and honors tag boundaries and regional locales', () => {
    // Corrupted or unsupported stored override falls through cleanly to hostLocale.
    assert.equal(resolveNimiStartupLocale({
      supportedLocales: ['en', 'zh'] as const,
      storedLocale: 'fr',
      hostLocale: 'en',
      navigatorLanguage: 'zh-CN',
      fallback: 'zh',
    }), 'en');
    assert.equal(resolveNimiStartupLocale({
      supportedLocales: ['en', 'zh'] as const,
      storedLocale: '   ',
      hostLocale: 'zh',
      navigatorLanguage: 'en-US',
      fallback: 'en',
    }), 'zh');

    // Unsupported hostLocale falls through cleanly to navigatorLanguage / fallback.
    assert.equal(resolveNimiStartupLocale({
      supportedLocales: ['en', 'ja'] as const,
      storedLocale: null,
      hostLocale: 'zh',
      navigatorLanguage: 'ja-JP',
      fallback: 'en',
    }), 'ja');

    // Prefix boundary safety: "english" or "zhx" must not match "en" or "zh".
    assert.equal(resolveNimiStartupLocale({
      supportedLocales: ['en', 'zh'] as const,
      storedLocale: 'english',
      hostLocale: 'zhx',
      navigatorLanguage: 'en-US-evil/../../',
      fallback: 'zh',
    }), 'zh');

    // Regional locale matching: exact tag, longest prefix, and primary subtag fallback.
    const regional = ['en-US', 'zh-CN', 'zh-TW'] as const;
    assert.equal(resolveNimiStartupLocale({
      supportedLocales: regional,
      navigatorLanguage: 'zh-TW',
      fallback: 'en-US',
    }), 'zh-TW');
    assert.equal(resolveNimiStartupLocale({
      supportedLocales: ['zh', 'zh-TW'] as const,
      navigatorLanguage: 'zh-TW-u-ca-gregory',
      fallback: 'zh',
    }), 'zh-TW');
    assert.equal(resolveNimiStartupLocale({
      supportedLocales: regional,
      hostLocale: 'zh',
      navigatorLanguage: 'en-US',
      fallback: 'en-US',
    }), 'zh-CN');
    assert.equal(resolveNimiStartupLocale({
      supportedLocales: regional,
      hostLocale: 'en',
      navigatorLanguage: 'zh-CN',
      fallback: 'zh-CN',
    }), 'en-US');
  });

  it('resolveNimiStartupLocale fails closed on invalid configuration', () => {
    for (const invalidInput of [
      null,
      undefined,
      'en',
      [],
      { supportedLocales: [], fallback: 'en' },
      { supportedLocales: ['en', ''], fallback: 'en' },
      { supportedLocales: ['en', 'zh'], fallback: 'fr' },
      { supportedLocales: ['en', 'zh'], fallback: 'en', extra: true },
    ]) {
      assert.throws(
        () => resolveNimiStartupLocale(invalidInput as never),
        (error: unknown) => error instanceof NimiHostLocaleParseError && error.reasonCode === 'SDK_HOST_LOCALE_INVALID',
      );
    }
  });
});
