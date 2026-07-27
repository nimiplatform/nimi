import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import YAML from 'yaml';

import { decodePngRgba } from '../src/node/png-rgba.mjs';
import { encodePngRgba } from '../src/node/png-rgba-encode.mjs';

const execFileAsync = promisify(execFile);
const packageRoot = path.resolve(import.meta.dirname, '..');
const cliPath = path.join(packageRoot, 'bin/nimi2d.mjs');
const workflowPath = path.join(packageRoot, 'experiments/image-to-layer-input/workflows/codex-image2-layer-workflow.mjs');

function setPixel(rgba, width, x, y, color) {
  const offset = ((y * width) + x) * 4;
  rgba[offset] = color[0];
  rgba[offset + 1] = color[1];
  rgba[offset + 2] = color[2];
  rgba[offset + 3] = color[3];
}

function fillRect(rgba, width, area, color) {
  for (let y = area.y; y < area.y + area.height; y += 1) {
    for (let x = area.x; x < area.x + area.width; x += 1) {
      setPixel(rgba, width, x, y, color);
    }
  }
}

function countTransparentPixels(image) {
  let count = 0;
  for (let offset = 3; offset < image.rgba.length; offset += 4) {
    if (image.rgba[offset] === 0) count += 1;
  }
  return count;
}

async function writeGeneratedLikeAtlas(filePath) {
  const cellWidth = 128;
  const cellHeight = 128;
  const width = cellWidth * 3;
  const height = cellHeight * 2;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      setPixel(rgba, width, x, y, [
        Math.floor((x / width) * 90),
        220 + Math.floor((y / height) * 25),
        Math.floor((y / height) * 80),
        255,
      ]);
    }
  }
  for (const x of [127, 128, 255, 256]) {
    fillRect(rgba, width, { x, y: 0, width: 1, height }, [248, 252, 248, 255]);
  }
  for (const y of [127, 128]) {
    fillRect(rgba, width, { x: 0, y, width, height: 1 }, [248, 252, 248, 255]);
  }

  const shapes = [
    { column: 0, row: 0, rect: { x: 48, y: 12, width: 32, height: 105 }, color: [140, 140, 140, 255] },
    { column: 1, row: 0, rect: { x: 42, y: 28, width: 44, height: 56 }, color: [236, 188, 150, 255] },
    { column: 2, row: 0, rect: { x: 34, y: 12, width: 60, height: 80 }, color: [176, 176, 198, 255] },
    { column: 0, row: 1, rect: { x: 42, y: 45, width: 44, height: 12 }, color: [30, 80, 140, 255] },
    { column: 1, row: 1, rect: { x: 54, y: 70, width: 20, height: 10 }, color: [180, 60, 80, 255] },
    { column: 2, row: 1, rect: { x: 34, y: 6, width: 60, height: 112 }, color: [40, 80, 150, 255] },
  ];
  for (const shape of shapes) {
    fillRect(rgba, width, {
      x: (shape.column * cellWidth) + shape.rect.x,
      y: (shape.row * cellHeight) + shape.rect.y,
      width: shape.rect.width,
      height: shape.rect.height,
    }, shape.color);
  }
  await writeFile(filePath, encodePngRgba({ width, height, rgba }));
}

async function readYaml(filePath) {
  return YAML.parse(await readFile(filePath, 'utf8'));
}

async function pathExists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function runWorkflowCli(args) {
  try {
    const { stdout } = await execFileAsync(process.execPath, [workflowPath, ...args], { cwd: packageRoot });
    return {
      exitStatus: 'ok',
      result: JSON.parse(stdout),
    };
  } catch (error) {
    return {
      exitStatus: 'error',
      result: JSON.parse(error.stdout),
    };
  }
}

async function runNimi2D(args) {
  const { stdout } = await execFileAsync(process.execPath, [cliPath, ...args], { cwd: packageRoot });
  return JSON.parse(stdout);
}

test('Codex Image2 layer workflow materializes and validates layers and package directly', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'nimi2d-image2-layer-workflow-'));
  const imagePath = path.join(tempDir, 'generated-atlas.png');
  const outDir = path.join(tempDir, 'run');
  await writeGeneratedLikeAtlas(imagePath);

  const { exitStatus, result } = await runWorkflowCli([
    '--image', imagePath,
    '--out-dir', outDir,
  ]);
  assert.equal(exitStatus, 'ok');
  assert.equal(result.status, 'ok');
  assert.equal(result.producerVerdict, 'not_recorded');
  assert.equal(result.layerAssetCount, 6);
  assert.equal(result.renderLayerCount, 6);
  assert.ok(result.transparentPixelCount > 0);
  const layerInput = await readYaml(result.layerInputManifestPath);
  assert.equal(layerInput.layers.length, 6);
  assert.equal(layerInput.layers.every((layer) => layer.asset.ref.startsWith('layers/')), true);
  const packageManifest = await readYaml(result.packageManifestPath);
  assert.equal(packageManifest.assets.length, 6);
  assert.equal(packageManifest.capability.proven_tier, 'tier-1_agent_basic');
  const transparentAtlas = await decodePngRgba(result.transparentAtlasPath);
  assert.ok(countTransparentPixels(transparentAtlas) > 0);
  assert.equal(await pathExists(path.join(outDir, 'quality')), false);
  assert.equal(await pathExists(path.join(outDir, 'codex-image2-layer-workflow.yaml')), false);
});

test('Codex Image2 layer workflow verifies and copies a registered provider artifact', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'nimi2d-image2-layer-workflow-producer-'));
  const imagePath = path.join(tempDir, 'generated-atlas.png');
  const producerManifestPath = path.join(tempDir, 'codex-image2.artifact.yaml');
  const outDir = path.join(tempDir, 'run');
  await writeGeneratedLikeAtlas(imagePath);

  const producerResult = await runNimi2D([
    'image2-register-output',
    '--image', imagePath,
    '--evidence-image', imagePath,
    '--surface', 'codex_cli',
    '--source-note', 'unit test pixel-identical atlas producer',
    '--out', producerManifestPath,
  ]);
  assert.equal(producerResult.verdict, 'admit');

  const { exitStatus, result } = await runWorkflowCli([
    '--producer-manifest', producerManifestPath,
    '--out-dir', outDir,
  ]);
  assert.equal(exitStatus, 'ok');
  assert.equal(result.status, 'ok');
  assert.equal(result.producerVerdict, 'admit');
  assert.match(result.producerManifestPath, /codex-image2-producer-manifest\.yaml$/);
  const copiedProducer = await readYaml(result.producerManifestPath);
  assert.equal(copiedProducer.manifest_kind, 'nimi.nimi2d.codex-image2.artifact');
  assert.equal(copiedProducer.verdict, 'admit');
  assert.equal(copiedProducer.artifact.file_sha256, result.sourceImageSha256);
  assert.equal((await readYaml(result.packageManifestPath)).capability.proven_tier, 'tier-1_agent_basic');
});

test('Codex Image2 layer workflow validates output from a registered-only artifact', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'nimi2d-image2-layer-workflow-recorded-only-'));
  const imagePath = path.join(tempDir, 'generated-atlas.png');
  const producerManifestPath = path.join(tempDir, 'codex-image2.artifact.yaml');
  const outDir = path.join(tempDir, 'run');
  await writeGeneratedLikeAtlas(imagePath);

  const producerResult = await runNimi2D([
    'image2-register-output',
    '--image', imagePath,
    '--surface', 'codex_cli',
    '--source-note', 'unit test artifact without pixel identity evidence',
    '--out', producerManifestPath,
  ]);
  assert.equal(producerResult.status, 'ok');
  assert.equal(producerResult.verdict, 'recorded_only');

  const { exitStatus, result } = await runWorkflowCli([
    '--producer-manifest', producerManifestPath,
    '--out-dir', outDir,
  ]);
  assert.equal(exitStatus, 'ok');
  assert.equal(result.status, 'ok');
  assert.equal(result.producerVerdict, 'recorded_only');
  const copiedProducer = await readYaml(result.producerManifestPath);
  assert.equal(copiedProducer.verdict, 'recorded_only');
  assert.equal(copiedProducer.evidence.pixel_identity.status, 'not_provided');
  assert.equal((await readYaml(result.packageManifestPath)).capability.proven_tier, 'tier-1_agent_basic');
});

test('Codex Image2 layer workflow refuses to clean a non-workflow output directory', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'nimi2d-image2-layer-workflow-safe-outdir-'));
  const imagePath = path.join(tempDir, 'generated-atlas.png');
  const unsafeOutDir = path.join(tempDir, 'existing-business-directory');
  const sentinelPath = path.join(unsafeOutDir, 'do-not-delete.txt');
  await writeGeneratedLikeAtlas(imagePath);
  await mkdir(unsafeOutDir, { recursive: true });
  await writeFile(sentinelPath, 'sentinel', 'utf8');

  const { exitStatus, result } = await runWorkflowCli([
    '--image', imagePath,
    '--out-dir', unsafeOutDir,
  ]);

  assert.equal(exitStatus, 'error');
  assert.equal(result.status, 'error');
  assert.match(result.message, /NIMI2D_IMAGE2_WORKFLOW_OUT_DIR_UNSAFE/);
  assert.equal(await pathExists(sentinelPath), true);
});

test('Codex Image2 layer workflow rejects producer manifests missing decoded pixel hash', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'nimi2d-image2-layer-workflow-missing-decoded-sha-'));
  const imagePath = path.join(tempDir, 'generated-atlas.png');
  const producerManifestPath = path.join(tempDir, 'codex-image2.artifact.yaml');
  const outDir = path.join(tempDir, 'run');
  await writeGeneratedLikeAtlas(imagePath);

  const producerResult = await runNimi2D([
    'image2-register-output',
    '--image', imagePath,
    '--evidence-image', imagePath,
    '--surface', 'codex_cli',
    '--source-note', 'unit test missing decoded pixel hash',
    '--out', producerManifestPath,
  ]);
  assert.equal(producerResult.verdict, 'admit');
  const manifest = await readYaml(producerManifestPath);
  delete manifest.artifact.decoded_pixel_sha256;
  await writeFile(producerManifestPath, YAML.stringify(manifest), 'utf8');

  const { exitStatus, result } = await runWorkflowCli([
    '--producer-manifest', producerManifestPath,
    '--out-dir', outDir,
  ]);
  assert.equal(exitStatus, 'error');
  assert.equal(result.status, 'error');
  assert.match(result.message, /NIMI2D_IMAGE2_PRODUCER_MANIFEST_INVALID/);
  assert.match(result.message, /artifact\.decoded_pixel_sha256/);
});

test('Codex Image2 layer workflow recomputes producer decoded pixel hash', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'nimi2d-image2-layer-workflow-bad-decoded-sha-'));
  const imagePath = path.join(tempDir, 'generated-atlas.png');
  const producerManifestPath = path.join(tempDir, 'codex-image2.artifact.yaml');
  const outDir = path.join(tempDir, 'run');
  await writeGeneratedLikeAtlas(imagePath);

  const producerResult = await runNimi2D([
    'image2-register-output',
    '--image', imagePath,
    '--evidence-image', imagePath,
    '--surface', 'codex_cli',
    '--source-note', 'unit test mismatched decoded pixel hash',
    '--out', producerManifestPath,
  ]);
  assert.equal(producerResult.verdict, 'admit');
  const manifest = await readYaml(producerManifestPath);
  manifest.artifact.decoded_pixel_sha256 = '0'.repeat(64);
  await writeFile(producerManifestPath, YAML.stringify(manifest), 'utf8');

  const { exitStatus, result } = await runWorkflowCli([
    '--producer-manifest', producerManifestPath,
    '--out-dir', outDir,
  ]);
  assert.equal(exitStatus, 'error');
  assert.equal(result.status, 'error');
  assert.match(result.message, /NIMI2D_IMAGE2_PRODUCER_ARTIFACT_MISMATCH/);
  assert.match(result.message, /decoded_pixel_sha256/);
});
