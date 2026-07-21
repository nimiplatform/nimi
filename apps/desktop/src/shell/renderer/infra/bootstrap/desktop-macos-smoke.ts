import { useEffect } from 'react';
import { hasTauriInvoke } from '@nimiplatform/kit/shell/renderer/bridge';
import {
  getDesktopMacosSmokeContext,
  pingDesktopMacosSmoke,
  writeDesktopMacosSmokeReport,
} from '../../bridge/runtime-bridge/macos-smoke';
import type { DesktopMacosSmokeContext } from '../../bridge/runtime-bridge/types';
import { createRendererFlowId, logRendererEvent } from '@nimiplatform/kit/telemetry';
import {
  buildDesktopMacosSmokeFailureReportPayload,
  SMOKE_BOOTSTRAP_TIMEOUT_MS,
  SMOKE_SCENARIO_TIMEOUT_MS,
  SMOKE_STEP_TIMEOUT_MS,
  shouldStartDesktopMacosSmoke,
} from './desktop-macos-smoke-shared';
import { createDomDriverDeps } from './desktop-macos-smoke-driver-deps';
import { runDesktopMacosSmokeScenario } from './desktop-macos-smoke-scenarios';
import type { DesktopRendererLifecyclePort } from '../../renderer/lifecycle-port.js';

export {
  buildDesktopMacosSmokeFailureReportPayload,
  shouldStartDesktopMacosSmoke,
} from './desktop-macos-smoke-shared';
export { runDesktopMacosSmokeScenario } from './desktop-macos-smoke-scenarios';

function resolveSmokeBootstrapTimeoutMs(context: DesktopMacosSmokeContext): number {
  const requested = Number(context.bootstrapTimeoutMs || 0);
  if (!Number.isFinite(requested) || requested <= 0) {
    return SMOKE_BOOTSTRAP_TIMEOUT_MS;
  }
  return Math.min(180_000, Math.max(SMOKE_BOOTSTRAP_TIMEOUT_MS, requested));
}

function resolveSmokeScenarioTimeoutMs(context: DesktopMacosSmokeContext): number {
  const requested = Number(context.bootstrapTimeoutMs || 0);
  if (!Number.isFinite(requested) || requested <= 0) {
    return SMOKE_SCENARIO_TIMEOUT_MS;
  }
  return Math.min(170_000, Math.max(SMOKE_STEP_TIMEOUT_MS, requested + SMOKE_STEP_TIMEOUT_MS));
}

async function withDesktopMacosSmokeScenarioTimeout<T>(
  scenarioId: string,
  task: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      task,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`desktop macOS smoke scenario ${scenarioId} timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
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

type DesktopMacosSmokeLifecycle = Pick<
  DesktopRendererLifecyclePort,
  | 'applyRuntimeAccountProjection'
  | 'auth'
  | 'bootstrap'
  | 'cancelAndClearQueries'
  | 'clearAgentConversationAnchorBindings'
  | 'readAgentConversationAnchorBinding'
  | 'subscribeBootstrap'
>;

export function connectDesktopMacosSmoke(
  lifecycle: DesktopMacosSmokeLifecycle,
): () => void {
  if (!hasTauriInvoke()) return () => {};
  let active = true;
  let started = false;
  let reported = false;
  let context: DesktopMacosSmokeContext | null = null;
  let bootstrapTimer: ReturnType<typeof setTimeout> | null = null;

  const clearBootstrapTimer = () => {
    if (!bootstrapTimer) return;
    clearTimeout(bootstrapTimer);
    bootstrapTimer = null;
  };

  const startScenario = (scenarioContext: DesktopMacosSmokeContext) => {
    if (!active || started || reported || !scenarioContext.scenarioId) return;
    started = true;
    clearBootstrapTimer();
    const flowId = createRendererFlowId('desktop-macos-smoke');
    logRendererEvent({
      area: 'desktop-macos-smoke',
      message: 'phase:desktop-macos-smoke:start',
      flowId,
      details: {
        scenarioId: scenarioContext.scenarioId,
      },
    });

    void (async () => {
      let currentStep = 'scenario-start';
      let recordedSteps: string[] = [];
      let reportOpen: boolean = active;
      let scenarioReportWritten = false;
      try {
        if (active && scenarioContext.scenarioId) {
          await pingDesktopMacosSmoke('macos-smoke-scenario-start', {
            scenarioId: scenarioContext.scenarioId,
          }).catch(() => {});
          const deps = createDomDriverDeps({
            context: scenarioContext,
            lifecycle,
            onStepStart(step, steps) {
              currentStep = step;
              recordedSteps = [...steps];
              void pingDesktopMacosSmoke('macos-smoke-step-start', {
                scenarioId: scenarioContext.scenarioId,
                step,
                stepCount: recordedSteps.length,
              }).catch(() => {});
            },
            onReportWrite() {
              scenarioReportWritten = true;
            },
            isReportOpen: () => active && reportOpen,
          });
          await withDesktopMacosSmokeScenarioTimeout(
            scenarioContext.scenarioId,
            runDesktopMacosSmokeScenario(scenarioContext.scenarioId, deps),
            resolveSmokeScenarioTimeoutMs(scenarioContext),
          );
          await pingDesktopMacosSmoke('macos-smoke-scenario-finished', {
            scenarioId: scenarioContext.scenarioId,
          }).catch(() => {});
          reportOpen = false;
          reported = true;
        }
      } catch (error) {
        reportOpen = false;
        if (!active) return;
        reported = true;
        logRendererEvent({
          level: 'error',
          area: 'desktop-macos-smoke',
          message: 'phase:desktop-macos-smoke:failed',
          flowId,
          details: {
            scenarioId: scenarioContext.scenarioId,
            error: error instanceof Error ? error.message : String(error || 'unknown error'),
          },
        });
        if (!scenarioReportWritten) {
          await writeDesktopMacosSmokeReport(
            buildDesktopMacosSmokeFailureReportPayload({
              failedStep: currentStep,
              steps: recordedSteps.length ? recordedSteps : [currentStep],
              message: error instanceof Error ? error.message : String(error || 'unknown error'),
              errorName: error instanceof Error ? error.name : undefined,
              errorStack: error instanceof Error ? error.stack : undefined,
              errorCause: error instanceof Error ? String(error.cause || '') || undefined : undefined,
            }),
          ).catch((reportError) => {
            logRendererEvent({
              level: 'error',
              area: 'desktop-macos-smoke',
              message: 'phase:desktop-macos-smoke:scenario-failure-report-failed',
              flowId,
              details: {
                scenarioId: scenarioContext.scenarioId,
                error: reportError instanceof Error ? reportError.message : String(reportError || 'unknown error'),
              },
            });
          });
        }
      }
    })();
  };

  const reconcile = () => {
    if (!active || !context?.enabled || !context.scenarioId || started || reported) return;
    const bootstrap = lifecycle.bootstrap();
    if (bootstrap.bootstrapError) {
      reported = true;
      clearBootstrapTimer();
      const flowId = createRendererFlowId('desktop-macos-smoke-bootstrap-error');
      void writeBootstrapFailureReport(
        'bootstrap-error-screen',
        bootstrap.bootstrapError,
        new Error(bootstrap.bootstrapError),
      ).catch((error) => {
        if (!active) return;
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
      return;
    }
    if (shouldStartDesktopMacosSmoke({
      bootstrapReady: bootstrap.bootstrapReady,
      context,
      alreadyStarted: started || reported,
    })) {
      startScenario(context);
      return;
    }
    if (bootstrapTimer) return;
    const flowId = createRendererFlowId('desktop-macos-smoke-bootstrap-timeout');
    const timeoutMs = resolveSmokeBootstrapTimeoutMs(context);
    bootstrapTimer = setTimeout(() => {
      bootstrapTimer = null;
      if (!active || started || reported) return;
      reported = true;
      void writeBootstrapFailureReport(
        'bootstrap-timeout-before-ready',
        'desktop macOS smoke bootstrap did not reach ready state before timeout',
      ).catch((error) => {
        if (!active) return;
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
    }, timeoutMs);
  };

  void pingDesktopMacosSmoke('app-mounted').catch(() => {});
  void getDesktopMacosSmokeContext().then((nextContext) => {
    if (!active) return;
    context = nextContext;
    if (nextContext.enabled && nextContext.scenarioId) {
      void pingDesktopMacosSmoke('macos-smoke-context-ready', {
        scenarioId: nextContext.scenarioId,
      }).catch(() => {});
    }
    reconcile();
  }).catch((error) => {
    if (!active || reported) return;
    reported = true;
    void writeBootstrapFailureReport(
      'smoke-context-load-failed',
      error instanceof Error ? error.message : String(error || 'unknown error'),
      error,
    ).catch(() => {});
  });
  const unsubscribeBootstrap = lifecycle.subscribeBootstrap(reconcile);

  return () => {
    active = false;
    clearBootstrapTimer();
    unsubscribeBootstrap();
  };
}

export function useDesktopMacosSmokeBootstrap(lifecycle: DesktopMacosSmokeLifecycle) {
  useEffect(() => connectDesktopMacosSmoke(lifecycle), [lifecycle]);
}
