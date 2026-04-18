import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  buildDesktopVrmWave4Evidence,
  renderDesktopVrmWave4EvidenceMarkdown,
  writeDesktopVrmWave4Evidence,
} from '../scripts/lib/desktop-vrm-wave4-evidence.mjs';

function createTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `${prefix}-`));
}

function writeScenario(runRoot: string, directory: string, input: {
  scenarioId: string;
  ok?: boolean;
  generatedAt?: string;
  expectedPhase?: string;
  expectedPosture?: string;
  expectedActiveViseme?: string | null;
  framingMode?: string;
  framingReason?: string;
  lifecycleEvidence?: boolean;
}) {
  const scenarioDir = path.join(runRoot, directory);
  fs.mkdirSync(scenarioDir, { recursive: true });
  fs.writeFileSync(path.join(scenarioDir, 'artifact-manifest.json'), JSON.stringify({
    scenario_id: input.scenarioId,
    suite_bucket: 'journeys',
    fixture_manifest: 'scenario-manifest.json',
  }, null, 2));
  fs.writeFileSync(path.join(scenarioDir, 'scenario-manifest.json'), JSON.stringify({
    scenarioId: input.scenarioId,
  }, null, 2));
  fs.writeFileSync(path.join(scenarioDir, 'macos-smoke-report.json'), JSON.stringify({
    ok: input.ok !== false,
    steps: ['one', 'two'],
    generatedAt: input.generatedAt || '2026-04-18T00:00:00.000Z',
    fixtureManifestPath: '/tmp/scenario-manifest.json',
    htmlSnapshotPath: `/tmp/${input.scenarioId}.dom.html`,
    details: {
      vrm: {
        expectedPhase: input.expectedPhase,
        expectedPosture: input.expectedPosture,
        expectedActiveViseme: input.expectedActiveViseme,
        expectedSceneResources: input.lifecycleEvidence
          ? {
              objectCount: 24,
              meshCount: 11,
              skinnedMeshCount: 1,
              geometryCount: 4,
              materialCount: 3,
              textureCount: 2,
              morphTargetCount: 8,
            }
          : undefined,
        expectedRendererMemory: input.lifecycleEvidence
          ? {
              geometries: 7,
              textures: 3,
              programs: 4,
            }
          : undefined,
        expectedFraming: input.framingMode
          ? {
            mode: input.framingMode,
            selectionReason: input.framingReason || 'width-ratio-threshold',
          }
          : undefined,
        initialVisible: input.lifecycleEvidence
          ? {
              runtimeDebug: {
                performance: {
                  loadSuccessCount: 1,
                  disposeCount: 0,
                  rendererMemory: {
                    geometries: 7,
                    textures: 3,
                    programs: 4,
                  },
                },
              },
            }
          : undefined,
        afterSecondRebind: input.lifecycleEvidence
          ? {
              runtimeDebug: {
                performance: {
                  loadSuccessCount: 3,
                  disposeCount: 2,
                  rendererMemory: {
                    geometries: 7,
                    textures: 3,
                    programs: 4,
                  },
                },
              },
            }
          : undefined,
      },
    },
  }, null, 2));
}

test('desktop vrm wave4 evidence collects the latest artifact per representative scenario across runs', () => {
  const desktopRoot = createTempDir('desktop-vrm-wave4-desktop-root');
  const smokeRoot = path.join(createTempDir('desktop-vrm-wave4-smoke-root'), 'desktop-macos-smoke');
  const olderRunRoot = path.join(smokeRoot, '2026-04-18T09-00-00-000Z');
  const newerRunRoot = path.join(smokeRoot, '2026-04-18T10-00-00-000Z');

  writeScenario(olderRunRoot, '01-chat.vrm-lifecycle-smoke', {
    scenarioId: 'chat.vrm-lifecycle-smoke',
    framingMode: 'broad-portrait',
    lifecycleEvidence: true,
  });
  writeScenario(newerRunRoot, '01-chat.vrm-lifecycle-smoke', {
    scenarioId: 'chat.vrm-lifecycle-smoke',
    framingMode: 'broad-portrait',
    generatedAt: '2026-04-18T10:00:00.000Z',
    lifecycleEvidence: true,
  });
  writeScenario(newerRunRoot, '02-chat.vrm-lifecycle-smoke-avatar-sample-a', {
    scenarioId: 'chat.vrm-lifecycle-smoke-avatar-sample-a',
    framingMode: 'broad-portrait',
    lifecycleEvidence: true,
  });
  writeScenario(newerRunRoot, '03-chat.vrm-lifecycle-smoke-avatar-sample-b', {
    scenarioId: 'chat.vrm-lifecycle-smoke-avatar-sample-b',
    framingMode: 'broad-portrait',
    lifecycleEvidence: true,
  });
  writeScenario(newerRunRoot, '04-chat.vrm-speaking-smoke', {
    scenarioId: 'chat.vrm-speaking-smoke',
    expectedPhase: 'speaking',
    expectedPosture: 'speaking-energized',
    expectedActiveViseme: 'aa',
    framingMode: 'broad-portrait',
  });
  writeScenario(newerRunRoot, '05-chat.vrm-speaking-smoke-no-viseme', {
    scenarioId: 'chat.vrm-speaking-smoke-no-viseme',
    expectedPhase: 'speaking',
    expectedPosture: 'speaking-energized',
    expectedActiveViseme: null,
    framingMode: 'broad-portrait',
  });
  writeScenario(newerRunRoot, '06-chat.vrm-listening-smoke', {
    scenarioId: 'chat.vrm-listening-smoke',
    expectedPhase: 'listening',
    expectedPosture: 'listening-attentive',
    expectedActiveViseme: null,
    framingMode: 'broad-portrait',
  });
  writeScenario(newerRunRoot, '07-chat.vrm-thinking-smoke', {
    scenarioId: 'chat.vrm-thinking-smoke',
    expectedPhase: 'thinking',
    expectedPosture: 'thinking-reflective',
    expectedActiveViseme: null,
    framingMode: 'broad-portrait',
  });

  const evidence = buildDesktopVrmWave4Evidence({
    desktopRoot,
    smokeRoot,
  });

  assert.equal(evidence.ok, true);
  assert.equal(evidence.scenarioCount, 7);
  assert.deepEqual(evidence.missingScenarios, []);
  assert.deepEqual(evidence.failedScenarios, []);
  assert.deepEqual(evidence.observedFramingModes, ['broad-portrait']);
  assert.equal(evidence.scenarios[0]?.scenario_id, 'chat.vrm-lifecycle-smoke');
  assert.equal(evidence.scenarios[0]?.generated_at, '2026-04-18T10:00:00.000Z');
  assert.equal(evidence.lifecyclePerformanceScenarioCount, 3);
  assert.match(
    renderDesktopVrmWave4EvidenceMarkdown(evidence),
    /chat\.vrm-speaking-smoke: PASS/,
  );
  assert.match(
    renderDesktopVrmWave4EvidenceMarkdown(evidence),
    /Lifecycle disposal\/resource\/headroom checks: 3\/3/,
  );
  assert.match(
    renderDesktopVrmWave4EvidenceMarkdown(evidence),
    /Renderer memory: geometries 7→7, textures 3→3, programs 4→4/,
  );
  assert.match(
    renderDesktopVrmWave4EvidenceMarkdown(evidence),
    /representative live framing breadth still resolves only to broad-portrait/,
  );
});

test('desktop vrm wave4 evidence writer emits json and markdown outputs', () => {
  const outputRoot = createTempDir('desktop-vrm-wave4-evidence-output');
  const jsonPath = path.join(outputRoot, 'evidence.json');
  const markdownPath = path.join(outputRoot, 'evidence.md');
  const evidence = {
    generatedAt: '2026-04-18T12:00:00.000Z',
    platform: 'macos',
    ok: false,
    smokeRoot: '/tmp/root',
    expectedScenarioCount: 7,
    scenarioCount: 0,
    expectedScenarios: [],
    missingScenarios: ['chat.vrm-lifecycle-smoke'],
    failedScenarios: [],
    observedFramingModes: [],
    observedPhaseScenarios: [],
    lifecyclePerformanceScenarioCount: 0,
    scenarios: [],
    residualRisks: ['human acceptance notes are not yet recorded in the Wave 4 evidence line'],
  };

  writeDesktopVrmWave4Evidence(jsonPath, markdownPath, evidence);

  assert.equal(fs.existsSync(jsonPath), true);
  assert.equal(fs.existsSync(markdownPath), true);
  assert.match(fs.readFileSync(markdownPath, 'utf8'), /Residual Risks/);
});
