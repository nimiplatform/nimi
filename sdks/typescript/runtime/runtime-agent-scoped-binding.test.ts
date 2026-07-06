import assert from 'node:assert/strict';
import test from 'node:test';

import {
  AccountCallerMode,
  AccountReasonCode,
  ReasonCode,
  ScopedAppBindingPurpose,
  ScopedAppBindingState,
  type IssueScopedAppBindingRequest,
  type RuntimeTypedCallOptions,
} from '../core-generated/runtime-typed-client';
import {
  issueNimiRuntimeAgentScopedBinding,
  projectNimiRuntimeAgentScopedBinding,
  runtimeAgentScopedBindingNeedsRenewal,
} from './runtime-agent-scoped-binding';

test('issues Runtime Agent scoped binding through Runtime account service', async () => {
  const calls: Array<{
    readonly request: IssueScopedAppBindingRequest;
    readonly options?: RuntimeTypedCallOptions;
  }> = [];
  const result = await issueNimiRuntimeAgentScopedBinding({
    runtime: {
      account: {
        async issueScopedAppBinding(request, options) {
          calls.push({ request, options });
          return {
            accepted: true,
            bindingId: 'binding-1',
            bindingCarrier: 'binding:binding-1',
            relation: {
              ...request.relation!,
              bindingId: 'binding-1',
              issuedAt: { seconds: '100', nanos: 0 },
              expiresAt: { seconds: '200', nanos: 500_000_000 },
              state: ScopedAppBindingState.ACTIVE,
              reasonCode: AccountReasonCode.ACTION_EXECUTED,
            },
            reasonCode: ReasonCode.ACTION_EXECUTED,
            accountReasonCode: AccountReasonCode.ACTION_EXECUTED,
            productionInert: false,
          };
        },
      },
    },
    caller: {
      appId: 'nimi.zhiyu',
      appInstanceId: 'nimi.zhiyu.local-first-party',
      deviceId: 'nimi-zhiyu-local-first-party-device',
      mode: AccountCallerMode.LOCAL_FIRST_PARTY_APP,
      scopes: [],
    },
    agentId: 'local-agent:agent-1',
    conversationAnchorId: 'agent_anchor_1',
    scopes: ['runtime.agent.delegation.write', ' runtime.agent.delegation.read ', ''],
    ttlSeconds: 120,
    options: { metadata: { idempotencyKey: 'binding-test' } },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].request.ttlSeconds, 120);
  assert.deepEqual(calls[0].options, { metadata: { idempotencyKey: 'binding-test' } });
  assert.deepEqual(calls[0].request.relation, {
    bindingId: '',
    runtimeAppId: 'nimi.zhiyu',
    appInstanceId: 'nimi.zhiyu.local-first-party',
    windowId: '',
    avatarInstanceId: '',
    agentId: 'local-agent:agent-1',
    conversationAnchorId: 'agent_anchor_1',
    worldId: '',
    purpose: ScopedAppBindingPurpose.APP_SCOPED_RUNTIME,
    scopes: ['runtime.agent.delegation.read', 'runtime.agent.delegation.write'],
    state: 0,
    reasonCode: 0,
  });
  assert.deepEqual(result.scopedBinding, {
    bindingId: 'binding-1',
    bindingHandle: 'binding:binding-1',
    runtimeAppId: 'nimi.zhiyu',
    appInstanceId: 'nimi.zhiyu.local-first-party',
    windowId: '',
    avatarInstanceId: '',
    agentId: 'local-agent:agent-1',
    conversationAnchorId: 'agent_anchor_1',
    worldId: '',
  });
  assert.equal(result.expiresAtMs, 200_500);
});

test('Runtime Agent scoped binding projection fails closed on rejected issue response', () => {
  assert.throws(
    () => projectNimiRuntimeAgentScopedBinding({
      accepted: false,
      bindingId: '',
      bindingCarrier: '',
      reasonCode: ReasonCode.PRINCIPAL_UNAUTHORIZED,
      accountReasonCode: AccountReasonCode.ACCOUNT_UNAVAILABLE,
      productionInert: false,
    }),
    (error: unknown) => {
      assert.equal((error as { reasonCode?: string }).reasonCode, 'SDK_RUNTIME_AGENT_SCOPED_BINDING_REJECTED');
      return true;
    },
  );
});

test('Runtime Agent scoped binding renewal guard renews only near expiry', () => {
  assert.equal(runtimeAgentScopedBindingNeedsRenewal({ expiresAtMs: 0, nowMs: 1_000 }), true);
  assert.equal(runtimeAgentScopedBindingNeedsRenewal({ expiresAtMs: 10_000, nowMs: 1_000, refreshSkewMs: 8_000 }), false);
  assert.equal(runtimeAgentScopedBindingNeedsRenewal({ expiresAtMs: 10_000, nowMs: 2_500, refreshSkewMs: 8_000 }), true);
});
