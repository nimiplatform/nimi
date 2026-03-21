import type { HookActionDescriptor, HookActionDescriptorView } from '../contracts/action.js';
import { assertActionDescriptorMatrix } from '../services/action-descriptor-validator.js';

function normalizeVerifyPolicy(value: unknown): 'required' | 'optional' | 'none' | null {
  const normalized = String(value || '').trim();
  if (normalized === 'required' || normalized === 'optional' || normalized === 'none') {
    return normalized;
  }
  return null;
}

function normalizeIdempotencyPolicy(value: unknown): 'required-for-write' | '' {
  return String(value || '').trim() === 'required-for-write'
    ? 'required-for-write'
    : '';
}

export function assertActionDescriptorFinalState(
  actionId: string,
  descriptor: HookActionDescriptor | HookActionDescriptorView,
): void {
  assertActionDescriptorMatrix(actionId, descriptor);

  const verifyPolicy = normalizeVerifyPolicy(descriptor.verifyPolicy);
  if (verifyPolicy === null) {
    throw new Error(
      `descriptor invalid for ${actionId}: unknown verifyPolicy=${String(descriptor.verifyPolicy || '').trim() || '<empty>'}`,
    );
  }
  const idempotencyPolicy = normalizeIdempotencyPolicy(descriptor.idempotencyPolicy);
  const operation = descriptor.operation === 'write' ? 'write' : 'read';

  if (operation === 'write' && idempotencyPolicy !== 'required-for-write') {
    throw new Error(`descriptor invalid for ${actionId}: write action requires idempotencyPolicy=required-for-write`);
  }

  if (operation === 'write' && verifyPolicy === 'none') {
    throw new Error(`descriptor invalid for ${actionId}: write action must not set verifyPolicy=none`);
  }

  if (operation === 'write' && !descriptor.compensation && descriptor.compensationPolicy === 'required-for-cross-domain-write') {
    throw new Error(`descriptor invalid for ${actionId}: compensation is required when compensationPolicy=required-for-cross-domain-write`);
  }
}
