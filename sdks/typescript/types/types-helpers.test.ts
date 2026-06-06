import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ReasonCode,
  asJsonObject,
  createNimiClientId,
  createNimiUlid,
  createOfflineNimiError,
  extractNimiErrorFields,
  getNimiErrorMessage,
  isJsonObject,
  isRealmOfflineErrorLike,
  isRuntimeOfflineErrorLike,
  normalizeApiError,
  parseJsonObjectResponse,
  tryParseJsonLike,
  type JsonObject,
} from './index';

test('SDK types expose string ReasonCode projection instead of generated numeric enum', () => {
  assert.equal(ReasonCode.REALM_UNAVAILABLE, 'REALM_UNAVAILABLE');
  assert.equal(ReasonCode.RUNTIME_UNAVAILABLE, 'RUNTIME_UNAVAILABLE');
  assert.equal(ReasonCode.AUTH_TOKEN_INVALID, 'AUTH_TOKEN_INVALID');
  assert.equal(typeof ReasonCode.REALM_UNAVAILABLE, 'string');
});

test('SDK types expose JSON and API error projection helpers', () => {
  const parsed = tryParseJsonLike('{"ok":true}');
  assert.deepEqual(parsed, { ok: true });
  const object: JsonObject = asJsonObject(parsed);
  assert.equal(object.ok, true);

  const error = normalizeApiError({
    status: 429,
    body: JSON.stringify({
      reasonCode: ReasonCode.REALM_RATE_LIMITED,
      actionHint: 'retry_later',
      message: 'Rate limited',
    }),
  });
  assert.equal(extractNimiErrorFields(error).reasonCode, 'REALM_RATE_LIMITED');
});

test('SDK JSON helpers parse objects and fail closed without throwing', async () => {
  assert.equal(isJsonObject({ ok: true }), true);
  assert.equal(isJsonObject(null), false);
  assert.equal(isJsonObject(['not-object']), false);
  assert.deepEqual(asJsonObject(['not-object']), {});

  assert.deepEqual(await parseJsonObjectResponse(new Response('{"ok":true}')), { ok: true });
  assert.equal(await parseJsonObjectResponse(new Response('')), null);
  assert.equal(await parseJsonObjectResponse(new Response('[1,2]')), null);
  assert.equal(await parseJsonObjectResponse(new Response('{bad-json')), null);

  assert.deepEqual(tryParseJsonLike('[1,2]') as unknown, [1, 2]);
  assert.equal(tryParseJsonLike('{bad-json'), '{bad-json');
  const value = { raw: true };
  assert.equal(tryParseJsonLike(value), value);
  assert.equal(tryParseJsonLike(' plain text '), ' plain text ');
});

test('SDK types classify offline errors and create NimiError values', () => {
  const realmError = createOfflineNimiError({
    source: 'realm',
    reasonCode: ReasonCode.REALM_UNAVAILABLE,
    message: 'Realm unavailable',
    actionHint: 'retry_when_online',
  });
  assert.equal(isRealmOfflineErrorLike(realmError), true);
  assert.equal(isRuntimeOfflineErrorLike(realmError), false);
  assert.equal(getNimiErrorMessage(realmError, 'fallback'), 'Realm unavailable');

  const runtimeError = createOfflineNimiError({
    source: 'runtime',
    reasonCode: ReasonCode.RUNTIME_UNAVAILABLE,
    message: 'Runtime unavailable',
    actionHint: 'check_runtime',
  });
  assert.equal(isRuntimeOfflineErrorLike(runtimeError), true);
});

test('SDK types create cryptographic Nimi client ids', () => {
  const originalCrypto = globalThis.crypto;
  const deterministicCrypto = {
    getRandomValues(bytes: Uint8Array): Uint8Array {
      bytes.fill(7);
      return bytes;
    },
  } as Crypto;
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: deterministicCrypto,
  });
  try {
    const ulid = createNimiUlid(0);
    assert.match(ulid, /^[0-9A-HJKMNP-TV-Z]{26}$/);
    assert.equal(createNimiClientId('chat', 0), `chat-${ulid}`);
    assert.throws(
      () => createNimiClientId('../bad', 0),
      (error: unknown) => extractNimiErrorFields(error).reasonCode === ReasonCode.ACTION_INPUT_INVALID,
    );
  } finally {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: originalCrypto,
    });
  }
});
