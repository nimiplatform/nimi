import { turnRegisterCapability } from '../contracts/capabilities.js';
import { TurnHookOrchestrator } from '../turn-hook/turn-hook.js';
import type { HookSourceType, TurnHookPoint, TurnHookResult } from '../contracts/types.js';
import { createHookRecord, type PermissionResolver } from './utils.js';
import { HookContractRegistry } from '../contracts/contract-registry.js';
import { HookRegistry } from '../registry/hook-registry.js';
import { HookAuditTrail } from '../audit/hook-audit.js';

export interface TurnServiceInput {
  contracts: HookContractRegistry;
  registry: HookRegistry;
  turnHook: TurnHookOrchestrator;
  audit: HookAuditTrail;
  evaluatePermission: PermissionResolver;
}

export class HookRuntimeTurnService {
  constructor(private readonly context: TurnServiceInput) {}

  async registerTurnHookV2(input: {
    modId: string;
    sourceType?: HookSourceType;
    point: TurnHookPoint;
    priority?: number;
    handler: (context: Record<string, unknown>) => Promise<Record<string, unknown>> | Record<string, unknown>;
  }): Promise<void> {
    const startedAt = Date.now();
    const contract = this.context.contracts.assertTurnPoint(input.point);
    const capabilityKey = turnRegisterCapability(input.point);
    const permission = this.context.evaluatePermission({
      modId: input.modId,
      sourceType: input.sourceType,
      hookType: 'turn-hook',
      target: input.point,
      capabilityKey,
      startedAt,
    });

    this.context.registry.registerTurnHook({
      modId: input.modId,
      sourceType: permission.sourceType,
      point: input.point,
      capabilityKey,
      contractId: contract.contractId,
      version: contract.version,
      priority: input.priority,
      handler: input.handler,
    });
    this.context.audit.append(createHookRecord({
      modId: input.modId,
      hookType: 'turn-hook',
      target: input.point,
      decision: 'ALLOW',
      reasonCodes: permission.reasonCodes,
      startedAt,
    }));
  }

  unregisterTurnHook(input: {
    modId: string;
    point: TurnHookPoint;
  }): number {
    return this.context.registry.unregisterByTarget({
      modId: input.modId,
      hookType: 'turn-hook',
      target: input.point,
    });
  }

  async invokeTurnHooks(input: {
    point: TurnHookPoint;
    context: Record<string, unknown>;
    abortSignal?: AbortSignal;
  }): Promise<TurnHookResult> {
    return this.context.turnHook.invoke(input.point, input.context, {
      abortSignal: input.abortSignal,
    });
  }
}
