/**
 * Runtime projection of the Simulator-owned Scenario artifact. This module
 * contains only generic Scenario interpretation; selected App identifiers
 * never select an implementation branch.
 *
 * Authority: P-SIM-010, P-SIM-014;
 * tables/simulator-scenario-contract.yaml.
 */

import { canonicalizeJson, type JsonValue } from '../state-engine/json-value.ts';
import type { SimulatorModuleCatalogDeclaration } from '../state-engine/types.ts';
import type { SimulatorReadinessExpectation } from '../lifecycle/readiness.ts';
import type { SimulatorSession } from './session.ts';

export interface SimulatorScenarioLaunchIntent {
  readonly launchId: string;
  readonly moduleId: string;
  readonly surfaceId: string;
  readonly activate: boolean;
}

export type SimulatorScenarioPredicateDefinition =
  | {
      readonly kind: 'json_pointer_equals';
      readonly json_pointer: string;
      readonly expected: JsonValue;
    }
  | { readonly kind: 'no_active_overlay_lease' };

const MISSING = Symbol('simulator-scenario-json-pointer-missing');

function pointerToken(value: string): string {
  return value.replace(/~1/gu, '/').replace(/~0/gu, '~');
}

function readJsonPointer(value: JsonValue, pointer: string): JsonValue | typeof MISSING {
  if (pointer === '') return value;
  let current: JsonValue = value;
  for (const encoded of pointer.slice(1).split('/')) {
    const token = pointerToken(encoded);
    if (Array.isArray(current)) {
      if (!/^(?:0|[1-9][0-9]*)$/u.test(token)) return MISSING;
      const index = Number(token);
      if (!Number.isSafeInteger(index) || index >= current.length) return MISSING;
      current = current[index] as JsonValue;
      continue;
    }
    if (!current || typeof current !== 'object' || !Object.hasOwn(current, token)) return MISSING;
    current = (current as Readonly<Record<string, JsonValue>>)[token];
  }
  return current;
}

export function bindScenarioModuleData(
  catalogs: readonly Omit<SimulatorModuleCatalogDeclaration, 'moduleData'>[],
  moduleData: Readonly<Record<string, JsonValue>>,
): readonly SimulatorModuleCatalogDeclaration[] {
  const selected = catalogs.map((entry) => entry.moduleId);
  if (canonicalizeJson(selected) !== canonicalizeJson(Object.keys(moduleData))) {
    throw new Error('SIMULATOR_SCENARIO_MODULE_DATA_MISMATCH');
  }
  return catalogs.map((catalog) => ({ ...catalog, moduleData: moduleData[catalog.moduleId] }));
}

export function compileScenarioReadiness(input: {
  readonly expectations: Readonly<Record<string, SimulatorReadinessExpectation>>;
  readonly predicates: Readonly<Record<string, SimulatorScenarioPredicateDefinition>>;
  readonly activeOverlayLeaseCount: () => number;
}): {
  readonly expectations: Readonly<Record<string, SimulatorReadinessExpectation>>;
  readonly projectionPredicates: Readonly<Record<string, (projection: JsonValue) => boolean>>;
  readonly blockingPredicates: Readonly<Record<string, () => boolean>>;
} {
  const projectionPredicates: Record<string, (projection: JsonValue) => boolean> = {};
  const blockingPredicates: Record<string, () => boolean> = {};
  for (const [id, definition] of Object.entries(input.predicates)) {
    if (definition.kind === 'json_pointer_equals') {
      projectionPredicates[id] = (projection) => {
        const actual = readJsonPointer(projection, definition.json_pointer);
        return actual !== MISSING && canonicalizeJson(actual) === canonicalizeJson(definition.expected);
      };
    } else if (definition.kind === 'no_active_overlay_lease') {
      blockingPredicates[id] = () => input.activeOverlayLeaseCount() > 0;
    } else {
      throw new Error('SIMULATOR_SCENARIO_PREDICATE_UNSUPPORTED');
    }
  }
  for (const expectation of Object.values(input.expectations)) {
    if (!projectionPredicates[expectation.projectionPredicateId]
      || !blockingPredicates[expectation.blockingStatePredicateId]) {
      throw new Error('SIMULATOR_SCENARIO_PREDICATE_MISSING');
    }
  }
  return Object.freeze({
    expectations: input.expectations,
    projectionPredicates: Object.freeze(projectionPredicates),
    blockingPredicates: Object.freeze(blockingPredicates),
  });
}

export async function launchScenarioInstances(
  session: SimulatorSession,
  intents: readonly SimulatorScenarioLaunchIntent[],
): Promise<Readonly<Record<string, string>>> {
  const instances: Record<string, string> = {};
  for (const intent of intents) {
    const opened = await session.openInstance(intent.moduleId, intent.surfaceId, {
      activateBeforeMount: intent.activate,
    });
    if (!opened.ok) throw new Error(`${opened.error.code}:${intent.launchId}`);
    instances[intent.launchId] = opened.value.instanceId;
    const readiness = session.readinessFor(opened.value.instanceId, intent.surfaceId);
    if (!readiness.ok) throw new Error(`${readiness.error.code}:${intent.launchId}`);
    // Serial Scenario launch prevents the next instance's authoritative state
    // commits from invalidating this instance's in-flight readiness barrier.
    await readiness.value.completion;
  }
  return Object.freeze(instances);
}
