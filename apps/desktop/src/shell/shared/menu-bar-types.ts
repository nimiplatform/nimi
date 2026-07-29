export const MENU_BAR_RUNTIME_HEALTH_SYNC_COMMAND = 'menu_bar_sync_runtime_health';
export const MENU_BAR_OPEN_TAB_EVENT = 'menu-bar://open-tab';

export const MENU_BAR_RUNTIME_PAGES = [
  'overview',
  'profiles',
  'models',
  'cloud',
  'environment',
  'advanced',
] as const;

export type MenuBarRuntimePage = typeof MENU_BAR_RUNTIME_PAGES[number];

export type MenuBarProviderSummary = {
  readonly healthy: number;
  readonly unhealthy: number;
  readonly unknown: number;
  readonly total: number;
};

export type MenuBarRuntimeHealthSyncPayload = {
  readonly runtimeHealthStatus?: string;
  readonly runtimeHealthReason?: string;
  readonly providerSummary?: MenuBarProviderSummary;
  readonly updatedAt?: string;
};

export type MenuBarOpenTabPayload =
  | { readonly tab: 'runtime'; readonly page: MenuBarRuntimePage }
  | { readonly tab: 'settings' };

export type MenuBarRuntimeHealthSyncResult = {
  readonly synced: true;
};

const MENU_BAR_RUNTIME_PAGE_SET = new Set<string>(MENU_BAR_RUNTIME_PAGES);
const HEALTH_STATUS_PATTERN = /^[A-Z][A-Z0-9_]{0,63}$/u;

export function parseMenuBarRuntimeHealthSyncCommandPayload(
  value: unknown,
): MenuBarRuntimeHealthSyncPayload {
  const root = exactRecord(value, ['payload'], 'menu-bar-runtime-health-sync-command-invalid');
  return parseMenuBarRuntimeHealthSyncPayload(root.payload);
}

export function parseMenuBarRuntimeHealthSyncPayload(
  value: unknown,
): MenuBarRuntimeHealthSyncPayload {
  const record = exactOptionalRecord(
    value,
    ['runtimeHealthStatus', 'runtimeHealthReason', 'providerSummary', 'updatedAt'],
    'menu-bar-runtime-health-sync-payload-invalid',
  );
  const runtimeHealthStatus = optionalText(
    record.runtimeHealthStatus,
    64,
    'menu-bar-runtime-health-status-invalid',
  );
  if (runtimeHealthStatus && !HEALTH_STATUS_PATTERN.test(runtimeHealthStatus)) {
    throw new Error('menu-bar-runtime-health-status-invalid');
  }
  const runtimeHealthReason = optionalText(
    record.runtimeHealthReason,
    256,
    'menu-bar-runtime-health-reason-invalid',
  );
  const updatedAtInput = optionalText(
    record.updatedAt,
    64,
    'menu-bar-runtime-health-updated-at-invalid',
  );
  const updatedAt = updatedAtInput
    ? canonicalTimestamp(updatedAtInput)
    : undefined;
  return {
    ...(runtimeHealthStatus ? { runtimeHealthStatus } : {}),
    ...(runtimeHealthReason ? { runtimeHealthReason } : {}),
    ...(record.providerSummary === undefined
      ? {}
      : { providerSummary: parseMenuBarProviderSummary(record.providerSummary) }),
    ...(updatedAt ? { updatedAt } : {}),
  };
}

export function parseMenuBarRuntimeHealthSyncResult(
  value: unknown,
): MenuBarRuntimeHealthSyncResult {
  const record = exactRecord(value, ['synced'], 'menu-bar-runtime-health-sync-result-invalid');
  if (record.synced !== true) {
    throw new Error('menu-bar-runtime-health-sync-result-invalid');
  }
  return { synced: true };
}

export function parseMenuBarOpenTabPayload(value: unknown): MenuBarOpenTabPayload {
  const record = recordValue(value, 'menu-bar-open-tab-payload-invalid');
  const tab = requiredText(record.tab, 16, 'menu-bar-open-tab-payload-invalid');
  if (tab === 'settings') {
    if (!hasExactKeys(record, ['tab'])) {
      throw new Error('menu-bar-open-tab-payload-invalid');
    }
    return { tab: 'settings' };
  }
  if (tab !== 'runtime' || !hasExactKeys(record, ['tab', 'page'])) {
    throw new Error('menu-bar-open-tab-payload-invalid');
  }
  const page = requiredText(record.page, 32, 'menu-bar-open-tab-payload-invalid');
  if (!MENU_BAR_RUNTIME_PAGE_SET.has(page)) {
    throw new Error('menu-bar-open-tab-payload-invalid');
  }
  return {
    tab: 'runtime',
    page: page as MenuBarRuntimePage,
  };
}

function parseMenuBarProviderSummary(value: unknown): MenuBarProviderSummary {
  const record = exactRecord(
    value,
    ['healthy', 'unhealthy', 'unknown', 'total'],
    'menu-bar-provider-summary-invalid',
  );
  const healthy = boundedCount(record.healthy);
  const unhealthy = boundedCount(record.unhealthy);
  const unknown = boundedCount(record.unknown);
  const total = boundedCount(record.total);
  if (healthy + unhealthy + unknown !== total) {
    throw new Error('menu-bar-provider-summary-invalid');
  }
  return { healthy, unhealthy, unknown, total };
}

function boundedCount(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 1_000_000) {
    throw new Error('menu-bar-provider-summary-invalid');
  }
  return Number(value);
}

function exactRecord(
  value: unknown,
  keys: readonly string[],
  errorCode: string,
): Record<string, unknown> {
  const record = recordValue(value, errorCode);
  if (!hasExactKeys(record, keys)) {
    throw new Error(errorCode);
  }
  return record;
}

function exactOptionalRecord(
  value: unknown,
  keys: readonly string[],
  errorCode: string,
): Record<string, unknown> {
  const record = recordValue(value, errorCode);
  const admittedKeys = new Set(keys);
  if (Object.keys(record).some((key) => !admittedKeys.has(key))) {
    throw new Error(errorCode);
  }
  return record;
}

function recordValue(value: unknown, errorCode: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(errorCode);
  }
  return value as Record<string, unknown>;
}

function hasExactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(record).sort();
  const expected = [...keys].sort();
  return actual.length === expected.length
    && actual.every((key, index) => key === expected[index]);
}

function optionalText(value: unknown, maxLength: number, errorCode: string): string | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  return requiredText(value, maxLength, errorCode);
}

function requiredText(value: unknown, maxLength: number, errorCode: string): string {
  if (typeof value !== 'string') {
    throw new Error(errorCode);
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > maxLength) {
    throw new Error(errorCode);
  }
  return normalized;
}

function canonicalTimestamp(value: string): string {
  const timestampMs = Date.parse(value);
  if (!Number.isFinite(timestampMs)) {
    throw new Error('menu-bar-runtime-health-updated-at-invalid');
  }
  return new Date(timestampMs).toISOString();
}
