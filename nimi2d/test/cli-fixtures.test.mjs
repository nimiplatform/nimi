import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { copyFile, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(import.meta.dirname, '..');
const cliPath = path.join(packageRoot, 'bin/nimi2d.mjs');
const fixtureDir = path.join(packageRoot, 'fixtures/basic-character');
const layerInputPath = path.join(fixtureDir, 'layer-input.yaml');

async function runCli(args) {
  const { stdout } = await execFileAsync(process.execPath, [cliPath, ...args], {
    cwd: packageRoot,
  });
  return JSON.parse(stdout);
}

test('CLI runs direct layer, package, render, visual, and action owner commands', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'nimi2d-cli-'));
  const packagePath = path.join(tempDir, 'package.yaml');
  await copyFile(path.join(fixtureDir, 'pixel.png'), path.join(tempDir, 'pixel.png'));

  const layerValidation = await runCli(['validate-layer-input', layerInputPath]);
  assert.equal(layerValidation.status, 'ok');

  const solved = await runCli(['solve-package', layerInputPath, '--out', packagePath]);
  assert.equal(solved.status, 'ok');
  assert.equal(solved.outPath, packagePath);

  const packageValidation = await runCli(['validate-package', packagePath]);
  assert.equal(packageValidation.status, 'ok');

  const renderPlan = await runCli(['render-plan', packagePath]);
  assert.equal(renderPlan.status, 'ok');
  assert.deepEqual(renderPlan.renderPlan.renderLayers.map((layer) => layer.layerRef), [
    'layer_body',
    'layer_head',
    'layer_eye',
    'layer_mouth',
    'layer_outfit',
  ]);

  const visualProof = await runCli(['prove-visual-frame', packagePath, '--grid-size', '2']);
  assert.equal(visualProof.status, 'ok');
  assert.equal(visualProof.stats.visiblePixels, 4);
  assert.equal(visualProof.stats.defaultOutfitVisiblePixels, 4);

  const referenceBench = await runCli(['run-reference-action-bench', packagePath]);
  assert.equal(referenceBench.status, 'ok');
  assert.equal(referenceBench.kind, 'reference_action_bench_run');
  assert.equal(referenceBench.result.verdict, 'pass_minimal_tier1');
  const referenceStress = await runCli(['run-reference-action-stress', packagePath]);
  assert.equal(referenceStress.status, 'ok');
  assert.equal(referenceStress.kind, 'reference_action_stress_run');
  assert.equal(referenceStress.result.verdict, 'pass_stream_stress_tier1');
  assert.equal(referenceStress.result.metrics.rejectedInvalidEventCount, 1);

});
