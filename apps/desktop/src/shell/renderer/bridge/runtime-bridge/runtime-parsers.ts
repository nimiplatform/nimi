import {
  parseRuntimeBridgeDaemonStatus as parseSharedRuntimeBridgeDaemonStatus,
  parseRuntimeDefaults as parseSharedRuntimeDefaults,
} from '@nimiplatform/kit/shell/renderer/bridge';
import {
  assertRecord,
  parseOptionalNumber,
  parseRequiredString,
} from './shared.js';
import type { SystemResourceSnapshot } from './runtime-types';

export const parseRuntimeDefaults = parseSharedRuntimeDefaults;
export const parseRuntimeBridgeDaemonStatus = parseSharedRuntimeBridgeDaemonStatus;

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
    temperatureCelsius: record.temperatureCelsius == null
      ? undefined
      : parseOptionalNumber(record.temperatureCelsius),
    capturedAtMs,
    source: parseRequiredString(record.source, 'source', 'get_system_resource_snapshot'),
  };
}
