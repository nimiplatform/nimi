import { createHookError } from '../contracts/errors.js';
import type { HookSourceType, HookType } from '../contracts/types.js';
import { HookAuditTrail } from '../audit/hook-audit.js';
import { PermissionGateway } from '../permission/permission-gateway.js';
import { createHookRecord, normalizeSourceType } from './utils.js';

export interface PermissionServiceInput {
  permissions: PermissionGateway;
  audit: HookAuditTrail;
}

export class HookRuntimePermissionService {
  constructor(private readonly context: PermissionServiceInput) {}

  evaluate(input: {
    modId: string;
    sourceType?: HookSourceType;
    hookType: HookType;
    target: string;
    capabilityKey: string;
    startedAt: number;
  }): {
    sourceType: HookSourceType;
    reasonCodes: string[];
  } {
    const resolvedSourceType = normalizeSourceType(
      String(input.sourceType || this.context.permissions.getSourceType(input.modId)),
    );
    const permission = this.context.permissions.evaluate({
      modId: input.modId,
      sourceType: resolvedSourceType,
      capabilityKey: input.capabilityKey,
      resource: input.target,
    });

    if (!permission.allow) {
      this.context.audit.append(createHookRecord({
        modId: input.modId,
        hookType: input.hookType,
        target: input.target,
        decision: 'DENY',
        reasonCodes: permission.reasonCodes,
        startedAt: input.startedAt,
      }));
      throw createHookError(
        'HOOK_PERMISSION_DENIED',
        permission.reasonCodes.join(','),
        {
          modId: input.modId,
          sourceType: resolvedSourceType,
          capabilityKey: input.capabilityKey,
          target: input.target,
        },
      );
    }

    return {
      sourceType: resolvedSourceType,
      reasonCodes: permission.reasonCodes,
    };
  }
}
