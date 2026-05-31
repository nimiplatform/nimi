import { parseRuntimeDefaults as parseSharedRuntimeDefaults } from '@nimiplatform/kit/shell/renderer/bridge';
import {
  assertRecord,
  parseOptionalJsonObject,
  parseOptionalNumber,
  parseOptionalString,
  parseRequiredString,
} from './shared.js';
import type {
  DesktopReleaseInfo,
  DesktopUpdateCheckResult,
  DesktopUpdateState,
  DesktopMacosSmokeContext,
  DesktopMacosSmokeAvatarEvidenceReadResult,
  DesktopMacosSmokeReportResult,
  MenuBarProviderSummary,
  RuntimeBridgeConfigGetResult,
  RuntimeBridgeConfigSetResult,
  RuntimeBridgeDaemonStatus,
  SystemResourceSnapshot,
} from './runtime-types';

export const parseRuntimeDefaults = parseSharedRuntimeDefaults;

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
    updaterAvailable: Boolean(record.updaterAvailable),
    updaterUnavailableReason: parseOptionalString(record.updaterUnavailableReason),
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

export function parseDesktopMacosSmokeContext(value: unknown): DesktopMacosSmokeContext {
  const record = assertRecord(value, 'desktop_macos_smoke_context_get returned invalid payload');
  return {
    enabled: Boolean(record.enabled),
    scenarioId: parseOptionalString(record.scenarioId),
    reportPath: parseOptionalString(record.reportPath),
    artifactsDir: parseOptionalString(record.artifactsDir),
    disableRuntimeBootstrap: Boolean(record.disableRuntimeBootstrap),
    bootstrapTimeoutMs: parseOptionalNumber(record.bootstrapTimeoutMs),
    avatarProductLocalAssetFault: parseOptionalJsonObject(record.avatarProductLocalAssetFault) || undefined,
  };
}

export function parseDesktopMacosSmokeReportResult(value: unknown): DesktopMacosSmokeReportResult {
  const record = assertRecord(value, 'desktop_macos_smoke_report_write returned invalid payload');
  return {
    reportPath: parseRequiredString(record.reportPath, 'reportPath', 'desktop_macos_smoke_report_write'),
    htmlSnapshotPath: parseOptionalString(record.htmlSnapshotPath),
  };
}

export function parseDesktopMacosSmokeAvatarEvidenceReadResult(value: unknown): DesktopMacosSmokeAvatarEvidenceReadResult {
  const record = assertRecord(value, 'desktop_macos_smoke_avatar_evidence_read returned invalid payload');
  return {
    evidencePath: parseRequiredString(record.evidencePath, 'evidencePath', 'desktop_macos_smoke_avatar_evidence_read'),
    evidence: parseOptionalJsonObject(record.evidence) || {},
  };
}
