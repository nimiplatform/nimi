export type DesktopSystemResourceSnapshot = {
  readonly cpuPercent: number;
  readonly memoryUsedBytes: number;
  readonly memoryTotalBytes: number;
  readonly diskUsedBytes: number;
  readonly diskTotalBytes: number;
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
