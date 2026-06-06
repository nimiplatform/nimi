import {
  CallerKind,
  UsageWindow,
} from '../core-generated/runtime-typed-client';

export type NimiRuntimeAuditCallerKindName =
  | 'DESKTOP_CORE'
  | 'THIRD_PARTY_APP'
  | 'THIRD_PARTY_SERVICE';

export type NimiRuntimeUsageWindowName = 'MINUTE' | 'HOUR' | 'DAY';

export function projectNimiRuntimeAuditCallerKindName(
  kind: unknown,
): NimiRuntimeAuditCallerKindName | undefined {
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

export function projectNimiRuntimeUsageWindowName(window: unknown): NimiRuntimeUsageWindowName | undefined {
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
