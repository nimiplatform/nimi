import { statfs } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const COMMAND = 'get_system_resource_snapshot' as const;
const CPU_SAMPLE_MS = 120;

export type DesktopElectronSystemResourceSnapshot = {
  readonly cpuPercent: number;
  readonly memoryUsedBytes: number;
  readonly memoryTotalBytes: number;
  readonly diskUsedBytes: number;
  readonly diskTotalBytes: number;
  readonly temperatureCelsius: null;
  readonly capturedAtMs: number;
  readonly source: string;
};

export type DesktopElectronSystemResourcesHost = {
  readonly commandHandlers: Readonly<Record<typeof COMMAND, (context: {
    readonly payload: Readonly<Record<string, unknown>>;
  }) => Promise<DesktopElectronSystemResourceSnapshot>>>;
};

export function createDesktopElectronSystemResourcesHost(): DesktopElectronSystemResourcesHost {
  return {
    commandHandlers: {
      [COMMAND]: async ({ payload }) => {
        if (Object.keys(payload).length !== 0) {
          throw new Error('desktop-system-resources-payload-invalid');
        }
        return collectDesktopElectronSystemResourceSnapshot();
      },
    },
  };
}

export async function collectDesktopElectronSystemResourceSnapshot(): Promise<DesktopElectronSystemResourceSnapshot> {
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

  const filesystem = await statfs(path.parse(process.cwd()).root);
  const diskTotalBytes = checkedProduct(filesystem.bsize, filesystem.blocks);
  const diskFreeBytes = checkedProduct(filesystem.bsize, filesystem.bfree);
  if (diskTotalBytes <= 0 || diskFreeBytes < 0 || diskFreeBytes > diskTotalBytes) {
    throw new Error('desktop-system-resources-disk-unavailable');
  }

  return Object.freeze({
    cpuPercent: Math.max(0, Math.min(100, 100 * (1 - (idleDelta / totalDelta)))),
    memoryUsedBytes: memoryTotalBytes - Math.min(memoryFreeBytes, memoryTotalBytes),
    memoryTotalBytes,
    diskUsedBytes: diskTotalBytes - diskFreeBytes,
    diskTotalBytes,
    temperatureCelsius: null,
    capturedAtMs: Date.now(),
    source: `electron-${process.platform}`,
  });
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
