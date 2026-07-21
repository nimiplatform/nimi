import { writeDesktopMacosSmokeReport } from '../../bridge/runtime-bridge/macos-smoke';
import { desktopBridge } from '../../bridge';
import type { DesktopMacosSmokeContext } from '../../bridge/runtime-bridge/types';
import { getDesktopAIConfigService } from '../../app-shell/providers/desktop-ai-config-service';
import {
  clearAllAgentConversationAnchorBindings,
  getAgentConversationAnchorBinding,
} from '../../app-shell/providers/agent-conversation-anchor-binding-storage';
import { getActiveScope } from '../../features/chat/chat-shared-active-ai-config-scope';
import {
  getDesktopAccountRuntime,
  getDesktopAppId,
  getDesktopRuntime,
} from '../sdk/desktop-nimi-client-session';
import { createNimiDesktopShellRuntimeAccountCaller, createNimiRuntimeAgentSmokeVerificationSurface, type NimiRuntimeAgentSmokeVerificationRuntime } from '@nimiplatform/sdk/runtime';
import { AccountSessionState } from '@nimiplatform/sdk/runtime/wire-types';
import {
  type DesktopMacosSmokeDriverDeps,
  SMOKE_STEP_TIMEOUT_MS,
} from './desktop-macos-smoke-shared';
import { applyRuntimeAccountStatusProjection } from './auth-state-watcher';
import type { DesktopRendererLifecyclePort } from '../../renderer/lifecycle-port.js';

export type DesktopMacosSmokeDriverDepsOptions = {
  lifecycle: Pick<
    DesktopRendererLifecyclePort,
    | 'applyRuntimeAccountProjection'
    | 'auth'
    | 'cancelAndClearQueries'
  >;
  context?: DesktopMacosSmokeContext | null;
  onStepStart?: DesktopMacosSmokeDriverDeps['onStepStart'];
  onReportWrite?: () => void;
  isReportOpen?: DesktopMacosSmokeDriverDeps['isReportOpen'];
};

function getDesktopRuntimeAgentSmokeVerificationRuntime(): NimiRuntimeAgentSmokeVerificationRuntime {
  const runtime = getDesktopRuntime();
  return {
    appId: getDesktopAppId(),
    agents: runtime.agents,
    health: (request, options) => runtime.health(request, options),
  };
}

export function createDomDriverDeps(options: DesktopMacosSmokeDriverDepsOptions): DesktopMacosSmokeDriverDeps {
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
              version: 'v2',
              profileBindingId: 'e2e-runtime-text-route',
            },
          },
        },
      });
    },
    async verifyRuntimeConversationAnchor(input) {
      const auth = options.lifecycle.auth();
      const subjectUserId = String((auth.user as Record<string, unknown> | null)?.id || '').trim();
      await createNimiRuntimeAgentSmokeVerificationSurface({
        getRuntime: getDesktopRuntimeAgentSmokeVerificationRuntime,
        getSubjectUserId: () => subjectUserId,
        withTimeout: withSmokeTimeout,
        timeoutMs: SMOKE_STEP_TIMEOUT_MS,
      }).verifyConversationAnchor(input);
    },
    async readRuntimeProductPathEvidence(input) {
      const auth = options.lifecycle.auth();
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
          reason: 'desktop_macos_smoke_reset',
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
        resetState = resetStatus.snapshot?.state ?? AccountSessionState.UNSPECIFIED;
        if (resetState === AccountSessionState.ANONYMOUS) {
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
          redirectUri: 'http://localhost:46373/oauth/callback',
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
          redirectUri: 'http://localhost:46373/oauth/callback',
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
            desktopBridge.getRuntimeAccountSessionStatus(),
            2_000,
          );
          const accountId = String(account.accountProjection?.accountId || '').trim();
          const isAuthenticated = account.state === 'authenticated';
          if (isAuthenticated && accountId) {
            applyRuntimeAccountStatusProjection(account, options.lifecycle);
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
