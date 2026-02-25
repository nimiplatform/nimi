import type { UsageRecord, UsageRecordInput } from '../usage-tracker';

function generateUsageId() {
  if (typeof globalThis.crypto?.randomUUID === 'function') {
    return `usage_${globalThis.crypto.randomUUID()}`;
  }
  return `usage_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function nowIso() {
  return new Date().toISOString();
}

export function toUsageRecord(input: UsageRecordInput): UsageRecord {
  return {
    ...input,
    id: input.id ?? generateUsageId(),
    timestamp: input.timestamp ?? nowIso(),
  };
}
