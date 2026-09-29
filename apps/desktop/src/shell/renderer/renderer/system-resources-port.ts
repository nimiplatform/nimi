// Occupancy and the OS's pressure verdict are separate facts; only pressure
// says memory is tight. Platforms without a verdict report unknown.
export type DesktopSystemMemoryPressure = 'normal' | 'warning' | 'critical' | 'unknown';

export type DesktopSystemResourceSnapshot = {
  readonly cpuPercent: number;
  readonly memoryUsedBytes: number;
  readonly memoryTotalBytes: number;
  readonly memoryPressure: DesktopSystemMemoryPressure;
  readonly diskUsedBytes: number | null;
  readonly diskTotalBytes: number | null;
  readonly temperatureCelsius?: number;
  readonly capturedAtMs: number;
  readonly source: string;
};

export interface DesktopRendererSystemResourcesPort {
  load(): Promise<DesktopSystemResourceSnapshot>;
}

export function createUnavailableDesktopRendererSystemResourcesPort(
  reason = 'DESKTOP_RENDERER_SYSTEM_RESOURCES_UNAVAILABLE',
): DesktopRendererSystemResourcesPort {
  return Object.freeze({
    async load() {
      throw new Error(reason);
    },
  });
}
