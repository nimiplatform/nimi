import type { HookRegistration, HookType, TurnHookPoint, TurnHookHandler } from '../contracts/types.js';

export class HookRegistry {
  private readonly registrations = new Map<string, HookRegistration>();
  private readonly turnHooks = new Map<TurnHookPoint, Array<{
    registrationId: string;
    modId: string;
    priority: number;
    handler: TurnHookHandler;
  }>>();

  private detachRegistration(registrationId: string): HookRegistration | undefined {
    const registration = this.registrations.get(registrationId);
    if (!registration) {
      return undefined;
    }
    if (registration.hookType === 'turn-hook') {
      const point = registration.target as TurnHookPoint;
      const list = this.turnHooks.get(point) || [];
      this.turnHooks.set(
        point,
        list.filter((item) => item.registrationId !== registrationId),
      );
    }
    return registration;
  }

  private markRemoved(registrationId: string, reason: string): HookRegistration | undefined {
    const registration = this.detachRegistration(registrationId);
    if (!registration) {
      return undefined;
    }
    const removed: HookRegistration = {
      ...registration,
      status: 'REMOVED',
      statusReason: reason,
    };
    this.registrations.set(registrationId, removed);
    return removed;
  }

  register(input: Omit<HookRegistration, 'registrationId' | 'createdAt' | 'status'>): HookRegistration {
    const registration: HookRegistration = {
      ...input,
      registrationId: `hook:${Date.now().toString(36)}:${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      status: 'ACTIVE',
    };
    this.registrations.set(registration.registrationId, registration);
    return registration;
  }

  registerTurnHook(input: {
    sourceType: HookRegistration['sourceType'];
    modId: string;
    point: TurnHookPoint;
    capabilityKey: string;
    contractId: string;
    version?: string;
    priority?: number;
    handler: TurnHookHandler;
  }): HookRegistration {
    const registration = this.register({
      modId: input.modId,
      sourceType: input.sourceType,
      hookType: 'turn-hook',
      target: input.point,
      capabilityKey: input.capabilityKey,
      contractId: input.contractId,
      version: input.version || 'v1',
      requestedCapabilities: [input.capabilityKey],
    });
    const list = this.turnHooks.get(input.point) || [];
    list.push({
      registrationId: registration.registrationId,
      modId: input.modId,
      priority: input.priority ?? 0,
      handler: input.handler,
    });
    list.sort((a, b) => b.priority - a.priority);
    this.turnHooks.set(input.point, list);
    return registration;
  }

  listTurnHooks(point: TurnHookPoint) {
    return [...(this.turnHooks.get(point) || [])];
  }

  listRegistrations(modId?: string): HookRegistration[] {
    const all = Array.from(this.registrations.values());
    if (!modId) return all;
    return all.filter((item) => item.modId === modId);
  }

  listByHookType(hookType: HookType): HookRegistration[] {
    return Array.from(this.registrations.values())
      .filter((item) => item.hookType === hookType && item.status === 'ACTIVE');
  }

  listByStatus(status: HookRegistration['status']): HookRegistration[] {
    return Array.from(this.registrations.values())
      .filter((item) => item.status === status);
  }

  getRegistration(registrationId: string): HookRegistration | undefined {
    return this.registrations.get(registrationId);
  }

  countActive(modId?: string): number {
    let count = 0;
    for (const reg of this.registrations.values()) {
      if (reg.status !== 'ACTIVE') continue;
      if (modId && reg.modId !== modId) continue;
      count += 1;
    }
    return count;
  }

  unregisterAll(modId: string): void {
    const toRemove: string[] = [];
    for (const [id, reg] of this.registrations) {
      if (reg.modId === modId && reg.status !== 'REMOVED') {
        toRemove.push(id);
      }
    }
    for (const registrationId of toRemove) {
      this.markRemoved(registrationId, 'UNREGISTER_ALL');
    }
  }

  updateStatus(registrationId: string, status: HookRegistration['status'], statusReason?: string): void {
    const value = this.registrations.get(registrationId);
    if (!value) return;
    if (status === 'REMOVED') {
      this.markRemoved(registrationId, statusReason || 'STATUS_REMOVED');
      return;
    }
    this.registrations.set(registrationId, {
      ...value,
      status,
      statusReason,
    });
  }

  unregisterByTarget(input: {
    modId: string;
    hookType: HookType;
    target: string;
  }): number {
    let removed = 0;
    const toRemove: string[] = [];
    for (const [id, reg] of this.registrations) {
      if (
        reg.modId === input.modId
        && reg.hookType === input.hookType
        && reg.target === input.target
        && reg.status !== 'REMOVED'
      ) {
        toRemove.push(id);
      }
    }
    for (const registrationId of toRemove) {
      this.markRemoved(registrationId, 'UNREGISTER_BY_TARGET');
      removed += 1;
    }
    return removed;
  }

  unregisterByRegistrationId(registrationId: string): boolean {
    const registration = this.registrations.get(registrationId);
    if (!registration) {
      return false;
    }
    if (registration.status === 'REMOVED') {
      return false;
    }

    return Boolean(this.markRemoved(registrationId, 'UNREGISTER_BY_ID'));
  }

  listCapabilities(modId: string): string[] {
    const caps = new Set<string>();
    for (const reg of this.registrations.values()) {
      if (reg.modId === modId && reg.status === 'ACTIVE') {
        for (const cap of reg.requestedCapabilities) {
          caps.add(cap);
        }
      }
    }
    return [...caps];
  }
}
