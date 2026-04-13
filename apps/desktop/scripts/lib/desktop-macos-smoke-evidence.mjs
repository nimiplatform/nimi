import fs from 'node:fs';
import path from 'node:path';

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

function newestRunDir(root) {
  if (!exists(root)) {
    return null;
  }
  const entries = fs.readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((left, right) => right.localeCompare(left));
  return entries[0] ? path.join(root, entries[0]) : null;
}

function collectScenarioArtifacts(runRoot) {
  if (!runRoot || !exists(runRoot)) {
    return [];
  }
  return fs.readdirSync(runRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const scenarioDir = path.join(runRoot, entry.name);
      const artifactManifestPath = path.join(scenarioDir, 'artifact-manifest.json');
      const scenarioManifestPath = path.join(scenarioDir, 'scenario-manifest.json');
      const reportPath = path.join(scenarioDir, 'macos-smoke-report.json');
      const artifactManifest = exists(artifactManifestPath) ? readJson(artifactManifestPath) : {};
      const scenarioManifest = exists(scenarioManifestPath) ? readJson(scenarioManifestPath) : {};
      const report = exists(reportPath) ? readJson(reportPath) : {};
      return {
        directory: entry.name,
        scenario_id: artifactManifest.scenario_id || scenarioManifest.scenarioId || entry.name.replace(/^\d+-/, ''),
        suite_bucket: artifactManifest.suite_bucket || 'journeys',
        spec_path: artifactManifest.spec_path || null,
        fixture_profile: artifactManifest.fixture_profile || null,
        fixture_manifest: report.fixtureManifestPath || artifactManifest.fixture_manifest || null,
        backend_log: artifactManifest.backend_log || null,
        smoke_report: reportPath,
        ok: report.ok === true,
        failed_step: report.failedStep || null,
        error_message: report.errorMessage || null,
        html_snapshot_path: report.htmlSnapshotPath || null,
        failure_source: report.failureSource || null,
        failure_phase: report.failurePhase || null,
        backend_log_path: report.backendLogPath || artifactManifest.backend_log || null,
        backend_log_present: typeof report.backendLogPresent === 'boolean'
          ? report.backendLogPresent
          : Boolean(artifactManifest.backend_log),
        step_count: Array.isArray(report.steps) ? report.steps.length : 0,
      };
    })
    .sort((left, right) => left.directory.localeCompare(right.directory));
}

export function buildDesktopMacosSmokeEvidence(input) {
  const desktopRoot = path.resolve(String(input.desktopRoot));
  const smokeRoot = path.resolve(String(input.smokeRoot || path.join(desktopRoot, '..', '..', '.local', 'report', 'desktop-macos-smoke')));
  const runRoot = input.runRoot
    ? path.resolve(String(input.runRoot))
    : newestRunDir(smokeRoot);
  const scenarios = collectScenarioArtifacts(runRoot);
  const ok = scenarios.length > 0 && scenarios.every((scenario) => scenario.ok);
  const residualRisks = ['macOS supplementary automated smoke remains non-blocking per D-GATE-060'];
  if (!runRoot) {
    residualRisks.push('no macOS smoke run directory was found');
  }
  if (scenarios.length === 0) {
    residualRisks.push('no macOS smoke scenario artifacts were found');
  }
  if (scenarios.some((scenario) => !scenario.ok)) {
    residualRisks.push('one or more macOS smoke scenarios failed');
  }

  return {
    generatedAt: new Date().toISOString(),
    platform: 'macos',
    ok,
    runRoot,
    smokeRoot,
    scenarioCount: scenarios.length,
    scenarios,
    residualRisks,
  };
}

export function renderDesktopMacosSmokeEvidenceMarkdown(evidence) {
  const lines = [
    '# Desktop macOS Smoke Evidence',
    '',
    `- Generated at: ${evidence.generatedAt}`,
    `- Platform: ${evidence.platform}`,
    `- Verdict: ${evidence.ok ? 'PASS' : 'FAIL'}`,
    `- Run root: ${evidence.runRoot || '-'}`,
    '',
    '## Scenario Details',
    '',
  ];
  if (evidence.scenarios.length === 0) {
    lines.push('- None');
  } else {
    for (const scenario of evidence.scenarios) {
      lines.push(`- ${scenario.scenario_id}: ${scenario.ok ? 'PASS' : 'FAIL'}`);
      lines.push(`  - Spec: ${scenario.spec_path || '-'}`);
      lines.push(`  - Fixture manifest: ${scenario.fixture_manifest || '-'}`);
      lines.push(`  - Backend log: ${scenario.backend_log || '-'}`);
      lines.push(`  - Smoke report: ${scenario.smoke_report}`);
      lines.push(`  - HTML snapshot: ${scenario.html_snapshot_path || '-'}`);
      lines.push(`  - Steps: ${scenario.step_count}, failed step: ${scenario.failed_step || '-'}`);
      lines.push(`  - Failure source: ${scenario.failure_source || '-'}, phase: ${scenario.failure_phase || '-'}`);
      lines.push(`  - Backend log present: ${scenario.backend_log_present ? 'true' : 'false'}, log path: ${scenario.backend_log_path || '-'}`);
      lines.push(`  - Error: ${scenario.error_message || '-'}`);
    }
  }
  lines.push('', '## Residual Risks', '');
  for (const risk of evidence.residualRisks) {
    lines.push(`- ${risk}`);
  }
  lines.push('');
  return `${lines.join('\n')}\n`;
}

export function writeDesktopMacosSmokeEvidence(outputJsonPath, outputMarkdownPath, evidence) {
  fs.mkdirSync(path.dirname(outputJsonPath), { recursive: true });
  fs.mkdirSync(path.dirname(outputMarkdownPath), { recursive: true });
  fs.writeFileSync(outputJsonPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  fs.writeFileSync(outputMarkdownPath, renderDesktopMacosSmokeEvidenceMarkdown(evidence), 'utf8');
}
