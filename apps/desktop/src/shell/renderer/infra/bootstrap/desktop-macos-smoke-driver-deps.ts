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
import {
  clearAllAgentConversationAnchorBindings,
  getAgentConversationAnchorBinding,
} from '@renderer/app-shell/providers/agent-conversation-anchor-binding-storage';
import { getActiveScope } from '@renderer/features/chat/chat-shared-active-ai-config-scope';
import {
  getDesktopAccountRuntime,
  getDesktopAppId,
  getDesktopRuntime,
} from '@renderer/infra/sdk/desktop-nimi-client-session';
import { createNimiDesktopShellRuntimeAccountCaller, createNimiRuntimeAgentSmokeVerificationSurface, parseRuntimeLocalAgentIdentity, type NimiRuntimeAgentSmokeVerificationRuntime } from '@nimiplatform/sdk/runtime';
import { AccountSessionState } from '@nimiplatform/sdk/runtime/generated';
import {
  type DesktopMacosSmokeDriverDeps,
  LIVE2D_VIEWPORT_SELECTOR,
  SMOKE_STEP_TIMEOUT_MS,
  VRM_VIEWPORT_SELECTOR,
} from './desktop-macos-smoke-shared';
import {
  mutateDesktopMacosSmokeViewportHost,
  pulseDesktopMacosSmokeViewportTinyHost,
  readDesktopMacosSmokeCanvasStats,
  triggerDesktopMacosSmokeViewportContextLossAndRestore,
} from './desktop-macos-smoke-dom-viewport';

export type DesktopMacosSmokeDriverDepsOptions = {
  context?: DesktopMacosSmokeContext | null;
  onStepStart?: DesktopMacosSmokeDriverDeps['onStepStart'];
  onReportWrite?: () => void;
  isReportOpen?: DesktopMacosSmokeDriverDeps['isReportOpen'];
};

function getDesktopRuntimeAgentSmokeVerificationRuntime(): NimiRuntimeAgentSmokeVerificationRuntime {
  const runtime = getDesktopRuntime();
  const accountRuntime = getDesktopAccountRuntime();
  return {
    appId: getDesktopAppId(),
    auth: accountRuntime.auth,
    appAuth: accountRuntime.grants,
    agents: runtime.agents,
    health: (request, options) => runtime.health(request, options),
  };
}

export function createDomDriverDeps(options: DesktopMacosSmokeDriverDepsOptions = {}): DesktopMacosSmokeDriverDeps {
  const queryByTestId = (id: string): HTMLElement | null => (
    document.querySelector(`[data-testid="${id}"]`) as HTMLElement | null
  );

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
    async clearAgentConversationAnchorBindings() {
      clearAllAgentConversationAnchorBindings();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    },
    async readAgentConversationAnchorBinding(localAgentRef: string) {
      return getAgentConversationAnchorBinding(localAgentRef);
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
          targetRefs: {
            ...current.capabilities.targetRefs,
            'text.generate': {
              kind: 'local-runtime',
              targetId: 'core:runtime',
              profileId: 'e2e-live2d-text-route',
              readinessRef: 'readiness:e2e-live2d-text-route',
            },
          },
        },
      });
    },
    async verifyRuntimeConversationAnchor(input) {
      const auth = useAppStore.getState().auth;
      const subjectUserId = String((auth.user as Record<string, unknown> | null)?.id || '').trim();
      await createNimiRuntimeAgentSmokeVerificationSurface({
        getRuntime: getDesktopRuntimeAgentSmokeVerificationRuntime,
        getSubjectUserId: () => subjectUserId,
        withTimeout: withSmokeTimeout,
        timeoutMs: SMOKE_STEP_TIMEOUT_MS,
      }).verifyConversationAnchor(input);
    },
    async readRuntimeProductPathEvidence(input) {
      const auth = useAppStore.getState().auth;
      const subjectUserId = String((auth.user as Record<string, unknown> | null)?.id || '').trim();
      return createNimiRuntimeAgentSmokeVerificationSurface({
        getRuntime: getDesktopRuntimeAgentSmokeVerificationRuntime,
        getSubjectUserId: () => subjectUserId,
        withTimeout: withSmokeTimeout,
        timeoutMs: SMOKE_STEP_TIMEOUT_MS,
      }).readProductPathEvidence(input);
    },
    async verifyRuntimeAccountProjection() {
      const accountRuntime = getDesktopAccountRuntime();
      const accountCaller = createNimiDesktopShellRuntimeAccountCaller({ appId: getDesktopAppId() });
      const logout = await withSmokeTimeout(
        'Runtime account product-smoke logout reset',
        accountRuntime.account.logout({
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
          accountRuntime.account.getAccountSessionStatus({ caller: accountCaller }),
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
        accountRuntime.account.beginLogin({
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
        accountRuntime.account.completeLogin({
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
            accountRuntime.account.getAccountSessionStatus({ caller: accountCaller }),
            2_000,
          );
          const accountId = String(account.accountProjection?.accountId || '').trim();
          const isAuthenticated = Number(account.state) === 3 || String(account.state) === 'authenticated';
          if (isAuthenticated && accountId) {
            useAppStore.getState().setAuthSession({
              id: accountId,
              displayName: String(account.accountProjection?.displayName || accountId),
              realmEnvironmentId: String(account.accountProjection?.realmEnvironmentId || ''),
            });
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
      await mutateDesktopMacosSmokeViewportHost(LIVE2D_VIEWPORT_SELECTOR, size);
    },
    async pulseLive2dViewportTinyHost() {
      await pulseDesktopMacosSmokeViewportTinyHost(LIVE2D_VIEWPORT_SELECTOR);
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
      await triggerDesktopMacosSmokeViewportContextLossAndRestore(LIVE2D_VIEWPORT_SELECTOR, 'live2d');
    },
    async resizeVrmViewport(size) {
      await mutateDesktopMacosSmokeViewportHost(VRM_VIEWPORT_SELECTOR, size);
    },
    async pulseVrmViewportTinyHost() {
      await pulseDesktopMacosSmokeViewportTinyHost(VRM_VIEWPORT_SELECTOR);
    },
    async triggerVrmContextLossAndRestore() {
      await triggerDesktopMacosSmokeViewportContextLossAndRestore(VRM_VIEWPORT_SELECTOR, 'vrm');
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
      const stats = await readDesktopMacosSmokeCanvasStats(selector, {
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
      const stats = await readDesktopMacosSmokeCanvasStats(selector, {
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
