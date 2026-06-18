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

async function readYaml(filePath) {
  return YAML.parse(await readFile(filePath, 'utf8'));
}

async function writeFixturePng(filePath, foreground = [80, 120, 190, 255]) {
  const width = 8;
  const height = 8;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < rgba.length; offset += 4) {
    rgba[offset] = 0;
    rgba[offset + 1] = 255;
    rgba[offset + 2] = 0;
    rgba[offset + 3] = 255;
  }
  for (let y = 2; y < 6; y += 1) {
    for (let x = 2; x < 6; x += 1) {
      const offset = ((y * width) + x) * 4;
      rgba[offset] = foreground[0];
      rgba[offset + 1] = foreground[1];
      rgba[offset + 2] = foreground[2];
      rgba[offset + 3] = foreground[3];
    }
  }
  await writeFile(filePath, encodePngRgba({ width, height, rgba }));
}

async function runCli(args) {
  const { stdout } = await execFileAsync(process.execPath, [cliPath, ...args], {
    cwd: packageRoot,
  });
  return JSON.parse(stdout);
}

async function runCliExpectReject(args) {
  try {
    await runCli(args);
    assert.fail('expected command to reject');
  } catch (error) {
    if (!error.stdout) throw error;
    return JSON.parse(error.stdout);
  }
}

test('Codex Image2 provider plans prompt-to-image and registers a consumed response artifact', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'nimi2d-image2-provider-'));
  const outDir = path.join(tempDir, 'plan');

  const planned = await runCli([
    'image2-provider-plan',
    '--workflow', 'prompt-to-image',
    '--description', 'front-facing fully clothed courier avatar with crisp hair and readable mouth',
    '--out-dir', outDir,
  ]);
  assert.equal(planned.status, 'ok');
  assert.equal(planned.workflow, 'prompt_to_image');

  const request = await readYaml(planned.requestPath);
  assert.equal(request.manifest_kind, 'nimi.nimi2d.codex-image2.request');
  assert.equal(request.workflow.kind, 'prompt_to_image');
  assert.equal(request.authority_boundary.formal_nimi2d_admission, 'layer_input_or_package_gates_only');
  const prompt = await readFile(planned.promptPath, 'utf8');
  assert.match(prompt, /Use Codex Image2 \/ Image Gen/);
  assert.match(prompt, /Required output image path:/);

  await writeFixturePng(planned.expectedImagePath);
  const responsePath = path.join(outDir, 'codex-response.json');
  await writeFile(responsePath, JSON.stringify({
    status: 'ok',
    image_path: planned.expectedImagePath,
    evidence_image_path: planned.expectedImagePath,
    summary: 'test harness consumed an already persisted PNG artifact',
    failure_reason: null,
  }, null, 2), 'utf8');

  const run = await runCli([
    'image2-provider-run',
    '--request', planned.requestPath,
    '--response-file', responsePath,
  ]);
  assert.equal(run.status, 'ok');
  assert.equal(run.artifactVerdict, 'admit');

  const artifact = await readYaml(run.artifactManifestPath);
  assert.equal(artifact.manifest_kind, 'nimi.nimi2d.codex-image2.artifact');
  assert.equal(artifact.producer.request.path, planned.requestPath);
  assert.equal(artifact.producer.model, undefined);
  assert.equal(artifact.producer.model_hint, 'gpt-image-2');
  assert.equal(artifact.producer.selected_model, null);
  assert.equal(artifact.evidence.pixel_identity.status, 'pass');
});

test('Codex Image2 provider records selected CLI model separately from request hint', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'nimi2d-image2-provider-model-truth-'));
  const outDir = path.join(tempDir, 'plan');

  const planned = await runCli([
    'image2-provider-plan',
    '--workflow', 'prompt-to-image',
    '--description', 'front-facing fully clothed courier avatar with crisp hair and readable mouth',
    '--out-dir', outDir,
  ]);
  await writeFixturePng(planned.expectedImagePath);
  const responsePath = path.join(outDir, 'codex-response.json');
  await writeFile(responsePath, JSON.stringify({
    status: 'ok',
    image_path: planned.expectedImagePath,
    evidence_image_path: planned.expectedImagePath,
    summary: 'test harness consumed an already persisted PNG artifact',
    failure_reason: null,
  }, null, 2), 'utf8');

  const run = await runCli([
    'image2-provider-run',
    '--request', planned.requestPath,
    '--response-file', responsePath,
    '--model', 'codex-image2-quality-test',
  ]);
  assert.equal(run.status, 'ok');
  assert.equal(run.artifactVerdict, 'admit');

  const artifact = await readYaml(run.artifactManifestPath);
  assert.equal(artifact.producer.model, undefined);
  assert.equal(artifact.producer.model_hint, 'gpt-image-2');
  assert.equal(artifact.producer.selected_model, 'codex-image2-quality-test');
  assert.equal(artifact.producer.selected_model_source, 'cli_argument');
});

test('Codex Image2 provider dry-run exposes codex exec image attachment for atlas workflow', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'nimi2d-image2-provider-atlas-'));
  const sourceImage = path.join(tempDir, 'source.png');
  await writeFixturePng(sourceImage);
  const outDir = path.join(tempDir, 'plan');

  const planned = await runCli([
    'image2-provider-plan',
    '--workflow', 'image-to-layer-atlas',
    '--image', sourceImage,
    '--description', 'preserve the courier design and produce the Nimi2D atlas',
    '--out-dir', outDir,
  ]);
  const request = await readYaml(planned.requestPath);
  assert.equal(request.inputs.source_image_ref, 'inputs/source.png');
  assert.equal(typeof request.inputs.source_image_sha256, 'string');
  assert.match(request.inputs.source_image_sha256, /^[0-9a-f]{64}$/);
  const dryRun = await runCli([
    'image2-provider-run',
    '--request', planned.requestPath,
    '--dry-run',
  ]);
  assert.equal(dryRun.status, 'ok');
  assert.equal(dryRun.mode, 'dry_run');
  assert.equal(dryRun.args.includes('exec'), true);
  assert.equal(dryRun.args.includes('--output-schema'), true);
  assert.equal(dryRun.args.includes('-i'), true);
  assert.equal(dryRun.args[dryRun.args.indexOf('-i') + 1], path.join(outDir, 'inputs', 'source.png'));
});

test('Codex Image2 provider rejects source image refs outside the provider directory', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'nimi2d-image2-provider-bad-source-ref-'));
  const sourceImage = path.join(tempDir, 'source.png');
  await writeFixturePng(sourceImage);
  const outDir = path.join(tempDir, 'plan');
  const planned = await runCli([
    'image2-provider-plan',
    '--workflow', 'image-to-layer-atlas',
    '--image', sourceImage,
    '--description', 'preserve the courier design and produce the Nimi2D atlas',
    '--out-dir', outDir,
  ]);
  const request = await readYaml(planned.requestPath);
  request.inputs.source_image_ref = '../source.png';
  await writeFile(planned.requestPath, YAML.stringify(request), 'utf8');

  const rejected = await runCliExpectReject([
    'image2-provider-run',
    '--request', planned.requestPath,
    '--dry-run',
  ]);
  assert.equal(rejected.status, 'error');
  assert.match(rejected.message, /NIMI2D_CODEX_IMAGE2_REQUEST_INVALID/);
  assert.match(rejected.message, /\$\.inputs\.source_image_ref/);
});

test('Codex Image2 provider rejects request artifact refs outside the provider directory', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'nimi2d-image2-provider-bad-request-'));
  const outDir = path.join(tempDir, 'plan');
  const planned = await runCli([
    'image2-provider-plan',
    '--workflow', 'prompt-to-image',
    '--description', 'front-facing fully clothed courier avatar with crisp hair and readable mouth',
    '--out-dir', outDir,
  ]);
  const request = await readYaml(planned.requestPath);
  request.artifacts.expected_image_ref = '../outside.png';
  await writeFile(planned.requestPath, YAML.stringify(request), 'utf8');

  const rejected = await runCliExpectReject([
    'image2-provider-run',
    '--request', planned.requestPath,
    '--dry-run',
  ]);
  assert.equal(rejected.status, 'error');
  assert.match(rejected.message, /NIMI2D_CODEX_IMAGE2_REQUEST_INVALID/);
  assert.match(rejected.message, /\$\.artifacts\.expected_image_ref/);
});

test('Codex Image2 provider rejects malformed response status before artifact registration', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'nimi2d-image2-provider-bad-response-'));
  const outDir = path.join(tempDir, 'plan');
  const planned = await runCli([
    'image2-provider-plan',
    '--workflow', 'prompt-to-image',
    '--description', 'front-facing fully clothed courier avatar with crisp hair and readable mouth',
    '--out-dir', outDir,
  ]);
  await writeFixturePng(planned.expectedImagePath);
  const responsePath = path.join(outDir, 'codex-response.json');
  await writeFile(responsePath, JSON.stringify({
    status: 'complete',
    image_path: planned.expectedImagePath,
    evidence_image_path: planned.expectedImagePath,
    summary: 'bad status should not be consumed',
    failure_reason: null,
  }, null, 2), 'utf8');

  const rejected = await runCliExpectReject([
    'image2-provider-run',
    '--request', planned.requestPath,
    '--response-file', responsePath,
  ]);
  assert.equal(rejected.status, 'error');
  assert.match(rejected.message, /NIMI2D_CODEX_IMAGE2_RESPONSE_INVALID/);
});

test('Codex Image2 provider rejects response image paths outside expected output ref', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'nimi2d-image2-provider-unexpected-path-'));
  const outDir = path.join(tempDir, 'plan');
  const planned = await runCli([
    'image2-provider-plan',
    '--workflow', 'prompt-to-image',
    '--description', 'front-facing fully clothed courier avatar with crisp hair and readable mouth',
    '--out-dir', outDir,
  ]);
  const alternateImagePath = path.join(tempDir, 'alternate.png');
  await writeFixturePng(planned.expectedImagePath);
  await writeFixturePng(alternateImagePath, [180, 40, 90, 255]);
  const responsePath = path.join(outDir, 'codex-response.json');
  await writeFile(responsePath, JSON.stringify({
    status: 'ok',
    image_path: alternateImagePath,
    evidence_image_path: alternateImagePath,
    summary: 'response pointed at an existing but unrequested PNG',
    failure_reason: null,
  }, null, 2), 'utf8');

  const rejected = await runCliExpectReject([
    'image2-provider-run',
    '--request', planned.requestPath,
    '--response-file', responsePath,
  ]);
  assert.equal(rejected.status, 'error');
  assert.match(rejected.message, /NIMI2D_CODEX_IMAGE2_UNEXPECTED_IMAGE_PATH/);
});

test('Codex Image2 provider rejects unknown companion slot taxonomy', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'nimi2d-image2-provider-invalid-slot-'));
  const rejected = await runCliExpectReject([
    'image2-provider-plan',
    '--workflow', 'companion-asset',
    '--description', 'small ribbon accessory',
    '--slot-kind', 'made_up_slot',
    '--out-dir', path.join(tempDir, 'plan'),
  ]);
  assert.equal(rejected.status, 'error');
  assert.match(rejected.message, /Unsupported Nimi2D slot kind/);
});

test('Codex Image2 register-output fails closed when pixel identity evidence mismatches', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'nimi2d-image2-provider-pixel-mismatch-'));
  const generatedPath = path.join(tempDir, 'generated.png');
  const evidencePath = path.join(tempDir, 'evidence.png');
  const manifestPath = path.join(tempDir, 'codex-image2.artifact.yaml');
  await writeFixturePng(generatedPath);
  await writeFixturePng(evidencePath, [180, 40, 90, 255]);

  const rejected = await runCliExpectReject([
    'image2-register-output',
    '--image', generatedPath,
    '--evidence-image', evidencePath,
    '--surface', 'codex_cli',
    '--out', manifestPath,
  ]);
  assert.equal(rejected.status, 'reject');
  assert.equal(rejected.verdict, 'reject');

  const manifest = await readYaml(manifestPath);
  assert.equal(manifest.verdict, 'reject');
  assert.equal(manifest.evidence.pixel_identity.status, 'fail');
});
