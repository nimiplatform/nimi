import assert from 'node:assert/strict';

import { E2E_IDS } from '../src/shell/renderer/testability/e2e-ids';
import {
  buildDesktopMacosSmokeFailureReportPayload,
  runDesktopMacosSmokeScenario,
  shouldStartDesktopMacosSmoke,
} from '../src/shell/renderer/infra/bootstrap/desktop-macos-smoke';

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

export function createBaseDriver(
  overrides: Partial<Parameters<typeof runDesktopMacosSmokeScenario>[1]> = {},
): Parameters<typeof runDesktopMacosSmokeScenario>[1] {
  return {
    async waitForTestId() {},
    async waitForSelector() {},
    async waitForSelectorGone() {},
    async clickByTestId() {},
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
