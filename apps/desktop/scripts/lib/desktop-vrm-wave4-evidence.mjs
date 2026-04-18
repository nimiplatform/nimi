import fs from 'node:fs';
import path from 'node:path';

const VRM_WAVE4_SCENARIOS = [
  'chat.vrm-lifecycle-smoke',
  'chat.vrm-lifecycle-smoke-avatar-sample-a',
  'chat.vrm-lifecycle-smoke-avatar-sample-b',
  'chat.vrm-speaking-smoke',
  'chat.vrm-speaking-smoke-no-viseme',
  'chat.vrm-listening-smoke',
  'chat.vrm-thinking-smoke',
];

function exists(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function listRunRoots(smokeRoot) {
  if (!exists(smokeRoot)) {
    return [];
  }
  return fs.readdirSync(smokeRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(smokeRoot, entry.name))
    .sort((left, right) => path.basename(right).localeCompare(path.basename(left)));
}

function parseScenarioArtifact(scenarioDir) {
  const artifactManifestPath = path.join(scenarioDir, 'artifact-manifest.json');
  const scenarioManifestPath = path.join(scenarioDir, 'scenario-manifest.json');
  const reportPath = path.join(scenarioDir, 'macos-smoke-report.json');
  const artifactManifest = exists(artifactManifestPath) ? readJson(artifactManifestPath) : {};
  const scenarioManifest = exists(scenarioManifestPath) ? readJson(scenarioManifestPath) : {};
  const report = exists(reportPath) ? readJson(reportPath) : {};
  const details = report && typeof report.details === 'object' && report.details
    ? report.details
    : {};
  const vrmDetails = details && typeof details.vrm === 'object' && details.vrm
    ? details.vrm
    : {};
  const expectedFraming = vrmDetails && typeof vrmDetails.expectedFraming === 'object' && vrmDetails.expectedFraming
    ? vrmDetails.expectedFraming
    : null;
  const expectedSceneResources = vrmDetails && typeof vrmDetails.expectedSceneResources === 'object' && vrmDetails.expectedSceneResources
    ? vrmDetails.expectedSceneResources
    : null;
  const expectedRendererMemory = vrmDetails && typeof vrmDetails.expectedRendererMemory === 'object' && vrmDetails.expectedRendererMemory
    ? vrmDetails.expectedRendererMemory
    : null;
  const initialVisiblePerformance = vrmDetails?.initialVisible?.runtimeDebug?.performance || null;
  const afterSecondRebindPerformance = vrmDetails?.afterSecondRebind?.runtimeDebug?.performance || null;
  return {
    scenario_id: artifactManifest.scenario_id || scenarioManifest.scenarioId || path.basename(scenarioDir).replace(/^\d+-/, ''),
    run_root: path.dirname(scenarioDir),
    scenario_dir: scenarioDir,
    smoke_report: reportPath,
    fixture_manifest: report.fixtureManifestPath || artifactManifest.fixture_manifest || null,
    html_snapshot_path: report.htmlSnapshotPath || null,
    ok: report.ok === true,
    failed_step: report.failedStep || null,
    error_message: report.errorMessage || null,
    steps: Array.isArray(report.steps) ? report.steps : [],
    generated_at: typeof report.generatedAt === 'string' ? report.generatedAt : null,
    expected_phase: typeof vrmDetails.expectedPhase === 'string' ? vrmDetails.expectedPhase : null,
    expected_posture: typeof vrmDetails.expectedPosture === 'string' ? vrmDetails.expectedPosture : null,
    expected_active_viseme: typeof vrmDetails.expectedActiveViseme === 'string'
      ? vrmDetails.expectedActiveViseme
      : vrmDetails.expectedActiveViseme === null
        ? null
        : undefined,
    expected_scene_resources: expectedSceneResources,
    expected_renderer_memory: expectedRendererMemory,
    framing_mode: typeof expectedFraming?.mode === 'string' ? expectedFraming.mode : null,
    framing_selection_reason: typeof expectedFraming?.selectionReason === 'string'
      ? expectedFraming.selectionReason
      : null,
    load_success_count_initial: typeof initialVisiblePerformance?.loadSuccessCount === 'number'
      ? initialVisiblePerformance.loadSuccessCount
      : null,
    dispose_count_initial: typeof initialVisiblePerformance?.disposeCount === 'number'
      ? initialVisiblePerformance.disposeCount
      : null,
    load_success_count_final: typeof afterSecondRebindPerformance?.loadSuccessCount === 'number'
      ? afterSecondRebindPerformance.loadSuccessCount
      : null,
    dispose_count_final: typeof afterSecondRebindPerformance?.disposeCount === 'number'
      ? afterSecondRebindPerformance.disposeCount
      : null,
    renderer_memory_initial: initialVisiblePerformance?.rendererMemory || null,
    renderer_memory_final: afterSecondRebindPerformance?.rendererMemory || null,
  };
}

function collectLatestWave4ScenarioArtifacts(smokeRoot) {
  const results = new Map();
  for (const runRoot of listRunRoots(smokeRoot)) {
    const scenarioDirs = fs.readdirSync(runRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(runRoot, entry.name))
      .sort((left, right) => path.basename(left).localeCompare(path.basename(right)));
    for (const scenarioDir of scenarioDirs) {
      const artifact = parseScenarioArtifact(scenarioDir);
      if (!VRM_WAVE4_SCENARIOS.includes(artifact.scenario_id) || results.has(artifact.scenario_id)) {
        continue;
      }
      results.set(artifact.scenario_id, artifact);
      if (results.size === VRM_WAVE4_SCENARIOS.length) {
        return VRM_WAVE4_SCENARIOS.map((scenarioId) => results.get(scenarioId));
      }
    }
  }
  return VRM_WAVE4_SCENARIOS
    .filter((scenarioId) => results.has(scenarioId))
    .map((scenarioId) => results.get(scenarioId));
}

export function buildDesktopVrmWave4Evidence(input) {
  const desktopRoot = path.resolve(String(input.desktopRoot));
  const smokeRoot = path.resolve(String(input.smokeRoot || path.join(desktopRoot, '..', '..', '.local', 'report', 'desktop-macos-smoke')));
  const scenarios = collectLatestWave4ScenarioArtifacts(smokeRoot);
  const scenarioMap = new Map(scenarios.map((scenario) => [scenario.scenario_id, scenario]));
  const missingScenarios = VRM_WAVE4_SCENARIOS.filter((scenarioId) => !scenarioMap.has(scenarioId));
  const failedScenarios = scenarios.filter((scenario) => !scenario.ok).map((scenario) => scenario.scenario_id);
  const observedFramingModes = Array.from(new Set(
    scenarios
      .map((scenario) => scenario.framing_mode)
      .filter((mode) => typeof mode === 'string' && mode.length > 0),
  ));
  const observedPhaseScenarios = scenarios
    .filter((scenario) => scenario.expected_phase)
    .map((scenario) => ({
      scenario_id: scenario.scenario_id,
      phase: scenario.expected_phase,
      posture: scenario.expected_posture,
      active_viseme: scenario.expected_active_viseme ?? null,
    }));
  const lifecyclePerformanceScenarios = scenarios.filter((scenario) => (
    scenario.scenario_id.startsWith('chat.vrm-lifecycle-smoke')
    && scenario.expected_scene_resources
    && scenario.expected_renderer_memory
    && scenario.load_success_count_initial === 1
    && scenario.dispose_count_initial === 0
    && scenario.load_success_count_final === 3
    && scenario.dispose_count_final === 2
    && typeof scenario.renderer_memory_initial?.geometries === 'number'
    && typeof scenario.renderer_memory_initial?.textures === 'number'
    && scenario.renderer_memory_final?.geometries === scenario.renderer_memory_initial.geometries
    && scenario.renderer_memory_final?.textures >= scenario.renderer_memory_initial.textures
    && scenario.renderer_memory_final?.textures <= scenario.renderer_memory_initial.textures + 1
    && (
      typeof scenario.renderer_memory_initial?.programs !== 'number'
      || scenario.renderer_memory_final?.programs === scenario.renderer_memory_initial.programs
    )
  ));
  const ok = missingScenarios.length === 0 && failedScenarios.length === 0;
  const residualRisks = [];
  if (missingScenarios.length > 0) {
    residualRisks.push(`missing representative Wave 4 scenarios: ${missingScenarios.join(', ')}`);
  }
  if (failedScenarios.length > 0) {
    residualRisks.push(`one or more representative Wave 4 scenarios failed: ${failedScenarios.join(', ')}`);
  }
  if (observedFramingModes.length === 1 && observedFramingModes[0] === 'broad-portrait') {
    residualRisks.push('representative live framing breadth still resolves only to broad-portrait across the admitted sample set');
  }
  if (lifecyclePerformanceScenarios.length !== 3) {
    residualRisks.push('bounded disposal / resource-stability checks are not yet complete across the admitted lifecycle sample set');
  }
  residualRisks.push('human acceptance notes are not yet recorded in the Wave 4 evidence line');

  return {
    generatedAt: new Date().toISOString(),
    platform: 'macos',
    ok,
    smokeRoot,
    expectedScenarioCount: VRM_WAVE4_SCENARIOS.length,
    scenarioCount: scenarios.length,
    expectedScenarios: VRM_WAVE4_SCENARIOS,
    missingScenarios,
    failedScenarios,
    observedFramingModes,
    observedPhaseScenarios,
    lifecyclePerformanceScenarioCount: lifecyclePerformanceScenarios.length,
    scenarios,
    residualRisks,
  };
}

export function renderDesktopVrmWave4EvidenceMarkdown(evidence) {
  const lines = [
    '# Desktop VRM Wave 4 Evidence',
    '',
    `- Generated at: ${evidence.generatedAt}`,
    `- Platform: ${evidence.platform}`,
    `- Verdict: ${evidence.ok ? 'PASS' : 'INCOMPLETE'}`,
    `- Smoke root: ${evidence.smokeRoot}`,
    `- Representative scenarios: ${evidence.scenarioCount}/${evidence.expectedScenarioCount}`,
    `- Observed framing modes: ${evidence.observedFramingModes.length > 0 ? evidence.observedFramingModes.join(', ') : '-'}`,
    `- Lifecycle disposal/resource/headroom checks: ${evidence.lifecyclePerformanceScenarioCount}/3`,
    '',
    '## Scenario Matrix',
    '',
  ];

  if (evidence.scenarios.length === 0) {
    lines.push('- None');
  } else {
    for (const scenario of evidence.scenarios) {
      lines.push(`- ${scenario.scenario_id}: ${scenario.ok ? 'PASS' : 'FAIL'}`);
      lines.push(`  - Generated at: ${scenario.generated_at || '-'}`);
      lines.push(`  - Run root: ${scenario.run_root}`);
      lines.push(`  - Phase/posture: ${scenario.expected_phase || '-'} / ${scenario.expected_posture || '-'}`);
      lines.push(`  - Active viseme: ${scenario.expected_active_viseme === undefined ? '-' : scenario.expected_active_viseme ?? 'none'}`);
      lines.push(`  - Framing: ${scenario.framing_mode || '-'} (${scenario.framing_selection_reason || '-'})`);
      lines.push(
        `  - Lifecycle performance: load ${scenario.load_success_count_initial ?? '-'}→${scenario.load_success_count_final ?? '-'}, dispose ${scenario.dispose_count_initial ?? '-'}→${scenario.dispose_count_final ?? '-'}`,
      );
      lines.push(
        `  - Renderer memory: geometries ${scenario.renderer_memory_initial?.geometries ?? '-'}→${scenario.renderer_memory_final?.geometries ?? '-'}, textures ${scenario.renderer_memory_initial?.textures ?? '-'}→${scenario.renderer_memory_final?.textures ?? '-'}, programs ${scenario.renderer_memory_initial?.programs ?? '-'}→${scenario.renderer_memory_final?.programs ?? '-'}`,
      );
      lines.push(`  - Steps: ${scenario.steps.length}, failed step: ${scenario.failed_step || '-'}`);
      lines.push(`  - Smoke report: ${scenario.smoke_report}`);
      lines.push(`  - Fixture manifest: ${scenario.fixture_manifest || '-'}`);
      lines.push(`  - HTML snapshot: ${scenario.html_snapshot_path || '-'}`);
      lines.push(`  - Error: ${scenario.error_message || '-'}`);
    }
  }

  lines.push('', '## Phase Coverage', '');
  if (evidence.observedPhaseScenarios.length === 0) {
    lines.push('- None');
  } else {
    for (const scenario of evidence.observedPhaseScenarios) {
      lines.push(
        `- ${scenario.scenario_id}: ${scenario.phase} / ${scenario.posture || '-'} / viseme=${scenario.active_viseme ?? 'none'}`,
      );
    }
  }

  lines.push('', '## Residual Risks', '');
  for (const risk of evidence.residualRisks) {
    lines.push(`- ${risk}`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

export function writeDesktopVrmWave4Evidence(outputJsonPath, outputMarkdownPath, evidence) {
  fs.mkdirSync(path.dirname(outputJsonPath), { recursive: true });
  fs.mkdirSync(path.dirname(outputMarkdownPath), { recursive: true });
  fs.writeFileSync(outputJsonPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  fs.writeFileSync(outputMarkdownPath, renderDesktopVrmWave4EvidenceMarkdown(evidence), 'utf8');
}
