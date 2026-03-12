export type RealmDefaults = {
  realmBaseUrl: string;
  realtimeUrl: string;
  accessToken: string;
  jwksUrl: string;
  jwtIssuer: string;
  jwtAudience: string;
};

export type RuntimeExecutionDefaults = {
  localProviderEndpoint: string;
  localProviderModel: string;
  localOpenAiEndpoint: string;
  connectorId: string;
  targetType: string;
  targetAccountId: string;
  agentId: string;
  worldId: string;
  provider: string;
  userConfirmedUpload: boolean;
};

export type RuntimeDefaults = {
  realm: RealmDefaults;
  runtime: RuntimeExecutionDefaults;
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
  config: Record<string, unknown>;
};

export type RuntimeBridgeConfigSetResult = {
  path: string;
  reasonCode?: string;
  actionHint?: string;
  config: Record<string, unknown>;
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

export type RuntimeLocalManifestSummary = {
  path: string;
  id: string;
  sourceId?: string;
  sourceType?: 'installed' | 'dev';
  sourceDir?: string;
  name?: string;
  version?: string;
  entry?: string;
  entryPath?: string;
  iconAsset?: string;
  iconAssetPath?: string;
  styles?: string[];
  stylePaths?: string[];
  description?: string;
  manifest?: Record<string, unknown>;
  releaseManifest?: Record<string, unknown>;
};

export type RuntimeLocalAsset = {
  mimeType: string;
  base64: string;
};

export type RuntimeModInstallSourceKind = 'directory' | 'archive' | 'url';

export type RuntimeModSourceType = 'installed' | 'dev';

export type RuntimeModSourceRecord = {
  sourceId: string;
  sourceType: RuntimeModSourceType;
  sourceDir: string;
  enabled: boolean;
  isDefault: boolean;
};

export type RuntimeModStorageDirs = {
  nimiDir: string;
  nimiDataDir: string;
  installedModsDir: string;
  runtimeModDbPath: string;
  mediaCacheDir: string;
  localModelsDir: string;
  localRuntimeStatePath: string;
};

export type RuntimeModDeveloperModeState = {
  enabled: boolean;
  autoReloadEnabled: boolean;
};

export type RuntimeModDiagnosticStatus = 'resolved' | 'conflict' | 'invalid';

export type RuntimeModDiagnosticRecord = {
  modId: string;
  status: RuntimeModDiagnosticStatus;
  sourceId: string;
  sourceType: RuntimeModSourceType;
  sourceDir: string;
  manifestPath?: string;
  entryPath?: string;
  error?: string;
  conflictPaths?: string[];
};

export type RuntimeModReloadResult = {
  modId: string;
  sourceId: string;
  status: RuntimeModDiagnosticStatus;
  occurredAt: string;
  error?: string;
};

export type RuntimeModSourceChangeEvent = {
  sourceId: string;
  sourceType: RuntimeModSourceType;
  sourceDir: string;
  occurredAt: string;
  paths: string[];
};

export type RuntimeModInstallPayload = {
  source: string;
  sourceKind?: RuntimeModInstallSourceKind;
  replaceExisting?: boolean;
};

export type RuntimeModUpdatePayload = {
  modId: string;
  source: string;
  sourceKind?: RuntimeModInstallSourceKind;
};

export type RuntimeModInstallResult = {
  installSessionId: string;
  operation: string;
  modId: string;
  installedPath: string;
  manifest: RuntimeLocalManifestSummary;
  rollbackPath?: string;
};

export type CatalogTrustTier = 'official' | 'verified' | 'community';

export type CatalogPublisher = {
  publisherId: string;
  displayName: string;
  trustTier: CatalogTrustTier;
};

export type CatalogState = {
  listed: boolean;
  yanked: boolean;
  quarantined: boolean;
};

export type CatalogSigner = {
  signerId: string;
  algorithm: string;
  publicKey: string;
};

export type CatalogPackageSummary = {
  packageId: string;
  packageType: 'desktop-mod' | 'nimi-app' | string;
  name: string;
  description: string;
  latestVersion?: string;
  latestChannel?: string;
  publisher: CatalogPublisher;
  state: CatalogState;
  keywords: string[];
  tags: string[];
  iconUrl?: string;
};

export type CatalogReleaseSource = {
  repoUrl: string;
  releaseTag: string;
};

export type CatalogReleaseRecord = {
  packageType: 'desktop-mod' | 'nimi-app' | string;
  packageId: string;
  version: string;
  channel: string;
  artifactUrl: string;
  sha256: string;
  signature: string;
  signerId: string;
  minDesktopVersion: string;
  minHookApiVersion: string;
  capabilities: string[];
  requiresReconsentOnCapabilityIncrease: boolean;
  publisher: CatalogPublisher;
  source: CatalogReleaseSource;
  state: CatalogState;
  appMode?: string;
  scopeCatalogVersion?: string;
  minRuntimeVersion?: string;
};

export type CatalogPackageRecord = {
  packageId: string;
  packageType: 'desktop-mod' | 'nimi-app' | string;
  name: string;
  description: string;
  publisher: CatalogPublisher;
  state: CatalogState;
  channels: Record<string, string>;
  keywords: string[];
  tags: string[];
  iconUrl?: string;
  signers: CatalogSigner[];
  releases: CatalogReleaseRecord[];
};

export type InstalledModPolicy = {
  channel: string;
  autoUpdate: boolean;
};

export type CatalogConsentReason =
  | 'advisory-review'
  | 'capability-increase'
  | 'community-package'
  | 'trust-tier-downgrade'
  | string;

export type AvailableModUpdate = {
  packageId: string;
  installedVersion: string;
  targetVersion: string;
  policy: InstalledModPolicy;
  trustTier: CatalogTrustTier | string;
  requiresUserConsent: boolean;
  consentReasons: CatalogConsentReason[];
  addedCapabilities: string[];
  advisoryIds: string[];
};

export type CatalogInstallResult = {
  install: RuntimeModInstallResult;
  package: CatalogPackageRecord;
  release: CatalogReleaseRecord;
  policy: InstalledModPolicy;
  requiresUserConsent: boolean;
  consentReasons: CatalogConsentReason[];
  addedCapabilities: string[];
  advisoryIds: string[];
};

export type RuntimeModInstallProgressEvent = {
  installSessionId: string;
  operation: string;
  sourceKind: string;
  phase: string;
  status: string;
  occurredAt: string;
  modId?: string;
  manifestPath?: string;
  installedPath?: string;
  progressPercent?: number;
  message?: string;
  error?: string;
};

export type OpenExternalUrlResult = {
  opened: boolean;
};

export type OauthTokenExchangePayload = {
  tokenUrl: string;
  clientId: string;
  code: string;
  codeVerifier?: string;
  redirectUri?: string;
  clientSecret?: string;
  extra?: Record<string, string>;
};

export type OauthTokenExchangeResult = {
  accessToken: string;
  refreshToken?: string;
  tokenType?: string;
  expiresIn?: number;
  scope?: string;
  raw: Record<string, unknown>;
};

export type OauthListenForCodePayload = {
  redirectUri: string;
  timeoutMs?: number;
};

export type OauthListenForCodeResult = {
  callbackUrl: string;
  code?: string;
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
