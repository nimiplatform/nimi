import { useEffect, useRef, useState } from 'react';
import { hasTauriInvoke } from '@renderer/bridge/runtime-bridge/env';
import {
  getDesktopMacosSmokeContext,
  pingDesktopMacosSmoke,
  writeDesktopMacosSmokeReport,
} from '@renderer/bridge/runtime-bridge/macos-smoke';
import type { DesktopMacosSmokeContext } from '@renderer/bridge/runtime-bridge/types';
import { E2E_IDS } from '@renderer/testability/e2e-ids';
import { createRendererFlowId, logRendererEvent } from '@renderer/infra/telemetry/renderer-log';

const SMOKE_STEP_TIMEOUT_MS = 15000;
const SMOKE_BOOTSTRAP_TIMEOUT_MS = 60000;

export function shouldStartDesktopMacosSmoke(input: {
  bootstrapReady: boolean;
  context: DesktopMacosSmokeContext | null;
  alreadyStarted: boolean;
}): boolean {
  return input.bootstrapReady
    && !input.alreadyStarted
    && Boolean(input.context?.enabled)
    && Boolean(input.context?.scenarioId);
}

type DesktopMacosSmokeDriverDeps = {
  waitForTestId: (id: string, timeoutMs?: number) => Promise<void>;
  waitForSelector: (selector: string, timeoutMs?: number) => Promise<void>;
  clickByTestId: (id: string, timeoutMs?: number) => Promise<void>;
  setLive2dInteractionOverride: (override: Record<string, unknown> | null) => Promise<void>;
  resizeLive2dViewport: (size: { width: number; height: number }) => Promise<void>;
  pulseLive2dViewportTinyHost: () => Promise<void>;
  pulseLive2dDevicePixelRatio: (value: number) => Promise<void>;
  triggerLive2dContextLossAndRestore: () => Promise<void>;
  readTextByTestId: (id: string) => Promise<string>;
  readAttributeByTestId: (id: string, name: string) => Promise<string | null>;
  readLive2dCanvasStats: (selector: string) => Promise<{
    status: string | null;
    fallbackText: string | null;
    width: number;
    height: number;
    canvasPresent: boolean;
    contextKind: 'webgl2' | 'webgl' | null;
    sampleCount: number;
    nonTransparentSampleCount: number;
    sampleError: string | null;
    runtimeDebug: Record<string, unknown> | null;
  }>;
  writeReport: (payload: {
    ok: boolean;
    failedStep?: string;
    steps: string[];
    errorMessage?: string;
    errorName?: string;
    errorStack?: string;
    errorCause?: string;
    route?: string;
    htmlSnapshot?: string;
    details?: Record<string, unknown>;
  }) => Promise<void>;
  currentRoute: () => string;
  currentHtml: () => string;
};

const LIVE2D_VIEWPORT_SELECTOR = '[data-avatar-live2d-status]';

type Live2dVisiblePixelsTimeoutError = Error & {
  live2dStats?: Awaited<ReturnType<typeof waitForVisibleLive2dPixels>>;
};

function isChatLive2dRenderSmokeScenario(scenarioId: string): boolean {
  return scenarioId === 'chat.live2d-render-smoke'
    || scenarioId === 'chat.live2d-render-smoke-mark'
    || scenarioId === 'chat.live2d-render-smoke-mark-speaking'
    || scenarioId.startsWith('chat.live2d-render-smoke-');
}

async function waitForSpeakingLive2dPose(
  deps: Pick<DesktopMacosSmokeDriverDeps, 'readLive2dCanvasStats'>,
  timeoutMs = SMOKE_STEP_TIMEOUT_MS,
): Promise<{
  status: string | null;
  fallbackText: string | null;
  width: number;
  height: number;
  canvasPresent: boolean;
  contextKind: 'webgl2' | 'webgl' | null;
  sampleCount: number;
  nonTransparentSampleCount: number;
  sampleError: string | null;
  runtimeDebug: Record<string, unknown> | null;
}> {
  const deadline = Date.now() + timeoutMs;
  let lastStats = await deps.readLive2dCanvasStats(LIVE2D_VIEWPORT_SELECTOR);
  while (Date.now() < deadline) {
    lastStats = await deps.readLive2dCanvasStats(LIVE2D_VIEWPORT_SELECTOR);
    const runtimeDebug = lastStats.runtimeDebug || {};
    const phase = typeof runtimeDebug.phase === 'string' ? runtimeDebug.phase : null;
    const smoothedAmplitude = typeof runtimeDebug.smoothedAmplitude === 'number'
      ? runtimeDebug.smoothedAmplitude
      : 0;
    const speakingEnergy = typeof runtimeDebug.speakingEnergy === 'number'
      ? runtimeDebug.speakingEnergy
      : 0;
    if (
      lastStats.status === 'ready'
      && lastStats.canvasPresent
      && lastStats.nonTransparentSampleCount >= 3
      && phase === 'speaking'
      && (smoothedAmplitude > 0.02 || speakingEnergy > 0.02)
    ) {
      return lastStats;
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  throw new Error(`live2d viewport did not enter speaking pose runtimeDebug=${JSON.stringify(lastStats.runtimeDebug || null)}`);
}

async function waitForVisibleLive2dPixels(
  deps: Pick<DesktopMacosSmokeDriverDeps, 'readLive2dCanvasStats'>,
  timeoutMs = SMOKE_STEP_TIMEOUT_MS,
): Promise<{
  status: string | null;
  fallbackText: string | null;
  width: number;
  height: number;
  canvasPresent: boolean;
  contextKind: 'webgl2' | 'webgl' | null;
  sampleCount: number;
  nonTransparentSampleCount: number;
  sampleError: string | null;
  runtimeDebug: Record<string, unknown> | null;
}> {
  const deadline = Date.now() + timeoutMs;
  let lastStats = await deps.readLive2dCanvasStats(LIVE2D_VIEWPORT_SELECTOR);
  while (Date.now() < deadline) {
    lastStats = await deps.readLive2dCanvasStats(LIVE2D_VIEWPORT_SELECTOR);
    if (lastStats.status === 'error') {
      throw new Error(lastStats.fallbackText || 'live2d viewport failed closed');
    }
    if (
      lastStats.status === 'ready'
      && lastStats.canvasPresent
      && lastStats.width > 0
      && lastStats.height > 0
      && lastStats.nonTransparentSampleCount >= 3
    ) {
      return lastStats;
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  const error = new Error(
    [
      'live2d viewport did not produce visible pixels',
      `status=${lastStats.status || 'missing'}`,
      `canvas=${lastStats.canvasPresent ? 'present' : 'missing'}`,
      `size=${lastStats.width}x${lastStats.height}`,
      `context=${lastStats.contextKind || 'none'}`,
      `nonTransparentSamples=${lastStats.nonTransparentSampleCount}/${lastStats.sampleCount}`,
      lastStats.sampleError ? `sampleError=${lastStats.sampleError}` : null,
      lastStats.runtimeDebug ? `runtimeDebug=${JSON.stringify(lastStats.runtimeDebug)}` : null,
      lastStats.fallbackText ? `fallback=${lastStats.fallbackText}` : null,
    ].filter(Boolean).join(' '),
  ) as Live2dVisiblePixelsTimeoutError;
  error.live2dStats = lastStats;
  throw error;
}

function toLive2dCanvasStatsReport(stats: Awaited<ReturnType<typeof waitForVisibleLive2dPixels>>): Record<string, unknown> {
  return {
    status: stats.status,
    fallbackText: stats.fallbackText,
    width: stats.width,
    height: stats.height,
    canvasPresent: stats.canvasPresent,
    contextKind: stats.contextKind,
    sampleCount: stats.sampleCount,
    nonTransparentSampleCount: stats.nonTransparentSampleCount,
    sampleError: stats.sampleError,
    runtimeDebug: stats.runtimeDebug ?? undefined,
  };
}

type DesktopMacosSmokeFailureReportPayload = {
  ok: false;
  failedStep: string;
  steps: string[];
  errorMessage: string;
  errorName?: string;
  errorStack?: string;
  errorCause?: string;
  route: string;
  htmlSnapshot: string;
};

async function waitForMemoryMode(
  deps: Pick<DesktopMacosSmokeDriverDeps, 'readAttributeByTestId' | 'readTextByTestId'>,
  expected: 'baseline' | 'standard',
  timeoutMs = SMOKE_STEP_TIMEOUT_MS,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const mode = (await deps.readAttributeByTestId(E2E_IDS.chatMemoryModeStatus, 'data-memory-mode'))?.trim().toLowerCase();
    if (mode === expected) {
      return;
    }
    if (!mode) {
      const label = (await deps.readTextByTestId(E2E_IDS.chatMemoryModeStatus)).trim().toLowerCase();
      if (label === expected) {
        return;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`expected memory mode ${expected}`);
}

export async function runDesktopMacosSmokeScenario(
  scenarioId: string,
  deps: DesktopMacosSmokeDriverDeps,
): Promise<void> {
  const steps: string[] = [];
  const record = (step: string) => {
    steps.push(step);
  };
  try {
    switch (scenarioId) {
      case 'chat.memory-standard-bind':
        record('wait-chat-panel');
        await deps.waitForTestId(E2E_IDS.panel('chat'));
        record('select-agent-target');
        await deps.clickByTestId(E2E_IDS.chatTarget('agent-e2e-alpha'));
        record('open-settings');
        await deps.clickByTestId(E2E_IDS.chatSettingsToggle);
        record('wait-baseline');
        await deps.waitForTestId(E2E_IDS.chatMemoryModeStatus);
        await waitForMemoryMode(deps, 'baseline');
        record('cancel-upgrade');
        await deps.clickByTestId(E2E_IDS.chatMemoryModeUpgradeButton);
        record('confirm-cancel-still-baseline');
        await waitForMemoryMode(deps, 'baseline');
        record('confirm-upgrade');
        await deps.clickByTestId(E2E_IDS.chatMemoryModeUpgradeButton);
        record('wait-standard');
        await waitForMemoryMode(deps, 'standard');
        record('write-pass-report');
        await deps.writeReport({
          ok: true,
          steps,
          route: deps.currentRoute(),
          htmlSnapshot: deps.currentHtml(),
        });
        return;
      case 'tester.speech-bundle-panels':
        record('open-tester-tab');
        await deps.clickByTestId(E2E_IDS.navTab('tester'));
        record('wait-tester-panel');
        await deps.waitForTestId(E2E_IDS.panel('tester'));
        record('open-tts-panel');
        await deps.clickByTestId(E2E_IDS.testerCapabilityTab('audio.synthesize'));
        record('wait-tts-input');
        await deps.waitForTestId(E2E_IDS.testerPanel('audio.synthesize'));
        await deps.waitForTestId(E2E_IDS.testerInput('audio-synthesize-text'));
        record('open-stt-panel');
        await deps.clickByTestId(E2E_IDS.testerCapabilityTab('audio.transcribe'));
        record('wait-stt-input');
        await deps.waitForTestId(E2E_IDS.testerPanel('audio.transcribe'));
        await deps.waitForTestId(E2E_IDS.testerInput('audio-transcribe-file'));
        record('open-voice-clone-panel');
        await deps.clickByTestId(E2E_IDS.testerCapabilityTab('voice.clone'));
        record('wait-voice-clone-input');
        await deps.waitForTestId(E2E_IDS.testerPanel('voice.clone'));
        await deps.waitForTestId(E2E_IDS.testerInput('voice-clone-file'));
        record('open-voice-design-panel');
        await deps.clickByTestId(E2E_IDS.testerCapabilityTab('voice.design'));
        record('wait-voice-design-input');
        await deps.waitForTestId(E2E_IDS.testerPanel('voice.design'));
        await deps.waitForTestId(E2E_IDS.testerInput('voice-design-instruction'));
        record('write-pass-report');
        await deps.writeReport({
          ok: true,
          steps,
          route: deps.currentRoute(),
          htmlSnapshot: deps.currentHtml(),
        });
        return;
      case 'chat.live2d-render-smoke':
      case 'chat.live2d-render-smoke-mark':
      case 'chat.live2d-render-smoke-mark-speaking': {
        record('wait-chat-panel');
        await deps.waitForTestId(E2E_IDS.panel('chat'));
        record('select-agent-target');
        await deps.clickByTestId(E2E_IDS.chatTarget('agent-e2e-alpha'));
        record('wait-live2d-viewport');
        await deps.waitForSelector(LIVE2D_VIEWPORT_SELECTOR);
        record('wait-live2d-visible-pixels');
        const initialVisibleStats = await waitForVisibleLive2dPixels(deps, 12_000);
        const speakingVisibleStats = scenarioId === 'chat.live2d-render-smoke-mark-speaking'
          ? await (async () => {
            record('set-live2d-speaking-override');
            await deps.setLive2dInteractionOverride({
              phase: 'speaking',
              label: 'Speaking…',
              emotion: 'focus',
              amplitude: 0.82,
              visemeId: 'aa',
            });
            record('wait-live2d-speaking-pose');
            return waitForSpeakingLive2dPose(deps, 12_000);
          })()
          : null;
        record('trigger-live2d-context-loss-restore');
        await deps.triggerLive2dContextLossAndRestore();
        record('wait-live2d-visible-pixels-after-context-restore');
        const afterContextRestoreStats = await waitForVisibleLive2dPixels(deps, 12_000);
        record('pulse-live2d-viewport-tiny-host');
        await deps.pulseLive2dViewportTinyHost();
        record('wait-live2d-visible-pixels-after-tiny-host');
        const afterTinyHostStats = await waitForVisibleLive2dPixels(deps, 12_000);
        record('pulse-live2d-device-pixel-ratio');
        await deps.pulseLive2dDevicePixelRatio(1.75);
        record('wait-live2d-visible-pixels-after-dpr-pulse');
        const afterDprPulseStats = await waitForVisibleLive2dPixels(deps, 12_000);
        record('resize-live2d-viewport-small');
        await deps.resizeLive2dViewport({ width: 292, height: 520 });
        record('wait-live2d-visible-pixels-after-small-resize');
        const afterSmallResizeStats = await waitForVisibleLive2dPixels(deps, 12_000);
        record('resize-live2d-viewport-restored');
        await deps.resizeLive2dViewport({ width: 360, height: 820 });
        record('wait-live2d-visible-pixels-after-restored-resize');
        const afterRestoredResizeStats = await waitForVisibleLive2dPixels(deps, 12_000);
        record('write-pass-report');
        await deps.writeReport({
          ok: true,
          steps,
          route: deps.currentRoute(),
          htmlSnapshot: deps.currentHtml(),
          details: {
            live2d: {
              initialVisible: toLive2dCanvasStatsReport(initialVisibleStats),
              ...(speakingVisibleStats
                ? { speakingVisible: toLive2dCanvasStatsReport(speakingVisibleStats) }
                : {}),
              afterContextRestore: toLive2dCanvasStatsReport(afterContextRestoreStats),
              afterTinyHost: toLive2dCanvasStatsReport(afterTinyHostStats),
              afterDprPulse: toLive2dCanvasStatsReport(afterDprPulseStats),
              afterSmallResize: toLive2dCanvasStatsReport(afterSmallResizeStats),
              afterRestoredResize: toLive2dCanvasStatsReport(afterRestoredResizeStats),
            },
          },
        });
        return;
      }
      default: {
        if (!isChatLive2dRenderSmokeScenario(scenarioId)) {
          throw new Error(`unknown macOS smoke scenario: ${scenarioId}`);
        }
        record('wait-chat-panel');
        await deps.waitForTestId(E2E_IDS.panel('chat'));
        record('select-agent-target');
        await deps.clickByTestId(E2E_IDS.chatTarget('agent-e2e-alpha'));
        record('wait-live2d-viewport');
        await deps.waitForSelector(LIVE2D_VIEWPORT_SELECTOR);
        record('wait-live2d-visible-pixels');
        const dynamicInitialVisibleStats = await waitForVisibleLive2dPixels(deps, 12_000);
        record('trigger-live2d-context-loss-restore');
        await deps.triggerLive2dContextLossAndRestore();
        record('wait-live2d-visible-pixels-after-context-restore');
        const dynamicAfterContextRestoreStats = await waitForVisibleLive2dPixels(deps, 12_000);
        record('pulse-live2d-viewport-tiny-host');
        await deps.pulseLive2dViewportTinyHost();
        record('wait-live2d-visible-pixels-after-tiny-host');
        const dynamicAfterTinyHostStats = await waitForVisibleLive2dPixels(deps, 12_000);
        record('pulse-live2d-device-pixel-ratio');
        await deps.pulseLive2dDevicePixelRatio(1.75);
        record('wait-live2d-visible-pixels-after-dpr-pulse');
        const dynamicAfterDprPulseStats = await waitForVisibleLive2dPixels(deps, 12_000);
        record('resize-live2d-viewport-small');
        await deps.resizeLive2dViewport({ width: 292, height: 520 });
        record('wait-live2d-visible-pixels-after-small-resize');
        const dynamicAfterSmallResizeStats = await waitForVisibleLive2dPixels(deps, 12_000);
        record('resize-live2d-viewport-restored');
        await deps.resizeLive2dViewport({ width: 360, height: 820 });
        record('wait-live2d-visible-pixels-after-restored-resize');
        const dynamicAfterRestoredResizeStats = await waitForVisibleLive2dPixels(deps, 12_000);
        record('write-pass-report');
        await deps.writeReport({
          ok: true,
          steps,
          route: deps.currentRoute(),
          htmlSnapshot: deps.currentHtml(),
          details: {
            live2d: {
              initialVisible: toLive2dCanvasStatsReport(dynamicInitialVisibleStats),
              afterContextRestore: toLive2dCanvasStatsReport(dynamicAfterContextRestoreStats),
              afterTinyHost: toLive2dCanvasStatsReport(dynamicAfterTinyHostStats),
              afterDprPulse: toLive2dCanvasStatsReport(dynamicAfterDprPulseStats),
              afterSmallResize: toLive2dCanvasStatsReport(dynamicAfterSmallResizeStats),
              afterRestoredResize: toLive2dCanvasStatsReport(dynamicAfterRestoredResizeStats),
            },
          },
        });
        return;
      }
    }
  } catch (error) {
    const live2dStats = (error as Live2dVisiblePixelsTimeoutError | null | undefined)?.live2dStats;
    await deps.writeReport({
      ok: false,
      failedStep: steps[steps.length - 1] || 'bootstrap',
      steps,
      errorMessage: error instanceof Error ? error.message : String(error || 'unknown error'),
      errorName: error instanceof Error ? error.name : undefined,
      errorStack: error instanceof Error ? error.stack : undefined,
      errorCause: error instanceof Error ? String(error.cause || '') || undefined : undefined,
      route: deps.currentRoute(),
      htmlSnapshot: deps.currentHtml(),
      details: live2dStats
        ? {
          live2d: {
            failureSnapshot: toLive2dCanvasStatsReport(live2dStats),
          },
        }
        : undefined,
    });
    throw error;
  }
}

function createDomDriverDeps(): DesktopMacosSmokeDriverDeps {
  const queryByTestId = (id: string): HTMLElement | null => (
    document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null
  );

  return {
    async waitForTestId(id: string, timeoutMs = SMOKE_STEP_TIMEOUT_MS) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (queryByTestId(id)) {
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error(`missing test id ${id}`);
    },
    async waitForSelector(selector: string, timeoutMs = SMOKE_STEP_TIMEOUT_MS) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (document.querySelector(selector)) {
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error(`missing selector ${selector}`);
    },
    async clickByTestId(id: string, timeoutMs = SMOKE_STEP_TIMEOUT_MS) {
      await this.waitForTestId(id, timeoutMs);
      const element = queryByTestId(id);
      if (!element) {
        throw new Error(`missing test id ${id}`);
      }
      element.click();
    },
    async setLive2dInteractionOverride(override) {
      const runtimeWindow = window as typeof window & {
        __NIMI_LIVE2D_SMOKE_OVERRIDE__?: Record<string, unknown> | null;
      };
      runtimeWindow.__NIMI_LIVE2D_SMOKE_OVERRIDE__ = override;
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    },
    async resizeLive2dViewport(size) {
      const root = document.querySelector(LIVE2D_VIEWPORT_SELECTOR) as HTMLElement | null;
      if (!root) {
        throw new Error(`missing selector ${LIVE2D_VIEWPORT_SELECTOR}`);
      }
      root.style.width = `${size.width}px`;
      root.style.height = `${size.height}px`;
      window.dispatchEvent(new Event('resize'));
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    },
    async pulseLive2dViewportTinyHost() {
      const root = document.querySelector(LIVE2D_VIEWPORT_SELECTOR) as HTMLElement | null;
      if (!root) {
        throw new Error(`missing selector ${LIVE2D_VIEWPORT_SELECTOR}`);
      }
      const previousWidth = root.style.width;
      const previousHeight = root.style.height;
      root.style.width = '12px';
      root.style.height = '12px';
      window.dispatchEvent(new Event('resize'));
      await new Promise((resolve) => setTimeout(resolve, 180));
      if (previousWidth) {
        root.style.width = previousWidth;
      } else {
        root.style.removeProperty('width');
      }
      if (previousHeight) {
        root.style.height = previousHeight;
      } else {
        root.style.removeProperty('height');
      }
      window.dispatchEvent(new Event('resize'));
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    },
    async pulseLive2dDevicePixelRatio(nextValue) {
      const descriptor = Object.getOwnPropertyDescriptor(window, 'devicePixelRatio');
      const fallbackValue = window.devicePixelRatio;
      Object.defineProperty(window, 'devicePixelRatio', {
        configurable: true,
        value: nextValue,
      });
      window.dispatchEvent(new Event('resize'));
      await new Promise((resolve) => setTimeout(resolve, 180));
      if (descriptor) {
        Object.defineProperty(window, 'devicePixelRatio', descriptor);
      } else {
        Object.defineProperty(window, 'devicePixelRatio', {
          configurable: true,
          value: fallbackValue,
        });
      }
      window.dispatchEvent(new Event('resize'));
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    },
    async triggerLive2dContextLossAndRestore() {
      const root = document.querySelector(LIVE2D_VIEWPORT_SELECTOR) as HTMLElement | null;
      if (!root) {
        throw new Error(`missing selector ${LIVE2D_VIEWPORT_SELECTOR}`);
      }
      const canvas = root.querySelector('canvas') as HTMLCanvasElement | null;
      if (!canvas) {
        throw new Error('live2d canvas is missing');
      }
      const gl = (canvas.getContext('webgl2') || canvas.getContext('webgl')) as (
        | WebGL2RenderingContext
        | WebGLRenderingContext
        | null
      );
      if (!gl) {
        throw new Error('live2d WebGL context is missing');
      }
      const loseContext = gl.getExtension('WEBGL_lose_context') as {
        loseContext: () => void;
        restoreContext: () => void;
      } | null;
      if (!loseContext) {
        throw new Error('WEBGL_lose_context is unavailable for live2d smoke');
      }
      loseContext.loseContext();
      await new Promise((resolve) => setTimeout(resolve, 160));
      loseContext.restoreContext();
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    },
    async readTextByTestId(id: string) {
      const element = queryByTestId(id);
      if (!element) {
        throw new Error(`missing test id ${id}`);
      }
      return element.textContent || '';
    },
    async readAttributeByTestId(id: string, name: string) {
      const element = queryByTestId(id);
      if (!element) {
        throw new Error(`missing test id ${id}`);
      }
      return element.getAttribute(name);
    },
    async readLive2dCanvasStats(selector: string) {
      const root = document.querySelector(selector) as HTMLElement | null;
      const fallbackText = (document.querySelector('[data-live2d-fallback-reason="true"]') as HTMLElement | null)
        ?.textContent
        ?.trim() || null;
      if (!root) {
        return {
          status: null,
          fallbackText,
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

      const canvas = root.querySelector('canvas') as HTMLCanvasElement | null;
      const status = root.getAttribute('data-avatar-live2d-status');
      if (!canvas) {
        return {
          status,
          fallbackText,
          width: 0,
          height: 0,
          canvasPresent: false,
          contextKind: null,
          sampleCount: 0,
          nonTransparentSampleCount: 0,
          sampleError: null,
          runtimeDebug: (window as typeof window & {
            __NIMI_LIVE2D_DEBUG__?: Record<string, unknown> | null;
          }).__NIMI_LIVE2D_DEBUG__ || null,
        };
      }

      const gl2 = canvas.getContext('webgl2') as WebGL2RenderingContext | null;
      const gl = (gl2 || canvas.getContext('webgl')) as WebGLRenderingContext | WebGL2RenderingContext | null;
      const width = Math.max(canvas.width, 0);
      const height = Math.max(canvas.height, 0);
      const sampleColumns = Math.min(12, Math.max(3, Math.floor(width / 64) || 3));
      const sampleRows = Math.min(16, Math.max(4, Math.floor(height / 64) || 4));
      let nonTransparentSampleCount = 0;
      let sampleError: string | null = null;

      if (gl && width > 0 && height > 0) {
        const pixel = new Uint8Array(4);
        try {
          for (let row = 0; row < sampleRows; row += 1) {
            const y = Math.min(height - 1, Math.floor(((row + 0.5) / sampleRows) * height));
            for (let column = 0; column < sampleColumns; column += 1) {
              const x = Math.min(width - 1, Math.floor(((column + 0.5) / sampleColumns) * width));
              gl.readPixels(x, y, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
              const red = pixel[0] ?? 0;
              const green = pixel[1] ?? 0;
              const blue = pixel[2] ?? 0;
              const alpha = pixel[3] ?? 0;
              if (alpha > 8 || (red + green + blue) > 24) {
                nonTransparentSampleCount += 1;
              }
            }
          }
        } catch (error) {
          sampleError = error instanceof Error ? error.message : String(error || 'unknown pixel sampling error');
        }
      }

      return {
        status,
        fallbackText,
        width,
        height,
        canvasPresent: true,
        contextKind: gl2 ? 'webgl2' : (gl ? 'webgl' : null),
        sampleCount: sampleColumns * sampleRows,
        nonTransparentSampleCount,
        sampleError,
        runtimeDebug: (window as typeof window & {
          __NIMI_LIVE2D_DEBUG__?: Record<string, unknown> | null;
        }).__NIMI_LIVE2D_DEBUG__ || null,
      };
    },
    async writeReport(payload) {
      await writeDesktopMacosSmokeReport(payload);
    },
    currentRoute() {
      return `${window.location.pathname}${window.location.search}${window.location.hash}`;
    },
    currentHtml() {
      return document.documentElement.outerHTML;
    },
  };
}

function currentRouteSnapshot(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function currentHtmlSnapshot(): string {
  return document.documentElement.outerHTML;
}

export function buildDesktopMacosSmokeFailureReportPayload(input: {
  failedStep: string;
  message: string;
  errorName?: string;
  errorStack?: string;
  errorCause?: string;
}): DesktopMacosSmokeFailureReportPayload {
  return {
    ok: false,
    failedStep: input.failedStep,
    steps: [input.failedStep],
    errorMessage: input.message,
    errorName: input.errorName,
    errorStack: input.errorStack,
    errorCause: input.errorCause,
    route: currentRouteSnapshot(),
    htmlSnapshot: currentHtmlSnapshot(),
  };
}

async function writeBootstrapFailureReport(
  failedStep: string,
  message: string,
  error?: unknown,
): Promise<void> {
  await writeDesktopMacosSmokeReport(
    buildDesktopMacosSmokeFailureReportPayload({
      failedStep,
      message,
      errorName: error instanceof Error ? error.name : undefined,
      errorStack: error instanceof Error ? error.stack : undefined,
      errorCause: error instanceof Error ? String(error.cause || '') || undefined : undefined,
    }),
  );
}

export function useDesktopMacosSmokeBootstrap(
  bootstrapReady: boolean,
  bootstrapError: string | null,
) {
  const startedRef = useRef(false);
  const reportedRef = useRef(false);
  const [context, setContext] = useState<DesktopMacosSmokeContext | null>(null);

  useEffect(() => {
    if (!hasTauriInvoke()) {
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const nextContext = await getDesktopMacosSmokeContext();
        if (!cancelled) {
          setContext(nextContext);
          if (nextContext.enabled && nextContext.scenarioId) {
            void pingDesktopMacosSmoke('macos-smoke-context-ready', {
              scenarioId: nextContext.scenarioId,
            }).catch(() => {});
          }
        }
      } catch (error) {
        if (cancelled || reportedRef.current) {
          return;
        }
        reportedRef.current = true;
        await writeBootstrapFailureReport(
          'smoke-context-load-failed',
          error instanceof Error ? error.message : String(error || 'unknown error'),
          error,
        ).catch(() => {});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!hasTauriInvoke()) {
      return;
    }
    if (!shouldStartDesktopMacosSmoke({
      bootstrapReady,
      context,
      alreadyStarted: startedRef.current || reportedRef.current,
    })) {
      return;
    }
    let cancelled = false;
    const flowId = createRendererFlowId('desktop-macos-smoke');
    startedRef.current = true;
    logRendererEvent({
      area: 'desktop-macos-smoke',
      message: 'phase:desktop-macos-smoke:start',
      flowId,
      details: {
        scenarioId: context?.scenarioId,
      },
    });

    void (async () => {
      try {
        if (!cancelled && context?.scenarioId) {
          await pingDesktopMacosSmoke('macos-smoke-scenario-start', {
            scenarioId: context.scenarioId,
          }).catch(() => {});
          await runDesktopMacosSmokeScenario(context.scenarioId, createDomDriverDeps());
          await pingDesktopMacosSmoke('macos-smoke-scenario-finished', {
            scenarioId: context.scenarioId,
          }).catch(() => {});
          reportedRef.current = true;
        }
      } catch (error) {
        reportedRef.current = true;
        logRendererEvent({
          level: 'error',
          area: 'desktop-macos-smoke',
          message: 'phase:desktop-macos-smoke:failed',
          flowId,
          details: {
            scenarioId: context?.scenarioId,
            error: error instanceof Error ? error.message : String(error || 'unknown error'),
          },
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [bootstrapReady, context]);

  useEffect(() => {
    if (!hasTauriInvoke() || bootstrapReady || startedRef.current || reportedRef.current || !context?.enabled || !context.scenarioId) {
      return;
    }
    const flowId = createRendererFlowId('desktop-macos-smoke-bootstrap-timeout');
    const timeoutId = setTimeout(() => {
      if (startedRef.current || reportedRef.current) {
        return;
      }
      reportedRef.current = true;
      void writeBootstrapFailureReport(
        'bootstrap-timeout-before-ready',
        'desktop macOS smoke bootstrap did not reach ready state before timeout',
      ).catch((error) => {
        logRendererEvent({
          level: 'error',
          area: 'desktop-macos-smoke',
          message: 'phase:desktop-macos-smoke:bootstrap-timeout-report-failed',
          flowId,
          details: {
            error: error instanceof Error ? error.message : String(error || 'unknown error'),
          },
        });
      });
    }, SMOKE_BOOTSTRAP_TIMEOUT_MS);
    return () => {
      clearTimeout(timeoutId);
    };
  }, [bootstrapReady, context]);

  useEffect(() => {
    if (!hasTauriInvoke() || startedRef.current || reportedRef.current || !context?.enabled || !context.scenarioId || !bootstrapError) {
      return;
    }
    const flowId = createRendererFlowId('desktop-macos-smoke-bootstrap-error');
    reportedRef.current = true;
    void writeBootstrapFailureReport('bootstrap-error-screen', bootstrapError, new Error(bootstrapError)).catch((error) => {
      logRendererEvent({
        level: 'error',
        area: 'desktop-macos-smoke',
        message: 'phase:desktop-macos-smoke:bootstrap-error-report-failed',
        flowId,
        details: {
          error: error instanceof Error ? error.message : String(error || 'unknown error'),
        },
      });
    });
  }, [bootstrapError, context]);
}
