import {
  DEFAULT_TURN_HOOK_POINTS,
  DEFAULT_UI_SLOTS,
} from './capabilities.js';
import { createHookError } from './errors.js';

type ContractKind =
  | 'turn-point'
  | 'ui-slot'
  | 'data-capability'
  | 'inter-mod-channel'
  | 'event-topic';

type ContractEntry = {
  contractId: string;
  kind: ContractKind;
  target: string;
  version: string;
};

function normalize(value: string): string {
  return String(value || '').trim();
}

function toContractId(kind: ContractKind, target: string): string {
  return `${kind}:${target}`;
}

export class HookContractRegistry {
  private readonly contracts = new Map<string, ContractEntry>();

  constructor() {
    for (const point of DEFAULT_TURN_HOOK_POINTS) {
      this.register({
        kind: 'turn-point',
        target: point,
      });
    }
    for (const slot of DEFAULT_UI_SLOTS) {
      this.register({
        kind: 'ui-slot',
        target: slot,
      });
    }
  }

  register(input: {
    kind: ContractKind;
    target: string;
    version?: string;
  }): ContractEntry {
    const target = normalize(input.target);
    if (!target) {
      throw createHookError(
        'HOOK_CONTRACT_TARGET_NOT_FOUND',
        'contract target is empty',
        {
          kind: input.kind,
        },
      );
    }

    const entry: ContractEntry = {
      contractId: toContractId(input.kind, target),
      kind: input.kind,
      target,
      version: normalize(input.version || 'v1') || 'v1',
    };
    this.contracts.set(entry.contractId, entry);
    return entry;
  }

  ensureEventTopic(topic: string): ContractEntry {
    const target = normalize(topic);
    const contractId = toContractId('event-topic', target);
    const existing = this.contracts.get(contractId);
    if (existing) {
      return existing;
    }
    return this.register({
      kind: 'event-topic',
      target,
    });
  }

  assertTurnPoint(point: string): ContractEntry {
    return this.assertByKind('turn-point', point);
  }

  assertUiSlot(slot: string): ContractEntry {
    return this.assertByKind('ui-slot', slot);
  }

  registerDataCapability(capability: string, version?: string): ContractEntry {
    return this.register({
      kind: 'data-capability',
      target: capability,
      version,
    });
  }

  ensureDataCapability(capability: string): ContractEntry {
    const target = normalize(capability);
    const contractId = toContractId('data-capability', target);
    const existing = this.contracts.get(contractId);
    if (existing) {
      return existing;
    }
    return this.registerDataCapability(target);
  }

  assertDataCapability(capability: string): ContractEntry {
    return this.ensureDataCapability(capability);
  }

  assertInterModChannel(channel: string): ContractEntry {
    return this.assertByKind('inter-mod-channel', channel);
  }

  validateUiExtension(slot: string, extension: Record<string, unknown>): void {
    const normalizedSlot = normalize(slot);
    const extensionType = normalize(String(extension.type || ''));

    if (normalizedSlot === 'ui-extension.runtime.devtools.panel') {
      if (extensionType !== 'query-panel') {
        throw createHookError(
          'HOOK_CONTRACT_INVALID_EXTENSION',
          'runtime.devtools.panel only accepts query-panel',
          {
            slot: normalizedSlot,
            extensionType: extensionType || null,
          },
        );
      }
      return;
    }

    if (normalizedSlot === 'ui-extension.app.sidebar.mods') {
      if (extensionType !== 'nav-item') {
        throw createHookError(
          'HOOK_CONTRACT_INVALID_EXTENSION',
          'app.sidebar.mods only accepts nav-item',
          {
            slot: normalizedSlot,
            extensionType: extensionType || null,
          },
        );
      }
      return;
    }

    if (normalizedSlot === 'ui-extension.app.content.routes') {
      if (extensionType !== 'tab-page') {
        throw createHookError(
          'HOOK_CONTRACT_INVALID_EXTENSION',
          'app.content.routes only accepts tab-page',
          {
            slot: normalizedSlot,
            extensionType: extensionType || null,
          },
        );
      }
      return;
    }
  }

  listByKind(kind: ContractKind): ContractEntry[] {
    const result: ContractEntry[] = [];
    for (const entry of this.contracts.values()) {
      if (entry.kind === kind) {
        result.push(entry);
      }
    }
    result.sort((a, b) => a.target.localeCompare(b.target));
    return result;
  }

  private assertByKind(kind: ContractKind, target: string): ContractEntry {
    const normalizedTarget = normalize(target);
    const contractId = toContractId(kind, normalizedTarget);
    const entry = this.contracts.get(contractId);
    if (!entry) {
      throw createHookError(
        'HOOK_CONTRACT_TARGET_NOT_FOUND',
        `missing contract target ${normalizedTarget}`,
        {
          kind,
          target: normalizedTarget || null,
        },
      );
    }
    return entry;
  }
}
