import { validateSimulatorScenario } from '../build/config.mjs';

export function scenarioForQualifiedReports(rows, { launch = [] } = {}) {
  return validateSimulatorScenario({
    schema: 'nimi.simulator.scenario/v1',
    scenario_id: 'qualification-fixture',
    scenario_revision: 'test',
    seed: 'a5'.repeat(32),
    initial_logical_time: 0,
    state: { scenario: {}, ecosystem: {}, shell: { readiness: {} } },
    module_data: rows.map(({ moduleId, report }) => ({
      module_id: moduleId,
      data: report.fixture.catalog.moduleData,
    })),
    enabled_capabilities: [],
    launch,
    readiness: rows.flatMap(({ moduleId, report }) => report.fixture.readiness.map((declaration) => ({
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
