import { interModProvideCapability, interModRequestCapability } from '../contracts/capabilities.js';
import { InterModBroker } from '../inter-mod/inter-mod.js';
import type { HookSourceType, InterModDiscovery } from '../contracts/types.js';
import { createHookRecord, type PermissionResolver } from './utils.js';
import { HookContractRegistry } from '../contracts/contract-registry.js';
import { HookRegistry } from '../registry/hook-registry.js';
import { HookAuditTrail } from '../audit/hook-audit.js';

export interface InterModServiceInput {
  contracts: HookContractRegistry;
  registry: HookRegistry;
  interMod: InterModBroker;
  audit: HookAuditTrail;
  evaluatePermission: PermissionResolver;
}

export class HookRuntimeInterModService {
  constructor(private readonly context: InterModServiceInput) {}

  async registerInterModHandlerV2(input: {
    modId: string;
    sourceType?: HookSourceType;
    channel: string;
    handler: (payload: Record<string, unknown>, context?: Record<string, unknown>) => Promise<unknown> | unknown;
  }): Promise<void> {
    const startedAt = Date.now();
    const contract = this.context.contracts.assertInterModChannel(input.channel);
    const capabilityKey = interModProvideCapability(input.channel);
    const permission = this.context.evaluatePermission({
      modId: input.modId,
      sourceType: input.sourceType,
      hookType: 'inter-mod',
      target: input.channel,
      capabilityKey,
      startedAt,
    });

    this.context.interMod.register(input);
    this.context.registry.register({
      modId: input.modId,
      sourceType: permission.sourceType,
      hookType: 'inter-mod',
      target: input.channel,
      capabilityKey,
      contractId: contract.contractId,
      version: contract.version,
      requestedCapabilities: [capabilityKey],
    });
    this.context.audit.append(createHookRecord({
      modId: input.modId,
      hookType: 'inter-mod',
      target: input.channel,
      decision: 'ALLOW',
      reasonCodes: permission.reasonCodes,
      startedAt,
    }));
  }

  unregisterInterModHandler(input: {
    modId: string;
    channel?: string;
  }): number {
    if (input.channel) {
      this.context.registry.unregisterByTarget({
        modId: input.modId,
        hookType: 'inter-mod',
        target: input.channel,
      });
      return this.context.interMod.unregisterByChannel(input.channel, input.modId) ? 1 : 0;
    }

    let removed = 0;
    for (const registration of this.context.registry.listByHookType('inter-mod')) {
      if (registration.modId !== input.modId) {
        continue;
      }
      if (this.context.registry.unregisterByRegistrationId(registration.registrationId)) {
        removed += 1;
      }
    }
    this.context.interMod.unregisterByMod(input.modId);
    return removed;
  }

  async requestInterMod(input: {
    fromModId: string;
    sourceType?: HookSourceType;
    toModId: string;
    channel: string;
    payload: Record<string, unknown>;
    context?: Record<string, unknown>;
  }): Promise<unknown> {
    const startedAt = Date.now();
    this.context.contracts.assertInterModChannel(input.channel);
    const capabilityKey = interModRequestCapability(input.channel);
    const permission = this.context.evaluatePermission({
      modId: input.fromModId,
      sourceType: input.sourceType,
      hookType: 'inter-mod',
      target: input.channel,
      capabilityKey,
      startedAt,
    });

    const result = await this.context.interMod.request(input);
    this.context.audit.append(createHookRecord({
      modId: input.fromModId,
      hookType: 'inter-mod',
      target: input.channel,
      decision: 'ALLOW',
      reasonCodes: permission.reasonCodes,
      startedAt,
    }));
    return result;
  }

  async broadcastInterMod(input: {
    fromModId: string;
    sourceType?: HookSourceType;
    channel: string;
    payload: Record<string, unknown>;
    context?: Record<string, unknown>;
  }): Promise<{ responses: Array<{ modId: string; result: unknown }>; errors: Array<{ modId: string; error: string }> }> {
    const startedAt = Date.now();
    this.context.contracts.assertInterModChannel(input.channel);
    const capabilityKey = interModRequestCapability(input.channel);
    const permission = this.context.evaluatePermission({
      modId: input.fromModId,
      sourceType: input.sourceType,
      hookType: 'inter-mod',
      target: input.channel,
      capabilityKey,
      startedAt,
    });

    const result = await this.context.interMod.broadcast(input);
    this.context.audit.append(createHookRecord({
      modId: input.fromModId,
      hookType: 'inter-mod',
      target: input.channel,
      decision: 'ALLOW',
      reasonCodes: permission.reasonCodes,
      startedAt,
    }));
    return result;
  }

  discoverInterModChannels(): InterModDiscovery[] {
    return this.context.interMod.discover();
  }
}
