import type { HookRegistration, HookType, TurnHookPoint, TurnHookHandler } from '../contracts/types.js';

export class HookRegistry {
  private readonly registrations = new Map<string, HookRegistration>();
  private readonly turnHooks = new Map<TurnHookPoint, Array<{
    registrationId: string;
    modId: string;
    priority: number;
    handler: TurnHookHandler;
  }>>();

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
    for (const [id, reg] of this.registrations) {
      if (reg.modId === modId) {
        this.registrations.set(id, { ...reg, status: 'REMOVED' });
      }
    }
    for (const [point, hooks] of this.turnHooks) {
      this.turnHooks.set(point, hooks.filter((h) => h.modId !== modId));
    }
  }

  updateStatus(registrationId: string, status: HookRegistration['status']): void {
    const value = this.registrations.get(registrationId);
    if (!value) return;
    this.registrations.set(registrationId, {
      ...value,
      status,
      statusReason: status === 'REMOVED' ? 'MANUAL_REMOVE' : value.statusReason,
    });
  }

  unregisterByTarget(input: {
    modId: string;
    hookType: HookType;
    target: string;
  }): number {
    let removed = 0;
    for (const [id, reg] of this.registrations) {
      if (
        reg.modId === input.modId
        && reg.hookType === input.hookType
        && reg.target === input.target
        && reg.status !== 'REMOVED'
      ) {
        this.registrations.set(id, {
          ...reg,
          status: 'REMOVED',
          statusReason: 'UNREGISTER_BY_TARGET',
        });
        removed += 1;
      }
    }
    if (input.hookType === 'turn-hook') {
      const point = input.target as TurnHookPoint;
      const list = this.turnHooks.get(point) || [];
      this.turnHooks.set(
        point,
        list.filter((item) => item.modId !== input.modId),
      );
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

    this.registrations.set(registrationId, {
      ...registration,
      status: 'REMOVED',
      statusReason: 'UNREGISTER_BY_REGISTRATION_ID',
    });

    if (registration.hookType === 'turn-hook') {
      const point = registration.target as TurnHookPoint;
      const list = this.turnHooks.get(point) || [];
      this.turnHooks.set(
        point,
        list.filter((item) => item.registrationId !== registrationId),
      );
    }

    return true;
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
