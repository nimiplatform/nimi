import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import YAML from 'yaml';

import { encodePngRgba } from '../src/node/png-rgba-encode.mjs';

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(import.meta.dirname, '..');
const cliPath = path.join(packageRoot, 'bin/nimi2d.mjs');
const promptPath = path.join(packageRoot, 'experiments/image-to-layer-input/prompts/codex-image2-layer-source-v1.md');

async function runNimi2D(args) {
  const { stdout } = await execFileAsync(process.execPath, [cliPath, ...args], {
    cwd: packageRoot,
  });
  return JSON.parse(stdout);
}

async function readYaml(filePath) {
  return YAML.parse(await readFile(filePath, 'utf8'));
}

async function writeFixturePng(filePath) {
  const width = 4;
  const height = 4;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < rgba.length; index += 4) {
    rgba[index] = 253;
    rgba[index + 1] = 253;
    rgba[index + 2] = 248;
    rgba[index + 3] = 255;
  }
  for (let y = 1; y <= 2; y += 1) {
    for (let x = 1; x <= 2; x += 1) {
      const offset = ((y * width) + x) * 4;
      rgba[offset] = 150;
      rgba[offset + 1] = 20;
      rgba[offset + 2] = 40;
      rgba[offset + 3] = 255;
    }
  }
  await writeFile(filePath, encodePngRgba({ width, height, rgba }));
}

test('Codex Image2 provider artifact commands register pixel-identical output and postprocess transparent crop', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'nimi2d-image2-artifact-'));
  const generatedPath = path.join(tempDir, 'generated.png');
  const evidencePath = path.join(tempDir, 'evidence.png');
  const comparePath = path.join(tempDir, 'pixel-identity.yaml');
  const manifestPath = path.join(tempDir, 'manifest.yaml');
  const transparentPath = path.join(tempDir, 'transparent.png');
  const postprocessReportPath = path.join(tempDir, 'postprocess.yaml');
  await writeFixturePng(generatedPath);
  await writeFixturePng(evidencePath);

  const compared = await runNimi2D([
    'image2-compare-pixels',
    '--left', generatedPath,
    '--right', evidencePath,
    '--out', comparePath,
  ]);
  assert.equal(compared.status, 'ok');
  assert.equal(compared.verdict, 'pass');
  const compareReport = await readYaml(comparePath);
  assert.equal(compareReport.comparison.diff_pixels, 0);
  assert.equal(compareReport.left.decoded_pixel_sha256, compareReport.right.decoded_pixel_sha256);

  const registered = await runNimi2D([
    'image2-register-output',
    '--image', generatedPath,
    '--evidence-image', evidencePath,
    '--prompt-file', promptPath,
    '--surface', 'codex_cli',
    '--source-note', 'unit test pixel-identical generated image',
    '--out', manifestPath,
  ]);
  assert.equal(registered.status, 'ok');
  assert.equal(registered.verdict, 'admit');
  const manifest = await readYaml(manifestPath);
  assert.equal(manifest.manifest_kind, 'nimi.nimi2d.codex-image2.artifact');
  assert.equal(manifest.schema_version, 1);
  assert.equal(manifest.producer.model, undefined);
  assert.equal(manifest.producer.model_hint, 'gpt-image-2');
  assert.equal(manifest.producer.selected_model, null);
  assert.equal(manifest.producer.selected_model_source, 'not_recorded');
  assert.equal(manifest.producer.auth_route, 'chatgpt_subscription');
  assert.equal(manifest.evidence.pixel_identity.status, 'pass');
  assert.equal(manifest.policy.rejected_persistence.includes('blank-canvas semantic redraw'), true);

  const postprocessed = await runNimi2D([
    'image2-postprocess',
    '--input', generatedPath,
    '--transparent-background', 'corner',
    '--tolerance', '0',
    '--crop-alpha',
    '--padding', '0',
    '--out', transparentPath,
    '--report', postprocessReportPath,
  ]);
  assert.equal(postprocessed.status, 'ok');
  const postprocessReport = await readYaml(postprocessReportPath);
  assert.equal(postprocessReport.verdict, 'ok');
  assert.equal(postprocessReport.output.width_px, 2);
  assert.equal(postprocessReport.output.height_px, 2);
  assert.equal(postprocessReport.operations.transparent_background.transparent_pixels_written, 12);
  assert.deepEqual(postprocessReport.operations.crop_alpha.crop_bounds_px, {
    x: 1,
    y: 1,
    width: 2,
    height: 2,
  });
  assert.equal(postprocessReport.alpha.output.visiblePixels, 4);
});
