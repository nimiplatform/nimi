import type { UiExtensionEntry } from '../contracts/types.js';

export class UiExtensionGateway {
  private readonly slots = new Map<string, UiExtensionEntry[]>();

  register(input: {
    modId: string;
    slot: string;
    priority?: number;
    extension: Record<string, unknown>;
  }): void {
    const entry: UiExtensionEntry = {
      modId: input.modId,
      slot: input.slot,
      priority: input.priority ?? 0,
      extension: input.extension,
    };
    const list = this.slots.get(input.slot) || [];
    list.push(entry);
    list.sort((a, b) => b.priority - a.priority);
    this.slots.set(input.slot, list);
  }

  unregisterByMod(modId: string): void {
    for (const [slot, list] of this.slots) {
      const filtered = list.filter((item) => item.modId !== modId);
      if (filtered.length === 0) {
        this.slots.delete(slot);
      } else {
        this.slots.set(slot, filtered);
      }
    }
  }

  unregisterBySlot(slot: string, modId: string): boolean {
    const list = this.slots.get(slot);
    if (!list) return false;
    const filtered = list.filter((item) => item.modId !== modId);
    if (filtered.length === list.length) return false;
    if (filtered.length === 0) {
      this.slots.delete(slot);
    } else {
      this.slots.set(slot, filtered);
    }
    return true;
  }

  resolve(slot: string): UiExtensionEntry[] {
    return [...(this.slots.get(slot) || [])];
  }

  listSlots(): string[] {
    return [...this.slots.keys()];
  }

  countBySlot(slot: string): number {
    return (this.slots.get(slot) || []).length;
  }

  countByMod(modId: string): number {
    let count = 0;
    for (const list of this.slots.values()) {
      for (const entry of list) {
        if (entry.modId === modId) count += 1;
      }
    }
    return count;
  }
}
