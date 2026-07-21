import {
  createNimiHostRuntimeRouteAccessSurface,
  type NimiRuntimeRouteLocalWarmMetric,
} from '@nimiplatform/sdk/runtime';
import { emitRuntimeLog } from '@nimiplatform/kit/telemetry';
import { getDesktopRuntime } from './sdk/desktop-nimi-client-session';

function emitDesktopRuntimeRouteWarmMetric(metric: NimiRuntimeRouteLocalWarmMetric): void {
  if (metric.kind === 'timing') {
    emitRuntimeLog({
      level: 'info',
      area: 'desktop-runtime-agent-latency',
      message: `phase:desktop.${metric.name}`,
      costMs: metric.durationMs,
      details: {
        stage: metric.name,
        ...(metric.details || {}),
      },
    });
    return;
  }
  emitRuntimeLog({
    level: 'info',
    area: 'desktop-runtime-agent-latency',
    message: `action:desktop_${metric.name}`,
    details: {
      counter: `desktop_${metric.name}`,
      value: metric.value ?? 1,
      ...(metric.details || {}),
    },
  });
}

export const desktopRuntimeRouteAccess = createNimiHostRuntimeRouteAccessSurface({
  getRuntime: getDesktopRuntime,
  appId: 'nimi.desktop',
  callerKind: 'desktop-core',
  surfaceId: 'desktop.renderer',
  identityMetadataMode: 'host',
  emitWarmMetric: emitDesktopRuntimeRouteWarmMetric,
});

export function getDesktopRuntimeClient() {
  return desktopRuntimeRouteAccess.getRuntimeClient();
}

export function resetDesktopRuntimeRouteLocalWarmCacheForTests(): void {
  desktopRuntimeRouteAccess.resetLocalModelWarmCache();
}
