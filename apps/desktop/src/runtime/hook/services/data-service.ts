import { dataQueryCapability, dataRegisterCapability } from '../contracts/capabilities.js';
import { DataApi } from '../data-api/data-api.js';
import { HookContractRegistry } from '../contracts/contract-registry.js';
import { HookRegistry } from '../registry/hook-registry.js';
import { HookAuditTrail } from '../audit/hook-audit.js';
import type { HookSourceType, MissingDataCapabilityResolver } from '../contracts/types.js';
import { createHookRecord, type PermissionResolver } from './utils.js';

export interface DataServiceInput {
  contracts: HookContractRegistry;
  registry: HookRegistry;
  dataApi: DataApi;
  audit: HookAuditTrail;
  evaluatePermission: PermissionResolver;
  getMissingDataCapabilityResolver: () => MissingDataCapabilityResolver | null;
}

export class HookRuntimeDataService {
  constructor(private readonly context: DataServiceInput) {}

  async queryData(input: {
    modId: string;
    sourceType?: HookSourceType;
    capability: string;
    query: Record<string, unknown>;
  }): Promise<unknown> {
    const startedAt = Date.now();
    this.context.contracts.ensureDataCapability(input.capability);

    const resolver = this.context.getMissingDataCapabilityResolver();
    if (!this.context.dataApi.has(input.capability) && resolver) {
      try {
        await resolver(input.capability);
      } catch {
        // Fall back to built-in data api behavior.
      }
    }

    const permission = this.context.evaluatePermission({
      modId: input.modId,
      sourceType: input.sourceType,
      hookType: 'data-api',
      target: input.capability,
      capabilityKey: dataQueryCapability(input.capability),
      startedAt,
    });

    const result = await this.context.dataApi.query(input.capability, input.query);
    this.context.audit.append(createHookRecord({
      modId: input.modId,
      hookType: 'data-api',
      target: input.capability,
      decision: 'ALLOW',
      reasonCodes: permission.reasonCodes,
      startedAt,
    }));

    return result;
  }

  async registerDataProvider(input: {
    modId: string;
    sourceType?: HookSourceType;
    capability: string;
    handler: (query: Record<string, unknown>) => Promise<unknown> | unknown;
  }): Promise<void> {
    const startedAt = Date.now();
    const contract = this.context.contracts.ensureDataCapability(input.capability);
    const permission = this.context.evaluatePermission({
      modId: input.modId,
      sourceType: input.sourceType,
      hookType: 'data-api',
      target: input.capability,
      capabilityKey: dataRegisterCapability(input.capability),
      startedAt,
    });

    this.context.dataApi.register(input.capability, input.handler);
    this.context.registry.register({
      modId: input.modId,
      sourceType: permission.sourceType,
      hookType: 'data-api',
      target: input.capability,
      capabilityKey: dataRegisterCapability(input.capability),
      contractId: contract.contractId,
      version: contract.version,
      requestedCapabilities: [dataRegisterCapability(input.capability)],
    });

    this.context.audit.append(createHookRecord({
      modId: input.modId,
      hookType: 'data-api',
      target: input.capability,
      decision: 'ALLOW',
      reasonCodes: permission.reasonCodes,
      startedAt,
    }));
  }

  unregisterDataProvider(input: {
    modId: string;
    capability: string;
  }): boolean {
    this.context.registry.unregisterByTarget({
      modId: input.modId,
      hookType: 'data-api',
      target: input.capability,
    });
    return this.context.dataApi.unregister(input.capability);
  }

  listDataCapabilities(): string[] {
    return this.context.dataApi.listCapabilities();
  }

  registerDataCapability(
    capability: string,
    handler?: (input: Record<string, unknown>) => Promise<unknown> | unknown,
  ): void {
    this.context.contracts.ensureDataCapability(capability);
    if (handler) {
      this.context.dataApi.register(capability, handler);
    }
  }
}
