import { SimulatorConformanceError } from '@nimiplatform/app-tools/simulator-conformance';

function fail(code, message, fieldPath = '') {
  throw new SimulatorConformanceError(code, message, fieldPath);
}

export function scenarioWire(scenario) {
  const { descriptor_label: ignoredLabel, ...wire } = scenario;
  void ignoredLabel;
  return wire;
}

export function assertScenarioMatchesModules(
  scenario,
  rows,
  supportedCapabilities = new Set(),
) {
  if (!scenario || typeof scenario !== 'object') {
    fail('SIM_SCENARIO_MISSING', 'one validated Simulator Scenario is required');
  }
  const selectedModuleIds = rows.map((row) => row.moduleId);
  const scenarioModuleIds = scenario.module_data.map((row) => row.module_id);
  if (JSON.stringify(selectedModuleIds) !== JSON.stringify(scenarioModuleIds)) {
    fail('SIM_SCENARIO_MODULE_DATA_MISMATCH', 'Scenario module_data must exactly follow selected registry order');
  }
  for (const capability of scenario.enabled_capabilities) {
    if (!supportedCapabilities.has(capability)) {
      fail('SIM_SCENARIO_CAPABILITY_UNSUPPORTED', `Scenario capability ${JSON.stringify(capability)} is not admitted`);
    }
  }
  const surfaces = new Map();
  for (const row of rows) {
    for (const surface of row.surfaces) surfaces.set(`${row.moduleId}/${surface.id}`, surface);
  }
  for (const launch of scenario.launch) {
    if (!surfaces.has(`${launch.module_id}/${launch.surface_id}`)) {
      fail(
        'SIM_SCENARIO_LAUNCH_TARGET',
        `Scenario launch ${JSON.stringify(launch.launch_id)} targets an undeclared selected surface`,
      );
    }
  }
}

export function runtimeScenarioProjection(scenario) {
  const desktopPersona = scenario.scenario_id === 'nimi-ecosystem'
    ? scenario.module_data.find((row) => row.module_id === 'desktop')?.data?.auth?.persona
    : null;
  const scenarioPersona = desktopPersona ? {
    protocolRevision: 1,
    ecosystemRevision: 0,
    interactionId: `sim-scenario-persona-${desktopPersona.userId}`,
    persona: desktopPersona,
    committedAt: scenario.initial_logical_time,
  } : null;
  const ecosystemState = scenarioPersona
    ? { ...scenario.state.ecosystem, persona: scenarioPersona }
    : scenario.state.ecosystem;
  const shellState = scenarioPersona
    ? {
      ...scenario.state.shell,
      product: {
        ...scenario.state.shell.product,
        persona: {
          name: desktopPersona.displayName,
          id: desktopPersona.userId,
          role: desktopPersona.role,
        },
      },
    }
    : scenario.state.shell;
  return {
    scenario: {
      scenarioId: scenario.scenario_id,
      scenarioRevision: scenario.scenario_revision,
      seed: scenario.seed,
      initialLogicalTime: scenario.initial_logical_time,
      scenarioState: scenario.state.scenario,
      ecosystemState,
      shellState,
    },
    moduleData: Object.fromEntries(scenario.module_data.map((row) => [row.module_id, row.data])),
    enabledCapabilities: scenario.enabled_capabilities,
    launch: scenario.launch.map((row) => ({
      launchId: row.launch_id,
      moduleId: row.module_id,
      surfaceId: row.surface_id,
      activate: row.activate,
    })),
  };
}
