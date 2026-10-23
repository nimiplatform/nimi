import assert from 'node:assert/strict';
import test from 'node:test';

import {
  RUNTIME_METHOD_BY_ID,
  RUNTIME_WIRE_CODECS,
  getRuntimeWireCodec,
  hasRuntimeWireCodec,
  runtimeRpcAuthPosture,
  DesktopAIExecutionRoute,
  DesktopAIExecutionState,
} from './generated';

const HOST_PRIVATE_AVATAR_METHOD_IDS = [
  '/nimi.runtime.v1.RuntimeAgentService/ResolveLocalAppAvatarHostTarget',
  '/nimi.runtime.v1.RuntimeAgentService/RevalidateLocalAppAvatarHostTarget',
] as const;

test('public Runtime generated facade excludes Host-private Avatar methods', () => {
  for (const methodId of HOST_PRIVATE_AVATAR_METHOD_IDS) {
    assert.equal(RUNTIME_METHOD_BY_ID.has(methodId), false);
    assert.equal(methodId in RUNTIME_WIRE_CODECS, false);
    assert.equal(hasRuntimeWireCodec(methodId), false);
    assert.equal(runtimeRpcAuthPosture(methodId), null);
    assert.throws(
      () => getRuntimeWireCodec(methodId),
      { code: 'SDK_RUNTIME_CODEC_MISSING' },
    );
  }
});

test('public Runtime generated facade retains an admitted public method', () => {
  const methodId = '/nimi.runtime.v1.RuntimeAuditService/GetRuntimeHealth';
  assert.equal(RUNTIME_METHOD_BY_ID.has(methodId), true);
  assert.equal(hasRuntimeWireCodec(methodId), true);
  assert.equal(getRuntimeWireCodec(methodId).methodId, methodId);
  assert.equal(runtimeRpcAuthPosture(methodId), 'protected_origin_required');
});

test('Home observation DTO exports retain exact protected operation posture', () => {
  assert.equal(typeof DesktopAIExecutionRoute.DESKTOP_AI_EXECUTION_ROUTE_CLOUD, 'number');
  assert.equal(typeof DesktopAIExecutionState.DESKTOP_AI_EXECUTION_STATE_OBSERVATION_UNKNOWN, 'number');
  for (const name of ['GetDesktopAIActivitySnapshot', 'SubscribeDesktopAIActivity', 'GetDesktopAIUsageSummary']) {
    const methodId = `/nimi.runtime.v1.RuntimeAuditService/${name}`;
    assert.equal(runtimeRpcAuthPosture(methodId), 'protected_origin_required');
    assert.equal(hasRuntimeWireCodec(methodId), true);
  }
});
