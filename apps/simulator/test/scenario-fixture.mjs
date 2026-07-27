import { validateSimulatorScenario } from '../build/config.mjs';

export function scenarioForValidatedSources(rows, { launch = [] } = {}) {
  return validateSimulatorScenario({
    schema: 'nimi.simulator.scenario/v1',
    scenario_id: 'module-test-fixture',
    scenario_revision: 'test',
    seed: 'a5'.repeat(32),
    initial_logical_time: 0,
    state: { scenario: {}, ecosystem: {}, shell: { readiness: {} } },
    module_data: rows.map(({ moduleId, validation }) => ({
      module_id: moduleId,
      data: validation.fixture.catalog.moduleData,
    })),
    enabled_capabilities: [],
    launch,
    readiness: rows.flatMap(({ moduleId, validation }) => validation.fixture.readiness.map((declaration) => ({
      module_id: moduleId,
      surface_id: declaration.surfaceId,
      contract_id: declaration.contractId,
      root_content_semantic_id: declaration.rootContentSemanticId,
      primary_control: {
        semantic_id: declaration.primaryControl.semanticId,
        aria_role: declaration.primaryControl.ariaRole,
        accessible_name: declaration.primaryControl.accessibleName,
      },
      projection: { kind: 'json_pointer_equals', json_pointer: '', expected: {} },
      blocking: { kind: 'no_active_overlay_lease' },
    }))),
  });
}
