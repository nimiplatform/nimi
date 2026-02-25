import { eventPublishCapability, eventSubscribeCapability } from '../contracts/capabilities.js';
import { EventBus } from '../event-bus/event-bus.js';
import { HookContractRegistry } from '../contracts/contract-registry.js';
import { HookRegistry } from '../registry/hook-registry.js';
import { HookAuditTrail } from '../audit/hook-audit.js';
import type { HookSourceType } from '../contracts/types.js';
import { createHookRecord, type PermissionResolver } from './utils.js';

export interface EventServiceInput {
  contracts: HookContractRegistry;
  registry: HookRegistry;
  eventBus: EventBus;
  audit: HookAuditTrail;
  evaluatePermission: PermissionResolver;
}

export class HookRuntimeEventService {
  constructor(private readonly context: EventServiceInput) {}

  async subscribeEvent(input: {
    modId: string;
    sourceType?: HookSourceType;
    topic: string;
    handler: (payload: Record<string, unknown>) => Promise<unknown> | unknown;
    once?: boolean;
  }): Promise<void> {
    const startedAt = Date.now();
    const contract = this.context.contracts.ensureEventTopic(input.topic);
    const capabilityKey = eventSubscribeCapability(input.topic);
    const permission = this.context.evaluatePermission({
      modId: input.modId,
      sourceType: input.sourceType,
      hookType: 'event-bus',
      target: input.topic,
      capabilityKey,
      startedAt,
    });

    this.context.registry.register({
      modId: input.modId,
      sourceType: permission.sourceType,
      hookType: 'event-bus',
      target: input.topic,
      capabilityKey,
      contractId: contract.contractId,
      version: contract.version,
      requestedCapabilities: [capabilityKey],
    });

    this.context.eventBus.register({
      modId: input.modId,
      topic: input.topic,
      handler: input.handler,
      once: input.once,
    });

    this.context.audit.append(createHookRecord({
      modId: input.modId,
      hookType: 'event-bus',
      target: input.topic,
      decision: 'ALLOW',
      reasonCodes: permission.reasonCodes,
      startedAt,
    }));
  }

  unsubscribeEvent(input: {
    modId: string;
    topic?: string;
  }): number {
    const topic = String(input.topic || '').trim();
    if (topic) {
      this.context.registry.unregisterByTarget({
        modId: input.modId,
        hookType: 'event-bus',
        target: topic,
      });
    } else {
      for (const registration of this.context.registry.listByHookType('event-bus')) {
        if (registration.modId !== input.modId) continue;
        this.context.registry.unregisterByRegistrationId(registration.registrationId);
      }
    }

    return this.context.eventBus.unregister({
      modId: input.modId,
      topic: input.topic,
    });
  }

  async publishEvent(input: {
    modId: string;
    sourceType?: HookSourceType;
    topic: string;
    payload: Record<string, unknown>;
  }): Promise<{ deliveredCount: number; failedCount: number; reasonCodes: string[] }> {
    const startedAt = Date.now();
    this.context.contracts.ensureEventTopic(input.topic);
    const capabilityKey = eventPublishCapability(input.topic);
    const permission = this.context.evaluatePermission({
      modId: input.modId,
      sourceType: input.sourceType,
      hookType: 'event-bus',
      target: input.topic,
      capabilityKey,
      startedAt,
    });

    const result = await this.context.eventBus.emit(input.topic, input.payload);
    this.context.audit.append(createHookRecord({
      modId: input.modId,
      hookType: 'event-bus',
      target: input.topic,
      decision: 'ALLOW',
      reasonCodes: permission.reasonCodes,
      startedAt,
    }));

    return {
      deliveredCount: result.delivered,
      failedCount: result.failed,
      reasonCodes: permission.reasonCodes,
    };
  }

  listEventTopics(): string[] {
    return this.context.eventBus.listTopics();
  }
}
