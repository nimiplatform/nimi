import assert from 'node:assert/strict';

const delegationScopes = [
  'runtime.agent.delegation.read',
  'runtime.agent.delegation.write',
];
const admittedRuntimeAgentAIConfigCapabilities = [
  'audio.synthesize',
  'audio.transcribe',
  'image.generate',
  'text.embed',
  'text.generate',
  'voice_workflow.voice_clone',
  'voice_workflow.voice_design',
];

export async function assertPreConfigRuntimeEvidence(page, fixture, zhiyuAppId) {
  const preConfigEvidence = await page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
  const preConfigScopedBinding = await page.evaluate(() =>
    globalThis.window.__nimiZhiyuRuntimeAgentBinding?.getScopedBinding?.()
      ?? globalThis.window.__nimiZhiyuRuntimeAgentBinding?.scopedBinding
      ?? null,
  );
  assert.equal(preConfigEvidence.runtime.reasonCode, 'ready');
  assert.equal(preConfigEvidence.auth.accountId, fixture.ownerUserId);
  assert.equal(preConfigEvidence.source.source, 'sdk-fixture');
  assert.equal(preConfigEvidence.source.runtimeSourceRef, fixture.runtimeSourceRef);
  assert.equal(preConfigEvidence.localAgent.localAgentRef, fixture.localAgentRef);
  assert.match(preConfigEvidence.conversation.conversationAnchorId, /^agent_anchor_/);
  assert.equal(preConfigEvidence.delegation.ready, true);
  assert.equal(preConfigEvidence.delegation.source, 'runtime');
  assert.equal(preConfigEvidence.delegation.reasonCode, 'runtime-delegation-control-surface-ready');
  assert.equal(preConfigEvidence.delegation.ownerUserId, fixture.ownerUserId);
  assert.equal(preConfigEvidence.delegation.localAgentRef, fixture.localAgentRef);
  assert.equal(preConfigEvidence.delegation.conversationAnchorId, preConfigEvidence.conversation.conversationAnchorId);
  assertRuntimeScopedBinding({
    scopedBinding: preConfigScopedBinding,
    fixture,
    zhiyuAppId,
    preConfigEvidence,
    expectedScopes: delegationScopes,
  });

  const scopedBindingRenewal = await page.evaluate(() =>
    globalThis.window.__NIMI_ZHIYU_ELECTRON_SDK_ACCEPTANCE__.renewDelegationScopedBinding(),
  );
  assert.equal(scopedBindingRenewal.ok, true);
  assert.equal(scopedBindingRenewal.reason, 'zhiyu-runtime-agent-scoped-binding-renewed');
  const renewedScopedBinding = scopedBindingRenewal.status;
  assertRuntimeScopedBinding({
    scopedBinding: renewedScopedBinding,
    fixture,
    zhiyuAppId,
    preConfigEvidence,
    expectedScopes: delegationScopes,
  });
  assert.notEqual(
    renewedScopedBinding.bindingId,
    preConfigScopedBinding.bindingId,
    'Runtime scoped binding renewal must issue a fresh binding instead of replaying the initial idempotency key',
  );
  const installedRenewedScopedBinding = await page.evaluate(() =>
    globalThis.window.__nimiZhiyuRuntimeAgentBinding?.getScopedBinding?.()
      ?? globalThis.window.__nimiZhiyuRuntimeAgentBinding?.scopedBinding
      ?? null,
  );
  assert.equal(installedRenewedScopedBinding?.bindingId, renewedScopedBinding.bindingId);
  assert.equal(preConfigEvidence.memory.ready, true);
  assert.match(preConfigEvidence.memory.state, /^(ready|empty)$/);
  // Pre-config route truth is the K-AGCORE-150 runtime-seeded AI Config:
  // text.generate=local/default resolves ready on a fresh daemon and
  // optional media capabilities stay not_configured until an app or fixture
  // commits them.
  assert.equal(preConfigEvidence.route.ready, true);
  assert.equal(preConfigEvidence.route.reasonCode, 'runtime-agent-ai-config-ready');
  assert.equal(preConfigEvidence.route.capability, 'text.generate');
  assert.equal(preConfigEvidence.route.configRevision, 1);
  assert.equal(preConfigEvidence.route.readinessRevision, 1);
  assert.equal(preConfigEvidence.route.updatedByAppId, 'runtime');
  assert.ok(preConfigEvidence.route.updatedAt, 'seeded Runtime Agent AI Config must carry a commit timestamp');
  assert.equal(preConfigEvidence.route.executionBinding.route, 'local');
  assert.equal(preConfigEvidence.route.executionBinding.modelId, 'local/default');
  assert.deepEqual(
    Object.keys(preConfigEvidence.route.capabilities).sort(),
    admittedRuntimeAgentAIConfigCapabilities,
  );
  assert.equal(preConfigEvidence.route.capabilities['text.generate'].state, 'ready');
  assert.equal(preConfigEvidence.route.capabilities['text.generate'].binding.modelId, 'local/default');
  assert.equal(preConfigEvidence.route.capabilities['text.embed'].state, 'ready');
  assert.equal(preConfigEvidence.route.capabilities['text.embed'].binding.modelId, 'local/default-embedding');
  assert.equal(preConfigEvidence.route.capabilities['image.generate'].state, 'not_configured');
  assert.equal(preConfigEvidence.route.capabilities['image.generate'].binding, null);
  assert.equal(preConfigEvidence.route.capabilities['audio.synthesize'].state, 'not_configured');
  assert.equal(preConfigEvidence.route.capabilities['audio.synthesize'].binding, null);
  assert.equal(preConfigEvidence.route.capabilities['audio.transcribe'].state, 'not_configured');
  assert.equal(preConfigEvidence.route.capabilities['audio.transcribe'].binding, null);
  assert.equal(preConfigEvidence.route.capabilities['voice_workflow.voice_clone'].state, 'not_configured');
  assert.equal(preConfigEvidence.route.capabilities['voice_workflow.voice_design'].state, 'not_configured');
  return { preConfigEvidence, preConfigScopedBinding, renewedScopedBinding };
}

function assertRuntimeScopedBinding({ scopedBinding, fixture, zhiyuAppId, preConfigEvidence, expectedScopes }) {
  assert.ok(scopedBinding, 'Zhiyu must expose Runtime-issued scoped binding evidence after delegation probe');
  assert.equal(scopedBinding.bindingSource, 'runtime-account-service');
  assert.match(scopedBinding.bindingId, /^[0-9A-HJKMNP-TV-Z]{26}$/);
  assert.equal(scopedBinding.runtimeAppId, zhiyuAppId);
  assert.equal(scopedBinding.appInstanceId, `${zhiyuAppId}.local-first-party`);
  assert.equal(scopedBinding.agentId, fixture.localAgentRef);
  assert.equal(scopedBinding.conversationAnchorId, preConfigEvidence.conversation.conversationAnchorId);
  assert.deepEqual(scopedBinding.scopes, expectedScopes);
}
