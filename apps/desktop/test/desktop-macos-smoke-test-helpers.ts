import assert from 'node:assert/strict';

import { E2E_IDS } from '../src/shell/renderer/testability/e2e-ids';
import {
  buildDesktopMacosSmokeFailureReportPayload,
  shouldStartDesktopMacosSmoke,
} from '../src/shell/renderer/infra/bootstrap/desktop-macos-smoke-shared';
import {
  runDesktopMacosSmokeScenario,
} from '../src/shell/renderer/infra/bootstrap/desktop-macos-smoke-scenarios';
import type { NimiRuntimeAgentSmokeProductPathEvidence } from '@nimiplatform/sdk/runtime';

export { assert, E2E_IDS, buildDesktopMacosSmokeFailureReportPayload, runDesktopMacosSmokeScenario, shouldStartDesktopMacosSmoke };

export function createEmptyLive2dCanvasStats() {
  return {
    status: null,
    fallbackText: null,
    width: 0,
    height: 0,
    canvasPresent: false,
    contextKind: null,
    sampleCount: 0,
    nonTransparentSampleCount: 0,
    sampleError: null,
    runtimeDebug: null,
  };
}

export function createEmptyVrmCanvasStats() {
  return {
    status: null,
    stage: null,
    fallbackText: null,
    width: 0,
    height: 0,
    canvasPresent: false,
    contextKind: null,
    sampleCount: 0,
    nonTransparentSampleCount: 0,
    sampleError: null,
    runtimeDebug: null,
  };
}

export function createRuntimeAgentSmokeProductPathEvidence(input: {
  agentId?: string;
  conversationAnchorId?: string;
  subjectUserId?: string;
  hasRuntimeTurn?: boolean;
} = {}): NimiRuntimeAgentSmokeProductPathEvidence {
  const agentId = input.agentId ?? 'local-agent:user-e2e-primary:agent-e2e-alpha';
  const conversationAnchorId = input.conversationAnchorId ?? 'anchor-1';
  return {
    runtime_health: {
      status: 'healthy',
      reason: null,
      queue_depth: 0,
      active_workflows: 0,
      active_inference_jobs: 0,
      sampled_at: '2026-04-26T00:00:00.000Z',
    },
    runtime_authenticated: true,
    runtime_auth_scopes: ['runtime.agent.read'],
    same_anchor: true,
    agent_id: agentId,
    conversation_anchor_id: conversationAnchorId,
    subject_user_id: input.subjectUserId ?? 'user-e2e-primary',
    anchor_snapshot: {
      status: 'active',
      last_turn_id: input.hasRuntimeTurn === false ? null : 'turn-1',
      active_turn_id: null,
      active_stream_id: null,
      last_message_id: input.hasRuntimeTurn === false ? null : 'message-1',
    },
    has_runtime_turn: input.hasRuntimeTurn ?? true,
  };
}

export function createBaseDriver(
  overrides: Partial<Parameters<typeof runDesktopMacosSmokeScenario>[1]> = {},
): Parameters<typeof runDesktopMacosSmokeScenario>[1] {
  return {
    async waitForTestId() {},
    async waitForSelector() {},
    async waitForSelectorEnabled() {},
    async waitForSelectorGone() {},
    async clickByTestId() {},
    async clickSelector() {},
    async setValueBySelector() {},
    async verifyRuntimeAccountProjection() {},
    async readAgentConversationAnchorBinding() {
      return null;
    },
    async clearAgentConversationAnchorBindings() {},
    async configureRuntimeTextRoute() {},
    async verifyRuntimeConversationAnchor() {},
    async readRuntimeProductPathEvidence() {
      return createRuntimeAgentSmokeProductPathEvidence();
    },
    async setChatAvatarInteractionOverride() {},
    async resizeLive2dViewport() {},
    async pulseLive2dViewportTinyHost() {},
    async pulseLive2dDevicePixelRatio() {},
    async triggerLive2dContextLossAndRestore() {},
    async resizeVrmViewport() {},
    async pulseVrmViewportTinyHost() {},
    async triggerVrmContextLossAndRestore() {},
    async readAttributeByTestId() {
      return null;
    },
    async readTextByTestId() {
      return '';
    },
    async readLive2dCanvasStats() {
      return createEmptyLive2dCanvasStats();
    },
    async readVrmCanvasStats() {
      return createEmptyVrmCanvasStats();
    },
    async listAvatarLiveInstances() {
      return [];
    },
    async readAvatarEvidence() {
      return {
        evidencePath: '',
        evidence: {},
      };
    },
    async applyAvatarProductLocalAssetFault() {
      return {};
    },
    async writeReport() {},
    currentRoute() {
      return '/';
    },
    currentHtml() {
      return '<html></html>';
    },
    ...overrides,
  };
}
