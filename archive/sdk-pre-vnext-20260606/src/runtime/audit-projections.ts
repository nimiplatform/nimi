import { UsageWindow } from './generated/runtime/v1/audit.js';
import { CallerKind } from './generated/runtime/v1/common.js';

export type RuntimeAuditCallerKindName = 'DESKTOP_CORE' | 'THIRD_PARTY_APP' | 'THIRD_PARTY_SERVICE';

export type RuntimeUsageWindowName = 'MINUTE' | 'HOUR' | 'DAY';

export function projectRuntimeAuditCallerKindName(kind: unknown): RuntimeAuditCallerKindName | undefined {
  if (kind === CallerKind.DESKTOP_CORE) {
    return 'DESKTOP_CORE';
  }
  if (kind === CallerKind.THIRD_PARTY_APP) {
    return 'THIRD_PARTY_APP';
  }
  if (kind === CallerKind.THIRD_PARTY_SERVICE) {
    return 'THIRD_PARTY_SERVICE';
  }
  return undefined;
}

export function projectRuntimeUsageWindowName(window: unknown): RuntimeUsageWindowName | undefined {
  if (window === UsageWindow.MINUTE) {
    return 'MINUTE';
  }
  if (window === UsageWindow.HOUR) {
    return 'HOUR';
  }
  if (window === UsageWindow.DAY) {
    return 'DAY';
  }
  return undefined;
}
