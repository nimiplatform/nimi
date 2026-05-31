import type { JsonObject } from '@nimiplatform/kit/shell/renderer/bridge';

export type RuntimeConfigBanner = {
  kind: 'success' | 'warning' | 'error' | 'info';
  message: string;
  actionLabel?: string;
  onAction?: () => void;
};

export type SetRuntimeConfigBanner = (value: RuntimeConfigBanner | null) => void;

export function asRecord(value: unknown): JsonObject {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : {};
}
