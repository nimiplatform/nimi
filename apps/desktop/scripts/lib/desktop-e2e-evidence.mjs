import fs from 'node:fs';
import path from 'node:path';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function exists(filePath) {
  try {
    fs.accessSync(filePath, fs.constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function collectScenarioArtifacts(artifactRoot) {
  if (!exists(artifactRoot)) {
    return [];
  }
  const entries = fs.readdirSync(artifactRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory() && entry.name !== 'evidence')
    .map((entry) => {
      const scenarioDir = path.join(artifactRoot, entry.name);
      const artifactManifestPath = path.join(scenarioDir, 'artifact-manifest.json');
      const scenarioManifestPath = path.join(scenarioDir, 'scenario-manifest.json');
      const artifactManifest = exists(artifactManifestPath) ? readJson(artifactManifestPath) : null;
      const scenarioManifest = exists(scenarioManifestPath) ? readJson(scenarioManifestPath) : null;
      const files = fs.readdirSync(scenarioDir).sort((left, right) => left.localeCompare(right));

      return {
        directory: entry.name,
        scenario_id: artifactManifest?.scenario_id || scenarioManifest?.scenarioId || entry.name.replace(/^\d+-/, ''),
        suite_bucket: artifactManifest?.suite_bucket || 'unknown',
        spec_path: artifactManifest?.spec_path || null,
        fixture_profile: artifactManifest?.fixture_profile || null,
        fixture_manifest: artifactManifest?.fixture_manifest || null,
        scenario_manifest_path: exists(scenarioManifestPath) ? scenarioManifestPath : null,
        artifact_manifest_path: exists(artifactManifestPath) ? artifactManifestPath : null,
        backend_log: artifactManifest?.backend_log || null,
        driver_log: artifactManifest?.driver_log || null,
        artifact_policy: artifactManifest?.artifact_policy || {},
        screenshot_count: files.filter((file) => file.endsWith('.png')).length,
        html_dump_count: files.filter((file) => file.endsWith('.html')).length,
        browser_log_count: files.filter((file) => file.endsWith('.browser.log')).length,
        renderer_error_files: files.filter((file) => file.endsWith('.renderer-errors.json')),
      };
    })
    .sort((left, right) => left.directory.localeCompare(right.directory));
}

function normalizeOutcome(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) {
    return 'missing';
  }
  if (['success', 'failure', 'cancelled', 'skipped'].includes(normalized)) {
    return normalized;
  }
  return normalized;
}

export function buildDesktopE2EEvidence(input) {
  const desktopRoot = path.resolve(String(input.desktopRoot));
  const artifactRoot = path.resolve(String(input.artifactRoot || path.join(desktopRoot, 'reports', 'e2e')));
  const platform = String(input.platform || '').trim();
  const workflowRef = String(input.workflowRef || '').trim();
  const workflowRunId = String(input.workflowRunId || '').trim();
  const commit = String(input.commit || '').trim();
  const nativeDriver = String(input.nativeDriver || '').trim();
  const tauriDriver = String(input.tauriDriver || '').trim() || 'tauri-driver';
  const appMode = String(input.appMode || '').trim() || 'packaged';
  const artifactUploadPath = String(input.artifactUploadPath || 'apps/desktop/reports/e2e/**').trim();
  const smokeOutcome = normalizeOutcome(input.smokeOutcome);
  const journeysOutcome = normalizeOutcome(input.journeysOutcome);
  const scenarios = collectScenarioArtifacts(artifactRoot);

  if (!platform) {
    throw new Error('platform is required');
  }

  const smokeScenarios = scenarios.filter((item) => item.suite_bucket === 'smoke');
  const journeyScenarios = scenarios.filter((item) => item.suite_bucket === 'journeys');
  const ok = smokeOutcome === 'success' && journeysOutcome === 'success';
  const residualRisks = [];
  if (smokeOutcome !== 'success') {
    residualRisks.push(`desktop E2E smoke outcome is ${smokeOutcome}`);
  }
  if (journeysOutcome !== 'success') {
    residualRisks.push(`desktop E2E journeys outcome is ${journeysOutcome}`);
  }
  if (scenarios.length === 0) {
    residualRisks.push('no desktop E2E scenario artifacts were found under apps/desktop/reports/e2e');
  }
  if (platform.includes('macos')) {
    residualRisks.push('macOS remains non-blocking manual smoke only per D-GATE-060');
  }

  return {
    generatedAt: new Date().toISOString(),
    platform,
    workflowRef,
    workflowRunId,
    commit,
    ok,
    smokeOutcome,
    journeysOutcome,
    appMode,
    prerequisites: {
      tauriDriver,
      nativeDriver: nativeDriver || '-',
    },
    artifactRoot,
    artifactUploadPath,
    scenarioCounts: {
      total: scenarios.length,
      smoke: smokeScenarios.length,
      journeys: journeyScenarios.length,
    },
    scenarios,
    residualRisks,
  };
}

export function renderDesktopE2EEvidenceMarkdown(evidence) {
  const lines = [
    '# Desktop E2E CI Evidence',
    '',
    `- Generated at: ${evidence.generatedAt}`,
    `- Platform: ${evidence.platform}`,
    `- Workflow ref: ${evidence.workflowRef || '-'}`,
    `- Workflow run id: ${evidence.workflowRunId || '-'}`,
    `- Commit: ${evidence.commit || '-'}`,
    `- Verdict: ${evidence.ok ? 'PASS' : 'FAIL'}`,
    '',
    '## Pass/Fail Summary',
    '',
    `- Smoke: ${evidence.smokeOutcome}`,
    `- Journeys: ${evidence.journeysOutcome}`,
    '',
    '## Driver / Runtime Prerequisites',
    '',
    `- Tauri driver: ${evidence.prerequisites.tauriDriver}`,
    `- Native driver: ${evidence.prerequisites.nativeDriver}`,
    `- App mode: ${evidence.appMode}`,
    '',
    '## Scenario Set',
    '',
    `- Total scenarios: ${evidence.scenarioCounts.total}`,
    `- Smoke scenarios: ${evidence.scenarioCounts.smoke}`,
    `- Journey scenarios: ${evidence.scenarioCounts.journeys}`,
    '',
    '## Artifact Paths',
    '',
    `- Artifact root: ${evidence.artifactRoot}`,
    `- Upload path: ${evidence.artifactUploadPath}`,
    '',
    '## Scenario Details',
    '',
  ];

  if (evidence.scenarios.length === 0) {
    lines.push('- None');
  } else {
    for (const scenario of evidence.scenarios) {
      lines.push(`- ${scenario.scenario_id} [${scenario.suite_bucket}]`);
      lines.push(`  - Spec: ${scenario.spec_path || '-'}`);
      lines.push(`  - Scenario manifest: ${scenario.scenario_manifest_path || '-'}`);
      lines.push(`  - Artifact manifest: ${scenario.artifact_manifest_path || '-'}`);
      lines.push(`  - Backend log: ${scenario.backend_log || '-'}`);
      lines.push(`  - Driver log: ${scenario.driver_log || '-'}`);
      lines.push(`  - Screenshots: ${scenario.screenshot_count}, HTML dumps: ${scenario.html_dump_count}, Browser logs: ${scenario.browser_log_count}`);
    }
  }

  lines.push('', '## Residual Risks', '');
  if (evidence.residualRisks.length === 0) {
    lines.push('- None');
  } else {
    for (const risk of evidence.residualRisks) {
      lines.push(`- ${risk}`);
    }
  }

  lines.push('');
  return `${lines.join('\n')}\n`;
}

export function writeDesktopE2EEvidence(outputJsonPath, outputMarkdownPath, evidence) {
  fs.mkdirSync(path.dirname(outputJsonPath), { recursive: true });
  fs.mkdirSync(path.dirname(outputMarkdownPath), { recursive: true });
  fs.writeFileSync(outputJsonPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  fs.writeFileSync(outputMarkdownPath, renderDesktopE2EEvidenceMarkdown(evidence), 'utf8');
}
