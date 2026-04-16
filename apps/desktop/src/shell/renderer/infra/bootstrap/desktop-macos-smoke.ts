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
  clickByTestId: (id: string, timeoutMs?: number) => Promise<void>;
  readTextByTestId: (id: string) => Promise<string>;
  readAttributeByTestId: (id: string, name: string) => Promise<string | null>;
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
  }) => Promise<void>;
  currentRoute: () => string;
  currentHtml: () => string;
};

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
      default:
        throw new Error(`unknown macOS smoke scenario: ${scenarioId}`);
    }
  } catch (error) {
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
    async clickByTestId(id: string, timeoutMs = SMOKE_STEP_TIMEOUT_MS) {
      await this.waitForTestId(id, timeoutMs);
      const element = queryByTestId(id);
      if (!element) {
        throw new Error(`missing test id ${id}`);
      }
      element.click();
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
