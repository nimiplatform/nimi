export type {
  RealmDefaults,
  RuntimeExecutionDefaults,
  RuntimeDefaults,
  RuntimeBridgeDaemonStatus,
} from '@nimiplatform/kit/shell/renderer/bridge';

export type SystemMemoryPressure = 'normal' | 'warning' | 'critical' | 'unknown';

export type SystemResourceSnapshot = {
  cpuPercent: number;
  memoryUsedBytes: number;
  memoryTotalBytes: number;
  memoryPressure: SystemMemoryPressure;
  diskUsedBytes: number | null;
  diskTotalBytes: number | null;
  temperatureCelsius?: number;
  capturedAtMs: number;
  source: string;
};
