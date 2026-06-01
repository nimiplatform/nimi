import {
  applyDesktopMacosSmokeAvatarProductLocalAssetFault,
  readDesktopMacosSmokeAvatarEvidence,
  writeDesktopMacosSmokeReport,
} from '@renderer/bridge/runtime-bridge/macos-smoke';
import { listDesktopAvatarLiveInstances } from '@renderer/bridge/runtime-bridge/chat-agent-avatar-instance-registry';
import type { DesktopMacosSmokeContext } from '@renderer/bridge/runtime-bridge/types';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { getDesktopAIConfigService } from '@renderer/app-shell/providers/desktop-ai-config-service';
import { CHAT_AGENT_AVATAR_SMOKE_OVERRIDE_EVENT } from '@renderer/features/chat/chat-agent-avatar-debug-override';
import { clearAllAgentConversationAnchorBindings } from '@renderer/app-shell/providers/agent-conversation-anchor-binding-storage';
import { getActiveScope } from '@renderer/features/chat/chat-shared-active-ai-config-scope';
import { refreshConversationCapabilityProjections } from '@renderer/features/chat/conversation-capability-projection';
import { getPlatformClient } from '@nimiplatform/sdk';
import {
  createRuntimeAgentSmokeVerificationSurface,
  parseRuntimeLocalAgentIdentity,
} from '@nimiplatform/sdk/runtime';
import { AccountSessionState } from '@nimiplatform/sdk/runtime/browser';
import {
  readStorageTextFrom,
  resolveBrowserStorage,
} from '@nimiplatform/kit/core/storage-json';
import {
  type DesktopMacosSmokeCanvasStats,
  type DesktopMacosSmokeDriverDeps,
  LIVE2D_VIEWPORT_SELECTOR,
  SMOKE_STEP_TIMEOUT_MS,
  VRM_VIEWPORT_SELECTOR,
} from './desktop-macos-smoke-shared';

export type DesktopMacosSmokeDriverDepsOptions = {
  context?: DesktopMacosSmokeContext | null;
  onStepStart?: DesktopMacosSmokeDriverDeps['onStepStart'];
  onReportWrite?: () => void;
  isReportOpen?: DesktopMacosSmokeDriverDeps['isReportOpen'];
};

export function createDomDriverDeps(options: DesktopMacosSmokeDriverDepsOptions = {}): DesktopMacosSmokeDriverDeps {
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

  const withSmokeTimeout = async <T,>(label: string, task: Promise<T>, timeoutMs = 5_000): Promise<T> => {
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    try {
      return await Promise.race([
        task,
        new Promise<never>((_, reject) => {
          timeoutId = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
        }),
      ]);
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
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
    onStepStart: options.onStepStart,
    isReportOpen: options.isReportOpen,
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
    async waitForSelectorEnabled(selector: string, timeoutMs = SMOKE_STEP_TIMEOUT_MS) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        const element = document.querySelector(selector) as (HTMLElement & { disabled?: boolean }) | null;
        if (
          element
          && element.disabled !== true
          && element.getAttribute('aria-disabled') !== 'true'
        ) {
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      throw new Error(`selector not enabled ${selector}`);
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
    async clickSelector(selector: string, timeoutMs = SMOKE_STEP_TIMEOUT_MS) {
      await this.waitForSelector(selector, timeoutMs);
      const element = document.querySelector(selector) as HTMLElement | null;
      if (!element) {
        throw new Error(`missing selector ${selector}`);
      }
      element.click();
    },
    async setValueBySelector(selector: string, value: string, timeoutMs = SMOKE_STEP_TIMEOUT_MS) {
      await this.waitForSelector(selector, timeoutMs);
      const element = document.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | null;
      if (!element) {
        throw new Error(`missing selector ${selector}`);
      }
      const prototype = element instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
      descriptor?.set?.call(element, value);
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
    },
    async readLocalStorageItem(key: string) {
      const result = readStorageTextFrom(resolveBrowserStorage('local'), key);
      return result.state === 'ready' ? result.value : null;
    },
    async clearAgentConversationAnchorBindings() {
      clearAllAgentConversationAnchorBindings();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    },
    async configureRuntimeTextRoute() {
      const scopeRef = getActiveScope();
      if (!scopeRef) {
        throw new Error(
          'cannot configure Runtime text route: active chat mode binds no built-in chat AIConfig scope',
        );
      }
      const service = getDesktopAIConfigService();
      const current = service.aiConfig.get(scopeRef);
      service.aiConfig.update(scopeRef, {
        ...current,
        capabilities: {
          ...current.capabilities,
          selectedBindings: {
            ...current.capabilities.selectedBindings,
            'text.generate': {
              source: 'local',
              connectorId: '',
              model: 'e2e-live2d-text-route',
              modelId: 'e2e-live2d-text-route',
              modelLabel: 'E2E Live2D Text Route',
              localModelId: 'local-e2e-live2d-text-route',
              goRuntimeLocalModelId: 'local-e2e-live2d-text-route',
              goRuntimeStatus: 'active',
              provider: 'llama',
              engine: 'llama',
            },
          },
        },
      });
      await withSmokeTimeout(
        'Runtime text route projection refresh',
        refreshConversationCapabilityProjections(['text.generate']),
        SMOKE_STEP_TIMEOUT_MS,
      );
      const projection = useAppStore.getState().conversationCapabilityProjectionByCapability['text.generate'] || null;
      if (!projection?.supported || !projection.resolvedBinding) {
        throw new Error(
          'Runtime text route projection unavailable after smoke configuration'
          + `; reason=${projection?.reasonCode || 'missing_projection'}`
          + `; selected=${JSON.stringify(projection?.selectedBinding || null)}`
          + `; health=${JSON.stringify(projection?.health || null)}`,
        );
      }
    },
    async verifyRuntimeConversationAnchor(input) {
      const auth = useAppStore.getState().auth;
      const subjectUserId = String((auth.user as Record<string, unknown> | null)?.id || '').trim();
      await createRuntimeAgentSmokeVerificationSurface({
        getRuntime: () => getPlatformClient().runtime,
        getSubjectUserId: () => subjectUserId,
        withTimeout: withSmokeTimeout,
        timeoutMs: SMOKE_STEP_TIMEOUT_MS,
      }).verifyConversationAnchor(input);
    },
    async readRuntimeProductPathEvidence(input) {
      const auth = useAppStore.getState().auth;
      const subjectUserId = String((auth.user as Record<string, unknown> | null)?.id || '').trim();
      return createRuntimeAgentSmokeVerificationSurface({
        getRuntime: () => getPlatformClient().runtime,
        getSubjectUserId: () => subjectUserId,
        withTimeout: withSmokeTimeout,
        timeoutMs: SMOKE_STEP_TIMEOUT_MS,
      }).readProductPathEvidence(input);
    },
    async verifyRuntimeAccountProjection() {
      const accountCaller = {
        appId: 'nimi.desktop',
        appInstanceId: 'nimi.desktop.local-first-party',
        deviceId: 'desktop-shell',
        mode: 2,
        scopes: [],
      };
      const logout = await withSmokeTimeout(
        'Runtime account product-smoke logout reset',
        getPlatformClient().runtime.account.logout({
          caller: accountCaller,
          reason: 'desktop_macos_avatar_product_smoke_reset',
        }),
        5_000,
      );
      if (!logout.accepted) {
        throw new Error(`Runtime account product-smoke logout reset rejected: ${String(logout.accountReasonCode || logout.reasonCode || 'unknown')}`);
      }
      const resetDeadline = Date.now() + 5_000;
      let resetState = logout.state;
      while (Date.now() < resetDeadline) {
        const resetStatus = await withSmokeTimeout(
          'Runtime account product-smoke logout readback',
          getPlatformClient().runtime.account.getAccountSessionStatus({ caller: accountCaller }),
          5_000,
        );
        resetState = resetStatus.state;
        if (resetStatus.state === AccountSessionState.ANONYMOUS) {
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      if (resetState !== AccountSessionState.ANONYMOUS) {
        throw new Error(`Runtime account product-smoke logout reset did not reach anonymous state: ${String(resetState)}`);
      }
      const begin = await withSmokeTimeout(
        'Runtime account product-smoke login begin',
        getPlatformClient().runtime.account.beginLogin({
          caller: accountCaller,
          redirectUri: 'http://localhost:46373/auth/callback',
          callbackOrigin: 'http://localhost:46373',
          requestedScopes: [],
          ttlSeconds: 60,
        }),
        5_000,
      );
      if (!begin.accepted || !begin.loginAttemptId || !begin.state || !begin.nonce) {
        throw new Error(`Runtime account product-smoke login begin rejected: ${String(begin.accountReasonCode || begin.reasonCode || 'unknown')}`);
      }
      const complete = await withSmokeTimeout(
        'Runtime account product-smoke login complete',
        getPlatformClient().runtime.account.completeLogin({
          caller: accountCaller,
          loginAttemptId: begin.loginAttemptId,
          code: 'e2e-runtime-product-smoke-code',
          state: begin.state,
          nonce: begin.nonce,
          redirectUri: 'http://localhost:46373/auth/callback',
          callbackOrigin: 'http://localhost:46373',
          uxTraceId: '',
          sealedCompletionTicket: '',
          refreshToken: '',
        }),
        5_000,
      );
      if (!complete.accepted || Number(complete.state) !== 3 || !String(complete.accountProjection?.accountId || '').trim()) {
        throw new Error(`Runtime account product-smoke login complete rejected: state=${String(complete.state)} reason=${String(complete.accountReasonCode || complete.reasonCode || 'unknown')}`);
      }
      const deadline = Date.now() + 5_000;
      let lastError = 'not checked';
      while (Date.now() < deadline) {
        try {
          const account = await withSmokeTimeout(
            'Runtime account projection readback',
            getPlatformClient().runtime.account.getAccountSessionStatus({ caller: accountCaller }),
            2_000,
          );
          const accountId = String(account.accountProjection?.accountId || '').trim();
          const isAuthenticated = Number(account.state) === 3 || String(account.state) === 'authenticated';
          if (isAuthenticated && accountId) {
            useAppStore.getState().setAuthSession({
              id: accountId,
              displayName: String(account.accountProjection?.displayName || accountId),
              realmEnvironmentId: String(account.accountProjection?.realmEnvironmentId || ''),
            }, '', '');
            return;
          }
          lastError = `Runtime account state=${String(account.state || 'unknown')} account_present=${Boolean(accountId)}`;
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error || 'Runtime account projection read failed');
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      throw new Error(`Desktop authenticated session was not available through Runtime account projection: ${lastError}`);
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
    async listAvatarLiveInstances(localAgentRef: string) {
      const normalized = String(localAgentRef || '').trim();
      let identity: ReturnType<typeof parseRuntimeLocalAgentIdentity>;
      try {
        identity = parseRuntimeLocalAgentIdentity(normalized);
      } catch {
        throw new Error('macOS smoke Avatar live-instance lookup requires localAgentRef');
      }
      return listDesktopAvatarLiveInstances({
        ownerUserId: identity.ownerUserId,
        realmAgentId: identity.realmAgentId,
        localAgentRef: identity.localAgentRef,
      });
    },
    async readAvatarEvidence(avatarInstanceId: string) {
      return readDesktopMacosSmokeAvatarEvidence(avatarInstanceId);
    },
    async applyAvatarProductLocalAssetFault(faultKind: 'missing_entry_file') {
      if (options.context?.avatarProductLocalAssetFault?.faultKind !== faultKind) {
        throw new Error(`Avatar product local asset fault is not configured for ${faultKind}`);
      }
      return withSmokeTimeout(
        'desktop_macos_smoke_avatar_product_local_asset_fault_apply',
        applyDesktopMacosSmokeAvatarProductLocalAssetFault(faultKind),
        3_000,
      );
    },
    async writeReport(payload) {
      if (options.isReportOpen && !options.isReportOpen()) {
        return;
      }
      await writeDesktopMacosSmokeReport(payload);
      options.onReportWrite?.();
    },
    currentRoute() {
      return `${window.location.pathname}${window.location.search}${window.location.hash}`;
    },
    currentHtml() {
      return document.documentElement.outerHTML;
    },
  };
}
