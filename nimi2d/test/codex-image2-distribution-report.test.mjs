import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import YAML from 'yaml';

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(import.meta.dirname, '..');
const reportPath = path.join(packageRoot, 'experiments/image-to-layer-input/workflows/codex-image2-distribution-report.mjs');

async function writeYaml(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, YAML.stringify(value), 'utf8');
}

async function readYaml(filePath) {
  return YAML.parse(await readFile(filePath, 'utf8'));
}

async function runReport(args) {
  try {
    const { stdout } = await execFileAsync(process.execPath, [reportPath, ...args], {
      cwd: packageRoot,
    });
    return { exitCode: 0, stdout: JSON.parse(stdout) };
  } catch (error) {
    return {
      exitCode: error.code,
      stdout: JSON.parse(error.stdout),
    };
  }
}

async function writeRun(runsDir, runId, sourceHash, sourceSurface = 'codex_cli') {
  const runDir = path.join(runsDir, runId);
  await writeYaml(path.join(runDir, 'codex-image2-layer-workflow.yaml'), {
    manifest_kind: 'nimi.nimi2d.codex-image2.layer-workflow-run',
    schema_version: 1,
    verdict: 'pass',
    quality_summary: {
      upstream_producer: 'admit',
      upstream_image2_atlas: 'fail',
      normalized_atlas: 'pass',
      transparent_atlas: 'pass',
      atlas_quality: 'pass',
      formal_nimi2d_admission: 'pass',
    },
    source: {
      file_sha256: sourceHash,
      surface: sourceSurface,
    },
    upstream_producer: {
      verdict: 'admit',
    },
    atlas_quality: {
      report_path: 'quality/atlas-quality.yaml',
      decision: { verdict: 'pass' },
    },
    workflow_bench: {
      report_path: 'output/workflow-report.yaml',
      decision: { verdict: 'pass' },
    },
  });
  await writeYaml(path.join(runDir, 'quality/atlas-quality.yaml'), {
    decision: { verdict: 'pass' },
    hard_gate_results: {
      declared_visible_bounds_match: 'pass',
      anchors_inside_measured_layer_bounds: 'pass',
      slots_overlap_measured_layer_bounds: 'pass',
    },
    quality_gate_results: {
      mouth_expressive_geometry: { status: 'pass' },
      eye_readability_geometry: { status: 'pass' },
      body_geometry: { status: 'pass' },
      outfit_geometry: { status: 'pass' },
      chroma_background_separation: { status: 'pass' },
    },
    failure_attribution: {},
    layer_measurements: [
      {
        layer_id: 'layer_mouth',
        measured_visible_bounds_px: { x: 10, y: 12, width: 20, height: 10 },
      },
      {
        layer_id: 'layer_eye',
        measured_visible_bounds_px: { x: 8, y: 5, width: 32, height: 12 },
      },
      {
        layer_id: 'layer_outfit',
        measured_visible_bounds_px: { x: 6, y: 20, width: 50, height: 80 },
      },
    ],
    tracking_metrics: {
      manual_correction_minutes: { status: 'not_measured' },
    },
  });
  await writeYaml(path.join(runDir, 'output/workflow-report.yaml'), {
    decision: { verdict: 'pass' },
  });
}

test('Codex Image2 distribution report fails closed on duplicate source samples', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'nimi2d-image2-distribution-'));
  const runsDir = path.join(tempDir, 'runs');
  await writeRun(runsDir, 'run-a', 'hash-a');
  await writeRun(runsDir, 'run-b', 'hash-a');

  const outPath = path.join(tempDir, 'distribution.yaml');
  const result = await runReport([
    '--runs-dir', runsDir,
    '--out', outPath,
    '--min-samples', '2',
  ]);
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout.decision.stop_class, 'insufficient_unique_samples');

  const report = await readYaml(outPath);
  assert.equal(report.manifest_kind, 'nimi.nimi2d.codex-image2.distribution-report');
  assert.equal(report.decision.verdict, 'fail');
  assert.equal(report.summary.run_count, 2);
  assert.equal(report.summary.unique_source_sample_count, 1);
  assert.deepEqual(report.summary.duplicate_source_groups[0].run_ids, ['run-a', 'run-b']);
});

test('Codex Image2 distribution report passes only when unique samples meet the gate', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'nimi2d-image2-distribution-pass-'));
  const runsDir = path.join(tempDir, 'runs');
  await writeRun(runsDir, 'run-a', 'hash-a');
  await writeRun(runsDir, 'run-b', 'hash-a');
  await writeRun(runsDir, 'run-c', 'hash-b');

  const outPath = path.join(tempDir, 'distribution.yaml');
  const result = await runReport([
    '--runs-dir', runsDir,
    '--out', outPath,
    '--min-samples', '2',
  ]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.decision.verdict, 'pass');

  const report = await readYaml(outPath);
  assert.equal(report.summary.run_count, 3);
  assert.equal(report.summary.unique_source_sample_count, 2);
  assert.equal(report.summary.passing_run_count, 3);
  assert.equal(report.cases.find((item) => item.run_id === 'run-c').mouth_bounds_px.width, 20);
});

test('Codex Image2 distribution report does not infer formal admission from legacy workflow verdict', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'nimi2d-image2-distribution-legacy-formal-'));
  const runsDir = path.join(tempDir, 'runs');
  await writeRun(runsDir, 'legacy-run', 'hash-a');
  const manifestPath = path.join(runsDir, 'legacy-run', 'codex-image2-layer-workflow.yaml');
  const manifest = await readYaml(manifestPath);
  delete manifest.quality_summary.formal_nimi2d_admission;
  await writeYaml(manifestPath, manifest);

  const outPath = path.join(tempDir, 'distribution.yaml');
  const result = await runReport([
    '--runs-dir', runsDir,
    '--out', outPath,
    '--min-samples', '1',
  ]);
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout.decision.stop_class, 'sample_gate_failure');

  const report = await readYaml(outPath);
  assert.equal(report.summary.passing_run_count, 0);
  assert.equal(report.cases[0].workflow_verdict, 'pass');
  assert.equal(report.cases[0].formal_nimi2d_admission, 'not_recorded');
});

test('Codex Image2 distribution report can isolate live codex_cli surface from demo fixtures', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'nimi2d-image2-distribution-live-'));
  const runsDir = path.join(tempDir, 'runs');
  await writeRun(runsDir, 'demo-a', 'hash-demo-a', 'demo_fixture');
  await writeRun(runsDir, 'live-a', 'hash-live-a', 'codex_cli');
  await writeRun(runsDir, 'live-b', 'hash-live-b', 'codex_cli');

  const outPath = path.join(tempDir, 'distribution.yaml');
  const result = await runReport([
    '--runs-dir', runsDir,
    '--out', outPath,
    '--min-samples', '2',
    '--source-surface', 'codex_cli',
  ]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.decision.verdict, 'pass');
  assert.equal(result.stdout.runCount, 2);

  const report = await readYaml(outPath);
  assert.deepEqual(report.filters, { source_surface: 'codex_cli' });
  assert.equal(report.summary.total_run_count, 3);
  assert.equal(report.summary.excluded_run_count, 1);
  assert.equal(report.summary.run_count, 2);
  assert.equal(report.summary.source_surface_counts.codex_cli, 2);
  assert.equal(report.summary.source_surface_counts.demo_fixture, undefined);
  assert.equal(report.cases.some((item) => item.source_surface === 'demo_fixture'), false);
});

test('Codex Image2 distribution report rejects demo-only runs when live codex_cli surface is required', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'nimi2d-image2-distribution-demo-only-'));
  const runsDir = path.join(tempDir, 'runs');
  await writeRun(runsDir, 'demo-a', 'hash-demo-a', 'demo_fixture');
  await writeRun(runsDir, 'demo-b', 'hash-demo-b', 'demo_fixture');

  const outPath = path.join(tempDir, 'distribution.yaml');
  const result = await runReport([
    '--runs-dir', runsDir,
    '--out', outPath,
    '--min-samples', '2',
    '--source-surface', 'codex_cli',
  ]);
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout.decision.stop_class, 'no_runs');

  const report = await readYaml(outPath);
  assert.equal(report.summary.total_run_count, 2);
  assert.equal(report.summary.excluded_run_count, 2);
  assert.equal(report.summary.run_count, 0);
});
