import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildDesktopMacosSmokeEvidence,
  renderDesktopMacosSmokeEvidenceMarkdown,
  writeDesktopMacosSmokeEvidence,
} from '../scripts/lib/desktop-macos-smoke-evidence.mjs';

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
}

test('desktop macos smoke evidence collects the latest scenario artifacts', () => {
  const desktopRoot = createTempDir('desktop-macos-smoke-desktop-root');
  const smokeRoot = path.join(createTempDir('desktop-macos-smoke-root'), 'desktop-macos-smoke');
  const runRoot = path.join(smokeRoot, '2026-04-14T12-00-00-000Z');
  const scenarioDir = path.join(runRoot, '01-chat.memory-standard-bind');
  fs.mkdirSync(scenarioDir, { recursive: true });
  fs.writeFileSync(path.join(scenarioDir, 'artifact-manifest.json'), JSON.stringify({
    scenario_id: 'chat.memory-standard-bind',
    suite_bucket: 'journeys',
    spec_path: 'apps/desktop/e2e/specs/chat.memory-standard-bind.e2e.mjs',
    fixture_profile: 'apps/desktop/e2e/fixtures/profiles/chat.memory-standard-bind.json',
    fixture_manifest: 'scenario-manifest.json',
    backend_log: 'backend.log',
  }, null, 2));
  fs.writeFileSync(path.join(scenarioDir, 'scenario-manifest.json'), JSON.stringify({
    scenarioId: 'chat.memory-standard-bind',
  }, null, 2));
  fs.writeFileSync(path.join(scenarioDir, 'macos-smoke-report.json'), JSON.stringify({
    ok: true,
    steps: ['wait-chat-panel', 'wait-standard'],
    fixtureManifestPath: '/tmp/scenario-manifest.json',
    htmlSnapshotPath: '/tmp/chat.memory-standard-bind.dom.html',
    failureSource: 'renderer',
    backendLogPresent: true,
  }, null, 2));

  const evidence = buildDesktopMacosSmokeEvidence({
    desktopRoot,
    smokeRoot,
  });

  assert.equal(evidence.ok, true);
  assert.equal(evidence.scenarioCount, 1);
  assert.equal(evidence.scenarios[0]?.scenario_id, 'chat.memory-standard-bind');
  assert.equal(evidence.scenarios[0]?.step_count, 2);
  assert.equal(evidence.scenarios[0]?.failure_source, 'renderer');
  assert.equal(evidence.scenarios[0]?.backend_log_present, true);
  assert.match(
    renderDesktopMacosSmokeEvidenceMarkdown(evidence),
    /chat\.memory-standard-bind: PASS/,
  );
  assert.match(
    renderDesktopMacosSmokeEvidenceMarkdown(evidence),
    /Failure source: renderer, phase: -/,
  );
});

test('desktop macos smoke evidence writer emits json and markdown outputs', () => {
  const outputRoot = createTempDir('desktop-macos-smoke-evidence-output');
  const jsonPath = path.join(outputRoot, 'evidence.json');
  const markdownPath = path.join(outputRoot, 'evidence.md');
  const evidence = {
    generatedAt: '2026-04-14T12:00:00.000Z',
    platform: 'macos',
    ok: false,
    runRoot: '/tmp/run',
    smokeRoot: '/tmp/root',
    scenarioCount: 0,
    scenarios: [],
    residualRisks: ['no macOS smoke run directory was found'],
  };

  writeDesktopMacosSmokeEvidence(jsonPath, markdownPath, evidence);

  assert.equal(fs.existsSync(jsonPath), true);
  assert.equal(fs.existsSync(markdownPath), true);
  assert.match(fs.readFileSync(markdownPath, 'utf8'), /Residual Risks/);
});
