import {
  assertRecord,
  parseOptionalNumber,
  parseOptionalString,
  parseRequiredString,
} from './shared.js';
import type {
  DesktopReleaseInfo,
  DesktopUpdateCheckResult,
  DesktopUpdateState,
  AvailableModUpdate,
  CatalogInstallResult,
  CatalogPackageRecord,
  CatalogPackageSummary,
  CatalogPublisher,
  CatalogReleaseRecord,
  CatalogReleaseSource,
  CatalogSigner,
  CatalogState,
  CatalogTrustTier,
  ConfirmPrivateSyncResult,
  InstalledModPolicy,
  MenuBarProviderSummary,
  OauthListenForCodeResult,
  OauthTokenExchangeResult,
  OpenExternalUrlResult,
  RuntimeBridgeConfigGetResult,
  RuntimeBridgeConfigSetResult,
  RuntimeBridgeDaemonStatus,
  RuntimeDefaults,
  RuntimeLocalAsset,
  RuntimeLocalManifestSummary,
  RuntimeModDeveloperModeState,
  RuntimeModDiagnosticRecord,
  RuntimeModInstallProgressEvent,
  RuntimeModInstallResult,
  RuntimeModReloadResult,
  RuntimeModSourceChangeEvent,
  RuntimeModSourceRecord,
  RuntimeModStorageDirs,
  SystemResourceSnapshot,
} from './runtime-types';

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

export function parseDesktopReleaseInfo(value: unknown): DesktopReleaseInfo {
  const record = assertRecord(value, 'desktop_release_info_get returned invalid payload');
  return {
    desktopVersion: parseRequiredString(record.desktopVersion, 'desktopVersion', 'desktop_release_info_get'),
    runtimeVersion: parseRequiredString(record.runtimeVersion, 'runtimeVersion', 'desktop_release_info_get'),
    channel: parseRequiredString(record.channel, 'channel', 'desktop_release_info_get'),
    commit: parseRequiredString(record.commit, 'commit', 'desktop_release_info_get'),
    builtAt: parseRequiredString(record.builtAt, 'builtAt', 'desktop_release_info_get'),
    runtimeReady: Boolean(record.runtimeReady),
    runtimeStagedPath: parseOptionalString(record.runtimeStagedPath),
    runtimeLastError: parseOptionalString(record.runtimeLastError),
  };
}

export function parseDesktopUpdateState(value: unknown): DesktopUpdateState {
  const record = assertRecord(value, 'desktop_update_state_get returned invalid payload');
  return {
    status: parseRequiredString(record.status, 'status', 'desktop_update_state_get'),
    currentVersion: parseRequiredString(record.currentVersion, 'currentVersion', 'desktop_update_state_get'),
    targetVersion: parseOptionalString(record.targetVersion),
    downloadedBytes: parseOptionalNumber(record.downloadedBytes) || 0,
    totalBytes: parseOptionalNumber(record.totalBytes),
    lastError: parseOptionalString(record.lastError),
    readyToRestart: Boolean(record.readyToRestart),
  };
}

export function parseDesktopUpdateCheckResult(value: unknown): DesktopUpdateCheckResult {
  const record = assertRecord(value, 'desktop_update_check returned invalid payload');
  return {
    available: Boolean(record.available),
    currentVersion: parseRequiredString(record.currentVersion, 'currentVersion', 'desktop_update_check'),
    targetVersion: parseOptionalString(record.targetVersion),
    notes: parseOptionalString(record.notes),
    pubDate: parseOptionalString(record.pubDate),
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
  const releaseManifestRecord = record.releaseManifest && typeof record.releaseManifest === 'object' && !Array.isArray(record.releaseManifest)
    ? (record.releaseManifest as Record<string, unknown>)
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
    iconAsset: parseOptionalString(record.iconAsset),
    iconAssetPath: parseOptionalString(record.iconAssetPath),
    styles: styles && styles.length > 0 ? styles : undefined,
    stylePaths: stylePaths && stylePaths.length > 0 ? stylePaths : undefined,
    description: parseOptionalString(record.description),
    manifest: manifestRecord,
    releaseManifest: releaseManifestRecord,
  };
}

export function parseRuntimeLocalManifestSummaries(value: unknown): RuntimeLocalManifestSummary[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.map((item) => parseRuntimeLocalManifestSummary(item));
}

export function parseRuntimeLocalAsset(value: unknown): RuntimeLocalAsset {
  const record = assertRecord(value, 'runtime_mod_read_local_asset returned invalid payload');
  return {
    mimeType: parseRequiredString(record.mimeType, 'mimeType', 'runtime_mod_read_local_asset'),
    base64: parseRequiredString(record.base64, 'base64', 'runtime_mod_read_local_asset'),
  };
}

export function parseRuntimeModInstallResult(value: unknown): RuntimeModInstallResult {
  const record = assertRecord(value, 'runtime_mod_install returned invalid payload');
  return {
    installSessionId: parseRequiredString(record.installSessionId, 'installSessionId', 'runtime_mod_install'),
    operation: parseRequiredString(record.operation, 'operation', 'runtime_mod_install'),
    modId: parseRequiredString(record.modId, 'modId', 'runtime_mod_install'),
    installedPath: parseRequiredString(record.installedPath, 'installedPath', 'runtime_mod_install'),
    manifest: parseRuntimeLocalManifestSummary(record.manifest),
    rollbackPath: parseOptionalString(record.rollbackPath),
  };
}

function parseCatalogPublisher(value: unknown): CatalogPublisher {
  const record = assertRecord(value, 'catalog publisher');
  return {
    publisherId: parseRequiredString(record.publisherId, 'publisherId', 'catalog publisher'),
    displayName: parseRequiredString(record.displayName, 'displayName', 'catalog publisher'),
    trustTier: parseRequiredString(record.trustTier, 'trustTier', 'catalog publisher') as CatalogTrustTier,
  };
}

function parseCatalogState(value: unknown): CatalogState {
  const record = assertRecord(value, 'catalog state');
  return {
    listed: Boolean(record.listed),
    yanked: Boolean(record.yanked),
    quarantined: Boolean(record.quarantined),
  };
}

function parseCatalogSigner(value: unknown): CatalogSigner {
  const record = assertRecord(value, 'catalog signer');
  return {
    signerId: parseRequiredString(record.signerId, 'signerId', 'catalog signer'),
    algorithm: parseRequiredString(record.algorithm, 'algorithm', 'catalog signer'),
    publicKey: parseRequiredString(record.publicKey, 'publicKey', 'catalog signer'),
  };
}

export function parseCatalogPackageSummary(value: unknown): CatalogPackageSummary {
  const record = assertRecord(value, 'runtime_mod_catalog_list returned invalid payload');
  return {
    packageId: parseRequiredString(record.packageId, 'packageId', 'runtime_mod_catalog_list'),
    packageType: parseRequiredString(record.packageType, 'packageType', 'runtime_mod_catalog_list'),
    name: parseRequiredString(record.name, 'name', 'runtime_mod_catalog_list'),
    description: parseRequiredString(record.description, 'description', 'runtime_mod_catalog_list'),
    latestVersion: parseOptionalString(record.latestVersion),
    latestChannel: parseOptionalString(record.latestChannel),
    publisher: parseCatalogPublisher(record.publisher),
    state: parseCatalogState(record.state),
    keywords: Array.isArray(record.keywords) ? record.keywords.map((item) => String(item || '').trim()).filter(Boolean) : [],
    tags: Array.isArray(record.tags) ? record.tags.map((item) => String(item || '').trim()).filter(Boolean) : [],
    iconUrl: parseOptionalString(record.iconUrl),
  };
}

export function parseCatalogPackageSummaries(value: unknown): CatalogPackageSummary[] {
  if (!Array.isArray(value)) return [];
  return value.map(parseCatalogPackageSummary);
}

function parseCatalogReleaseSource(value: unknown): CatalogReleaseSource {
  const record = assertRecord(value, 'catalog release source');
  return {
    repoUrl: parseRequiredString(record.repoUrl, 'repoUrl', 'catalog release source'),
    releaseTag: parseRequiredString(record.releaseTag, 'releaseTag', 'catalog release source'),
  };
}

export function parseCatalogReleaseRecord(value: unknown): CatalogReleaseRecord {
  const record = assertRecord(value, 'catalog release');
  return {
    packageType: parseRequiredString(record.packageType, 'packageType', 'catalog release'),
    packageId: parseRequiredString(record.packageId, 'packageId', 'catalog release'),
    version: parseRequiredString(record.version, 'version', 'catalog release'),
    channel: parseRequiredString(record.channel, 'channel', 'catalog release'),
    artifactUrl: parseRequiredString(record.artifactUrl, 'artifactUrl', 'catalog release'),
    sha256: parseRequiredString(record.sha256, 'sha256', 'catalog release'),
    signature: parseRequiredString(record.signature, 'signature', 'catalog release'),
    signerId: parseRequiredString(record.signerId, 'signerId', 'catalog release'),
    minDesktopVersion: parseRequiredString(record.minDesktopVersion, 'minDesktopVersion', 'catalog release'),
    minHookApiVersion: parseRequiredString(record.minHookApiVersion, 'minHookApiVersion', 'catalog release'),
    capabilities: Array.isArray(record.capabilities) ? record.capabilities.map((item) => String(item || '').trim()).filter(Boolean) : [],
    requiresReconsentOnCapabilityIncrease: Boolean(record.requiresReconsentOnCapabilityIncrease),
    publisher: parseCatalogPublisher(record.publisher),
    source: parseCatalogReleaseSource(record.source),
    state: parseCatalogState(record.state),
    appMode: parseOptionalString(record.appMode),
    scopeCatalogVersion: parseOptionalString(record.scopeCatalogVersion),
    minRuntimeVersion: parseOptionalString(record.minRuntimeVersion),
  };
}

export function parseCatalogPackageRecord(value: unknown): CatalogPackageRecord {
  const record = assertRecord(value, 'catalog package record');
  const channelsRecord = record.channels && typeof record.channels === 'object' && !Array.isArray(record.channels)
    ? record.channels as Record<string, unknown>
    : {};
  return {
    packageId: parseRequiredString(record.packageId, 'packageId', 'catalog package record'),
    packageType: parseRequiredString(record.packageType, 'packageType', 'catalog package record'),
    name: parseRequiredString(record.name, 'name', 'catalog package record'),
    description: parseRequiredString(record.description, 'description', 'catalog package record'),
    publisher: parseCatalogPublisher(record.publisher),
    state: parseCatalogState(record.state),
    channels: Object.fromEntries(Object.entries(channelsRecord).map(([key, item]) => [key, String(item || '').trim()])),
    keywords: Array.isArray(record.keywords) ? record.keywords.map((item) => String(item || '').trim()).filter(Boolean) : [],
    tags: Array.isArray(record.tags) ? record.tags.map((item) => String(item || '').trim()).filter(Boolean) : [],
    iconUrl: parseOptionalString(record.iconUrl),
    signers: Array.isArray(record.signers) ? record.signers.map(parseCatalogSigner) : [],
    releases: Array.isArray(record.releases) ? record.releases.map(parseCatalogReleaseRecord) : [],
  };
}

function parseInstalledModPolicy(value: unknown): InstalledModPolicy {
  const record = assertRecord(value, 'installed mod policy');
  return {
    channel: parseRequiredString(record.channel, 'channel', 'installed mod policy'),
    autoUpdate: Boolean(record.autoUpdate),
  };
}

export function parseAvailableModUpdate(value: unknown): AvailableModUpdate {
  const record = assertRecord(value, 'catalog update');
  return {
    packageId: parseRequiredString(record.packageId, 'packageId', 'catalog update'),
    installedVersion: parseRequiredString(record.installedVersion, 'installedVersion', 'catalog update'),
    targetVersion: parseRequiredString(record.targetVersion, 'targetVersion', 'catalog update'),
    policy: parseInstalledModPolicy(record.policy),
    trustTier: parseRequiredString(record.trustTier, 'trustTier', 'catalog update'),
    requiresUserConsent: Boolean(record.requiresUserConsent),
    consentReasons: Array.isArray(record.consentReasons)
      ? record.consentReasons.map((item) => String(item || '').trim()).filter(Boolean)
      : [],
    addedCapabilities: Array.isArray(record.addedCapabilities)
      ? record.addedCapabilities.map((item) => String(item || '').trim()).filter(Boolean)
      : [],
    advisoryIds: Array.isArray(record.advisoryIds) ? record.advisoryIds.map((item) => String(item || '').trim()).filter(Boolean) : [],
  };
}

export function parseAvailableModUpdates(value: unknown): AvailableModUpdate[] {
  if (!Array.isArray(value)) return [];
  return value.map(parseAvailableModUpdate);
}

export function parseCatalogInstallResult(value: unknown): CatalogInstallResult {
  const record = assertRecord(value, 'catalog install result');
  return {
    install: parseRuntimeModInstallResult(record.install),
    package: parseCatalogPackageRecord(record.package),
    release: parseCatalogReleaseRecord(record.release),
    policy: parseInstalledModPolicy(record.policy),
    requiresUserConsent: Boolean(record.requiresUserConsent),
    consentReasons: Array.isArray(record.consentReasons)
      ? record.consentReasons.map((item) => String(item || '').trim()).filter(Boolean)
      : [],
    addedCapabilities: Array.isArray(record.addedCapabilities)
      ? record.addedCapabilities.map((item) => String(item || '').trim()).filter(Boolean)
      : [],
    advisoryIds: Array.isArray(record.advisoryIds) ? record.advisoryIds.map((item) => String(item || '').trim()).filter(Boolean) : [],
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
