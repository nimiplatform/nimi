import { parseOptionalJsonObject } from '../../bridge/runtime-bridge/shared';
import type { JsonObject } from '../../bridge/runtime-bridge/types';

export type RuntimeConfigBanner = {
  kind: 'success' | 'warning' | 'error' | 'info';
  message: string;
  actionLabel?: string;
  onAction?: () => void;
};

export type SetRuntimeConfigBanner = (value: RuntimeConfigBanner | null) => void;

export function asRecord(value: unknown): JsonObject {
  return parseOptionalJsonObject(value) || {};
}
