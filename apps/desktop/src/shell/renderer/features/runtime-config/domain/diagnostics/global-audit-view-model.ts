export function runtimeHealthStatusLabel(status: number): string {
  switch (status) {
    case 1: return 'Stopped';
    case 2: return 'Starting';
    case 3: return 'Ready';
    case 4: return 'Degraded';
    case 5: return 'Stopping';
    default: return 'Unspecified';
  }
}

export function runtimeHealthStatusColor(status: number): string {
  switch (status) {
    case 3: return 'text-green-700 bg-green-50 border-green-200';
    case 4: return 'text-yellow-700 bg-yellow-50 border-yellow-200';
    case 1: return 'text-red-700 bg-red-50 border-red-200';
    case 2:
    case 5: return 'text-blue-700 bg-blue-50 border-blue-200';
    default: return 'text-gray-700 bg-gray-50 border-gray-200';
  }
}

export function providerStateColor(state: string): string {
  const s = state.toLowerCase();
  if (s === 'healthy') return 'text-green-700';
  if (s === 'unhealthy' || s === 'degraded') return 'text-red-700';
  return 'text-gray-500';
}

export function formatBytes(bytesStr: string): string {
  const bytes = Number(bytesStr);
  if (Number.isNaN(bytes) || bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(value < 10 ? 1 : 0)} ${units[exponent]}`;
}

export function formatCpuMilli(milliStr: string): string {
  const milli = Number(milliStr);
  if (Number.isNaN(milli) || milli === 0) return '0 cores';
  const cores = milli / 1000;
  return `${cores.toFixed(cores < 1 ? 2 : 1)} cores`;
}

export function callerKindLabel(kind: number): string {
  switch (kind) {
    case 1: return 'Desktop Core';
    case 2: return 'Desktop Mod';
    case 3: return 'Third-Party App';
    case 4: return 'Third-Party Service';
    default: return '-';
  }
}

export function usageWindowLabel(window: number): string {
  switch (window) {
    case 1: return 'Minute';
    case 2: return 'Hour';
    case 3: return 'Day';
    default: return '-';
  }
}

export function formatTokenCount(n: string): string {
  const num = Number(n);
  if (Number.isNaN(num) || num === 0) return '0';
  if (num >= 1_000_000_000) return `${(num / 1_000_000_000).toFixed(1)}B`;
  if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1_000).toFixed(1)}K`;
  return String(num);
}

export function timestampToIso(ts?: { seconds: string; nanos: number }): string {
  if (!ts) return '-';
  const ms = Number(ts.seconds) * 1000 + Math.floor(ts.nanos / 1_000_000);
  if (Number.isNaN(ms)) return '-';
  return new Date(ms).toISOString();
}

export function structToRecord(struct?: { fields: Record<string, unknown> }): Record<string, unknown> {
  if (!struct || !struct.fields) return {};
  return struct.fields;
}

export function relativeTimeShort(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  if (Number.isNaN(then)) return isoString;
  const diffMs = now - then;
  if (diffMs < 0) return 'just now';
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function formatComputeMs(msStr: string): string {
  const ms = Number(msStr);
  if (Number.isNaN(ms) || ms === 0) return '0s';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function formatNumber(n: string): string {
  const num = Number(n);
  if (Number.isNaN(num)) return n;
  return num.toLocaleString();
}
