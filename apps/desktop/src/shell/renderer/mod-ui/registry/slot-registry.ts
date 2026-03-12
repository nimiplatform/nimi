import type {
  UiExtensionRegistration,
  UiExtensionStrategy,
  UiSlotId,
  UiSlotResolution,
} from '@renderer/mod-ui/contracts';

function compareExtensions(a: UiExtensionRegistration, b: UiExtensionRegistration): number {
  if (b.priority !== a.priority) {
    return b.priority - a.priority;
  }
  return a.extensionId.localeCompare(b.extensionId);
}

function collectConflicts(
  entries: UiExtensionRegistration[],
  strategy: UiExtensionStrategy,
): UiSlotResolution['conflicts'] {
  const group = new Map<number, UiExtensionRegistration[]>();
  for (const entry of entries) {
    const list = group.get(entry.priority) || [];
    list.push(entry);
    group.set(entry.priority, list);
  }

  const conflicts: UiSlotResolution['conflicts'] = [];
  for (const [priority, list] of group.entries()) {
    if (list.length <= 1) {
      continue;
    }
    conflicts.push({
      strategy,
      priority,
      extensionIds: list.map((item) => item.extensionId).sort(),
    });
  }
  return conflicts;
}

export class SlotRegistry {
  private readonly slots = new Map<UiSlotId, Map<string, UiExtensionRegistration>>();

  register(registration: UiExtensionRegistration): void {
    const map = this.slots.get(registration.slot) || new Map<string, UiExtensionRegistration>();
    map.set(registration.extensionId, registration);
    this.slots.set(registration.slot, map);
  }

  unregister(extensionId: string): boolean {
    let removed = false;
    for (const map of this.slots.values()) {
      if (map.delete(extensionId)) {
        removed = true;
      }
    }
    return removed;
  }

  clearByPrefix(prefix: string): void {
    for (const map of this.slots.values()) {
      for (const extensionId of map.keys()) {
        if (extensionId.startsWith(prefix)) {
          map.delete(extensionId);
        }
      }
    }
  }

  clearByModId(modId: string): void {
    for (const map of this.slots.values()) {
      for (const reg of map.values()) {
        if (reg.modId === modId) {
          map.delete(reg.extensionId);
        }
      }
    }
  }

  listSlots(): UiSlotId[] {
    return Array.from(this.slots.keys());
  }

  listBySlot(slot: UiSlotId): UiExtensionRegistration[] {
    return Array.from(this.slots.get(slot)?.values() || []).sort(compareExtensions);
  }

  resolve(slot: UiSlotId): UiSlotResolution {
    const all = this.listBySlot(slot);
    const hide = all.filter((item) => item.strategy === 'hide');
    const replace = all.filter((item) => item.strategy === 'replace');
    const wrap = all.filter((item) => item.strategy === 'wrap');
    const append = all.filter((item) => item.strategy === 'append');

    return {
      hide: hide.length > 0,
      replace,
      wrap,
      append,
      conflicts: [
        ...collectConflicts(replace, 'replace'),
        ...collectConflicts(wrap, 'wrap'),
        ...collectConflicts(append, 'append'),
      ],
    };
  }
}

export const runtimeSlotRegistry = new SlotRegistry();
