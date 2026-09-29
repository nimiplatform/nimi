import { execFile } from 'node:child_process';
import { statfs } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const COMMAND = 'get_system_resource_snapshot' as const;
const CPU_SAMPLE_MS = 120;
const HOST_PROBE_WAIT_MS = 1_000;

// Pressure is the OS's own verdict and stays apart from occupancy: on macOS
// total minus free also counts cache the system can reclaim, so a high share is
// not pressure by itself. Platforms without such a verdict report unknown.
export type DesktopElectronMemoryPressure = 'normal' | 'warning' | 'critical' | 'unknown';

// kern.memorystatus_vm_pressure_level carries the dispatch memory-pressure level.
const MACOS_MEMORY_PRESSURE_LEVELS: Readonly<Record<string, DesktopElectronMemoryPressure>> = {
  '1': 'normal',
  '2': 'warning',
  '4': 'critical',
};

export type DesktopElectronSystemResourceSnapshot = {
  readonly cpuPercent: number;
  readonly memoryUsedBytes: number;
  readonly memoryTotalBytes: number;
  readonly memoryPressure: DesktopElectronMemoryPressure;
  readonly diskUsedBytes: number | null;
  readonly diskTotalBytes: number | null;
  readonly temperatureCelsius: null;
  readonly capturedAtMs: number;
  readonly source: string;
};

export type DesktopElectronSystemResourcesHost = {
  readonly commandHandlers: Readonly<Record<typeof COMMAND, (context: {
    readonly payload: Readonly<Record<string, unknown>>;
  }) => Promise<DesktopElectronSystemResourceSnapshot>>>;
};

export type DesktopElectronSystemResourceSources = {
  /** Disk usage describes the volume holding the selected Nimi data root. */
  readonly resolveDataRoot?: () => Promise<string>;
  readonly readMemoryPressure?: () => Promise<DesktopElectronMemoryPressure>;
};

export function createDesktopElectronSystemResourcesHost(
  sources: DesktopElectronSystemResourceSources = {},
): DesktopElectronSystemResourcesHost {
  return {
    commandHandlers: {
      [COMMAND]: async ({ payload }) => {
        if (Object.keys(payload).length !== 0) {
          throw new Error('desktop-system-resources-payload-invalid');
        }
        return collectDesktopElectronSystemResourceSnapshot(sources);
      },
    },
  };
}

export async function collectDesktopElectronSystemResourceSnapshot(
  sources: DesktopElectronSystemResourceSources = {},
): Promise<DesktopElectronSystemResourceSnapshot> {
  const dataRoot = resolveDataRootForDisk(sources.resolveDataRoot);
  const memoryPressure = (sources.readMemoryPressure ?? readHostMemoryPressure)();
  const cpuBefore = readCpuTimes();
  await delay(CPU_SAMPLE_MS);
  const cpuAfter = readCpuTimes();
  const totalDelta = cpuAfter.total - cpuBefore.total;
  const idleDelta = cpuAfter.idle - cpuBefore.idle;
  if (totalDelta <= 0 || idleDelta < 0 || idleDelta > totalDelta) {
    throw new Error('desktop-system-resources-cpu-unavailable');
  }

  const memoryTotalBytes = os.totalmem();
  const memoryFreeBytes = os.freemem();
  if (!Number.isSafeInteger(memoryTotalBytes)
    || memoryTotalBytes <= 0
    || !Number.isSafeInteger(memoryFreeBytes)
    || memoryFreeBytes < 0) {
    throw new Error('desktop-system-resources-memory-unavailable');
  }

  const disk = await statDiskVolume(await dataRoot);

  return Object.freeze({
    cpuPercent: Math.max(0, Math.min(100, 100 * (1 - (idleDelta / totalDelta)))),
    memoryUsedBytes: memoryTotalBytes - Math.min(memoryFreeBytes, memoryTotalBytes),
    memoryTotalBytes,
    memoryPressure: await memoryPressure,
    diskUsedBytes: disk?.used ?? null,
    diskTotalBytes: disk?.total ?? null,
    temperatureCelsius: null,
    capturedAtMs: Date.now(),
    source: `electron-${process.platform}`,
  });
}

export function memoryPressureFromMacosLevel(level: string): DesktopElectronMemoryPressure {
  return MACOS_MEMORY_PRESSURE_LEVELS[level.trim()] ?? 'unknown';
}

function readHostMemoryPressure(): Promise<DesktopElectronMemoryPressure> {
  if (process.platform !== 'darwin') return Promise.resolve('unknown');
  return new Promise((resolve) => {
    execFile(
      '/usr/sbin/sysctl',
      ['-n', 'kern.memorystatus_vm_pressure_level'],
      { timeout: HOST_PROBE_WAIT_MS },
      (error, stdout) => resolve(error ? 'unknown' : memoryPressureFromMacosLevel(String(stdout))),
    );
  });
}

// A slow or unavailable data-root answer must not hold the whole snapshot; the
// disk stays unavailable while CPU and memory retain their own measurements.
export async function resolveDataRootForDisk(
  resolveDataRoot: (() => Promise<string>) | undefined,
): Promise<string | null> {
  if (!resolveDataRoot) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const dataRoot = await Promise.race([
      resolveDataRoot(),
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), HOST_PROBE_WAIT_MS); }),
    ]);
    return dataRoot && path.isAbsolute(dataRoot) ? dataRoot : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function statDiskVolume(dataRoot: string | null): Promise<{ used: number; total: number } | null> {
  if (!dataRoot) return null;
  try {
    const filesystem = await statfs(dataRoot);
    const total = checkedProduct(filesystem.bsize, filesystem.blocks);
    const free = checkedProduct(filesystem.bsize, filesystem.bfree);
    if (total <= 0 || free > total) return null;
    return { used: total - free, total };
  } catch { return null; }
}

function readCpuTimes(): { readonly idle: number; readonly total: number } {
  const cpus = os.cpus();
  if (cpus.length === 0) throw new Error('desktop-system-resources-cpu-unavailable');
  let idle = 0;
  let total = 0;
  for (const cpu of cpus) {
    idle += cpu.times.idle;
    total += cpu.times.idle + cpu.times.irq + cpu.times.nice + cpu.times.sys + cpu.times.user;
  }
  if (!Number.isSafeInteger(idle) || !Number.isSafeInteger(total) || idle < 0 || total <= 0) {
    throw new Error('desktop-system-resources-cpu-unavailable');
  }
  return { idle, total };
}

function checkedProduct(left: number, right: number): number {
  const product = left * right;
  if (!Number.isSafeInteger(product) || product < 0) {
    throw new Error('desktop-system-resources-disk-unavailable');
  }
  return product;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
