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

  getAudit(filter?: Parameters<HookAuditTrail['query']>[0]) {
    return this.context.audit.query(filter);
  }

  getAuditStats(modId?: Parameters<HookAuditTrail['stats']>[0]) {
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
