import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import YAML from 'yaml';

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(import.meta.dirname, '..');
const cliPath = path.join(packageRoot, 'bin/nimi2d.mjs');

async function readYaml(filePath) {
  return YAML.parse(await readFile(filePath, 'utf8'));
}

async function runCli(args) {
  const { stdout } = await execFileAsync(process.execPath, [cliPath, ...args], {
    cwd: packageRoot,
    maxBuffer: 1024 * 1024 * 8,
  });
  return JSON.parse(stdout);
}

test('Codex Image2 demo suite exercises all workflow families and unique atlas samples', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'nimi2d-image2-demo-suite-'));
  const outDir = path.join(tempDir, 'suite');

  const result = await runCli([
    'image2-demo-suite',
    '--out-dir', outDir,
    '--sample-count', '2',
    '--grid-size', '4',
  ]);

  assert.equal(result.status, 'ok');
  assert.equal(result.decision.verdict, 'pass');
  assert.equal(result.workflows.image_to_layer_atlas.sample_count, 2);
  assert.equal(result.workflows.image_to_layer_atlas.passing_count, 2);

  const suiteReport = await readYaml(result.suiteReportPath);
  assert.equal(suiteReport.manifest_kind, 'nimi.nimi2d.codex-image2.demo-suite-report');
  assert.equal(suiteReport.verdict, 'pass');
  assert.equal(suiteReport.workflows.prompt_to_image.verdict, 'admit');
  assert.equal(suiteReport.workflows.image_prompt_to_image.verdict, 'admit');
  assert.equal(suiteReport.workflows.companion_asset.verdict, 'admit');
  assert.equal(suiteReport.workflows.image_to_layer_atlas.repaired_workflow_passing_count, 2);
  assert.equal(suiteReport.workflows.image_to_layer_atlas.source_to_layer_pipeline_passing_count, 2);
  assert.equal(suiteReport.workflows.image_to_layer_atlas.formal_admission_passing_count, 2);
  assert.match(suiteReport.note, /must not be represented as live Codex Image2 generation/);

  const promptArtifact = await readYaml(suiteReport.workflows.prompt_to_image.artifact_manifest_path);
  assert.equal(promptArtifact.producer.surface, 'demo_fixture');
  assert.equal(promptArtifact.producer.family, 'codex_image2_demo_fixture');

  const distribution = await readYaml(result.distributionReportPath);
  assert.equal(distribution.manifest_kind, 'nimi.nimi2d.codex-image2.distribution-report');
  assert.equal(distribution.gate_mode, 'source_to_layer_pipeline');
  assert.equal(distribution.summary.run_count, 2);
  assert.equal(distribution.summary.unique_source_sample_count, 2);
  assert.equal(distribution.summary.passing_run_count, 2);
  assert.equal(distribution.summary.duplicate_source_groups.length, 0);
  assert.equal(distribution.cases.every((item) => item.source_surface === 'demo_fixture'), true);
});
