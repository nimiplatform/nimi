import { useEffect, useRef, useState } from 'react';
import { hasTauriInvoke } from '@renderer/bridge/runtime-bridge/env';
import {
  getDesktopMacosSmokeContext,
  pingDesktopMacosSmoke,
  writeDesktopMacosSmokeReport,
} from '@renderer/bridge/runtime-bridge/macos-smoke';
import type { DesktopMacosSmokeContext } from '@renderer/bridge/runtime-bridge/types';
import { createRendererFlowId, logRendererEvent } from '@renderer/infra/telemetry/renderer-log';
import { CHAT_AGENT_AVATAR_SMOKE_OVERRIDE_EVENT } from '@renderer/features/chat/chat-agent-avatar-debug-override';
import {
  type DesktopMacosSmokeCanvasStats,
  type DesktopMacosSmokeDriverDeps,
  type DesktopMacosSmokeFailureReportPayload,
  LIVE2D_VIEWPORT_SELECTOR,
  SMOKE_BOOTSTRAP_TIMEOUT_MS,
  SMOKE_STEP_TIMEOUT_MS,
  VRM_VIEWPORT_SELECTOR,
  shouldStartDesktopMacosSmoke,
} from './desktop-macos-smoke-shared';
import { runDesktopMacosSmokeScenario } from './desktop-macos-smoke-scenarios';

export { shouldStartDesktopMacosSmoke } from './desktop-macos-smoke-shared';
export { runDesktopMacosSmokeScenario } from './desktop-macos-smoke-scenarios';

function createDomDriverDeps(): DesktopMacosSmokeDriverDeps {
  const queryByTestId = (id: string): HTMLElement | null => (
    document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null
  );

  const mutateViewportHost = async (selector: string, size: { width: number; height: number }) => {
    const root = document.querySelector(selector) as HTMLElement | null;
    if (!root) {
      throw new Error(`missing selector ${selector}`);
    }
    root.style.width = `${size.width}px`;
    root.style.height = `${size.height}px`;
    window.dispatchEvent(new Event('resize'));
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  };

  const pulseViewportTinyHost = async (selector: string) => {
    const root = document.querySelector(selector) as HTMLElement | null;
    if (!root) {
      throw new Error(`missing selector ${selector}`);
    }
    const previousWidth = root.style.width;
    const previousHeight = root.style.height;
    root.style.width = '48px';
    root.style.height = '64px';
    window.dispatchEvent(new Event('resize'));
    await new Promise((resolve) => setTimeout(resolve, 180));
    root.style.width = previousWidth;
    root.style.height = previousHeight;
    window.dispatchEvent(new Event('resize'));
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
  };

  const triggerViewportContextLossAndRestore = async (selector: string, debugKey: 'live2d' | 'vrm') => {
    const root = document.querySelector(selector) as HTMLElement | null;
    const canvas = root?.querySelector('canvas') as HTMLCanvasElement | null;
    if (!canvas) {
      throw new Error(`missing canvas for selector ${selector}`);
    }
    const runtimeWindow = window as typeof window & {
      __NIMI_DESKTOP_SMOKE_DEBUG_ACTION__?: { kind: 'context-loss-restore'; target: 'live2d' | 'vrm' } | null;
    };
    runtimeWindow.__NIMI_DESKTOP_SMOKE_DEBUG_ACTION__ = {
      kind: 'context-loss-restore',
      target: debugKey,
    };
    canvas.dispatchEvent(new Event('webglcontextlost', { cancelable: true }));
    await new Promise((resolve) => setTimeout(resolve, 200));
    canvas.dispatchEvent(new Event('webglcontextrestored'));
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    runtimeWindow.__NIMI_DESKTOP_SMOKE_DEBUG_ACTION__ = null;
  };

  const readCanvasStats = async (
    selector: string,
    input: {
      statusAttribute: string;
      stageAttribute?: string;
      debugWindowKey: '__NIMI_LIVE2D_DEBUG__' | '__NIMI_VRM_DEBUG__';
      fallbackSelector: string;
    },
  ): Promise<DesktopMacosSmokeCanvasStats> => {
    const root = document.querySelector(selector) as HTMLElement | null;
    if (!root) {
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

    const canvas = root.querySelector('canvas') as HTMLCanvasElement | null;
    const fallbackElement = root.querySelector(input.fallbackSelector) as HTMLElement | null;
    const status = root.getAttribute(input.statusAttribute);
    const stage = input.stageAttribute ? root.getAttribute(input.stageAttribute) : null;
    const fallbackText = fallbackElement?.textContent?.trim() || null;
    if (!canvas) {
      return {
        status,
        stage,
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

    const gl2 = canvas.getContext('webgl2');
    const gl = (gl2 || canvas.getContext('webgl')) as WebGLRenderingContext | WebGL2RenderingContext | null;
    const contextKind: DesktopMacosSmokeCanvasStats['contextKind'] = gl2 ? 'webgl2' : (gl ? 'webgl' : null);
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
      stage,
      fallbackText,
      width,
      height,
      canvasPresent: true,
      contextKind,
      sampleCount: sampleColumns * sampleRows,
      nonTransparentSampleCount,
      sampleError,
      runtimeDebug: (window as typeof window & {
        __NIMI_LIVE2D_DEBUG__?: Record<string, unknown> | null;
        __NIMI_VRM_DEBUG__?: Record<string, unknown> | null;
      })[input.debugWindowKey] || null,
    };
  };

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
    async waitForSelectorGone(selector: string, timeoutMs = SMOKE_STEP_TIMEOUT_MS) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (!document.querySelector(selector)) {
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error(`selector still present ${selector}`);
    },
    async clickByTestId(id: string, timeoutMs = SMOKE_STEP_TIMEOUT_MS) {
      await this.waitForTestId(id, timeoutMs);
      const element = queryByTestId(id);
      if (!element) {
        throw new Error(`missing test id ${id}`);
      }
      element.click();
    },
    async setChatAvatarInteractionOverride(override) {
      const runtimeWindow = window as typeof window & {
        __NIMI_CHAT_AVATAR_SMOKE_OVERRIDE__?: Record<string, unknown> | null;
        __NIMI_LIVE2D_SMOKE_OVERRIDE__?: Record<string, unknown> | null;
      };
      runtimeWindow.__NIMI_CHAT_AVATAR_SMOKE_OVERRIDE__ = override;
      runtimeWindow.__NIMI_LIVE2D_SMOKE_OVERRIDE__ = override;
      window.dispatchEvent(new CustomEvent(CHAT_AGENT_AVATAR_SMOKE_OVERRIDE_EVENT));
      await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    },
    async resizeLive2dViewport(size) {
      await mutateViewportHost(LIVE2D_VIEWPORT_SELECTOR, size);
    },
    async pulseLive2dViewportTinyHost() {
      await pulseViewportTinyHost(LIVE2D_VIEWPORT_SELECTOR);
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
      await triggerViewportContextLossAndRestore(LIVE2D_VIEWPORT_SELECTOR, 'live2d');
    },
    async resizeVrmViewport(size) {
      await mutateViewportHost(VRM_VIEWPORT_SELECTOR, size);
    },
    async pulseVrmViewportTinyHost() {
      await pulseViewportTinyHost(VRM_VIEWPORT_SELECTOR);
    },
    async triggerVrmContextLossAndRestore() {
      await triggerViewportContextLossAndRestore(VRM_VIEWPORT_SELECTOR, 'vrm');
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
      const stats = await readCanvasStats(selector, {
        statusAttribute: 'data-avatar-live2d-status',
        debugWindowKey: '__NIMI_LIVE2D_DEBUG__',
        fallbackSelector: '[data-live2d-fallback-reason="true"]',
      });
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
        runtimeDebug: stats.runtimeDebug,
      };
    },
    async readVrmCanvasStats(selector: string) {
      const stats = await readCanvasStats(selector, {
        statusAttribute: 'data-avatar-vrm-status',
        stageAttribute: 'data-avatar-vrm-stage',
        debugWindowKey: '__NIMI_VRM_DEBUG__',
        fallbackSelector: '[data-vrm-load-reason="true"], [data-vrm-error-reason="true"]',
      });
      return {
        status: stats.status,
        stage: stats.stage,
        fallbackText: stats.fallbackText,
        width: stats.width,
        height: stats.height,
        canvasPresent: stats.canvasPresent,
        contextKind: stats.contextKind,
        sampleCount: stats.sampleCount,
        nonTransparentSampleCount: stats.nonTransparentSampleCount,
        sampleError: stats.sampleError,
        runtimeDebug: stats.runtimeDebug,
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
