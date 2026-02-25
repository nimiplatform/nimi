import type { HookSourceType } from '../contracts/types.js';
import { EventBus } from '../event-bus/event-bus.js';
import { InterModBroker } from '../inter-mod/inter-mod.js';
import { PermissionGateway } from '../permission/permission-gateway.js';
import { HookRegistry } from '../registry/hook-registry.js';
import { UiExtensionGateway } from '../ui-extension/ui-extension.js';

export interface LifecycleServiceInput {
  registry: HookRegistry;
  eventBus: EventBus;
  interMod: InterModBroker;
  uiExtension: UiExtensionGateway;
  permissions: PermissionGateway;
}

export class HookRuntimeLifecycleService {
  constructor(private readonly context: LifecycleServiceInput) {}

  setModSourceType(modId: string, sourceType: HookSourceType): void {
    this.context.permissions.setSourceType(modId, sourceType);
  }

  getModSourceType(modId: string): HookSourceType {
    return this.context.permissions.getSourceType(modId);
  }

  setCapabilityBaseline(modId: string, capabilities: string[]): void {
    this.context.permissions.setBaseline(modId, capabilities);
  }

  clearCapabilityBaseline(modId: string): void {
    this.context.permissions.clearBaseline(modId);
  }

  setGrantCapabilities(modId: string, capabilities: string[]): void {
    this.context.permissions.setGrant(modId, capabilities);
  }

  clearGrantCapabilities(modId: string): void {
    this.context.permissions.clearGrant(modId);
  }

  setDenialCapabilities(modId: string, capabilities: string[]): void {
    this.context.permissions.setDenial(modId, capabilities);
  }

  clearDenialCapabilities(modId: string): void {
    this.context.permissions.clearDenial(modId);
  }

  suspendMod(modId: string): void {
    this.context.registry.unregisterAll(modId);
    this.context.eventBus.unregisterByMod(modId);
    this.context.interMod.unregisterByMod(modId);
    this.context.uiExtension.unregisterByMod(modId);
    this.context.permissions.clearBaseline(modId);
    this.context.permissions.clearGrant(modId);
    this.context.permissions.clearDenial(modId);
    this.context.permissions.clearSourceType(modId);
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
