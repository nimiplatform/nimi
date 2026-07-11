import type { JsonObject } from './shared.js';

export type {
  RealmDefaults,
  RuntimeExecutionDefaults,
  RuntimeDefaults,
  RuntimeBridgeDaemonStatus,
} from '@nimiplatform/kit/shell/renderer/bridge';

export type DesktopReleaseInfo = {
  desktopVersion: string;
  runtimeVersion: string;
  channel: string;
  commit: string;
  builtAt: string;
  runtimeReady: boolean;
  runtimeStagedPath?: string;
  runtimeLastError?: string;
  updaterAvailable: boolean;
  updaterUnavailableReason?: string;
};

export type DesktopUpdateState = {
  status: 'idle' | 'checking' | 'available' | 'downloading' | 'downloaded' | 'installing' | 'readyToRestart' | 'error' | string;
  currentVersion: string;
  targetVersion?: string;
  downloadedBytes: number;
  totalBytes?: number;
  lastError?: string;
  readyToRestart: boolean;
};

export type DesktopUpdateCheckResult = {
  available: boolean;
  currentVersion: string;
  targetVersion?: string;
  notes?: string;
  pubDate?: string;
};

export type SystemResourceSnapshot = {
  cpuPercent: number;
  memoryUsedBytes: number;
  memoryTotalBytes: number;
  diskUsedBytes: number;
  diskTotalBytes: number;
  temperatureCelsius?: number;
  capturedAtMs: number;
  source: string;
};

export type MenuBarProviderSummary = {
  healthy: number;
  unhealthy: number;
  unknown: number;
  total: number;
};

export type MenuBarRuntimeHealthSyncPayload = {
  runtimeHealthStatus?: string;
  runtimeHealthReason?: string;
  providerSummary?: MenuBarProviderSummary;
  updatedAt?: string;
};

export type DesktopMacosSmokeContext = {
  enabled: boolean;
  scenarioId?: string;
  reportPath?: string;
  artifactsDir?: string;
  disableRuntimeBootstrap?: boolean;
  bootstrapTimeoutMs?: number;
};

export type DesktopMacosSmokeReportPayload = {
  ok: boolean;
  failedStep?: string;
  steps: string[];
  errorMessage?: string;
  errorName?: string;
  errorStack?: string;
  errorCause?: string;
  route?: string;
  htmlSnapshot?: string;
  details?: JsonObject;
};

export type DesktopMacosSmokeReportResult = {
  reportPath: string;
  htmlSnapshotPath?: string;
};
