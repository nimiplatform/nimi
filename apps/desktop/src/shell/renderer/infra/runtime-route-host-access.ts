import {
  createNimiHostRuntimeRouteAccessSurface,
  type NimiRuntimeRouteLocalWarmMetric,
  type NimiRuntimeRouteHostAccessClient,
} from '@nimiplatform/sdk/runtime';
import { emitRuntimeLog } from '@nimiplatform/kit/telemetry';

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

export function createDesktopRuntimeRouteAccess(getRuntime: () => NimiRuntimeRouteHostAccessClient) {
  return createNimiHostRuntimeRouteAccessSurface({
    getRuntime,
    appId: 'nimi.desktop',
    callerKind: 'desktop-core',
    surfaceId: 'desktop.renderer',
    identityMetadataMode: 'host',
    emitWarmMetric: emitDesktopRuntimeRouteWarmMetric,
  });
}

export type DesktopRuntimeRouteAccess = ReturnType<typeof createDesktopRuntimeRouteAccess>;
