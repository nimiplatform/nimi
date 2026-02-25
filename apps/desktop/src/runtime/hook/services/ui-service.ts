import { uiRegisterCapability } from '../contracts/capabilities.js';
import { UiExtensionGateway } from '../ui-extension/ui-extension.js';
import type { HookSourceType, UiExtensionEntry } from '../contracts/types.js';
import { createHookRecord, type PermissionResolver } from './utils.js';
import { HookContractRegistry } from '../contracts/contract-registry.js';
import { HookRegistry } from '../registry/hook-registry.js';
import { HookAuditTrail } from '../audit/hook-audit.js';

export interface UiServiceInput {
  contracts: HookContractRegistry;
  registry: HookRegistry;
  uiExtension: UiExtensionGateway;
  audit: HookAuditTrail;
  evaluatePermission: PermissionResolver;
}

export class HookRuntimeUiService {
  constructor(private readonly context: UiServiceInput) {}

  async registerUIExtensionV2(input: {
    modId: string;
    sourceType?: HookSourceType;
    slot: string;
    priority?: number;
    extension: Record<string, unknown>;
  }): Promise<void> {
    const startedAt = Date.now();
    const contract = this.context.contracts.assertUiSlot(input.slot);
    this.context.contracts.validateUiExtension(input.slot, input.extension);
    const capabilityKey = uiRegisterCapability(input.slot);
    const permission = this.context.evaluatePermission({
      modId: input.modId,
      sourceType: input.sourceType,
      hookType: 'ui-extension',
      target: input.slot,
      capabilityKey,
      startedAt,
    });

    this.context.uiExtension.register({
      modId: input.modId,
      slot: input.slot,
      priority: input.priority,
      extension: input.extension,
    });
    this.context.registry.register({
      modId: input.modId,
      sourceType: permission.sourceType,
      hookType: 'ui-extension',
      target: input.slot,
      capabilityKey,
      contractId: contract.contractId,
      version: contract.version,
      requestedCapabilities: [capabilityKey],
    });
    this.context.audit.append(createHookRecord({
      modId: input.modId,
      hookType: 'ui-extension',
      target: input.slot,
      decision: 'ALLOW',
      reasonCodes: permission.reasonCodes,
      startedAt,
    }));
  }

  unregisterUIExtension(input: {
    modId: string;
    slot?: string;
  }): number {
    if (input.slot) {
      this.context.registry.unregisterByTarget({
        modId: input.modId,
        hookType: 'ui-extension',
        target: input.slot,
      });
      return this.context.uiExtension.unregisterBySlot(input.slot, input.modId) ? 1 : 0;
    }

    let removed = 0;
    for (const registration of this.context.registry.listByHookType('ui-extension')) {
      if (registration.modId !== input.modId) {
        continue;
      }
      if (this.context.registry.unregisterByRegistrationId(registration.registrationId)) {
        removed += 1;
      }
    }
    this.context.uiExtension.unregisterByMod(input.modId);
    return removed;
  }

  resolveUIExtensions(slot: string): UiExtensionEntry[] {
    return this.context.uiExtension.resolve(slot);
  }

  listUISlots(): string[] {
    return this.context.uiExtension.listSlots();
  }
}
