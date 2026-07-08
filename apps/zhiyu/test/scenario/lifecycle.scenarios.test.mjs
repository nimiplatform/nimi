import assert from 'node:assert/strict';
import test from 'node:test';
import { createFixtureRuntimeAgentClient } from '../../../../sdks/typescript/runtime/runtime-agent-live-e2e-fixture-runtime.test-helper.ts';
import {
  assertCompletedTurnEvidence,
  assertScenarioPageProblemsClean,
  captureScenarioEvidence,
  openScenarioAppPage,
  runtimeAgentLiveE2EChatScenarioPrompt,
  sendScenarioPrompt,
  waitForEvidence,
  withOfflineScenarioApp,
  withZhiyuScenarioApp,
} from './run-context-helpers.mjs';
import { runRepeatedScenario, scenarioTestTimeoutMs } from './repeat-runner-helpers.mjs';

test('C-01 product state projection matches admitted lifecycle stages', { timeout: scenarioTestTimeoutMs() }, async () => {
  await runRepeatedScenario({
    group: 'C',
    id: 'C-01',
    runOnce: async ({ scenarioId, iteration }) => withZhiyuScenarioApp({ scenarioId }, async (context) => {
      const evidence = await context.page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
      const stage = await context.page.locator('[data-zhiyu-product-stage]').getAttribute('data-zhiyu-product-stage');
      const mapping = {
        local_service_unavailable: 'runtime-unavailable',
        no_partner: 'source-required',
        partner_candidates_unselected: 'agent-required',
        model_config_not_ready: 'route-required',
        partner_ready: 'ready',
        partner_responding: 'responding',
        recoverable_failure: 'recoverable-failure',
      };
      assert.equal(stage, 'ready');
      assert.equal(mapping.partner_ready, stage);
      assert.equal(Object.keys(mapping).length, 7);
      return captureScenarioEvidence(context, { scenarioId, iteration, extra: { evidence, mapping, stage } });
    }),
  });
});

test('C-02 AI Config readiness projects ready and not-configured capability states', { timeout: scenarioTestTimeoutMs() }, async () => {
  await runRepeatedScenario({
    group: 'C',
    id: 'C-02',
    runOnce: async ({ scenarioId, iteration }) => withZhiyuScenarioApp({ scenarioId }, async (context) => {
      const route = (await context.page.evaluate(() => globalThis.window.__nimiZhiyuEvidence)).route;
      assert.equal(route.ready, true);
      assert.equal(route.capabilities['text.generate'].state, 'ready');
      assert.equal(route.capabilities['image.generate'].state, 'ready');
      assert.equal(route.capabilities['voice_workflow.voice_clone'].state, 'not_configured');
      return captureScenarioEvidence(context, { scenarioId, iteration, extra: { route } });
    }),
  });
});

test('C-03 AI Config configRevision and readinessRevision stay aligned', { timeout: scenarioTestTimeoutMs() }, async () => {
  await runRepeatedScenario({
    group: 'C',
    id: 'C-03',
    runOnce: async ({ scenarioId, iteration }) => withZhiyuScenarioApp({ scenarioId }, async (context) => {
      const route = (await context.page.evaluate(() => globalThis.window.__nimiZhiyuEvidence)).route;
      assert.equal(route.configRevision, route.readinessRevision);
      assert.equal(route.configRevision, context.config.revision);
      return captureScenarioEvidence(context, { scenarioId, iteration, extra: { route } });
    }),
  });
});

test('C-04 AI Config mutation moves route readiness from unavailable back to ready', { timeout: scenarioTestTimeoutMs() }, async () => {
  await runRepeatedScenario({
    group: 'C',
    id: 'C-04',
    runOnce: async ({ scenarioId, iteration }) => withZhiyuScenarioApp({ scenarioId }, async (context) => {
      const agentAIConfig = createFixtureRuntimeAgentClient(context.fixture.runtime).agentAIConfig;
      const identity = {
        ownerUserId: context.fixture.ownerUserId,
        runtimeSourceRef: context.fixture.runtimeSourceRef,
        localAgentRef: context.fixture.localAgentRef,
      };
      const current = await agentAIConfig.get(identity);
      const unavailable = await agentAIConfig.upsert({
        ...identity,
        expectedRevision: current.revision,
        intents: {
          ...current.intents,
          'text.generate': {
            route: 'cloud',
            modelId: context.fixture.route.executionBinding.modelId,
          },
        },
      });
      await waitForEvidence(context.page, ({ revision }) =>
        globalThis.window.__nimiZhiyuEvidence?.route?.configRevision === revision
        && globalThis.window.__nimiZhiyuEvidence?.route?.ready === false,
        'C-04 route unavailable after config mutation',
        { revision: unavailable.revision },
      );
      const restored = await agentAIConfig.upsert({
        ...identity,
        expectedRevision: unavailable.revision,
        intents: current.intents,
      });
      await waitForEvidence(context.page, ({ revision }) =>
        globalThis.window.__nimiZhiyuEvidence?.route?.configRevision === revision
        && globalThis.window.__nimiZhiyuEvidence?.route?.ready === true,
        'C-04 route ready after config restore',
        { revision: restored.revision },
      );
      const evidence = await context.page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
      return captureScenarioEvidence(context, { scenarioId, iteration, extra: { unavailable, restored, evidence } });
    }),
  });
});

test('C-05 app restart hydrates Runtime conversation and AI Config evidence', { timeout: scenarioTestTimeoutMs() }, async () => {
  await runRepeatedScenario({
    group: 'C',
    id: 'C-05',
    runOnce: async ({ scenarioId, iteration }) => withZhiyuScenarioApp({ scenarioId }, async (context) => {
      const prompt = `${runtimeAgentLiveE2EChatScenarioPrompt('b-single-turn')} C-05 restart hydration.`;
      const before = await sendScenarioPrompt(context, prompt, 'C-05 pre-restart completed chat');
      assert.equal(before.chat.state, 'completed');
      const outputText = before.chat.outputText;
      await context.closeApp();

      const relaunchedApp = await context.launchApp();
      try {
        const relaunched = await openScenarioAppPage({
          app: relaunchedApp,
          fixture: context.fixture,
        });
        await waitForEvidence(relaunched.page, ({ conversationAnchorId, configRevision, text }) =>
          globalThis.window.__nimiZhiyuEvidence?.conversation?.conversationAnchorId === conversationAnchorId
          && globalThis.window.__nimiZhiyuEvidence?.chat?.reasonCode === 'runtime-agent-session-snapshot-hydrated'
          && globalThis.window.__nimiZhiyuEvidence?.chat?.conversationAnchorId === conversationAnchorId
          && globalThis.window.__nimiZhiyuEvidence?.chat?.messageCount >= 2
          && globalThis.window.__nimiZhiyuEvidence?.chat?.eventTypes?.includes('session-snapshot-hydrated')
          && globalThis.window.__nimiZhiyuEvidence?.chat?.messages?.some((message) => message?.text === text)
          && globalThis.window.__nimiZhiyuEvidence?.route?.reasonCode === 'runtime-agent-ai-config-ready'
          && globalThis.window.__nimiZhiyuEvidence?.route?.configRevision === configRevision,
          'C-05 restart hydrated Runtime Agent chat snapshot and route',
          {
            conversationAnchorId: context.readyEvidence.conversation.conversationAnchorId,
            configRevision: context.readyEvidence.route.configRevision,
            text: outputText,
          },
        );
        const after = await relaunched.page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
        assert.equal(after.chat.ready, true);
        assert.equal(after.chat.state, 'completed');
        assert.equal(after.chat.messages.some((message) => message?.text === prompt), true);
        assert.equal(after.chat.messages.some((message) => message?.text === outputText), true);
        assert.equal(after.route.configRevision, context.readyEvidence.route.configRevision);
        assertScenarioPageProblemsClean(relaunched.pageProblems);
        return await captureScenarioEvidence({
          ...context,
          page: relaunched.page,
          pageProblems: relaunched.pageProblems,
        }, { scenarioId, iteration, extra: { before, after } });
      } finally {
        await relaunchedApp.close();
      }
    }),
  });
});

test('C-06 recoverable runtime failure remains non-success and can retry after readiness returns', { timeout: scenarioTestTimeoutMs() }, async () => {
  await runRepeatedScenario({
    group: 'C',
    id: 'C-06',
    runOnce: async ({ scenarioId, iteration }) => {
      let offlineEvidence = null;
      let offlineText = '';
      await withOfflineScenarioApp({ scenarioId }, async (offline) => {
        await offline.page.waitForSelector('.runtime-unavailable-screen');
        const unavailableScreen = offline.page.locator('.runtime-unavailable-screen');
        assert.equal(
          await unavailableScreen.getAttribute('data-zhiyu-runtime-unavailable-reason'),
          'electron-runtime-endpoint-unavailable',
        );
        assert.equal(
          await unavailableScreen.getAttribute('data-zhiyu-runtime-unavailable-action'),
          'start_external_runtime_daemon',
        );
        await waitForEvidence(offline.page, () =>
          globalThis.window.__nimiZhiyuEvidence?.runtime?.ready === false
          && globalThis.window.__nimiZhiyuEvidence?.runtime?.reasonCode === 'electron-runtime-endpoint-unavailable',
          'C-06 runtime unavailable fail-closed evidence',
        );
        offlineEvidence = await offline.page.evaluate(() => globalThis.window.__nimiZhiyuEvidence);
        offlineText = await offline.page.locator('.runtime-unavailable-screen').innerText();
        assert.equal(offlineEvidence.runtime.ready, false);
        assert.equal(offlineEvidence.runtime.reasonCode, 'electron-runtime-endpoint-unavailable');
        assert.doesNotMatch(offlineText, /ECONNREFUSED|start_external_runtime_daemon/u);
        await captureScenarioEvidence({
          ...offline,
          fixture: null,
        }, {
          scenarioId: `${scenarioId}-offline`,
          iteration,
          extra: { offlineEvidence, offlineText },
        });
      });

      return withZhiyuScenarioApp({ scenarioId }, async (context) => {
        const prompt = `${runtimeAgentLiveE2EChatScenarioPrompt('b-single-turn')} C-06 retry after runtime readiness.`;
        const recovered = await sendScenarioPrompt(context, prompt, 'C-06 recovered Runtime Agent chat');
        await assertCompletedTurnEvidence(recovered, {
          conversationAnchorId: context.readyEvidence.conversation.conversationAnchorId,
          prompt,
        });
        assert.equal(recovered.runtime.ready, true);
        assert.notEqual(recovered.chat.reasonCode, 'electron-runtime-endpoint-unavailable');
        return captureScenarioEvidence(context, {
          scenarioId,
          iteration,
          extra: { offlineEvidence, offlineText, recovered },
        });
      });
    },
  });
});

test('C-07 scoped binding lifecycle exposes Runtime-issued turn scopes', { timeout: scenarioTestTimeoutMs() }, async () => {
  await runRepeatedScenario({
    group: 'C',
    id: 'C-07',
    runOnce: async ({ scenarioId, iteration }) => withZhiyuScenarioApp({ scenarioId }, async (context) => {
      const preConfigScopedBinding = await context.page.evaluate(() =>
        globalThis.window.__nimiZhiyuRuntimeAgentBinding?.getScopedBinding?.()
          ?? globalThis.window.__nimiZhiyuRuntimeAgentBinding?.scopedBinding
          ?? null,
      );
      assertDelegationScopedBinding(preConfigScopedBinding, context.fixture, context.readyEvidence);
      const scopedBindingRenewal = await context.page.evaluate(() =>
        globalThis.window.__NIMI_ZHIYU_ELECTRON_SDK_ACCEPTANCE__.renewDelegationScopedBinding(),
      );
      assert.equal(scopedBindingRenewal.ok, true);
      assert.equal(scopedBindingRenewal.reason, 'zhiyu-runtime-agent-scoped-binding-renewed');
      const renewedScopedBinding = scopedBindingRenewal.status;
      assertDelegationScopedBinding(renewedScopedBinding, context.fixture, context.readyEvidence);
      assert.notEqual(
        renewedScopedBinding.bindingId,
        preConfigScopedBinding.bindingId,
        'Runtime scoped binding renewal must issue a fresh binding instead of replaying the initial idempotency key',
      );
      const installedRenewedScopedBinding = await context.page.evaluate(() =>
        globalThis.window.__nimiZhiyuRuntimeAgentBinding?.getScopedBinding?.()
          ?? globalThis.window.__nimiZhiyuRuntimeAgentBinding?.scopedBinding
          ?? null,
      );
      assert.equal(installedRenewedScopedBinding?.bindingId, renewedScopedBinding.bindingId);
      const prompt = `${runtimeAgentLiveE2EChatScenarioPrompt('b-single-turn')} C-07 scoped binding lifecycle.`;
      const evidence = await sendScenarioPrompt(context, prompt, 'C-07 completed Runtime Agent chat before binding read');
      await assertCompletedTurnEvidence(evidence, {
        conversationAnchorId: context.readyEvidence.conversation.conversationAnchorId,
        prompt,
      });
      const issued = await context.page.evaluate(async ({ readyEvidence }) => {
        const invoke = globalThis.window.__NIMI_ELECTRON_RUNTIME__?.invoke
          || globalThis.window.__NIMI_ELECTRON_TEST__?.invoke
          || globalThis.__NIMI_ELECTRON_RUNTIME__?.invoke
          || globalThis.__NIMI_ELECTRON_TEST__?.invoke
          || null;
        if (typeof invoke !== 'function') {
          return { error: 'electron_runtime_invoke_unavailable' };
        }
        return invoke('zhiyu.runtimeAgent.issueScopedBinding', {
          ownerUserId: readyEvidence.conversation.ownerUserId,
          runtimeSourceRef: readyEvidence.conversation.runtimeSourceRef,
          localAgentRef: readyEvidence.conversation.localAgentRef,
          conversationAnchorId: readyEvidence.conversation.conversationAnchorId,
          scopes: ['runtime.agent.turn.read', 'runtime.agent.turn.write'],
          issueRequestId: `zhiyu-scenario-c07-turn-binding:${Date.now()}`,
          forceRenewal: true,
        });
      }, { readyEvidence: context.readyEvidence });
      const binding = issued?.scopedBinding;
      assert.ok(binding?.bindingId);
      assert.equal(binding.bindingSource, 'runtime-account-service');
      assert.equal(binding.runtimeAppId, 'nimi.zhiyu');
      assert.ok(binding.scopes.includes('runtime.agent.turn.read'));
      assert.ok(binding.scopes.includes('runtime.agent.turn.write'));
      return captureScenarioEvidence(context, { scenarioId, iteration, extra: { issued, binding, evidence, preConfigScopedBinding, renewedScopedBinding } });
    }),
  });
});

test('C-08 turn state matrix reaches completed with typed Runtime events', { timeout: scenarioTestTimeoutMs() }, async () => {
  await runRepeatedScenario({
    group: 'C',
    id: 'C-08',
    runOnce: async ({ scenarioId, iteration }) => withZhiyuScenarioApp({ scenarioId }, async (context) => {
      const prompt = `${runtimeAgentLiveE2EChatScenarioPrompt('b-single-turn')} C-08 turn state.`;
      const evidence = await sendScenarioPrompt(context, prompt, 'C-08 completed Runtime Agent chat');
      await assertCompletedTurnEvidence(evidence, {
        conversationAnchorId: context.readyEvidence.conversation.conversationAnchorId,
        prompt,
      });
      assert.deepEqual(
        ['turn-started', 'text-delta', 'message-sealed', 'turn-completed']
          .filter((eventType) => evidence.chat.eventTypes.includes(eventType)),
        ['turn-started', 'text-delta', 'message-sealed', 'turn-completed'],
      );
      return captureScenarioEvidence(context, { scenarioId, iteration, extra: { evidence } });
    }),
  });
});

function assertDelegationScopedBinding(scopedBinding, fixture, readyEvidence) {
  assert.ok(scopedBinding, 'C-07 requires Runtime-issued scoped binding evidence');
  assert.equal(scopedBinding.bindingSource, 'runtime-account-service');
  assert.match(scopedBinding.bindingId, /^[0-9A-HJKMNP-TV-Z]{26}$/);
  assert.equal(scopedBinding.runtimeAppId, 'nimi.zhiyu');
  assert.equal(scopedBinding.appInstanceId, 'nimi.zhiyu.local-first-party');
  assert.equal(scopedBinding.agentId, fixture.localAgentRef);
  assert.equal(scopedBinding.conversationAnchorId, readyEvidence.conversation.conversationAnchorId);
  assert.deepEqual(scopedBinding.scopes, [
    'runtime.agent.delegation.read',
    'runtime.agent.delegation.write',
  ]);
}
