import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { CoreClient } from '../core-client';
import { RealmGeneratedClient } from '../core-generated/realm-client';
import { RuntimeGeneratedClient } from '../core-generated/runtime-client';
import { getRuntimeWireCodec } from '../runtime/generated';
import {
  ReasonCode,
  asJsonObject,
  asNimiError,
  createNimiClientId,
  createNimiUlid,
  createOfflineNimiError,
  createNimiError,
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

test('SDK error field extraction preserves Runtime interruption and resubmit disposition', () => {
  for (const resubmitDisposition of ['caller-may-resubmit', 'outcome-uncertain'] as const) {
    const interruption = { cause: 'runtime-restart' as const, resubmitDisposition };
    const error = createNimiError({
      reasonCode: 'AI_EXECUTION_INTERRUPTED', actionHint: 'review_outcome', traceId: 'test-trace',
      interruption, message: 'Interrupted.', retryable: resubmitDisposition === 'caller-may-resubmit',
    });
    const fields = extractNimiErrorFields(error);
    assert.deepEqual(fields.interruption, interruption);
    assert.notEqual(fields.interruption, error.interruption);
    assert.equal(fields.traceId, 'test-trace');
  }
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
  assert.equal(isRuntimeOfflineErrorLike({
    reasonCode: ReasonCode.RUNTIME_BRIDGE_DAEMON_UNAVAILABLE,
    message: 'Electron Runtime endpoint is unavailable.',
  }), true);
  assert.equal(isRealmOfflineErrorLike({ message: 'Realm unavailable' }), false);
  assert.equal(isRealmOfflineErrorLike(
    new TypeError('fetch failed'),
    { transportOwner: 'realm' },
  ), true);
  assert.equal(isRealmOfflineErrorLike(
    new TypeError('fetch failed'),
    { transportOwner: 'runtime' },
  ), false);
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

test('derived SDK error-code manifests stay synchronized with category rows and thrown public errors', () => {
  type ErrorCodeRow = {
    readonly name: string;
    readonly family: string;
    readonly source_rule: string;
    readonly note?: string;
  };
  type ErrorCodesManifest = {
    readonly values: readonly string[];
    readonly codes: readonly ErrorCodeRow[];
  };

  const tsManifest = JSON.parse(
    readFileSync(new URL('../core-generated/error-codes.manifest.json', import.meta.url), 'utf8'),
  ) as ErrorCodesManifest;
  const sharedManifest = JSON.parse(
    readFileSync(new URL('../../generators/shared/generated/error-codes.manifest.json', import.meta.url), 'utf8'),
  ) as ErrorCodesManifest;

  assert.deepEqual(tsManifest.values, sharedManifest.values);
  assert.deepEqual(tsManifest.codes, sharedManifest.codes);
  assert.deepEqual(
    tsManifest.values,
    tsManifest.codes.map((entry) => entry.name),
  );
  assert.equal(tsManifest.codes.length, 243);

  const byName = new Map(tsManifest.codes.map((entry) => [entry.name, entry]));
  assert.deepEqual(byName.get('SDK_ADAPTER_FEATURE_UNSUPPORTED'), {
    name: 'SDK_ADAPTER_FEATURE_UNSUPPORTED',
    family: 'SDK_ADAPTER',
    source_rule: 'S-ERROR-003',
  });
  assert.equal(tsManifest.values[8], 'SDK_TRANSPORT_INVALID');
  assert.equal(tsManifest.values[34], 'SDK_MOD_HOST_MISSING');
  assert.equal(tsManifest.values[35], 'SDK_ADAPTER_FEATURE_UNSUPPORTED');
  assert.equal(tsManifest.values[36], 'SDK_AI_PROVIDER_BASE64_UNAVAILABLE');
  assert.equal(byName.get(ReasonCode.OPERATION_ABORTED)?.family, 'SDK_SYNTHETIC_REASON');
  assert.equal(byName.get(ReasonCode.RUNTIME_UNAVAILABLE)?.family, 'SDK_SYNTHETIC_REASON');
  assert.equal(byName.get(ReasonCode.RUNTIME_BRIDGE_DAEMON_UNAVAILABLE)?.family, 'SDK_SYNTHETIC_REASON');

  const stubCore = new CoreClient({
    transport: {
      async unary() {
        throw new Error('unused');
      },
      async *serverStream() {
        throw new Error('unused');
      },
    },
  });
  const runtimeClient = new RuntimeGeneratedClient(stubCore);
  const realmClient = new RealmGeneratedClient(stubCore);

  const thrownCases: ReadonlyArray<{
    readonly invoke: () => unknown;
    readonly expectedCode: string;
    readonly expectedFamily: string;
  }> = [
    {
      invoke: () => getRuntimeWireCodec('/nimi.runtime.v1.NonExistent/Missing'),
      expectedCode: 'SDK_RUNTIME_CODEC_MISSING',
      expectedFamily: 'SDK_RUNTIME',
    },
    {
      invoke: () => runtimeClient.describe('/nimi.runtime.v1.NonExistent/Missing'),
      expectedCode: 'SDK_RUNTIME_METHOD_UNAVAILABLE',
      expectedFamily: 'SDK_CONFIG',
    },
    {
      invoke: () => realmClient.describe('non_existent_operation'),
      expectedCode: 'SDK_REALM_CONFIG_INVALID',
      expectedFamily: 'SDK_REALM',
    },
  ];

  for (const testCase of thrownCases) {
    let caught: unknown;
    try {
      testCase.invoke();
    } catch (error) {
      caught = error;
    }
    const normalized = asNimiError(caught, { source: 'sdk' });
    assert.equal(normalized.code, testCase.expectedCode);
    assert.equal(extractNimiErrorFields(caught).code, testCase.expectedCode);
    assert.ok(tsManifest.values.includes(testCase.expectedCode));
    assert.equal(byName.get(testCase.expectedCode)?.family, testCase.expectedFamily);
  }
});
