import { useEffect, useRef, useState } from 'react';
import { hasTauriInvoke } from '@nimiplatform/kit/shell/renderer/bridge';
import {
  getDesktopMacosSmokeContext,
  pingDesktopMacosSmoke,
  writeDesktopMacosSmokeReport,
} from '@renderer/bridge/runtime-bridge/macos-smoke';
import type { DesktopMacosSmokeContext } from '@renderer/bridge/runtime-bridge/types';
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
      let currentStep = 'scenario-start';
      let recordedSteps: string[] = [];
      let reportOpen = true;
      let scenarioReportWritten = false;
      try {
        if (!cancelled && context?.scenarioId) {
          await pingDesktopMacosSmoke('macos-smoke-scenario-start', {
            scenarioId: context.scenarioId,
          }).catch(() => {});
          const deps = createDomDriverDeps({
            context,
            onStepStart(step, steps) {
              currentStep = step;
              recordedSteps = [...steps];
              void pingDesktopMacosSmoke('macos-smoke-step-start', {
                scenarioId: context.scenarioId,
                step,
                stepCount: recordedSteps.length,
              }).catch(() => {});
            },
            onReportWrite() {
              scenarioReportWritten = true;
            },
            isReportOpen: () => reportOpen,
          });
          await withDesktopMacosSmokeScenarioTimeout(
            context.scenarioId,
            runDesktopMacosSmokeScenario(context.scenarioId, deps),
            resolveSmokeScenarioTimeoutMs(context),
          );
          await pingDesktopMacosSmoke('macos-smoke-scenario-finished', {
            scenarioId: context.scenarioId,
          }).catch(() => {});
          reportOpen = false;
          reportedRef.current = true;
        }
      } catch (error) {
        reportOpen = false;
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
                scenarioId: context?.scenarioId,
                error: reportError instanceof Error ? reportError.message : String(reportError || 'unknown error'),
              },
            });
          });
        }
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
    const timeoutMs = resolveSmokeBootstrapTimeoutMs(context);
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
    }, timeoutMs);
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
