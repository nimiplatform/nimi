import { useEffect, useState } from 'react';

export type SystemResourceSnapshot = {
  cpuPercent: number;
  memoryUsedBytes: number;
  memoryTotalBytes: number;
  diskUsedBytes: number;
  diskTotalBytes: number;
  temperatureCelsius: number | null;
};

const MOCK_BASE: SystemResourceSnapshot = {
  cpuPercent: 23,
  memoryUsedBytes: 6.8 * 1024 ** 3,
  memoryTotalBytes: 16 * 1024 ** 3,
  diskUsedBytes: 187 * 1024 ** 3,
  diskTotalBytes: 512 * 1024 ** 3,
  temperatureCelsius: 52,
};

function jitter(base: number, range: number): number {
  return base + (Math.random() - 0.5) * 2 * range;
}

function createMockSnapshot(): SystemResourceSnapshot {
  return {
    cpuPercent: Math.max(0, Math.min(100, jitter(MOCK_BASE.cpuPercent, 8))),
    memoryUsedBytes: Math.max(0, jitter(MOCK_BASE.memoryUsedBytes, 0.3 * 1024 ** 3)),
    memoryTotalBytes: MOCK_BASE.memoryTotalBytes,
    diskUsedBytes: MOCK_BASE.diskUsedBytes,
    diskTotalBytes: MOCK_BASE.diskTotalBytes,
    temperatureCelsius: Math.max(30, Math.min(95, jitter(MOCK_BASE.temperatureCelsius!, 3))),
  };
}

export function useMockSystemResources(): SystemResourceSnapshot {
  const [snapshot, setSnapshot] = useState(createMockSnapshot);

  useEffect(() => {
    const timer = setInterval(() => {
      setSnapshot(createMockSnapshot());
    }, 3000);
    return () => { clearInterval(timer); };
  }, []);

  return snapshot;
}
