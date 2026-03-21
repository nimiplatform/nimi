import type { HookCallRecord, HookDecision, HookSourceType, HookType } from '../contracts/types.js';
import { createSecureIdSuffix } from '../../id.js';

export interface PermissionInput {
  modId: string;
  sourceType?: HookSourceType;
  hookType: HookType;
  target: string;
  capabilityKey: string;
  startedAt: number;
}

export type PermissionResult = {
  sourceType: HookSourceType;
  reasonCodes: string[];
};

export type PermissionResolver = (input: PermissionInput) => PermissionResult;

export interface AuditInput {
  modId: string;
  hookType: HookType;
  target: string;
  decision: HookDecision;
  reasonCodes: string[];
  startedAt: number;
}

export function createHookRecord(input: AuditInput): HookCallRecord {
  return {
    callId: `hook:${Date.now().toString(36)}:${createSecureIdSuffix()}`,
    modId: input.modId,
    hookType: input.hookType,
    target: input.target,
    decision: input.decision,
    reasonCodes: input.reasonCodes || [],
    latencyMs: Date.now() - input.startedAt,
    timestamp: new Date().toISOString(),
  };
}

export function normalizeSourceType(value: string): HookSourceType {
  if (value === 'builtin') return 'builtin';
  if (value === 'injected') return 'injected';
  if (value === 'core') return 'core';
  if (value === 'codegen') return 'codegen';
  return 'sideload';
}
