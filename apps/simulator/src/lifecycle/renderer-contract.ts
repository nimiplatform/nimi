// @nimi-authority: definition.nimi.platform.simulator.renderer-factory
// @nimi-authority: rule.nimi.platform.simulator.p-sim-004
/**
 * Runtime edge for the App-owned canonical renderer module. The shared host
 * envelope is validated by Kit; Simulator validates only module/factory and
 * surface facts that it owns before mounting anything.
 *
 * Authority: P-SIM-006, P-SIM-007, P-SIM-016.
 */

import {
  assertNimiCanonicalRendererHostBindings,
  type AnyNimiCanonicalRendererHostBindingsV1,
} from '@nimiplatform/kit/shell/renderer/host';

const MODULE_PROTOCOL = 'nimi.simulator.module/v1' as const;
const SURFACE_ID_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;

export type SimulatorCanonicalRendererBindings =
  AnyNimiCanonicalRendererHostBindingsV1;

export interface SimulatorCanonicalSurface {
  readonly id: string;
  render(): unknown;
}

export interface SimulatorCanonicalInstance {
  readonly surfaces: Readonly<Record<string, SimulatorCanonicalSurface>>;
  dispose(): Promise<void> | void;
}

export interface SimulatorCanonicalFactory {
  readonly factoryId: string;
  createInstance(
    bindings: SimulatorCanonicalRendererBindings,
  ): SimulatorCanonicalInstance;
}

export interface SimulatorRendererModuleSource {
  readonly protocol: typeof MODULE_PROTOCOL;
  readonly moduleId: string;
  readonly factory: SimulatorCanonicalFactory;
}

export function assertSimulatorRendererModuleSource(
  value: unknown,
  expectedModuleId: string,
): asserts value is SimulatorRendererModuleSource {
  assertRecord(value, 'MODULE');
  assertExactOwnKeys(value, ['factory', 'moduleId', 'protocol'], 'MODULE_KEYS');
  if (value.protocol !== MODULE_PROTOCOL || value.moduleId !== expectedModuleId) {
    fail('MODULE_IDENTITY');
  }
  assertRecord(value.factory, 'FACTORY');
  assertExactOwnKeys(value.factory, ['createInstance', 'factoryId'], 'FACTORY_KEYS');
  if (typeof value.factory.factoryId !== 'string'
    || !value.factory.factoryId
    || value.factory.factoryId !== value.factory.factoryId.trim()
    || typeof value.factory.createInstance !== 'function') {
    fail('FACTORY');
  }
}

export function assertSimulatorCanonicalBindings(
  value: unknown,
): asserts value is SimulatorCanonicalRendererBindings {
  assertNimiCanonicalRendererHostBindings(value);
}

export function assertSimulatorCanonicalInstance(
  value: unknown,
  selectedSurfaceId: string,
): asserts value is SimulatorCanonicalInstance {
  assertRecord(value, 'INSTANCE');
  assertExactOwnKeys(value, ['dispose', 'surfaces'], 'INSTANCE_KEYS');
  if (typeof value.dispose !== 'function') fail('INSTANCE_DISPOSE');
  assertRecord(value.surfaces, 'SURFACES');
  if (!Object.isFrozen(value.surfaces)) fail('SURFACES_MUTABLE');
  const surfaceIds = Object.keys(value.surfaces);
  if (!surfaceIds.includes('main') || !surfaceIds.includes(selectedSurfaceId)) {
    fail('SURFACE_REQUIRED');
  }
  for (const surfaceId of surfaceIds) {
    if (!SURFACE_ID_PATTERN.test(surfaceId)) fail('SURFACE_ID');
    const surface = value.surfaces[surfaceId];
    assertRecord(surface, 'SURFACE');
    assertExactOwnKeys(surface, ['id', 'render'], 'SURFACE_KEYS');
    if (surface.id !== surfaceId || typeof surface.render !== 'function') {
      fail('SURFACE');
    }
  }
}

function assertRecord(value: unknown, suffix: string): asserts value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) fail(suffix);
}

function assertExactOwnKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  suffix: string,
): void {
  const actual = Object.keys(value).sort();
  const sortedExpected = [...expected].sort();
  if (actual.length !== sortedExpected.length
    || actual.some((key, index) => key !== sortedExpected[index])) {
    fail(suffix);
  }
}

function fail(suffix: string): never {
  throw new Error(`SIMULATOR_RENDERER_CONTRACT_${suffix}_INVALID`);
}
