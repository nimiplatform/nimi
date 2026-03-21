import type { AuditStats, HookCallRecord, HookType } from '../contracts/types.js';
import { HookAuditTrail } from '../audit/hook-audit.js';
import { PermissionGateway } from '../permission/permission-gateway.js';
import { HookRegistry } from '../registry/hook-registry.js';

export interface MetaServiceInput {
  audit: HookAuditTrail;
  registry: HookRegistry;
  permissions: PermissionGateway;
}

export class HookRuntimeMetaService {
  constructor(private readonly context: MetaServiceInput) {}

  getAudit(filter?: {
    modId?: string;
    hookType?: HookType;
    target?: string;
    decision?: HookCallRecord['decision'];
    since?: string;
    limit?: number;
  }): HookCallRecord[] {
    return this.context.audit.query(filter);
  }

  getAuditStats(modId?: string): AuditStats {
    return this.context.audit.stats(modId);
  }

  listRegistrations(modId?: string) {
    return this.context.registry.listRegistrations(modId);
  }

  listModCapabilities(modId: string): string[] {
    return this.context.registry.listCapabilities(modId);
  }

  getPermissionDeclaration(modId: string) {
    return this.context.permissions.getDeclaration(modId);
  }
}
