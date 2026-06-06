import test from 'node:test';

import {
  assert,
  E2E_IDS,
  createBaseDriver,
  createRuntimeAgentSmokeProductPathEvidence,
  runDesktopMacosSmokeScenario,
} from './desktop-macos-smoke-test-helpers';
import { waitForAvatarCarrierEvidence } from '../src/shell/renderer/infra/bootstrap/desktop-macos-smoke-avatar-evidence';

const AVATAR_CARRIER_FAILURE_EVIDENCE_TIMEOUT_MS = 50;

function createRuntimeVerifiedAgentAnchorBinding() {
  return {
    ownerUserId: 'user-e2e-primary',
    realmAgentId: 'agent-e2e-alpha',
    localAgentRef: 'local-agent:user-e2e-primary:agent-e2e-alpha',
    conversationAnchorId: 'anchor-1',
    updatedAtMs: Date.now(),
  };
}

function createAvatarLocalAssetResolvedRecord(recordedAt = '2026-04-26T00:00:02.000Z') {
  return {
    kind: 'avatar.visual.local-asset-resolved',
    recordedAt,
    detail: {
      conversation_anchor_id: 'anchor-1',
      local_asset_ref: 'live2d_ab12cd34ef56',
      backend_kind: 'live2d',
      asset_authority: 'local_avatar_asset',
      resolver_authority: 'avatar_local_materialization',
    },
  };
}

function createAvatarCarrierVisualReadyRecord(recordedAt = '2026-04-26T00:00:05.000Z') {
  return {
    kind: 'avatar.carrier.visual',
    recordedAt,
    detail: {
      conversation_anchor_id: 'anchor-1',
      status: 'ready',
      source: 'live2d-carrier-surface',
      visible_pixels: 12,
      visible_drawable_count: 24,
      texture_binding_count: 1,
      sampled_pixels: 96,
      sampled_pixel_checksum: 123456,
      canvas_width: 360,
      canvas_height: 480,
      human_visible_artifact_path: '/tmp/nimi-avatar-evidence/artifacts/instance/live2d-visible-frame.png',
      artifact_mime_type: 'image/png',
      artifact_byte_length: 128,
    },
  };
}

function createAvatarCarrierInteractionRecord(recordedAt = '2026-04-26T00:00:06.000Z') {
  return {
    kind: 'avatar.carrier.interaction',
    recordedAt,
    detail: {
      conversation_anchor_id: 'anchor-1',
      status: 'ready',
      source: 'live2d-carrier-surface',
      active_motion_group: 'Idle',
      active_expression_id: 'exp_01',
      motion_frame_applied: true,
      expression_frame_applied: true,
      visible_pixels: 12,
      visible_drawable_count: 24,
      texture_binding_count: 1,
      sampled_pixels: 96,
      sampled_pixel_checksum: 789012,
      canvas_width: 360,
      canvas_height: 480,
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
      return createRuntimeAgentSmokeProductPathEvidence({
        agentId: input.agentId,
        conversationAnchorId: input.conversationAnchorId,
      });
    },
    async readAgentConversationAnchorBinding() {
      return createRuntimeVerifiedAgentAnchorBinding();
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
            createAvatarLocalAssetResolvedRecord('2026-04-26T00:00:01.500Z'),
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
            evidenceReads >= 2
              ? createAvatarCarrierVisualReadyRecord('2026-04-26T00:00:05.000Z')
              : {
                  kind: 'avatar.carrier.visual',
                  recordedAt: '2026-04-26T00:00:05.000Z',
                  detail: { conversation_anchor_id: 'anchor-1', status: 'ready', visible_pixels: 0 },
                },
            ...(evidenceReads >= 3 ? [createAvatarCarrierInteractionRecord()] : []),
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
    '[data-chat-composer-send="true"]',
  ]);
  assert.deepEqual(values, [
    {
      selector: '[data-chat-composer-textarea="true"]',
      value: 'Wave 2 product smoke anchor turn.',
    },
    {
      selector: '[data-chat-composer-textarea="true"]',
      value: 'Wave 2 product smoke interaction turn.',
    },
  ]);
  assert.equal(runtimeAccountProjectionVerified, true);
  assert.equal(routeConfigured, true);
  assert.equal(staleAnchorsCleared, true);
  assert.equal(runtimeAnchorVerified, true);
  assert.equal(runtimeProductEvidenceRead, true);
  assert.equal(evidenceReads, 3);
  assert.equal(writtenReports.length, 1);
  const report = writtenReports[0] as Record<string, unknown>;
  assert.equal(report.ok, true);
  assert.deepEqual(report.steps, [
    'verify-runtime-account-projection',
    'wait-chat-panel',
    'clear-stale-anchor-bindings',
    'select-agent-target',
    'wait-agent-target-selected',
    'configure-runtime-text-route',
    'submit-anchor-turn',
    'wait-anchor-send-ready',
    'wait-runtime-anchor-binding',
    'wait-runtime-product-path-evidence',
    'wait-avatar-composer-ready',
    'launch-avatar-current-anchor',
    'wait-avatar-same-anchor-registry',
    'wait-avatar-carrier-evidence',
    'wait-avatar-interaction-composer-ready',
    'submit-avatar-interaction-turn',
    'wait-avatar-interaction-send-ready',
    'wait-avatar-live2d-interaction-evidence',
    'write-pass-report',
  ]);
  const details = report.details as { avatarProductPath?: Record<string, unknown> };
  assert.deepEqual(details.avatarProductPath?.runtime, createRuntimeAgentSmokeProductPathEvidence());
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
    details.avatarProductPath?.localAssetResolved,
    createAvatarLocalAssetResolvedRecord('2026-04-26T00:00:01.500Z'),
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
  assert.deepEqual(details.avatarProductPath?.visual, createAvatarCarrierVisualReadyRecord('2026-04-26T00:00:05.000Z'));
  assert.deepEqual(details.avatarProductPath?.interaction, createAvatarCarrierInteractionRecord());
});

test('desktop macos smoke live2d avatar local asset missing scenario requires typed degraded evidence', async () => {
  const clickedSelectors: string[] = [];
  const values: Array<{ selector: string; value: string }> = [];
  const appliedFaults: string[] = [];
  const writtenReports: Array<Record<string, unknown>> = [];

  await runDesktopMacosSmokeScenario('chat.live2d-avatar-local-asset-missing-smoke', createBaseDriver({
    async clickSelector(selector) {
      clickedSelectors.push(selector);
    },
    async setValueBySelector(selector, value) {
      values.push({ selector, value });
    },
    async readRuntimeProductPathEvidence(input) {
      return createRuntimeAgentSmokeProductPathEvidence({
        agentId: input.agentId,
        conversationAnchorId: input.conversationAnchorId,
      });
    },
    async readAgentConversationAnchorBinding() {
      return createRuntimeVerifiedAgentAnchorBinding();
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
        evidencePath: '/tmp/avatar-evidence-local-asset-missing.json',
        evidence: {
          records: [
            {
              kind: 'avatar.runtime.bind-failed',
              recordedAt: '2026-04-26T00:00:02.000Z',
              detail: {
                conversation_anchor_id: 'anchor-1',
                error_stage: 'local_avatar_asset_manifest',
                error_reason_code: 'LOCAL_AVATAR_ASSET_RESOLVE_FAILED',
                error_action_hint: 'reimport_or_select_local_avatar_asset',
                error_source: 'avatar_local_materialization',
                error_retryable: false,
              },
            },
            {
              kind: 'avatar.composition.transition',
              recordedAt: '2026-04-26T00:00:02.500Z',
              detail: {
                from: 'loading',
                to: 'degraded_runtime_unavailable',
                stage: 'local_avatar_asset_manifest',
                reason_code: 'LOCAL_AVATAR_ASSET_RESOLVE_FAILED',
                action_hint: 'reimport_or_select_local_avatar_asset',
                source: 'avatar_local_materialization',
                retryable: false,
              },
            },
            {
              kind: 'avatar.composition.surface-mounted',
              recordedAt: '2026-04-26T00:00:03.000Z',
              detail: {
                surface: 'degraded-surface',
                composition_state: 'degraded_runtime_unavailable',
              },
            },
          ],
        },
      };
    },
    async applyAvatarProductLocalAssetFault(faultKind) {
      appliedFaults.push(faultKind);
      return {
        faultKind,
        manifestPath: '/tmp/avatar-asset/manifest.json',
        removedEntryPath: '/tmp/avatar-asset/files/Hiyori.model3.json',
      };
    },
    async writeReport(payload) {
      writtenReports.push(payload as unknown as Record<string, unknown>);
    },
    currentRoute() {
      return '/chat';
    },
    currentHtml() {
      return '<html>avatar-product-local-asset-missing</html>';
    },
  }));

  assert.deepEqual(clickedSelectors, [
    '[data-chat-composer-send="true"]',
    '[data-agent-composer-avatar="ready_stopped"]',
  ]);
  assert.deepEqual(appliedFaults, ['missing_entry_file']);
  assert.deepEqual(values, [{
    selector: '[data-chat-composer-textarea="true"]',
    value: 'Wave 2 local asset missing degraded turn.',
  }]);
  assert.equal(writtenReports.length, 1);
  const report = writtenReports[0] as Record<string, unknown>;
  assert.equal(report.ok, true);
  assert.deepEqual(report.steps, [
    'verify-runtime-account-projection',
    'wait-chat-panel',
    'clear-stale-anchor-bindings',
    'select-agent-target',
    'wait-agent-target-selected',
    'configure-runtime-text-route',
    'submit-anchor-turn',
    'wait-anchor-send-ready',
    'wait-runtime-anchor-binding',
    'wait-runtime-product-path-evidence',
    'wait-avatar-composer-ready',
    'apply-avatar-local-asset-fault',
    'launch-avatar-current-anchor',
    'wait-avatar-same-anchor-registry',
    'wait-avatar-local-asset-degraded-evidence',
    'write-pass-report',
  ]);
  const details = report.details as { avatarProductDegradedPath?: Record<string, unknown> };
  assert.equal(details.avatarProductDegradedPath?.conversationAnchorId, 'anchor-1');
  assert.equal(details.avatarProductDegradedPath?.evidencePath, '/tmp/avatar-evidence-local-asset-missing.json');
  assert.deepEqual(details.avatarProductDegradedPath?.localAssetFault, {
    faultKind: 'missing_entry_file',
    manifestPath: '/tmp/avatar-asset/manifest.json',
    removedEntryPath: '/tmp/avatar-asset/files/Hiyori.model3.json',
  });
  assert.deepEqual(details.avatarProductDegradedPath?.bindFailure, {
    kind: 'avatar.runtime.bind-failed',
    recordedAt: '2026-04-26T00:00:02.000Z',
    detail: {
      conversation_anchor_id: 'anchor-1',
      error_stage: 'local_avatar_asset_manifest',
      error_reason_code: 'LOCAL_AVATAR_ASSET_RESOLVE_FAILED',
      error_action_hint: 'reimport_or_select_local_avatar_asset',
      error_source: 'avatar_local_materialization',
      error_retryable: false,
    },
  });
});

test('desktop macos smoke live2d avatar product scenario fails without local Avatar asset evidence', async () => {
  const writtenReports: Array<Record<string, unknown>> = [];

  await assert.rejects(
    runDesktopMacosSmokeScenario('chat.live2d-avatar-product-smoke', createBaseDriver({
      avatarCarrierEvidenceTimeoutMs: AVATAR_CARRIER_FAILURE_EVIDENCE_TIMEOUT_MS,
      async readAgentConversationAnchorBinding() {
        return createRuntimeVerifiedAgentAnchorBinding();
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
              createAvatarCarrierVisualReadyRecord('2026-04-26T00:00:05.000Z'),
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
        return '<html>avatar-product-missing-local-asset</html>';
      },
    })),
    /missing same-anchor Avatar local asset\/SDK\/model\/visual evidence/,
  );

  assert.equal(writtenReports.length, 1);
  assert.equal(writtenReports[0]?.ok, false);
  assert.equal(writtenReports[0]?.failedStep, 'wait-avatar-carrier-evidence');
  assert.match(String(writtenReports[0]?.errorMessage || ''), /localAssetResolved:false/);
  assert.match(String(writtenReports[0]?.errorMessage || ''), /live2dLocalAssetResolved:false/);
  assert.match(String(writtenReports[0]?.errorMessage || ''), /consumeReady:true/);
  assert.match(String(writtenReports[0]?.errorMessage || ''), /visual:true/);
});

test('desktop macos smoke avatar carrier evidence reports pre-anchor runtime bind failure detail', async () => {
  const writtenReports: Array<Record<string, unknown>> = [];

  await assert.rejects(
    runDesktopMacosSmokeScenario('chat.live2d-avatar-product-smoke', createBaseDriver({
      avatarCarrierEvidenceTimeoutMs: AVATAR_CARRIER_FAILURE_EVIDENCE_TIMEOUT_MS,
      async readAgentConversationAnchorBinding() {
        return createRuntimeVerifiedAgentAnchorBinding();
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
          evidencePath: '/tmp/avatar-evidence-runtime-bind-failed.json',
          evidence: {
            records: [{
              kind: 'avatar.runtime.bind-failed',
              recordedAt: '2026-04-26T00:00:02.000Z',
              detail: {
                avatar_instance_id: 'desktop-avatar-agent-e2e-alpha-anchor-1',
                agentId: 'local-agent:user-e2e-primary:agent-e2e-alpha',
                runtime_app_id: 'nimi.avatar',
                reason: 'platform_client: RUNTIME_CALL_FAILED / register_runtime_app_first',
                error_stage: 'platform_client',
                error_reason_code: 'RUNTIME_CALL_FAILED',
                error_action_hint: 'register_runtime_app_first',
                error_source: 'runtime',
                error_retryable: false,
                error_message: 'local first-party Runtime account caller registration rejected: 5',
              },
            }],
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
        return '<html>avatar-product-runtime-bind-failed</html>';
      },
    })),
    /Avatar Runtime consume failed before anchor binding/,
  );

  assert.equal(writtenReports.length, 1);
  assert.equal(writtenReports[0]?.ok, false);
  assert.equal(writtenReports[0]?.failedStep, 'wait-avatar-carrier-evidence');
  assert.match(String(writtenReports[0]?.errorMessage || ''), /register_runtime_app_first/);
  assert.match(String(writtenReports[0]?.errorMessage || ''), /local first-party Runtime account caller registration rejected: 5/);
  const details = writtenReports[0]?.details as { avatarCarrierEvidence?: { bindFailure?: Record<string, unknown> } };
  assert.equal(details.avatarCarrierEvidence?.bindFailure?.errorActionHint, 'register_runtime_app_first');
  assert.equal(details.avatarCarrierEvidence?.bindFailure?.errorMessage, 'local first-party Runtime account caller registration rejected: 5');
  assert.equal(details.avatarCarrierEvidence?.bindFailure?.runtimeAppId, 'nimi.avatar');
});

test('desktop macos smoke avatar carrier evidence requires human-visible artifact metadata', async () => {
  await assert.rejects(
    waitForAvatarCarrierEvidence(createBaseDriver({
      async readAvatarEvidence() {
        return {
          evidencePath: '/tmp/avatar-evidence.json',
          evidence: {
            records: [
              {
                kind: 'avatar.startup.runtime-bound',
                recordedAt: '2026-04-26T00:00:00.000Z',
                conversationAnchorId: 'anchor-1',
                detail: { conversation_anchor_id: 'anchor-1' },
              },
              {
                kind: 'avatar.runtime.consume-ready',
                recordedAt: '2026-04-26T00:00:01.000Z',
                conversationAnchorId: 'anchor-1',
                detail: { conversation_anchor_id: 'anchor-1' },
              },
              createAvatarLocalAssetResolvedRecord('2026-04-26T00:00:02.000Z'),
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
                detail: {
                  conversation_anchor_id: 'anchor-1',
                  status: 'ready',
                  visible_pixels: 12,
                  canvas_width: 360,
                  canvas_height: 480,
                },
              },
            ],
          },
        };
      },
    }), 'avatar-instance-1', 'anchor-1', 1),
    /visual:true visualArtifact:false/,
  );
});

test('desktop macos smoke avatar carrier evidence requires local asset resolution before model and visual evidence', async () => {
  await assert.rejects(
    waitForAvatarCarrierEvidence(createBaseDriver({
      async readAvatarEvidence() {
        return {
          evidencePath: '/tmp/avatar-evidence.json',
          evidence: {
            records: [
              {
                kind: 'avatar.startup.runtime-bound',
                recordedAt: '2026-04-26T00:00:00.000Z',
                conversationAnchorId: 'anchor-1',
                detail: { conversation_anchor_id: 'anchor-1' },
              },
              {
                kind: 'avatar.runtime.consume-ready',
                recordedAt: '2026-04-26T00:00:01.000Z',
                conversationAnchorId: 'anchor-1',
                detail: { conversation_anchor_id: 'anchor-1' },
              },
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
              createAvatarCarrierVisualReadyRecord('2026-04-26T00:00:04.000Z'),
              createAvatarLocalAssetResolvedRecord('2026-04-26T00:00:05.000Z'),
            ],
          },
        };
      },
    }), 'avatar-instance-1', 'anchor-1', 1),
    /localAssetResolvedBeforeModelLoad:false/,
  );
});

test('desktop macos smoke live2d avatar product scenario fails without Runtime consume-ready evidence', async () => {
  const writtenReports: Array<Record<string, unknown>> = [];

  await assert.rejects(
    runDesktopMacosSmokeScenario('chat.live2d-avatar-product-smoke', createBaseDriver({
      avatarCarrierEvidenceTimeoutMs: AVATAR_CARRIER_FAILURE_EVIDENCE_TIMEOUT_MS,
      async readAgentConversationAnchorBinding() {
        return createRuntimeVerifiedAgentAnchorBinding();
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
              createAvatarLocalAssetResolvedRecord('2026-04-26T00:00:01.500Z'),
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
              createAvatarCarrierVisualReadyRecord('2026-04-26T00:00:04.000Z'),
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
    /missing same-anchor Avatar local asset\/SDK\/model\/visual evidence/,
  );

  assert.equal(writtenReports.length, 1);
  assert.equal(writtenReports[0]?.ok, false);
  assert.equal(writtenReports[0]?.failedStep, 'wait-avatar-carrier-evidence');
  assert.match(String(writtenReports[0]?.errorMessage || ''), /consumeReady:false/);
  assert.match(String(writtenReports[0]?.errorMessage || ''), /localAssetResolved:true/);
  assert.match(String(writtenReports[0]?.errorMessage || ''), /avatar\.startup\.runtime-bound:anchor-1/);
  assert.match(String(writtenReports[0]?.errorMessage || ''), /avatar\.visual\.local-asset-resolved:anchor-1/);
  assert.match(String(writtenReports[0]?.errorMessage || ''), /avatar\.model\.load:anchor-1/);
  assert.match(String(writtenReports[0]?.errorMessage || ''), /avatar\.carrier\.visual:anchor-1/);
});

test('desktop macos smoke live2d avatar product scenario fails without hit-region evidence', async () => {
  const writtenReports: Array<Record<string, unknown>> = [];

  await assert.rejects(
    runDesktopMacosSmokeScenario('chat.live2d-avatar-product-smoke', createBaseDriver({
      avatarCarrierEvidenceTimeoutMs: AVATAR_CARRIER_FAILURE_EVIDENCE_TIMEOUT_MS,
      async readAgentConversationAnchorBinding() {
        return createRuntimeVerifiedAgentAnchorBinding();
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
              createAvatarLocalAssetResolvedRecord('2026-04-26T00:00:01.500Z'),
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
              createAvatarCarrierVisualReadyRecord('2026-04-26T00:00:05.000Z'),
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
    /missing same-anchor Avatar local asset\/SDK\/model\/visual evidence/,
  );

  assert.equal(writtenReports.length, 1);
  assert.equal(writtenReports[0]?.ok, false);
  assert.equal(writtenReports[0]?.failedStep, 'wait-avatar-carrier-evidence');
  assert.match(String(writtenReports[0]?.errorMessage || ''), /hitRegionDefault:false/);
  assert.match(String(writtenReports[0]?.errorMessage || ''), /lifecycleMounted:true/);
});
