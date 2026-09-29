import {
  parseRuntimeBridgeDaemonStatus as parseSharedRuntimeBridgeDaemonStatus,
  parseRuntimeDefaults as parseSharedRuntimeDefaults,
} from '@nimiplatform/kit/shell/renderer/bridge';
import {
  assertRecord,
  parseOptionalNumber,
  parseRequiredString,
} from './shared.js';
import type { SystemMemoryPressure, SystemResourceSnapshot } from './runtime-types';

const MEMORY_PRESSURES: ReadonlySet<string> = new Set<SystemMemoryPressure>(['normal', 'warning', 'critical', 'unknown']);

export const parseRuntimeDefaults = parseSharedRuntimeDefaults;
export const parseRuntimeBridgeDaemonStatus = parseSharedRuntimeBridgeDaemonStatus;

export function parseSystemResourceSnapshot(value: unknown): SystemResourceSnapshot {
  const record = assertRecord(value, 'get_system_resource_snapshot returned invalid payload');
  const cpuPercent = Number(record.cpuPercent);
  const memoryUsedBytes = Number(record.memoryUsedBytes);
  const memoryTotalBytes = Number(record.memoryTotalBytes);
  const diskUsedBytes = record.diskUsedBytes === null ? null : Number(record.diskUsedBytes);
  const diskTotalBytes = record.diskTotalBytes === null ? null : Number(record.diskTotalBytes);
  const capturedAtMs = Number(record.capturedAtMs);
  const memoryPressure = record.memoryPressure;
  if (!Number.isFinite(cpuPercent)) {
    throw new Error('get_system_resource_snapshot: cpuPercent is required');
  }
  if (!Number.isFinite(memoryUsedBytes) || !Number.isFinite(memoryTotalBytes)) {
    throw new Error('get_system_resource_snapshot: memory bytes are required');
  }
  if (typeof memoryPressure !== 'string' || !MEMORY_PRESSURES.has(memoryPressure)) {
    throw new Error('get_system_resource_snapshot: memoryPressure is invalid');
  }
  if (!((diskUsedBytes === null && diskTotalBytes === null)
    || (diskUsedBytes !== null && diskTotalBytes !== null && Number.isSafeInteger(diskUsedBytes) && Number.isSafeInteger(diskTotalBytes)
      && diskUsedBytes >= 0 && diskTotalBytes > 0 && diskUsedBytes <= diskTotalBytes))) {
    throw new Error('get_system_resource_snapshot: disk bytes are required');
  }
  if (!Number.isFinite(capturedAtMs)) {
    throw new Error('get_system_resource_snapshot: capturedAtMs is required');
  }
  return {
    cpuPercent,
    memoryUsedBytes,
    memoryTotalBytes,
    memoryPressure: memoryPressure as SystemMemoryPressure,
    diskUsedBytes,
    diskTotalBytes,
    temperatureCelsius: record.temperatureCelsius == null
      ? undefined
      : parseOptionalNumber(record.temperatureCelsius),
    capturedAtMs,
    source: parseRequiredString(record.source, 'source', 'get_system_resource_snapshot'),
  };
}
