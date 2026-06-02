/**
 * Wave 2 (topic 2026-05-10-runtime-bearer-revocation-contract-closure)
 * bearer-injection and classifier tests.
 *
 * The classifier `isRuntimeAnonymousReadMethod` is the SOLE pre-call
 * decision point for whether the SDK attaches an `Authorization: Bearer …`
 * header for Runtime gRPC methods classified as `anonymous_read` in the
 * Wave 0 spec table. These tests verify:
 *
 *   - resolveAuthorization returns undefined for every anonymous_read
 *     method id, regardless of token state (string, function, undefined).
 *   - resolveAuthorization returns `Bearer <token>` for sample
 *     authenticated_required methods that fall through to the fallback
 *     path (i.e. NOT in the existing account / app-session-bootstrap /
 *     local-anonymous skip-bearer branches).
 *   - resolveAuthorization treats `mixed` methods as fallback (Bearer if
 *     token, undefined if not) — no posture-aware bearer stripping.
 *   - The classifier itself returns true / false correctly for known
 *     anonymous_read, authenticated_required, mixed, and fabricated
 *     method ids.
 *
 * Live-failure anchor methods explicitly exercised:
 *   /nimi.runtime.v1.RuntimeAuditService/GetRuntimeHealth
 *   /nimi.runtime.v1.RuntimeAuditService/ListAIProviderHealth
 *   /nimi.runtime.v1.RuntimeAuditService/SubscribeRuntimeHealthEvents
 *   /nimi.runtime.v1.RuntimeAuditService/SubscribeAIProviderHealthEvents
 *   /nimi.runtime.v1.RuntimeAiService/PeekScheduling
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { toUnaryCall, toStreamCall } from '../../src/runtime/core/client-auth.js';
import {
  isRuntimeAnonymousReadMethod,
  RuntimeAnonymousReadMethodIds,
  RuntimeMethodIds,
} from '../../src/runtime/method-ids.js';
import type { RuntimeClientConfig } from '../../src/runtime/types.js';

const APP_ID = 'nimi.runtime.anonymous-read.test';

const ANONYMOUS_READ_LIVE_FAILURE_ANCHORS = [
  '/nimi.runtime.v1.RuntimeAuditService/GetRuntimeHealth',
  '/nimi.runtime.v1.RuntimeAuditService/ListAIProviderHealth',
  '/nimi.runtime.v1.RuntimeAuditService/SubscribeRuntimeHealthEvents',
  '/nimi.runtime.v1.RuntimeAuditService/SubscribeAIProviderHealthEvents',
  '/nimi.runtime.v1.RuntimeAiService/PeekScheduling',
] as const;

// Sample of >=10 anonymous_read methods drawn from across services for the
// classifier spot-check. Includes the live-failure anchors plus a spread of
// other services to catch service-specific regressions.
const ANONYMOUS_READ_SPOT_CHECK = [
  ...ANONYMOUS_READ_LIVE_FAILURE_ANCHORS,
  '/nimi.runtime.v1.RuntimeConnectorService/ListProviderCatalog',
  '/nimi.runtime.v1.RuntimeAuthService/RegisterApp',
  '/nimi.runtime.v1.RuntimeAuthService/OpenSession',
  '/nimi.runtime.v1.RuntimeLocalService/ListLocalAssets',
  '/nimi.runtime.v1.RuntimeAgentService/GetAgent',
  '/nimi.runtime.v1.RuntimeCognitionService/Recall',
] as const;

// Authenticated-required methods that fall through to the fallback path
// (NOT account / app-session-bootstrap / local-anonymous). These attach
// Bearer when a token is set.
const AUTHENTICATED_REQUIRED_FALLTHROUGH_SAMPLE = [
  '/nimi.runtime.v1.RuntimeAuthService/RefreshSession',
  '/nimi.runtime.v1.RuntimeAuthService/OpenExternalPrincipalSession',
  '/nimi.runtime.v1.RuntimeConnectorService/UpsertCatalogModelOverlay',
] as const;

// Mixed methods. Per K-AUTH-002 / K-AUTH-003 the SDK MUST forward bearer
// when present; the handler decides what to do.
//
// We deliberately exclude AI-route mixed methods
// (ExecuteScenario / StreamScenario / SubmitScenarioJob) here because the
// existing precedence-position #6 branch already drops bearer when no
// `subjectUserId` is in the request — that is K-AUTH-002 / K-AUTH-004
// behavior preserved verbatim by Wave 2, not a posture-aware strip.
const MIXED_SAMPLE = [
  '/nimi.runtime.v1.RuntimeConnectorService/ListConnectors',
  '/nimi.runtime.v1.RuntimeConnectorService/TestConnector',
  '/nimi.runtime.v1.RuntimeWorkflowService/GetWorkflow',
] as const;

// Known authenticated_required and mixed for the false spot-check (10 ids).
const NON_ANONYMOUS_READ_SPOT_CHECK = [
  '/nimi.runtime.v1.RuntimeAccountService/GetAccountSessionStatus',
  '/nimi.runtime.v1.RuntimeAccountService/BeginLogin',
  '/nimi.runtime.v1.RuntimeAccountService/Logout',
  '/nimi.runtime.v1.RuntimeAccountService/SwitchAccount',
  '/nimi.runtime.v1.RuntimeAuthService/RefreshSession',
  '/nimi.runtime.v1.RuntimeConnectorService/UpsertModelCatalogProvider',
  '/nimi.runtime.v1.RuntimeAppService/SendAppMessage',
  '/nimi.runtime.v1.RuntimeAiService/ExecuteScenario',
  '/nimi.runtime.v1.RuntimeAiService/StreamScenario',
  '/nimi.runtime.v1.RuntimeWorkflowService/CancelWorkflow',
] as const;

const FABRICATED_METHOD_ID = '/nimi.runtime.v1.NoSuchService/NoSuchMethod';

function makeConfig(
  accessToken: string | undefined | (() => string | Promise<string>),
): RuntimeClientConfig {
  return {
    appId: APP_ID,
    transport: {
      type: 'node-grpc',
      endpoint: '127.0.0.1:46371',
    },
    auth: accessToken === undefined ? undefined : { accessToken },
  };
}

const EMPTY_REQUEST: Uint8Array = new Uint8Array();

// ---------------------------------------------------------------------------
// Classifier tests
// ---------------------------------------------------------------------------

test('isRuntimeAnonymousReadMethod returns true for 10+ known anonymous_read method ids', () => {
  for (const methodId of ANONYMOUS_READ_SPOT_CHECK) {
    assert.equal(
      isRuntimeAnonymousReadMethod(methodId),
      true,
      `expected ${methodId} to be classified anonymous_read`,
    );
  }
  assert.ok(ANONYMOUS_READ_SPOT_CHECK.length >= 10, 'spot-check sample must include >=10 ids');
});

test('isRuntimeAnonymousReadMethod returns false for 10 known authenticated_required / mixed method ids', () => {
  for (const methodId of NON_ANONYMOUS_READ_SPOT_CHECK) {
    assert.equal(
      isRuntimeAnonymousReadMethod(methodId),
      false,
      `expected ${methodId} to NOT be classified anonymous_read`,
    );
  }
  assert.equal(NON_ANONYMOUS_READ_SPOT_CHECK.length, 10, 'spot-check sample must include exactly 10 ids');
});

test('isRuntimeAnonymousReadMethod returns false for fabricated method ids', () => {
  assert.equal(isRuntimeAnonymousReadMethod(FABRICATED_METHOD_ID), false);
  assert.equal(isRuntimeAnonymousReadMethod(''), false);
  assert.equal(isRuntimeAnonymousReadMethod('/nimi.runtime.v1.RuntimeAuditService/'), false);
  assert.equal(isRuntimeAnonymousReadMethod('garbage'), false);
});

test('RuntimeAnonymousReadMethodIds set has exactly 146 members (current spec shard size)', () => {
  // Set equality is enforced by scripts/check-runtime-rpc-auth-posture-sdk-drift.mjs;
  // this in-memory check guards against accidental duplication / truncation
  // of the literal at TS compile time.
  const distinct = new Set(RuntimeAnonymousReadMethodIds);
  assert.equal(distinct.size, RuntimeAnonymousReadMethodIds.length, 'classifier list must have no duplicates');
  assert.equal(distinct.size, 146, 'classifier set must contain exactly 146 method ids');
});

test('RuntimeMethodIds.audit live-failure anchors are all classified anonymous_read', () => {
  for (const methodId of ANONYMOUS_READ_LIVE_FAILURE_ANCHORS) {
    assert.equal(isRuntimeAnonymousReadMethod(methodId), true, `${methodId} must be anonymous_read`);
  }
  assert.equal(
    isRuntimeAnonymousReadMethod(RuntimeMethodIds.audit.getRuntimeHealth),
    true,
    'RuntimeMethodIds.audit.getRuntimeHealth must be classified anonymous_read',
  );
  assert.equal(
    isRuntimeAnonymousReadMethod(RuntimeMethodIds.ai.peekScheduling),
    true,
    'RuntimeMethodIds.ai.peekScheduling must be classified anonymous_read',
  );
});

// ---------------------------------------------------------------------------
// Bearer-injection tests — anonymous_read MUST NOT carry Authorization
// regardless of token state.
// ---------------------------------------------------------------------------

test('toUnaryCall: anonymous_read methods omit Authorization with static-string token', async () => {
  const config = makeConfig('non-empty-static-token');
  for (const methodId of ANONYMOUS_READ_LIVE_FAILURE_ANCHORS) {
    const call = await toUnaryCall(config, methodId, EMPTY_REQUEST, undefined, undefined);
    assert.equal(call.authorization, undefined, `${methodId} must not carry Authorization (static token)`);
  }
});

test('toUnaryCall: anonymous_read methods omit Authorization with function-returning token', async () => {
  const config = makeConfig(() => 'fn-returning-token');
  for (const methodId of ANONYMOUS_READ_LIVE_FAILURE_ANCHORS) {
    const call = await toUnaryCall(config, methodId, EMPTY_REQUEST, undefined, undefined);
    assert.equal(call.authorization, undefined, `${methodId} must not carry Authorization (fn token)`);
  }
});

test('toUnaryCall: anonymous_read methods omit Authorization with undefined token', async () => {
  const config = makeConfig(undefined);
  for (const methodId of ANONYMOUS_READ_LIVE_FAILURE_ANCHORS) {
    const call = await toUnaryCall(config, methodId, EMPTY_REQUEST, undefined, undefined);
    assert.equal(call.authorization, undefined, `${methodId} must not carry Authorization (no token)`);
  }
});

test('toStreamCall: subscribe-style anonymous_read methods omit Authorization with token set', async () => {
  // Subscribe* anchors are streaming; verify the same skip-bearer behavior on
  // the stream-call path.
  const config = makeConfig('streaming-token');
  const streamingAnchors = [
    '/nimi.runtime.v1.RuntimeAuditService/SubscribeRuntimeHealthEvents',
    '/nimi.runtime.v1.RuntimeAuditService/SubscribeAIProviderHealthEvents',
  ];
  for (const methodId of streamingAnchors) {
    const call = await toStreamCall(config, methodId, EMPTY_REQUEST, undefined, undefined);
    assert.equal(call.authorization, undefined, `${methodId} must not carry Authorization on stream call`);
  }
});

// ---------------------------------------------------------------------------
// Bearer-injection tests — authenticated_required (fallthrough sample) MUST
// attach Bearer when token is set, omit otherwise.
// ---------------------------------------------------------------------------

test('toUnaryCall: authenticated_required (fallthrough) attaches Bearer with token set', async () => {
  const config = makeConfig('static-bearer-token');
  for (const methodId of AUTHENTICATED_REQUIRED_FALLTHROUGH_SAMPLE) {
    const call = await toUnaryCall(config, methodId, EMPTY_REQUEST, undefined, undefined);
    assert.equal(
      call.authorization,
      'Bearer static-bearer-token',
      `${methodId} must attach Bearer header when token is set`,
    );
  }
});

test('toUnaryCall: authenticated_required (fallthrough) attaches Bearer with function-returning token', async () => {
  const config = makeConfig(async () => 'fn-bearer-token');
  for (const methodId of AUTHENTICATED_REQUIRED_FALLTHROUGH_SAMPLE) {
    const call = await toUnaryCall(config, methodId, EMPTY_REQUEST, undefined, undefined);
    assert.equal(
      call.authorization,
      'Bearer fn-bearer-token',
      `${methodId} must attach Bearer header when fn token resolves`,
    );
  }
});

test('toUnaryCall: authenticated_required (fallthrough) omits Authorization with no token (existing behavior)', async () => {
  const config = makeConfig(undefined);
  for (const methodId of AUTHENTICATED_REQUIRED_FALLTHROUGH_SAMPLE) {
    const call = await toUnaryCall(config, methodId, EMPTY_REQUEST, undefined, undefined);
    assert.equal(
      call.authorization,
      undefined,
      `${methodId} must omit Authorization when no token configured`,
    );
  }
});

// ---------------------------------------------------------------------------
// Bearer-injection tests — mixed methods follow fallback path: Bearer if
// token is set, undefined if not. Per packet `mixed_posture_handling`.
// ---------------------------------------------------------------------------

test('toUnaryCall: mixed methods attach Bearer when token is set', async () => {
  const config = makeConfig('mixed-token');
  for (const methodId of MIXED_SAMPLE) {
    const call = await toUnaryCall(config, methodId, EMPTY_REQUEST, undefined, undefined);
    assert.equal(
      call.authorization,
      'Bearer mixed-token',
      `${methodId} (mixed) must attach Bearer when token is set`,
    );
  }
});

test('toUnaryCall: mixed methods omit Authorization when no token is set', async () => {
  const config = makeConfig(undefined);
  for (const methodId of MIXED_SAMPLE) {
    const call = await toUnaryCall(config, methodId, EMPTY_REQUEST, undefined, undefined);
    assert.equal(
      call.authorization,
      undefined,
      `${methodId} (mixed) must omit Authorization when no token`,
    );
  }
});

// ---------------------------------------------------------------------------
// Cross-state matrix: every anonymous_read live-failure anchor × token state
// — combinatorial coverage to catch regressions at the precedence-position
// #2 branch.
// ---------------------------------------------------------------------------

test('toUnaryCall: 5 anonymous_read live-failure anchors × 3 token states all omit Authorization', async () => {
  const tokenStates: Array<{ name: string; token: Parameters<typeof makeConfig>[0] }> = [
    { name: 'static-string', token: 'live-token' },
    { name: 'function', token: () => 'fn-live-token' },
    { name: 'undefined', token: undefined },
  ];
  for (const methodId of ANONYMOUS_READ_LIVE_FAILURE_ANCHORS) {
    for (const state of tokenStates) {
      const config = makeConfig(state.token);
      const call = await toUnaryCall(config, methodId, EMPTY_REQUEST, undefined, undefined);
      assert.equal(
        call.authorization,
        undefined,
        `${methodId} with token state "${state.name}" must omit Authorization`,
      );
    }
  }
});
