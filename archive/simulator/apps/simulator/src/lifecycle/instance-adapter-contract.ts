// @nimi-authority: definition.nimi.platform.simulator.adapter
// @nimi-authority: rule.nimi.platform.simulator.p-sim-005
/** Runtime shape checks for App-owned Adapter modules and instances. */

import type {
  SimulatorAdapterFactorySource,
  SimulatorAdapterInstance,
} from './instance-host-contract.ts';

function assertRecord(value: unknown): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error('SIMULATOR_MODULE_VALUE_INVALID');
  }
}

function assertExactOwnKeys(value: Record<string, unknown>, expected: readonly string[]): void {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (actual.length !== sortedExpected.length
    || actual.some((key, index) => key !== sortedExpected[index])) {
    throw new Error('SIMULATOR_MODULE_KEYS_INVALID');
  }
}

export function assertSimulatorAdapterFactorySource(
  value: unknown,
  expectedModuleId: string,
): asserts value is SimulatorAdapterFactorySource {
  assertRecord(value);
  assertExactOwnKeys(value, ['behavior', 'create', 'moduleId', 'protocol']);
  if (value.protocol !== 'nimi.simulator.module/v1'
    || value.moduleId !== expectedModuleId
    || typeof value.create !== 'function') {
    throw new Error('SIMULATOR_ADAPTER_FACTORY_IDENTITY_INVALID');
  }
  assertRecord(value.behavior);
  assertExactOwnKeys(value.behavior, ['initialState', 'project', 'reduce']);
  if (typeof value.behavior.initialState !== 'function'
    || typeof value.behavior.reduce !== 'function'
    || typeof value.behavior.project !== 'function') {
    throw new Error('SIMULATOR_ADAPTER_BEHAVIOR_INVALID');
  }
}

export function assertSimulatorAdapterInstance(
  value: unknown,
): asserts value is SimulatorAdapterInstance {
  assertRecord(value);
  for (const method of ['activate', 'deactivate', 'dispose', 'prepare'] as const) {
    if (typeof value[method] !== 'function') {
      throw new Error(`SIMULATOR_ADAPTER_INSTANCE_${method.toUpperCase()}_INVALID`);
    }
  }
}
