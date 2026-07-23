import {
  stableJson,
  SimulatorConformanceError,
} from '@nimiplatform/app-tools/simulator-conformance';

function fail(code, message, fieldPath = '') {
  throw new SimulatorConformanceError(code, message, fieldPath);
}

export function scenarioWire(scenario) {
  const { digest: ignoredDigest, descriptor_label: ignoredLabel, ...wire } = scenario;
  void ignoredDigest;
  void ignoredLabel;
  return wire;
}

export function assertScenarioMatchesQualified(
  scenario,
  rows,
  readinessDeclarations,
  supportedCapabilities = new Set(),
) {
  if (!scenario || typeof scenario !== 'object') {
    fail('SIM_SCENARIO_MISSING', 'one validated Simulator Scenario is required');
  }
  const selectedModuleIds = rows.map((row) => row.moduleId);
  const scenarioModuleIds = scenario.module_data.map((row) => row.module_id);
  if (stableJson(selectedModuleIds) !== stableJson(scenarioModuleIds)) {
    fail('SIM_SCENARIO_MODULE_DATA_MISMATCH', 'Scenario module_data must exactly follow selected registry order');
  }
  if (scenario.scenario_id === 'nimi-ecosystem') {
    const desktopData = scenario.module_data.find((row) => row.module_id === 'desktop')?.data;
    const desktopAuth = desktopData?.auth;
    const desktopPersona = desktopAuth?.persona;
    if (!desktopData || desktopAuth?.initialStatus !== 'authenticated'
      || desktopData?.productControl?.initialStatus !== 'ready_for_use'
      || !desktopPersona
      || !['accountId', 'userId', 'realmEnvironmentId'].every((field) => (
        typeof desktopPersona[field] === 'string' && desktopPersona[field].startsWith('sim-')
      ))) {
      fail('SIM_SCENARIO_DESKTOP_AUTH', 'canonical Desktop Scenario auth must be a simulated authenticated State Engine projection');
    }
    const desktopSurface = rows.find((row) => row.moduleId === 'desktop')?.surfaces.find((surface) => surface.id === 'main');
    const desktopReadiness = scenario.readiness.find((row) => row.module_id === 'desktop' && row.surface_id === 'main');
    if (desktopSurface?.initialRoute !== '/'
      || desktopReadiness?.primary_control?.semantic_id !== 'desktop-main-shell-primary'
      || desktopReadiness?.primary_control?.accessible_name !== 'Home'
      || desktopReadiness?.primary_control?.semantic_id === 'desktop-login-primary') {
      fail('SIM_SCENARIO_DESKTOP_SHELL', 'canonical Desktop Scenario must qualify the post-login main Shell at route /');
    }
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
  const readinessKeys = scenario.readiness.map((row) => `${row.module_id}/${row.surface_id}`);
  if (stableJson([...surfaces.keys()]) !== stableJson(readinessKeys)) {
    fail('SIM_SCENARIO_READINESS_COVERAGE', 'Scenario readiness must exactly follow selected surface order');
  }
  for (const row of scenario.readiness) {
    const key = `${row.module_id}/${row.surface_id}`;
    const declaration = readinessDeclarations[key];
    if (!declaration
      || declaration.contractId !== row.contract_id
      || declaration.rootContentSemanticId !== row.root_content_semantic_id
      || declaration.primaryControl.semanticId !== row.primary_control.semantic_id
      || declaration.primaryControl.ariaRole !== row.primary_control.aria_role
      || declaration.primaryControl.accessibleName !== row.primary_control.accessible_name) {
      fail('SIM_SCENARIO_READINESS_DECLARATION', `Scenario readiness differs from App declaration ${JSON.stringify(key)}`);
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
  const readiness = Object.fromEntries(scenario.readiness.map((row) => {
    const key = `${row.module_id}/${row.surface_id}`;
    return [key, {
      contractId: row.contract_id,
      rootContentSemanticId: row.root_content_semantic_id,
      primaryControl: {
        semanticId: row.primary_control.semantic_id,
        ariaRole: row.primary_control.aria_role,
        accessibleName: row.primary_control.accessible_name,
      },
      projectionPredicateId: `${key}/projection`,
      blockingStatePredicateId: `${key}/blocking`,
    }];
  }));
  const predicates = Object.fromEntries(scenario.readiness.flatMap((row) => {
    const key = `${row.module_id}/${row.surface_id}`;
    return [
      [`${key}/projection`, row.projection],
      [`${key}/blocking`, row.blocking],
    ];
  }));
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
    readiness,
    predicates,
  };
}
