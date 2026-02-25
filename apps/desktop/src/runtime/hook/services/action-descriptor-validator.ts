import type { HookActionDescriptor, HookActionDescriptorView } from '../contracts/action.js';

function normalizeExecutionMode(value: unknown): HookActionDescriptor['executionMode'] {
  const normalized = String(value || '').trim();
  if (normalized === 'full' || normalized === 'guarded' || normalized === 'opaque') {
    return normalized;
  }
  return 'guarded';
}

function normalizeRiskLevel(value: unknown): HookActionDescriptor['riskLevel'] {
  const normalized = String(value || '').trim();
  if (normalized === 'low' || normalized === 'medium' || normalized === 'high') {
    return normalized;
  }
  return 'medium';
}

function normalizeOperation(value: unknown): HookActionDescriptor['operation'] {
  return String(value || '').trim() === 'write' ? 'write' : 'read';
}

export function assertActionDescriptorMatrix(
  actionId: string,
  descriptor: HookActionDescriptor | HookActionDescriptorView,
): void {
  const executionMode = normalizeExecutionMode(descriptor.executionMode);
  const riskLevel = normalizeRiskLevel(descriptor.riskLevel);
  const operation = normalizeOperation(descriptor.operation);

  if (executionMode === 'full' && descriptor.supportsDryRun !== true) {
    throw new Error(`descriptor invalid for ${actionId}: full mode requires supportsDryRun=true`);
  }

  if (executionMode === 'opaque' && descriptor.supportsDryRun !== false) {
    throw new Error(`descriptor invalid for ${actionId}: opaque mode requires supportsDryRun=false`);
  }

  if (operation === 'write' && descriptor.idempotent !== true) {
    throw new Error(`descriptor invalid for ${actionId}: write mode requires idempotent=true`);
  }

  if (executionMode === 'opaque' && riskLevel === 'high') {
    throw new Error(`descriptor invalid for ${actionId}: high-risk action must not be opaque`);
  }
}

