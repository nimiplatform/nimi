import test from 'node:test';

import { assert, E2E_IDS, createBaseDriver, runDesktopMacosSmokeScenario } from './desktop-macos-smoke-test-helpers';

function createAvatarPackageResolvedRecord(recordedAt = '2026-04-26T00:00:02.000Z') {
  return {
    kind: 'avatar.visual.package-resolved',
    recordedAt,
    detail: {
      conversation_anchor_id: 'anchor-1',
      avatar_package_ref: 'live2d_ab12cd34ef56',
      backend_kind: 'live2d',
      backend_capability_profile_ref: 'avatar.backend_profile/live2d/basic',
      materialization_ref: 'agent-center-avatar-package:desktop-smoke:id_8f0290aacb07e123ae912240:live2d:live2d_ab12cd34ef56',
      package_authority: 'runtime_avatar_package_projection',
      resolver_authority: 'local_materialization_only',
    },
  };
}

test('desktop macos smoke live2d render scenario waits for visible pixels before passing', async () => {
  for (const scenarioId of ['chat.live2d-render-smoke', 'chat.live2d-render-smoke-mark', 'chat.live2d-render-smoke-wanko'] as const) {
    const clicked: string[] = [];
    const selectorsWaited: string[] = [];
    const writtenReports: Array<Record<string, unknown>> = [];
    const resizeRequests: Array<{ width: number; height: number }> = [];
    let tinyHostPulseRequests = 0;
    const dprPulseRequests: number[] = [];
    let contextRecoveryRequests = 0;
    let statsReads = 0;

    await runDesktopMacosSmokeScenario(scenarioId, createBaseDriver({
      async waitForSelector(selector) {
        selectorsWaited.push(selector);
      },
      async clickByTestId(id) {
        clicked.push(id);
      },
    async setChatAvatarInteractionOverride() {},
      async resizeLive2dViewport(size) {
        resizeRequests.push(size);
      },
      async pulseLive2dViewportTinyHost() {
        tinyHostPulseRequests += 1;
      },
      async pulseLive2dDevicePixelRatio(value) {
        dprPulseRequests.push(value);
      },
      async triggerLive2dContextLossAndRestore() {
        contextRecoveryRequests += 1;
      },
      async readLive2dCanvasStats(selector) {
        assert.equal(selector, '[data-avatar-live2d-status]');
        statsReads += 1;
        return {
          status: 'ready',
          fallbackText: null,
          width: 320,
          height: 640,
          canvasPresent: true,
          contextKind: 'webgl2',
          sampleCount: 48,
          nonTransparentSampleCount: statsReads >= 2 ? 7 : 0,
          sampleError: null,
          runtimeDebug: null,
        };
      },
      async writeReport(payload) {
        writtenReports.push(payload as unknown as Record<string, unknown>);
      },
      currentRoute() {
        return '/chat';
      },
      currentHtml() {
        return '<html>live2d</html>';
      },
    }));

    assert.deepEqual(clicked, [E2E_IDS.chatTarget('local-agent:user-e2e-primary:agent-e2e-alpha')]);
    assert.deepEqual(selectorsWaited, ['[data-avatar-live2d-status]']);
    assert.equal(tinyHostPulseRequests, 1);
    assert.deepEqual(dprPulseRequests, [1.75]);
    assert.equal(contextRecoveryRequests, 1);
    assert.deepEqual(resizeRequests, [
      { width: 292, height: 520 },
      { width: 360, height: 820 },
    ]);
    assert.equal(writtenReports.length, 1);
    assert.deepEqual(writtenReports[0], {
      ok: true,
      steps: [
        'wait-chat-panel',
        'select-agent-target',
        'wait-live2d-viewport',
        'wait-live2d-visible-pixels',
        'trigger-live2d-context-loss-restore',
        'wait-live2d-visible-pixels-after-context-restore',
        'pulse-live2d-viewport-tiny-host',
        'wait-live2d-visible-pixels-after-tiny-host',
        'pulse-live2d-device-pixel-ratio',
        'wait-live2d-visible-pixels-after-dpr-pulse',
        'resize-live2d-viewport-small',
        'wait-live2d-visible-pixels-after-small-resize',
        'resize-live2d-viewport-restored',
        'wait-live2d-visible-pixels-after-restored-resize',
        'write-pass-report',
      ],
      route: '/chat',
      htmlSnapshot: '<html>live2d</html>',
      details: {
        live2d: {
          initialVisible: {
            status: 'ready',
            fallbackText: null,
            width: 320,
            height: 640,
            canvasPresent: true,
            contextKind: 'webgl2',
            sampleCount: 48,
            nonTransparentSampleCount: 7,
            sampleError: null,
            runtimeDebug: undefined,
          },
          afterContextRestore: {
            status: 'ready',
            fallbackText: null,
            width: 320,
            height: 640,
            canvasPresent: true,
            contextKind: 'webgl2',
            sampleCount: 48,
            nonTransparentSampleCount: 7,
            sampleError: null,
            runtimeDebug: undefined,
          },
          afterTinyHost: {
            status: 'ready',
            fallbackText: null,
            width: 320,
            height: 640,
            canvasPresent: true,
            contextKind: 'webgl2',
            sampleCount: 48,
            nonTransparentSampleCount: 7,
            sampleError: null,
            runtimeDebug: undefined,
          },
          afterDprPulse: {
            status: 'ready',
            fallbackText: null,
            width: 320,
            height: 640,
            canvasPresent: true,
            contextKind: 'webgl2',
            sampleCount: 48,
            nonTransparentSampleCount: 7,
            sampleError: null,
            runtimeDebug: undefined,
          },
          afterSmallResize: {
            status: 'ready',
            fallbackText: null,
            width: 320,
            height: 640,
            canvasPresent: true,
            contextKind: 'webgl2',
            sampleCount: 48,
            nonTransparentSampleCount: 7,
            sampleError: null,
            runtimeDebug: undefined,
          },
          afterRestoredResize: {
            status: 'ready',
            fallbackText: null,
            width: 320,
            height: 640,
            canvasPresent: true,
            contextKind: 'webgl2',
            sampleCount: 48,
            nonTransparentSampleCount: 7,
            sampleError: null,
            runtimeDebug: undefined,
          },
        },
      },
    });
  }
});

test('desktop macos smoke live2d speaking scenario waits for speaking telemetry before passing', async () => {
  const overrides: Array<Record<string, unknown> | null> = [];
  const writtenReports: Array<Record<string, unknown>> = [];
  let statsReads = 0;

  await runDesktopMacosSmokeScenario('chat.live2d-render-smoke-mark-speaking', createBaseDriver({
    async setChatAvatarInteractionOverride(override) {
      overrides.push(override);
    },
    async readLive2dCanvasStats() {
      statsReads += 1;
      const speakingReady = statsReads >= 4;
      return {
        status: 'ready',
        fallbackText: null,
        width: 320,
        height: 640,
        canvasPresent: true,
        contextKind: 'webgl2',
        sampleCount: 48,
        nonTransparentSampleCount: 8,
        sampleError: null,
        runtimeDebug: speakingReady
          ? {
            phase: 'speaking',
            smoothedAmplitude: 0.34,
            speakingEnergy: 0.41,
          }
          : {
            phase: 'idle',
            smoothedAmplitude: 0,
            speakingEnergy: 0,
          },
      };
    },
    async writeReport(payload) {
      writtenReports.push(payload as unknown as Record<string, unknown>);
    },
    currentRoute() {
      return '/chat';
    },
    currentHtml() {
      return '<html>live2d-speaking</html>';
    },
  }));

  assert.deepEqual(overrides, [{
    phase: 'speaking',
    label: 'Speaking…',
    emotion: 'focus',
    amplitude: 0.82,
    visemeId: 'aa',
  }]);
  assert.equal(writtenReports.length, 1);
  assert.deepEqual(writtenReports[0], {
    ok: true,
    steps: [
      'wait-chat-panel',
      'select-agent-target',
      'wait-live2d-viewport',
      'wait-live2d-visible-pixels',
      'set-live2d-speaking-override',
      'wait-live2d-speaking-pose',
      'trigger-live2d-context-loss-restore',
      'wait-live2d-visible-pixels-after-context-restore',
      'pulse-live2d-viewport-tiny-host',
      'wait-live2d-visible-pixels-after-tiny-host',
      'pulse-live2d-device-pixel-ratio',
      'wait-live2d-visible-pixels-after-dpr-pulse',
      'resize-live2d-viewport-small',
      'wait-live2d-visible-pixels-after-small-resize',
      'resize-live2d-viewport-restored',
      'wait-live2d-visible-pixels-after-restored-resize',
      'write-pass-report',
    ],
    route: '/chat',
    htmlSnapshot: '<html>live2d-speaking</html>',
    details: {
      live2d: {
        initialVisible: {
          status: 'ready',
          fallbackText: null,
          width: 320,
          height: 640,
          canvasPresent: true,
          contextKind: 'webgl2',
          sampleCount: 48,
          nonTransparentSampleCount: 8,
          sampleError: null,
          runtimeDebug: {
            phase: 'idle',
            smoothedAmplitude: 0,
            speakingEnergy: 0,
          },
        },
        speakingVisible: {
          status: 'ready',
          fallbackText: null,
          width: 320,
          height: 640,
          canvasPresent: true,
          contextKind: 'webgl2',
          sampleCount: 48,
          nonTransparentSampleCount: 8,
          sampleError: null,
          runtimeDebug: {
            phase: 'speaking',
            smoothedAmplitude: 0.34,
            speakingEnergy: 0.41,
          },
        },
        afterContextRestore: {
          status: 'ready',
          fallbackText: null,
          width: 320,
          height: 640,
          canvasPresent: true,
          contextKind: 'webgl2',
          sampleCount: 48,
          nonTransparentSampleCount: 8,
          sampleError: null,
          runtimeDebug: {
            phase: 'speaking',
            smoothedAmplitude: 0.34,
            speakingEnergy: 0.41,
          },
        },
        afterTinyHost: {
          status: 'ready',
          fallbackText: null,
          width: 320,
          height: 640,
          canvasPresent: true,
          contextKind: 'webgl2',
          sampleCount: 48,
          nonTransparentSampleCount: 8,
          sampleError: null,
          runtimeDebug: {
            phase: 'speaking',
            smoothedAmplitude: 0.34,
            speakingEnergy: 0.41,
          },
        },
        afterDprPulse: {
          status: 'ready',
          fallbackText: null,
          width: 320,
          height: 640,
          canvasPresent: true,
          contextKind: 'webgl2',
          sampleCount: 48,
          nonTransparentSampleCount: 8,
          sampleError: null,
          runtimeDebug: {
            phase: 'speaking',
            smoothedAmplitude: 0.34,
            speakingEnergy: 0.41,
          },
        },
        afterSmallResize: {
          status: 'ready',
          fallbackText: null,
          width: 320,
          height: 640,
          canvasPresent: true,
          contextKind: 'webgl2',
          sampleCount: 48,
          nonTransparentSampleCount: 8,
          sampleError: null,
          runtimeDebug: {
            phase: 'speaking',
            smoothedAmplitude: 0.34,
            speakingEnergy: 0.41,
          },
        },
        afterRestoredResize: {
          status: 'ready',
          fallbackText: null,
          width: 320,
          height: 640,
          canvasPresent: true,
          contextKind: 'webgl2',
          sampleCount: 48,
          nonTransparentSampleCount: 8,
          sampleError: null,
          runtimeDebug: {
            phase: 'speaking',
            smoothedAmplitude: 0.34,
            speakingEnergy: 0.41,
          },
        },
      },
    },
  });
});

test('desktop macos smoke live2d avatar product scenario waits for same-anchor Avatar evidence', async () => {
  const clicked: string[] = [];
  const clickedSelectors: string[] = [];
  const values: Array<{ selector: string; value: string }> = [];
  let runtimeAccountProjectionVerified = false;
  let routeConfigured = false;
  let staleAnchorsCleared = false;
  let runtimeAnchorVerified = false;
  let runtimeProductEvidenceRead = false;
  const writtenReports: Array<Record<string, unknown>> = [];
  let evidenceReads = 0;

  await runDesktopMacosSmokeScenario('chat.live2d-avatar-product-smoke', createBaseDriver({
    async clickByTestId(id) {
      clicked.push(id);
    },
    async clickSelector(selector) {
      clickedSelectors.push(selector);
    },
    async setValueBySelector(selector, value) {
      values.push({ selector, value });
    },
    async verifyRuntimeAccountProjection() {
      runtimeAccountProjectionVerified = true;
    },
    async configureRuntimeTextRoute() {
      routeConfigured = true;
    },
    async clearAgentConversationAnchorBindings() {
      staleAnchorsCleared = true;
    },
    async verifyRuntimeConversationAnchor(input) {
      runtimeAnchorVerified = input.agentId === 'local-agent:user-e2e-primary:agent-e2e-alpha' && input.conversationAnchorId === 'anchor-1';
    },
    async readRuntimeProductPathEvidence(input) {
      runtimeProductEvidenceRead = input.agentId === 'local-agent:user-e2e-primary:agent-e2e-alpha' && input.conversationAnchorId === 'anchor-1';
      return {
        runtime_health: { status: 'healthy', sampled_at: '2026-04-26T00:00:00.000Z' },
        runtime_authenticated: true,
        runtime_auth_scopes: ['runtime.agent.read'],
        same_anchor: true,
        agent_id: input.agentId,
        conversation_anchor_id: input.conversationAnchorId,
        anchor_snapshot: {
          last_turn_id: 'turn-1',
          active_turn_id: null,
          active_stream_id: null,
          last_message_id: 'message-1',
        },
        has_runtime_turn: true,
      };
    },
    async readLocalStorageItem() {
      return JSON.stringify([{
        threadId: 'agent-thread-1',
        localAgentRef: 'local-agent:user-e2e-primary:agent-e2e-alpha',
        conversationAnchorId: 'anchor-1',
        updatedAtMs: Date.now(),
      }]);
    },
    async listAvatarLiveInstances(agentId) {
      assert.equal(agentId, 'local-agent:user-e2e-primary:agent-e2e-alpha');
      return [{
        avatarInstanceId: 'desktop-avatar-agent-e2e-alpha-anchor-1',
        ownerUserId: 'desktop-smoke',
        realmAgentId: 'agent-e2e-alpha',
        localAgentRef: 'local-agent:user-e2e-primary:agent-e2e-alpha',
        launchSource: 'desktop-agent-chat',
      }];
    },
    async readAvatarEvidence(avatarInstanceId) {
      evidenceReads += 1;
      assert.equal(avatarInstanceId, 'desktop-avatar-agent-e2e-alpha-anchor-1');
      return {
        evidencePath: '/tmp/avatar-evidence.json',
        evidence: {
          launchContext: {
            agentId: 'local-agent:user-e2e-primary:agent-e2e-alpha',
            avatarInstanceId,
            conversationAnchorId: 'anchor-1',
          },
          records: [
            {
              kind: 'avatar.startup.runtime-bound',
              recordedAt: '2026-04-26T00:00:01.000Z',
              detail: { driver_kind: 'sdk', authority: 'runtime', conversation_anchor_id: 'anchor-1' },
            },
            createAvatarPackageResolvedRecord('2026-04-26T00:00:01.500Z'),
            {
              kind: 'avatar.runtime.consume-ready',
              recordedAt: '2026-04-26T00:00:02.000Z',
              detail: {
                conversation_anchor_id: 'anchor-1',
                driver_status: 'running',
                session_id: 'anchor-1',
                session_status: 'idle',
                latest_committed_message_id: 'message-1',
                latest_committed_turn_id: 'turn-1',
                scoped_binding_attached: true,
              },
            },
            {
              kind: 'avatar.model.load',
              recordedAt: '2026-04-26T00:00:03.000Z',
              detail: {
                conversation_anchor_id: 'anchor-1',
                model_id: 'ren',
                backend_kind: 'live2d',
                compatibility_tier: 'semantic_basic',
                adapter_id: 'ren-basic',
                backend_metadata: {
                  model_kind: 'live2d',
                  hit_region_default: {
                    body: { left: 0, top: 0, right: 1, bottom: 1 },
                    drag: { left: 0, top: 0, right: 1, bottom: 1 },
                  },
                },
              },
            },
            {
              kind: 'avatar.carrier.visual',
              recordedAt: '2026-04-26T00:00:04.000Z',
              detail: {
                conversation_anchor_id: 'anchor-1',
                lifecycle: 'mounted',
                source: 'live2d-carrier-surface',
              },
            },
            {
              kind: 'avatar.carrier.visual',
              recordedAt: '2026-04-26T00:00:05.000Z',
              detail: {
                conversation_anchor_id: 'anchor-1',
                status: 'ready',
                visible_pixels: evidenceReads >= 2 ? 12 : 0,
                visible_drawable_count: 24,
                texture_binding_count: 1,
                sampled_pixels: 96,
                sampled_pixel_checksum: 123456,
                canvas_width: 360,
                canvas_height: 480,
              },
            },
          ],
        },
      };
    },
    async writeReport(payload) {
      writtenReports.push(payload as unknown as Record<string, unknown>);
    },
    currentRoute() {
      return '/chat';
    },
    currentHtml() {
      return '<html>avatar-product</html>';
    },
  }));

  assert.deepEqual(clicked, [
    E2E_IDS.chatTarget('local-agent:user-e2e-primary:agent-e2e-alpha'),
  ]);
  assert.deepEqual(clickedSelectors, [
    '[data-chat-composer-send="true"]',
    '[data-agent-composer-avatar="ready_stopped"]',
  ]);
  assert.deepEqual(values, [{
    selector: '[data-chat-composer-textarea="true"]',
    value: 'Wave 2 product smoke anchor turn.',
  }]);
  assert.equal(runtimeAccountProjectionVerified, true);
  assert.equal(routeConfigured, true);
  assert.equal(staleAnchorsCleared, true);
  assert.equal(runtimeAnchorVerified, true);
  assert.equal(runtimeProductEvidenceRead, true);
  assert.equal(evidenceReads, 2);
  assert.equal(writtenReports.length, 1);
  const report = writtenReports[0] as Record<string, unknown>;
  assert.equal(report.ok, true);
  assert.deepEqual(report.steps, [
    'wait-chat-panel',
    'verify-runtime-account-projection',
    'clear-stale-anchor-bindings',
    'select-agent-target',
    'wait-agent-target-selected',
    'configure-runtime-text-route',
    'submit-anchor-turn',
    'wait-runtime-anchor-binding',
    'wait-runtime-product-path-evidence',
    'wait-avatar-composer-ready',
    'launch-avatar-current-anchor',
    'wait-avatar-same-anchor-registry',
    'wait-avatar-carrier-evidence',
    'write-pass-report',
  ]);
  const details = report.details as { avatarProductPath?: Record<string, unknown> };
  assert.deepEqual(details.avatarProductPath?.runtime, {
    runtime_health: { status: 'healthy', sampled_at: '2026-04-26T00:00:00.000Z' },
    runtime_authenticated: true,
    runtime_auth_scopes: ['runtime.agent.read'],
    same_anchor: true,
    agent_id: 'local-agent:user-e2e-primary:agent-e2e-alpha',
    conversation_anchor_id: 'anchor-1',
    anchor_snapshot: {
      last_turn_id: 'turn-1',
      active_turn_id: null,
      active_stream_id: null,
      last_message_id: 'message-1',
    },
    has_runtime_turn: true,
  });
  assert.deepEqual(details.avatarProductPath?.consumeReady, {
    kind: 'avatar.runtime.consume-ready',
    recordedAt: '2026-04-26T00:00:02.000Z',
    detail: {
      conversation_anchor_id: 'anchor-1',
      driver_status: 'running',
      session_id: 'anchor-1',
      session_status: 'idle',
      latest_committed_message_id: 'message-1',
      latest_committed_turn_id: 'turn-1',
      scoped_binding_attached: true,
    },
  });
  assert.deepEqual(
    details.avatarProductPath?.packageResolved,
    createAvatarPackageResolvedRecord('2026-04-26T00:00:01.500Z'),
  );
  assert.deepEqual(details.avatarProductPath?.modelLoad, {
    kind: 'avatar.model.load',
    recordedAt: '2026-04-26T00:00:03.000Z',
    detail: {
      conversation_anchor_id: 'anchor-1',
      model_id: 'ren',
      backend_kind: 'live2d',
      compatibility_tier: 'semantic_basic',
      adapter_id: 'ren-basic',
      backend_metadata: {
        model_kind: 'live2d',
        hit_region_default: {
          body: { left: 0, top: 0, right: 1, bottom: 1 },
          drag: { left: 0, top: 0, right: 1, bottom: 1 },
        },
      },
    },
  });
  assert.deepEqual(details.avatarProductPath?.lifecycleMounted, {
    kind: 'avatar.carrier.visual',
    recordedAt: '2026-04-26T00:00:04.000Z',
    detail: {
      conversation_anchor_id: 'anchor-1',
      lifecycle: 'mounted',
      source: 'live2d-carrier-surface',
    },
  });
  assert.deepEqual(details.avatarProductPath?.visual, {
    kind: 'avatar.carrier.visual',
    recordedAt: '2026-04-26T00:00:05.000Z',
    detail: {
      conversation_anchor_id: 'anchor-1',
      status: 'ready',
      visible_pixels: 12,
      visible_drawable_count: 24,
      texture_binding_count: 1,
      sampled_pixels: 96,
      sampled_pixel_checksum: 123456,
      canvas_width: 360,
      canvas_height: 480,
    },
  });
});

test('desktop macos smoke live2d avatar product scenario fails without Runtime package handoff evidence', async () => {
  const writtenReports: Array<Record<string, unknown>> = [];

  await assert.rejects(
    runDesktopMacosSmokeScenario('chat.live2d-avatar-product-smoke', createBaseDriver({
      avatarCarrierEvidenceTimeoutMs: 1,
      async readLocalStorageItem() {
        return JSON.stringify([{
          threadId: 'agent-thread-1',
          localAgentRef: 'local-agent:user-e2e-primary:agent-e2e-alpha',
          conversationAnchorId: 'anchor-1',
          updatedAtMs: Date.now(),
        }]);
      },
      async listAvatarLiveInstances(agentId) {
        assert.equal(agentId, 'local-agent:user-e2e-primary:agent-e2e-alpha');
        return [{
          avatarInstanceId: 'desktop-avatar-agent-e2e-alpha-anchor-1',
          ownerUserId: 'desktop-smoke',
          realmAgentId: 'agent-e2e-alpha',
          localAgentRef: 'local-agent:user-e2e-primary:agent-e2e-alpha',
          launchSource: 'desktop-agent-chat',
        }];
      },
      async readAvatarEvidence(avatarInstanceId) {
        assert.equal(avatarInstanceId, 'desktop-avatar-agent-e2e-alpha-anchor-1');
        return {
          evidencePath: '/tmp/avatar-evidence.json',
          evidence: {
            records: [
              {
                kind: 'avatar.startup.runtime-bound',
                recordedAt: '2026-04-26T00:00:01.000Z',
                detail: { conversation_anchor_id: 'anchor-1' },
              },
              {
                kind: 'avatar.runtime.consume-ready',
                recordedAt: '2026-04-26T00:00:02.000Z',
                detail: {
                  conversation_anchor_id: 'anchor-1',
                  driver_status: 'running',
                  scoped_binding_attached: true,
                },
              },
              {
                kind: 'avatar.model.load',
                recordedAt: '2026-04-26T00:00:03.000Z',
                detail: {
                  conversation_anchor_id: 'anchor-1',
                  model_id: 'ren',
                  backend_kind: 'live2d',
                  backend_metadata: {
                    model_kind: 'live2d',
                    hit_region_default: {
                      body: { left: 0, top: 0, right: 1, bottom: 1 },
                      drag: { left: 0, top: 0, right: 1, bottom: 1 },
                    },
                  },
                },
              },
              {
                kind: 'avatar.carrier.visual',
                recordedAt: '2026-04-26T00:00:04.000Z',
                detail: {
                  conversation_anchor_id: 'anchor-1',
                  lifecycle: 'mounted',
                  source: 'live2d-carrier-surface',
                },
              },
              {
                kind: 'avatar.carrier.visual',
                recordedAt: '2026-04-26T00:00:05.000Z',
                detail: { conversation_anchor_id: 'anchor-1', status: 'ready', visible_pixels: 12 },
              },
            ],
          },
        };
      },
      async writeReport(payload) {
        writtenReports.push(payload as unknown as Record<string, unknown>);
      },
      currentRoute() {
        return '/chat';
      },
      currentHtml() {
        return '<html>avatar-product-missing-package-handoff</html>';
      },
    })),
    /missing same-anchor Avatar package\/SDK\/model\/visual evidence/,
  );

  assert.equal(writtenReports.length, 1);
  assert.equal(writtenReports[0]?.ok, false);
  assert.equal(writtenReports[0]?.failedStep, 'wait-avatar-carrier-evidence');
  assert.match(String(writtenReports[0]?.errorMessage || ''), /packageResolved:false/);
  assert.match(String(writtenReports[0]?.errorMessage || ''), /live2dPackageResolved:false/);
  assert.match(String(writtenReports[0]?.errorMessage || ''), /consumeReady:true/);
  assert.match(String(writtenReports[0]?.errorMessage || ''), /visual:true/);
});

test('desktop macos smoke live2d avatar product scenario fails without Runtime consume-ready evidence', async () => {
  const writtenReports: Array<Record<string, unknown>> = [];

  await assert.rejects(
    runDesktopMacosSmokeScenario('chat.live2d-avatar-product-smoke', createBaseDriver({
      avatarCarrierEvidenceTimeoutMs: 1,
      async readLocalStorageItem() {
        return JSON.stringify([{
          threadId: 'agent-thread-1',
          localAgentRef: 'local-agent:user-e2e-primary:agent-e2e-alpha',
          conversationAnchorId: 'anchor-1',
          updatedAtMs: Date.now(),
        }]);
      },
      async listAvatarLiveInstances(agentId) {
        assert.equal(agentId, 'local-agent:user-e2e-primary:agent-e2e-alpha');
        return [{
          avatarInstanceId: 'desktop-avatar-agent-e2e-alpha-anchor-1',
          ownerUserId: 'desktop-smoke',
          realmAgentId: 'agent-e2e-alpha',
          localAgentRef: 'local-agent:user-e2e-primary:agent-e2e-alpha',
          launchSource: 'desktop-agent-chat',
        }];
      },
      async readAvatarEvidence(avatarInstanceId) {
        assert.equal(avatarInstanceId, 'desktop-avatar-agent-e2e-alpha-anchor-1');
        return {
          evidencePath: '/tmp/avatar-evidence.json',
          evidence: {
            records: [
              {
                kind: 'avatar.startup.runtime-bound',
                recordedAt: '2026-04-26T00:00:01.000Z',
                detail: { conversation_anchor_id: 'anchor-1' },
              },
              createAvatarPackageResolvedRecord('2026-04-26T00:00:01.500Z'),
              {
                kind: 'avatar.model.load',
                recordedAt: '2026-04-26T00:00:02.000Z',
                detail: {
                  conversation_anchor_id: 'anchor-1',
                  model_id: 'ren',
                  backend_kind: 'live2d',
                  backend_metadata: {
                    model_kind: 'live2d',
                    hit_region_default: {
                      body: { left: 0, top: 0, right: 1, bottom: 1 },
                      drag: { left: 0, top: 0, right: 1, bottom: 1 },
                    },
                  },
                },
              },
              {
                kind: 'avatar.carrier.visual',
                recordedAt: '2026-04-26T00:00:03.000Z',
                detail: {
                  conversation_anchor_id: 'anchor-1',
                  lifecycle: 'mounted',
                  source: 'live2d-carrier-surface',
                },
              },
              {
                kind: 'avatar.carrier.visual',
                recordedAt: '2026-04-26T00:00:04.000Z',
                detail: { conversation_anchor_id: 'anchor-1', status: 'ready', visible_pixels: 12 },
              },
            ],
          },
        };
      },
      async writeReport(payload) {
        writtenReports.push(payload as unknown as Record<string, unknown>);
      },
      currentRoute() {
        return '/chat';
      },
      currentHtml() {
        return '<html>avatar-product-missing-consume-ready</html>';
      },
    })),
    /missing same-anchor Avatar package\/SDK\/model\/visual evidence/,
  );

  assert.equal(writtenReports.length, 1);
  assert.equal(writtenReports[0]?.ok, false);
  assert.equal(writtenReports[0]?.failedStep, 'wait-avatar-carrier-evidence');
  assert.match(String(writtenReports[0]?.errorMessage || ''), /consumeReady:false/);
  assert.match(String(writtenReports[0]?.errorMessage || ''), /packageResolved:true/);
  assert.match(String(writtenReports[0]?.errorMessage || ''), /avatar\.startup\.runtime-bound:anchor-1/);
  assert.match(String(writtenReports[0]?.errorMessage || ''), /avatar\.visual\.package-resolved:anchor-1/);
  assert.match(String(writtenReports[0]?.errorMessage || ''), /avatar\.model\.load:anchor-1/);
  assert.match(String(writtenReports[0]?.errorMessage || ''), /avatar\.carrier\.visual:anchor-1/);
});

test('desktop macos smoke live2d avatar product scenario fails without hit-region evidence', async () => {
  const writtenReports: Array<Record<string, unknown>> = [];

  await assert.rejects(
    runDesktopMacosSmokeScenario('chat.live2d-avatar-product-smoke', createBaseDriver({
      avatarCarrierEvidenceTimeoutMs: 1,
      async readLocalStorageItem() {
        return JSON.stringify([{
          threadId: 'agent-thread-1',
          localAgentRef: 'local-agent:user-e2e-primary:agent-e2e-alpha',
          conversationAnchorId: 'anchor-1',
          updatedAtMs: Date.now(),
        }]);
      },
      async listAvatarLiveInstances(agentId) {
        assert.equal(agentId, 'local-agent:user-e2e-primary:agent-e2e-alpha');
        return [{
          avatarInstanceId: 'desktop-avatar-agent-e2e-alpha-anchor-1',
          ownerUserId: 'desktop-smoke',
          realmAgentId: 'agent-e2e-alpha',
          localAgentRef: 'local-agent:user-e2e-primary:agent-e2e-alpha',
          launchSource: 'desktop-agent-chat',
        }];
      },
      async readAvatarEvidence(avatarInstanceId) {
        assert.equal(avatarInstanceId, 'desktop-avatar-agent-e2e-alpha-anchor-1');
        return {
          evidencePath: '/tmp/avatar-evidence.json',
          evidence: {
            records: [
              {
                kind: 'avatar.startup.runtime-bound',
                recordedAt: '2026-04-26T00:00:01.000Z',
                detail: { conversation_anchor_id: 'anchor-1' },
              },
              createAvatarPackageResolvedRecord('2026-04-26T00:00:01.500Z'),
              {
                kind: 'avatar.runtime.consume-ready',
                recordedAt: '2026-04-26T00:00:02.000Z',
                detail: {
                  conversation_anchor_id: 'anchor-1',
                  driver_status: 'running',
                  scoped_binding_attached: true,
                },
              },
              {
                kind: 'avatar.model.load',
                recordedAt: '2026-04-26T00:00:03.000Z',
                detail: {
                  conversation_anchor_id: 'anchor-1',
                  model_id: 'ren',
                  backend_kind: 'live2d',
                  backend_metadata: {
                    model_kind: 'live2d',
                  },
                },
              },
              {
                kind: 'avatar.carrier.visual',
                recordedAt: '2026-04-26T00:00:04.000Z',
                detail: {
                  conversation_anchor_id: 'anchor-1',
                  lifecycle: 'mounted',
                  source: 'live2d-carrier-surface',
                },
              },
              {
                kind: 'avatar.carrier.visual',
                recordedAt: '2026-04-26T00:00:05.000Z',
                detail: { conversation_anchor_id: 'anchor-1', status: 'ready', visible_pixels: 12 },
              },
            ],
          },
        };
      },
      async writeReport(payload) {
        writtenReports.push(payload as unknown as Record<string, unknown>);
      },
      currentRoute() {
        return '/chat';
      },
      currentHtml() {
        return '<html>avatar-product-missing-hit-region</html>';
      },
    })),
    /missing same-anchor Avatar package\/SDK\/model\/visual evidence/,
  );

  assert.equal(writtenReports.length, 1);
  assert.equal(writtenReports[0]?.ok, false);
  assert.equal(writtenReports[0]?.failedStep, 'wait-avatar-carrier-evidence');
  assert.match(String(writtenReports[0]?.errorMessage || ''), /hitRegionDefault:false/);
  assert.match(String(writtenReports[0]?.errorMessage || ''), /lifecycleMounted:true/);
});
