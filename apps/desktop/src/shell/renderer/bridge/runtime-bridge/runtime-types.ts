import type { JsonObject } from './shared.js';

export type {
  RealmDefaults,
  RuntimeExecutionDefaults,
  RuntimeDefaults,
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

export type RuntimeBridgeDaemonStatus = {
  running: boolean;
  managed: boolean;
  launchMode: 'RUNTIME' | 'RELEASE' | 'INVALID';
  grpcAddr: string;
  pid?: number;
  version?: string;
  lastError?: string;
  debugLogPath?: string;
};

export type RuntimeBridgeConfigGetResult = {
  path: string;
  config: JsonObject;
};

export type RuntimeBridgeConfigSetResult = {
  path: string;
  reasonCode?: string;
  actionHint?: string;
  config: JsonObject;
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

export type OpenExternalUrlResult = {
  opened: boolean;
};

export type OauthTokenExchangeProvider = 'CODEX' | 'TWITTER' | 'TIKTOK';

export type OauthTokenExchangePayload = {
  provider: OauthTokenExchangeProvider;
  clientId: string;
  code: string;
  codeVerifier?: string;
  redirectUri?: string;
};

export type OauthTokenExchangeResult = {
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  expiresIn?: number;
  scope?: string;
  raw: JsonObject;
};

export type OauthListenForCodePayload = {
  redirectUri: string;
  timeoutMs?: number;
};

export type OauthListenForCodeResult = {
  callbackUrl: string;
  code?: string;
  refreshToken?: string;
  state?: string;
  error?: string;
};

export type ConfirmPrivateSyncPayload = {
  agentId?: string;
  sessionId?: string;
};

export type ConfirmPrivateSyncResult = {
  confirmed: boolean;
};

export type ConfirmDialogPayload = {
  title: string;
  description: string;
  level?: 'info' | 'warning' | 'error';
};

export type ConfirmDialogResult = {
  confirmed: boolean;
};

export type AgentMemoryStandardFixtureStatusPayload = {
  agentId: string;
};

export type AgentMemoryStandardFixtureStatusResult = {
  available: boolean;
  alreadyBound: boolean;
  bank: JsonObject;
};

export type DesktopMacosSmokeContext = {
  enabled: boolean;
  scenarioId?: string;
  reportPath?: string;
  artifactsDir?: string;
  disableRuntimeBootstrap?: boolean;
  bootstrapTimeoutMs?: number;
  avatarProductLocalAssetFault?: JsonObject;
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

export type DesktopMacosSmokeAvatarEvidenceReadResult = {
  evidencePath: string;
  evidence: JsonObject;
};
