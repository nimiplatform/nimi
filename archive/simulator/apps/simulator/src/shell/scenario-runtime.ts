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
import type { SimulatorSession } from './session.ts';

export interface SimulatorScenarioLaunchIntent {
  readonly launchId: string;
  readonly moduleId: string;
  readonly surfaceId: string;
  readonly activate: boolean;
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
    // Keep initial App mounting ordered and easy to diagnose.
    await readiness.value.completion;
  }
  return Object.freeze(instances);
}
