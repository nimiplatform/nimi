// Shared Home presentation; rates and ETA are supplied by Runtime.
export function formatBytes(value: number | undefined): string {
  const safe = Number.isFinite(Number(value)) ? Number(value) : 0;
  if (safe <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let next = safe;
  let unitIndex = 0;
  while (next >= 1024 && unitIndex < units.length - 1) {
    next /= 1024;
    unitIndex += 1;
  }
  const precision = unitIndex === 0 ? 0 : unitIndex >= 3 ? 2 : 1;
  return `${next.toFixed(precision)} ${units[unitIndex]}`;
}

export function formatSpeed(value: number | undefined): string {
  const safe = Number(value);
  if (!Number.isFinite(safe) || safe <= 0) return '-';
  return `${formatBytes(safe)}/s`;
}

/** "3.1 MB/s"; empty when the rate is unknown so callers can omit it. */
export function formatTransferRate(bytesPerSecond: number | undefined): string {
  const safe = Number(bytesPerSecond);
  if (!Number.isFinite(safe) || safe <= 0) return '';
  return `${formatBytes(safe)}/s`;
}

/** Compact remaining-time label: "45s", "12m", "1h 40m". Empty when unknown. */
export function formatDurationShort(seconds: number | undefined): string {
  const safe = Number(seconds);
  if (!Number.isFinite(safe) || safe <= 0) return '';
  if (safe < 60) return `${Math.ceil(safe)}s`;
  const minutes = Math.round(safe / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  const remain = minutes % 60;
  return remain ? `${hours}h ${remain}m` : `${hours}h`;
}

export function formatEta(seconds: number | undefined): string {
  const safe = Number(seconds);
  if (!Number.isFinite(safe) || safe < 0) return '-';
  if (safe < 60) return `${Math.ceil(safe)}s`;
  const minutes = Math.floor(safe / 60);
  const remain = Math.ceil(safe % 60);
  return `${minutes}m ${remain}s`;
}
