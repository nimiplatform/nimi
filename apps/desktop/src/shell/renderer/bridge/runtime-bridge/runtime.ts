import {
  assertRecord,
  parseOptionalNumber,
  parseOptionalString,
  parseRequiredString,
} from './shared.js';
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
  styles?: string[];
  stylePaths?: string[];
  description?: string;
  manifest?: Record<string, unknown>;
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

export function parseRuntimeDefaults(value: unknown): RuntimeDefaults {
  const record = assertRecord(value, 'runtime_defaults returned invalid payload');
  const realmRecord = assertRecord(record.realm, 'runtime_defaults realm payload is invalid');
  const runtimeRecord = assertRecord(record.runtime, 'runtime_defaults runtime payload is invalid');
  return {
    realm: {
      realmBaseUrl: parseRequiredString(
        realmRecord.realmBaseUrl,
        'realm.realmBaseUrl',
        'runtime_defaults',
      ),
      realtimeUrl: String(realmRecord.realtimeUrl || '').trim(),
      accessToken: String(realmRecord.accessToken || '').trim(),
      jwksUrl: parseRequiredString(
        realmRecord.jwksUrl,
        'realm.jwksUrl',
        'runtime_defaults',
      ),
      jwtIssuer: parseRequiredString(
        realmRecord.jwtIssuer,
        'realm.jwtIssuer',
        'runtime_defaults',
      ),
      jwtAudience: parseRequiredString(
        realmRecord.jwtAudience,
        'realm.jwtAudience',
        'runtime_defaults',
      ),
    },
    runtime: {
      localProviderEndpoint: parseRequiredString(
        runtimeRecord.localProviderEndpoint,
        'runtime.localProviderEndpoint',
        'runtime_defaults',
      ),
      localProviderModel: parseRequiredString(
        runtimeRecord.localProviderModel,
        'runtime.localProviderModel',
        'runtime_defaults',
      ),
      localOpenAiEndpoint: parseRequiredString(
        runtimeRecord.localOpenAiEndpoint,
        'runtime.localOpenAiEndpoint',
        'runtime_defaults',
      ),
      connectorId: String(runtimeRecord.connectorId || '').trim(),
      targetType: parseRequiredString(runtimeRecord.targetType, 'runtime.targetType', 'runtime_defaults'),
      targetAccountId: String(runtimeRecord.targetAccountId || '').trim(),
      agentId: String(runtimeRecord.agentId || '').trim(),
      worldId: String(runtimeRecord.worldId || '').trim(),
      provider: String(runtimeRecord.provider || '').trim(),
      userConfirmedUpload: Boolean(runtimeRecord.userConfirmedUpload),
    },
  };
}

export function parseRuntimeModStorageDirs(value: unknown): RuntimeModStorageDirs {
  const record = assertRecord(value, 'runtime_mod_storage_dirs_get returned invalid payload');
  return {
    nimiDir: parseRequiredString(record.nimiDir, 'nimiDir', 'runtime_mod_storage_dirs_get'),
    nimiDataDir: parseRequiredString(record.nimiDataDir, 'nimiDataDir', 'runtime_mod_storage_dirs_get'),
    installedModsDir: parseRequiredString(record.installedModsDir, 'installedModsDir', 'runtime_mod_storage_dirs_get'),
    runtimeModDbPath: parseRequiredString(record.runtimeModDbPath, 'runtimeModDbPath', 'runtime_mod_storage_dirs_get'),
    mediaCacheDir: parseRequiredString(record.mediaCacheDir, 'mediaCacheDir', 'runtime_mod_storage_dirs_get'),
    localModelsDir: parseRequiredString(record.localModelsDir, 'localModelsDir', 'runtime_mod_storage_dirs_get'),
    localRuntimeStatePath: parseRequiredString(record.localRuntimeStatePath, 'localRuntimeStatePath', 'runtime_mod_storage_dirs_get'),
  };
}

export function parseSystemResourceSnapshot(value: unknown): SystemResourceSnapshot {
  const record = assertRecord(value, 'get_system_resource_snapshot returned invalid payload');
  const cpuPercent = Number(record.cpuPercent);
  const memoryUsedBytes = Number(record.memoryUsedBytes);
  const memoryTotalBytes = Number(record.memoryTotalBytes);
  const diskUsedBytes = Number(record.diskUsedBytes);
  const diskTotalBytes = Number(record.diskTotalBytes);
  const capturedAtMs = Number(record.capturedAtMs);
  if (!Number.isFinite(cpuPercent)) {
    throw new Error('get_system_resource_snapshot: cpuPercent is required');
  }
  if (!Number.isFinite(memoryUsedBytes) || !Number.isFinite(memoryTotalBytes)) {
    throw new Error('get_system_resource_snapshot: memory bytes are required');
  }
  if (!Number.isFinite(diskUsedBytes) || !Number.isFinite(diskTotalBytes)) {
    throw new Error('get_system_resource_snapshot: disk bytes are required');
  }
  if (!Number.isFinite(capturedAtMs)) {
    throw new Error('get_system_resource_snapshot: capturedAtMs is required');
  }
  return {
    cpuPercent,
    memoryUsedBytes,
    memoryTotalBytes,
    diskUsedBytes,
    diskTotalBytes,
    temperatureCelsius: parseOptionalNumber(record.temperatureCelsius),
    capturedAtMs,
    source: parseRequiredString(record.source, 'source', 'get_system_resource_snapshot'),
  };
}

export function parseRuntimeBridgeDaemonStatus(value: unknown): RuntimeBridgeDaemonStatus {
  const record = assertRecord(value, 'runtime_bridge_status returned invalid payload');
  const launchModeRaw = String(record.launchMode || '').trim().toUpperCase();
  const launchMode = launchModeRaw === 'RUNTIME' || launchModeRaw === 'RELEASE'
    ? launchModeRaw
    : 'INVALID';
  return {
    running: Boolean(record.running),
    managed: Boolean(record.managed),
    launchMode,
    grpcAddr: parseRequiredString(record.grpcAddr, 'grpcAddr', 'runtime_bridge_status'),
    pid: parseOptionalNumber(record.pid),
    version: parseOptionalString(record.version),
    lastError: parseOptionalString(record.lastError),
    debugLogPath: parseOptionalString(record.debugLogPath),
  };
}

export function parseRuntimeBridgeConfigGetResult(value: unknown): RuntimeBridgeConfigGetResult {
  const record = assertRecord(value, 'runtime_bridge_config_get returned invalid payload');
  const config = assertRecord(record.config, 'runtime_bridge_config_get config payload is invalid');
  return {
    path: parseRequiredString(record.path, 'path', 'runtime_bridge_config_get'),
    config,
  };
}

export function parseRuntimeBridgeConfigSetResult(value: unknown): RuntimeBridgeConfigSetResult {
  const record = assertRecord(value, 'runtime_bridge_config_set returned invalid payload');
  const config = assertRecord(record.config, 'runtime_bridge_config_set config payload is invalid');
  return {
    path: parseRequiredString(record.path, 'path', 'runtime_bridge_config_set'),
    reasonCode: parseOptionalString(record.reasonCode),
    actionHint: parseOptionalString(record.actionHint),
    config,
  };
}

export function parseMenuBarProviderSummary(value: unknown): MenuBarProviderSummary {
  const record = assertRecord(value, 'menu bar provider summary');
  return {
    healthy: parseOptionalNumber(record.healthy) || 0,
    unhealthy: parseOptionalNumber(record.unhealthy) || 0,
    unknown: parseOptionalNumber(record.unknown) || 0,
    total: parseOptionalNumber(record.total) || 0,
  };
}

export function parseRuntimeLocalManifestSummary(value: unknown): RuntimeLocalManifestSummary {
  const record = assertRecord(value, 'runtime_mod_list_local_manifests returned invalid manifest payload');
  const manifestRecord = record.manifest && typeof record.manifest === 'object' && !Array.isArray(record.manifest)
    ? (record.manifest as Record<string, unknown>)
    : undefined;
  const styles = Array.isArray(record.styles)
    ? record.styles.map((item) => String(item || '').trim()).filter(Boolean)
    : undefined;
  const stylePaths = Array.isArray(record.stylePaths)
    ? record.stylePaths.map((item) => String(item || '').trim()).filter(Boolean)
    : undefined;
  return {
    path: parseRequiredString(record.path, 'path', 'runtime_mod_list_local_manifests'),
    id: parseRequiredString(record.id, 'id', 'runtime_mod_list_local_manifests'),
    sourceId: parseOptionalString(record.sourceId),
    sourceType: (() => {
      const value = parseOptionalString(record.sourceType);
      return value === 'installed' || value === 'dev' ? value : undefined;
    })(),
    sourceDir: parseOptionalString(record.sourceDir),
    name: parseOptionalString(record.name),
    version: parseOptionalString(record.version),
    entry: parseOptionalString(record.entry),
    entryPath: parseOptionalString(record.entryPath),
    styles: styles && styles.length > 0 ? styles : undefined,
    stylePaths: stylePaths && stylePaths.length > 0 ? stylePaths : undefined,
    description: parseOptionalString(record.description),
    manifest: manifestRecord,
  };
}

export function parseRuntimeLocalManifestSummaries(value: unknown): RuntimeLocalManifestSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => parseRuntimeLocalManifestSummary(item));
}

export function parseRuntimeModInstallResult(value: unknown): RuntimeModInstallResult {
  const record = assertRecord(value, 'runtime_mod_install returned invalid payload');
  return {
    installSessionId: parseRequiredString(record.installSessionId, 'installSessionId', 'runtime_mod_install'),
    operation: parseRequiredString(record.operation, 'operation', 'runtime_mod_install'),
    modId: parseRequiredString(record.modId, 'modId', 'runtime_mod_install'),
    installedPath: parseRequiredString(record.installedPath, 'installedPath', 'runtime_mod_install'),
    manifest: parseRuntimeLocalManifestSummary(record.manifest),
  };
}

export function parseRuntimeModInstallProgressEvent(value: unknown): RuntimeModInstallProgressEvent {
  const record = assertRecord(value, 'runtime_mod_install_progress returned invalid payload');
  return {
    installSessionId: parseRequiredString(record.installSessionId, 'installSessionId', 'runtime_mod_install_progress'),
    operation: parseRequiredString(record.operation, 'operation', 'runtime_mod_install_progress'),
    sourceKind: parseRequiredString(record.sourceKind, 'sourceKind', 'runtime_mod_install_progress'),
    phase: parseRequiredString(record.phase, 'phase', 'runtime_mod_install_progress'),
    status: parseRequiredString(record.status, 'status', 'runtime_mod_install_progress'),
    occurredAt: parseRequiredString(record.occurredAt, 'occurredAt', 'runtime_mod_install_progress'),
    modId: parseOptionalString(record.modId),
    manifestPath: parseOptionalString(record.manifestPath),
    installedPath: parseOptionalString(record.installedPath),
    progressPercent: parseOptionalNumber(record.progressPercent),
    message: parseOptionalString(record.message),
    error: parseOptionalString(record.error),
  };
}

export function parseRuntimeModInstallProgressEvents(value: unknown): RuntimeModInstallProgressEvent[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => parseRuntimeModInstallProgressEvent(item));
}

export function parseRuntimeModSourceRecord(value: unknown): RuntimeModSourceRecord {
  const record = assertRecord(value, 'runtime_mod_sources_list returned invalid payload');
  const sourceType = parseRequiredString(record.sourceType, 'sourceType', 'runtime_mod_sources_list');
  if (sourceType !== 'installed' && sourceType !== 'dev') {
    throw new Error(`runtime_mod_sources_list: invalid sourceType ${sourceType}`);
  }
  return {
    sourceId: parseRequiredString(record.sourceId, 'sourceId', 'runtime_mod_sources_list'),
    sourceType,
    sourceDir: parseRequiredString(record.sourceDir, 'sourceDir', 'runtime_mod_sources_list'),
    enabled: Boolean(record.enabled),
    isDefault: Boolean(record.isDefault),
  };
}

export function parseRuntimeModSourceRecords(value: unknown): RuntimeModSourceRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => parseRuntimeModSourceRecord(item));
}

export function parseRuntimeModDeveloperModeState(value: unknown): RuntimeModDeveloperModeState {
  const record = assertRecord(value, 'runtime_mod_dev_mode_get returned invalid payload');
  return {
    enabled: Boolean(record.enabled),
    autoReloadEnabled: Boolean(record.autoReloadEnabled),
  };
}

export function parseRuntimeModDiagnosticRecord(value: unknown): RuntimeModDiagnosticRecord {
  const record = assertRecord(value, 'runtime_mod_diagnostics_list returned invalid payload');
  const status = parseRequiredString(record.status, 'status', 'runtime_mod_diagnostics_list');
  if (status !== 'resolved' && status !== 'conflict' && status !== 'invalid') {
    throw new Error(`runtime_mod_diagnostics_list: invalid status ${status}`);
  }
  const sourceType = parseRequiredString(record.sourceType, 'sourceType', 'runtime_mod_diagnostics_list');
  if (sourceType !== 'installed' && sourceType !== 'dev') {
    throw new Error(`runtime_mod_diagnostics_list: invalid sourceType ${sourceType}`);
  }
  return {
    modId: parseRequiredString(record.modId, 'modId', 'runtime_mod_diagnostics_list'),
    status,
    sourceId: parseRequiredString(record.sourceId, 'sourceId', 'runtime_mod_diagnostics_list'),
    sourceType,
    sourceDir: parseRequiredString(record.sourceDir, 'sourceDir', 'runtime_mod_diagnostics_list'),
    manifestPath: parseOptionalString(record.manifestPath),
    entryPath: parseOptionalString(record.entryPath),
    error: parseOptionalString(record.error),
    conflictPaths: Array.isArray(record.conflictPaths)
      ? record.conflictPaths.map((item) => String(item || '').trim()).filter(Boolean)
      : undefined,
  };
}

export function parseRuntimeModDiagnosticRecords(value: unknown): RuntimeModDiagnosticRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => parseRuntimeModDiagnosticRecord(item));
}

export function parseRuntimeModReloadResult(value: unknown): RuntimeModReloadResult {
  const record = assertRecord(value, 'runtime_mod_reload returned invalid payload');
  const status = parseRequiredString(record.status, 'status', 'runtime_mod_reload');
  if (status !== 'resolved' && status !== 'conflict' && status !== 'invalid') {
    throw new Error(`runtime_mod_reload: invalid status ${status}`);
  }
  return {
    modId: parseRequiredString(record.modId, 'modId', 'runtime_mod_reload'),
    sourceId: parseRequiredString(record.sourceId, 'sourceId', 'runtime_mod_reload'),
    status,
    occurredAt: parseRequiredString(record.occurredAt, 'occurredAt', 'runtime_mod_reload'),
    error: parseOptionalString(record.error),
  };
}

export function parseRuntimeModReloadResults(value: unknown): RuntimeModReloadResult[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => parseRuntimeModReloadResult(item));
}

export function parseRuntimeModSourceChangeEvent(value: unknown): RuntimeModSourceChangeEvent {
  const record = assertRecord(value, 'runtime-mod://source-changed returned invalid payload');
  const sourceType = parseRequiredString(record.sourceType, 'sourceType', 'runtime-mod://source-changed');
  if (sourceType !== 'installed' && sourceType !== 'dev') {
    throw new Error(`runtime-mod://source-changed: invalid sourceType ${sourceType}`);
  }
  return {
    sourceId: parseRequiredString(record.sourceId, 'sourceId', 'runtime-mod://source-changed'),
    sourceType,
    sourceDir: parseRequiredString(record.sourceDir, 'sourceDir', 'runtime-mod://source-changed'),
    occurredAt: parseRequiredString(record.occurredAt, 'occurredAt', 'runtime-mod://source-changed'),
    paths: Array.isArray(record.paths)
      ? record.paths.map((item) => String(item || '').trim()).filter(Boolean)
      : [],
  };
}

export function parseOpenExternalUrlResult(value: unknown): OpenExternalUrlResult {
  const record = assertRecord(value, 'open_external_url returned invalid payload');
  return {
    opened: Boolean(record.opened),
  };
}

export function parseConfirmPrivateSyncResult(value: unknown): ConfirmPrivateSyncResult {
  const record = assertRecord(value, 'confirm_private_sync returned invalid payload');
  return {
    confirmed: Boolean(record.confirmed),
  };
}

export function parseOauthTokenExchangeResult(value: unknown): OauthTokenExchangeResult {
  const record = assertRecord(value, 'oauth_token_exchange returned invalid payload');
  const raw = record.raw && typeof record.raw === 'object' && !Array.isArray(record.raw)
    ? (record.raw as Record<string, unknown>)
    : {};
  return {
    accessToken: parseRequiredString(record.accessToken, 'accessToken', 'oauth_token_exchange'),
    refreshToken: parseOptionalString(record.refreshToken),
    tokenType: parseOptionalString(record.tokenType),
    expiresIn: Number.isFinite(Number(record.expiresIn)) ? Number(record.expiresIn) : undefined,
    scope: parseOptionalString(record.scope),
    raw,
  };
}

export function parseOauthListenForCodeResult(value: unknown): OauthListenForCodeResult {
  const record = assertRecord(value, 'oauth_listen_for_code returned invalid payload');
  return {
    callbackUrl: parseRequiredString(record.callbackUrl, 'callbackUrl', 'oauth_listen_for_code'),
    code: parseOptionalString(record.code),
    state: parseOptionalString(record.state),
    error: parseOptionalString(record.error),
  };
}
