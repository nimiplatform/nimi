import type { CatalogConsentReason } from '@renderer/bridge';
import { describeConsentReasons } from './mod-hub-model';

export const MOD_HUB_RECONSENT_STORAGE_KEY = 'nimi.mod-hub.reconsent-required.v1';

export type ModHubReconsentRecord = {
  modId: string;
  version: string;
  consentReasons: CatalogConsentReason[];
  addedCapabilities: string[];
  recordedAt: string;
};

export function formatConsentSummary(input: {
  consentReasons?: readonly CatalogConsentReason[];
  addedCapabilities?: readonly string[];
}): string {
  const reasonLabels = describeConsentReasons(input.consentReasons);
  const details: string[] = [];
  if (reasonLabels.length > 0) {
    details.push(reasonLabels.join(', '));
  }
  if (Array.isArray(input.addedCapabilities) && input.addedCapabilities.length > 0) {
    details.push(`New capabilities: ${input.addedCapabilities.join(', ')}`);
  }
  return details.join('. ');
}

export function requireModHubEnableReconsent(input: {
  record: ModHubReconsentRecord | null;
  confirmMessage: string;
}): void {
  if (!input.record) return;
  if (!formatConsentSummary(input.record)) {
    throw new Error('MOD_HUB_RECONSENT_REQUIRED_MISSING_METADATA');
  }
  const confirmFn = typeof window !== 'undefined' && typeof window.confirm === 'function'
    ? window.confirm.bind(window)
    : (globalThis as { confirm?: (message: string) => boolean }).confirm;
  if (typeof confirmFn !== 'function') {
    throw new Error('MOD_HUB_RECONSENT_REQUIRED_CONFIRMATION_UNAVAILABLE');
  }
  if (!confirmFn(input.confirmMessage)) {
    throw new Error('MOD_HUB_RECONSENT_REQUIRED');
  }
}

function normalizeModId(modId: string): string {
  return String(modId || '').trim();
}

function stripVersionPrefix(value: string | undefined): string {
  return String(value || '').trim().replace(/^v/i, '');
}

function resolveModHubStorage(): Storage | undefined {
  if (typeof window !== 'undefined' && window.localStorage) {
    return window.localStorage;
  }
  if (typeof globalThis === 'undefined') return undefined;
  return globalThis.localStorage as Storage | undefined;
}

function normalizeConsentReasons(value: unknown): CatalogConsentReason[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item || '').trim())
    .filter(Boolean) as CatalogConsentReason[];
}

function normalizeCapabilities(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(new Set(value.map((item) => String(item || '').trim()).filter(Boolean))).sort();
}

function normalizeReconsentRecord(value: unknown): ModHubReconsentRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const modId = normalizeModId(String(record.modId || ''));
  if (!modId) return null;
  return {
    modId,
    version: stripVersionPrefix(String(record.version || '')),
    consentReasons: normalizeConsentReasons(record.consentReasons),
    addedCapabilities: normalizeCapabilities(record.addedCapabilities),
    recordedAt: String(record.recordedAt || '').trim(),
  };
}

export function readPendingReconsentRecords(): Record<string, ModHubReconsentRecord> {
  const storage = resolveModHubStorage();
  if (!storage) return {};
  const raw = storage.getItem(MOD_HUB_RECONSENT_STORAGE_KEY);
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as unknown;
    const records = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>).records
      : null;
    if (!records || typeof records !== 'object' || Array.isArray(records)) {
      return {};
    }
    const normalized: Record<string, ModHubReconsentRecord> = {};
    for (const item of Object.values(records)) {
      const record = normalizeReconsentRecord(item);
      if (record) {
        normalized[record.modId] = record;
      }
    }
    return normalized;
  } catch {
    return {};
  }
}

function persistPendingReconsentRecords(records: Record<string, ModHubReconsentRecord>): void {
  const storage = resolveModHubStorage();
  if (!storage) return;
  const normalized = Object.fromEntries(
    Object.values(records)
      .flatMap((item) => {
        const record = normalizeReconsentRecord(item);
        return record ? [[record.modId, record] as const] : [];
      }),
  );
  storage.setItem(MOD_HUB_RECONSENT_STORAGE_KEY, JSON.stringify({
    version: 1,
    records: normalized,
  }));
}

export function writePendingReconsentRecord(record: ModHubReconsentRecord): void {
  const normalized = normalizeReconsentRecord(record);
  if (!normalized) return;
  persistPendingReconsentRecords({
    ...readPendingReconsentRecords(),
    [normalized.modId]: normalized,
  });
}

export function clearPendingReconsentRecord(modId: string): void {
  const normalizedModId = normalizeModId(modId);
  if (!normalizedModId) return;
  const records = readPendingReconsentRecords();
  if (!records[normalizedModId]) return;
  delete records[normalizedModId];
  persistPendingReconsentRecords(records);
}
