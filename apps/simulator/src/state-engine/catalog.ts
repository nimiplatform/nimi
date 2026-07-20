/**
 * Simulator operation catalog: every accepted command has exactly one reducer
 * owner and closed write set; every query has one declared read projection.
 *
 * Authority: P-SIM-011, tables/simulator-state-engine-policy.yaml
 * `operation_queue` (duplicate owners, wildcard write sets, cross-partition
 * writes, and query writes are integrity failures).
 */

import type { SimulatorSchema } from './schema.ts';

export type SimulatorPartition = 'scenario' | 'ecosystem' | 'shell' | 'instances' | 'modules';

export type SimulatorOperationOwner =
  | { readonly kind: 'scenario' }
  | { readonly kind: 'shell' }
  | { readonly kind: 'module'; readonly moduleId: string };

export interface SimulatorCommandRegistration {
  readonly kind: 'command';
  readonly type: string;
  readonly owner: SimulatorOperationOwner;
  readonly payloadSchema: SimulatorSchema;
  /** Exact partitions the command may write. Module commands: exactly ['modules']. */
  readonly writeSet: readonly SimulatorPartition[];
  /** Capabilities the active scenario must grant, checked before the reducer runs. */
  readonly requiredCapabilities: readonly string[];
}

export interface SimulatorQueryRegistration {
  readonly kind: 'query';
  readonly type: string;
  readonly owner: SimulatorOperationOwner;
  readonly inputSchema: SimulatorSchema;
  readonly projectionSchema: SimulatorSchema;
}

export class SimulatorCatalogError extends Error {
  readonly code: 'SIMULATOR_CATALOG_DUPLICATE' | 'SIMULATOR_CATALOG_WRITE_SET';
  constructor(code: 'SIMULATOR_CATALOG_DUPLICATE' | 'SIMULATOR_CATALOG_WRITE_SET', message: string) {
    super(message);
    this.name = 'SimulatorCatalogError';
    this.code = code;
  }
}

const PARTITIONS: readonly SimulatorPartition[] = ['scenario', 'ecosystem', 'shell', 'instances', 'modules'];

function assertWriteSet(owner: SimulatorOperationOwner, writeSet: readonly SimulatorPartition[]): void {
  if (writeSet.length === 0) {
    throw new SimulatorCatalogError('SIMULATOR_CATALOG_WRITE_SET', `command owner ${owner.kind} declares an empty write set`);
  }
  const unique = new Set(writeSet);
  if (unique.size !== writeSet.length) {
    throw new SimulatorCatalogError('SIMULATOR_CATALOG_WRITE_SET', 'duplicate partitions in a write set');
  }
  for (const partition of writeSet) {
    if (!PARTITIONS.includes(partition)) {
      throw new SimulatorCatalogError('SIMULATOR_CATALOG_WRITE_SET', `unknown partition ${String(partition)}`);
    }
  }
  if (owner.kind === 'module' && (writeSet.length !== 1 || writeSet[0] !== 'modules')) {
    throw new SimulatorCatalogError(
      'SIMULATOR_CATALOG_WRITE_SET',
      `module ${owner.moduleId} commands may write only their own modules partition`,
    );
  }
}

export interface SimulatorOperationCatalog {
  registerCommand(registration: SimulatorCommandRegistration): void;
  registerQuery(registration: SimulatorQueryRegistration): void;
  command(type: string): SimulatorCommandRegistration | null;
  query(type: string): SimulatorQueryRegistration | null;
  commandTypesForModule(moduleId: string): readonly string[];
  readonly commandTypes: readonly string[];
  readonly queryTypes: readonly string[];
}

export function createOperationCatalog(): SimulatorOperationCatalog {
  const commands = new Map<string, SimulatorCommandRegistration>();
  const queries = new Map<string, SimulatorQueryRegistration>();

  return {
    registerCommand(registration) {
      if (commands.has(registration.type) || queries.has(registration.type)) {
        throw new SimulatorCatalogError(
          'SIMULATOR_CATALOG_DUPLICATE',
          `duplicate operation type ${JSON.stringify(registration.type)}`,
        );
      }
      assertWriteSet(registration.owner, registration.writeSet);
      commands.set(registration.type, Object.freeze(registration));
    },
    registerQuery(registration) {
      if (queries.has(registration.type) || commands.has(registration.type)) {
        throw new SimulatorCatalogError(
          'SIMULATOR_CATALOG_DUPLICATE',
          `duplicate operation type ${JSON.stringify(registration.type)}`,
        );
      }
      queries.set(registration.type, Object.freeze(registration));
    },
    command: (type) => commands.get(type) ?? null,
    query: (type) => queries.get(type) ?? null,
    commandTypesForModule(moduleId) {
      return [...commands.values()]
        .filter((entry) => entry.owner.kind === 'module' && entry.owner.moduleId === moduleId)
        .map((entry) => entry.type);
    },
    get commandTypes() {
      return [...commands.keys()];
    },
    get queryTypes() {
      return [...queries.keys()];
    },
  };
}
