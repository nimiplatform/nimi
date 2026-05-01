import { listRegisteredRuntimeModIds } from '@runtime/mod';
import { useAppStore } from '@renderer/app-shell/providers/app-store';
import { logRendererEvent } from '@renderer/infra/telemetry/renderer-log';
import { registerBootstrapRuntimeMods } from './runtime-bootstrap-runtime-mods';
import { startNonCriticalBootstrapStep } from './runtime-bootstrap-step-timeout';
import { safeErrorMessage } from './runtime-bootstrap-utils';

let postReadyRuntimeModHydrationGeneration = 0;

export function invalidatePostReadyRuntimeModHydration(): void {
  postReadyRuntimeModHydrationGeneration += 1;
}

function nextPostReadyRuntimeModHydrationGeneration(): string {
  postReadyRuntimeModHydrationGeneration += 1;
  return `bootstrap-${postReadyRuntimeModHydrationGeneration}`;
}

function isCurrentPostReadyRuntimeModHydrationGeneration(generation: string): boolean {
  return generation === `bootstrap-${postReadyRuntimeModHydrationGeneration}`;
}

export function schedulePostReadyRuntimeModHydration(input: {
  flowId: string;
}): void {
  const generation = nextPostReadyRuntimeModHydrationGeneration();
  const updatedAt = new Date().toISOString();
  useAppStore.getState().setRuntimeModHydrationRecords([{
    modId: 'runtime.bootstrap-mod-hydration',
    status: 'scheduled',
    generation,
    updatedAt,
  }]);
  logRendererEvent({
    level: 'info',
    area: 'renderer-bootstrap',
    message: 'phase:post-ready-runtime-mod-hydration:scheduled',
    flowId: input.flowId,
    details: { generation },
  });
  startNonCriticalBootstrapStep({
    flowId: input.flowId,
    step: 'post-ready runtime mod hydration',
    task: (async () => {
      if (isCurrentPostReadyRuntimeModHydrationGeneration(generation)) {
        useAppStore.getState().setRuntimeModHydrationRecords([{
          modId: 'runtime.bootstrap-mod-hydration',
          status: 'hydrating',
          generation,
          updatedAt: new Date().toISOString(),
        }]);
      }
      let result: Awaited<ReturnType<typeof registerBootstrapRuntimeMods>>;
      try {
        result = await registerBootstrapRuntimeMods({
          flowId: input.flowId,
          generation,
          isCurrent: () => isCurrentPostReadyRuntimeModHydrationGeneration(generation),
        });
      } catch (error) {
        if (isCurrentPostReadyRuntimeModHydrationGeneration(generation)) {
          useAppStore.getState().setRuntimeModHydrationRecords([{
            modId: 'runtime.bootstrap-mod-hydration',
            status: 'failed',
            generation,
            error: safeErrorMessage(error),
            updatedAt: new Date().toISOString(),
          }]);
        }
        throw error;
      }
      if (!isCurrentPostReadyRuntimeModHydrationGeneration(generation)) {
        logRendererEvent({
          level: 'warn',
          area: 'renderer-bootstrap',
          message: 'phase:post-ready-runtime-mod-hydration:stale-result-ignored',
          flowId: input.flowId,
          details: { generation },
        });
        return;
      }
      useAppStore.getState().setRuntimeModHydrationRecords([{
        modId: 'runtime.bootstrap-mod-hydration',
        status: result.runtimeModFailures.length > 0 ? 'failed' : 'hydrated',
        generation,
        updatedAt: new Date().toISOString(),
      }]);
      logRendererEvent({
        level: result.runtimeModFailures.length > 0 ? 'warn' : 'info',
        area: 'renderer-bootstrap',
        message: result.runtimeModFailures.length > 0
          ? 'phase:post-ready-runtime-mod-hydration:done-with-failures'
          : 'phase:post-ready-runtime-mod-hydration:done',
        flowId: input.flowId,
        details: {
          generation,
          manifestCount: result.manifestCount,
          runtimeModFailureCount: result.runtimeModFailures.length,
          runtimeModCount: listRegisteredRuntimeModIds().length,
        },
      });
    })(),
  });
}
