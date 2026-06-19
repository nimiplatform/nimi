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

async function writeRun(runsDir, runId, sourceHash, sourceSurface = 'codex_cli', overrides = {}) {
  const runDir = path.join(runsDir, runId);
  const producerManifestRef = overrides.underlying_source_hash ? 'source/codex-image2-producer-manifest.yaml' : null;
  const producerRequestPath = producerManifestRef ? path.join(runDir, 'source/provider-request.yaml') : null;
  const producerManifestPath = producerManifestRef ? path.join(runDir, producerManifestRef) : null;
  const qualitySummary = {
    upstream_producer: 'admit',
    upstream_image2_atlas: 'fail',
    raw_provider_atlas_admission: 'fail',
    normalized_atlas: 'pass',
    transparent_atlas: 'pass',
    atlas_quality: 'pass',
    repaired_workflow: 'pass',
    source_to_layer_pipeline: 'pass',
    formal_admission_model: 'raw_plus_repaired_evidence',
    formal_nimi2d_admission: 'pass',
    ...overrides.quality_summary,
  };
  await writeYaml(path.join(runDir, 'codex-image2-layer-workflow.yaml'), {
    manifest_kind: 'nimi.nimi2d.codex-image2.layer-workflow-run',
    schema_version: 1,
    verdict: 'pass',
    quality_summary: qualitySummary,
    source: {
      file_sha256: sourceHash,
      surface: sourceSurface,
      ...(producerManifestRef ? { producer_manifest_path: producerManifestRef } : {}),
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
  if (producerManifestPath && producerRequestPath) {
    await writeYaml(producerRequestPath, {
      manifest_kind: 'nimi.nimi2d.codex-image2.request',
      schema_version: 1,
      workflow: {
        kind: 'image_to_layer_atlas',
      },
      inputs: {
        source_image_ref: 'inputs/source.png',
        source_image_sha256: overrides.underlying_source_hash,
      },
    });
    await writeYaml(producerManifestPath, {
      manifest_kind: 'nimi.nimi2d.codex-image2.artifact',
      schema_version: 1,
      verdict: 'admit',
      producer: {
        surface: sourceSurface,
        request: {
          path: producerRequestPath,
          sha256: 'test-request-sha',
        },
      },
      artifact: {
        file_sha256: sourceHash,
      },
    });
  }
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

test('Codex Image2 distribution report defaults to source-to-layer pipeline admission', async () => {
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
  assert.equal(report.gate_mode, 'source_to_layer_pipeline');
  assert.equal(report.summary.run_count, 3);
  assert.equal(report.summary.unique_source_sample_count, 2);
  assert.equal(report.summary.passing_run_count, 3);
  assert.equal(report.cases.find((item) => item.run_id === 'run-c').raw_provider_atlas_admission, 'fail');
  assert.equal(report.cases.find((item) => item.run_id === 'run-c').source_to_layer_pipeline, 'pass');
  assert.equal(report.cases.find((item) => item.run_id === 'run-c').mouth_bounds_px.width, 20);
});

test('Codex Image2 distribution report can fail on duplicate underlying source images', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'nimi2d-image2-distribution-underlying-'));
  const runsDir = path.join(tempDir, 'runs');
  await writeRun(runsDir, 'run-a', 'atlas-hash-a', 'codex_cli', { underlying_source_hash: 'source-image-hash-a' });
  await writeRun(runsDir, 'run-b', 'atlas-hash-b', 'codex_cli', { underlying_source_hash: 'source-image-hash-a' });

  const outPath = path.join(tempDir, 'distribution.yaml');
  const result = await runReport([
    '--runs-dir', runsDir,
    '--out', outPath,
    '--min-samples', '2',
    '--min-underlying-sources', '2',
  ]);
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout.decision.stop_class, 'insufficient_unique_underlying_sources');

  const report = await readYaml(outPath);
  assert.equal(report.summary.unique_source_sample_count, 2);
  assert.equal(report.summary.unique_underlying_source_sample_count, 1);
  assert.equal(report.summary.underlying_source_not_recorded_count, 0);
  assert.deepEqual(report.summary.duplicate_underlying_source_groups[0].run_ids, ['run-a', 'run-b']);
});

test('Codex Image2 distribution report keeps full-chain package proof as an explicit strict gate', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'nimi2d-image2-distribution-full-chain-'));
  const runsDir = path.join(tempDir, 'runs');
  await writeRun(runsDir, 'run-a', 'hash-a', 'codex_cli', {
    quality_summary: { layer_input_full_chain: 'pass' },
  });
  await writeRun(runsDir, 'run-b', 'hash-b', 'codex_cli', {
    quality_summary: { layer_input_full_chain: 'fail' },
  });

  const defaultOutPath = path.join(tempDir, 'distribution-default.yaml');
  const defaultResult = await runReport([
    '--runs-dir', runsDir,
    '--out', defaultOutPath,
    '--min-samples', '2',
  ]);
  assert.equal(defaultResult.exitCode, 0);
  const defaultReport = await readYaml(defaultOutPath);
  assert.equal(defaultReport.summary.passing_run_count, 2);
  assert.equal(defaultReport.cases.find((item) => item.run_id === 'run-b').source_to_layer_pipeline, 'pass');
  assert.equal(defaultReport.cases.find((item) => item.run_id === 'run-b').layer_input_full_chain, 'fail');

  const strictOutPath = path.join(tempDir, 'distribution-strict.yaml');
  const strictResult = await runReport([
    '--runs-dir', runsDir,
    '--out', strictOutPath,
    '--min-samples', '2',
    '--require-layer-input-full-chain',
  ]);
  assert.equal(strictResult.exitCode, 1);
  assert.equal(strictResult.stdout.decision.stop_class, 'sample_gate_failure');

  const strictReport = await readYaml(strictOutPath);
  assert.equal(strictReport.require_layer_input_full_chain, true);
  assert.equal(strictReport.summary.layer_input_full_chain_pass_count, 1);
  assert.equal(strictReport.summary.passing_run_count, 1);
});

test('Codex Image2 distribution report keeps raw provider atlas gate as diagnostic strict mode', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'nimi2d-image2-distribution-raw-gate-'));
  const runsDir = path.join(tempDir, 'runs');
  await writeRun(runsDir, 'run-a', 'hash-a');
  await writeRun(runsDir, 'run-b', 'hash-b');

  const outPath = path.join(tempDir, 'distribution.yaml');
  const result = await runReport([
    '--runs-dir', runsDir,
    '--out', outPath,
    '--min-samples', '2',
    '--gate-mode', 'raw_provider_atlas',
  ]);
  assert.equal(result.exitCode, 1);
  assert.equal(result.stdout.decision.stop_class, 'sample_gate_failure');

  const report = await readYaml(outPath);
  assert.equal(report.gate_mode, 'raw_provider_atlas');
  assert.equal(report.summary.passing_run_count, 0);
  assert.equal(report.cases[0].source_to_layer_pipeline, 'pass');
  assert.equal(report.cases[0].raw_provider_atlas_admission, 'fail');
});

test('Codex Image2 distribution report derives source-to-layer from explicit legacy repaired gates', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'nimi2d-image2-distribution-legacy-source-layer-'));
  const runsDir = path.join(tempDir, 'runs');
  await writeRun(runsDir, 'legacy-run', 'hash-a');
  const manifestPath = path.join(runsDir, 'legacy-run', 'codex-image2-layer-workflow.yaml');
  const manifest = await readYaml(manifestPath);
  manifest.verdict = 'fail';
  delete manifest.quality_summary.source_to_layer_pipeline;
  delete manifest.quality_summary.raw_provider_atlas_admission;
  manifest.quality_summary.formal_nimi2d_admission = 'fail';
  await writeYaml(manifestPath, manifest);

  const outPath = path.join(tempDir, 'distribution.yaml');
  const result = await runReport([
    '--runs-dir', runsDir,
    '--out', outPath,
    '--min-samples', '1',
  ]);
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout.decision.verdict, 'pass');

  const report = await readYaml(outPath);
  assert.equal(report.cases[0].source_to_layer_pipeline, 'pass');
  assert.equal(report.cases[0].raw_provider_atlas_admission, 'fail');
  assert.equal(report.cases[0].formal_nimi2d_admission, 'fail');
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
    '--gate-mode', 'formal_admission',
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
