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

async function writeIndependentlyCenteredAtlas(filePath) {
  const cellWidth = 128;
  const cellHeight = 128;
  const width = cellWidth * 3;
  const height = cellHeight * 2;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < rgba.length; offset += 4) {
    rgba[offset] = 0;
    rgba[offset + 1] = 255;
    rgba[offset + 2] = 0;
    rgba[offset + 3] = 255;
  }

  const shapes = [
    { column: 0, row: 0, rect: { x: 52, y: 8, width: 24, height: 112 }, color: [140, 140, 140, 255] },
    { column: 1, row: 0, rect: { x: 28, y: 44, width: 72, height: 72 }, color: [236, 188, 150, 255] },
    { column: 2, row: 0, rect: { x: 24, y: 24, width: 80, height: 104 }, color: [176, 176, 198, 255] },
    { column: 0, row: 1, rect: { x: 30, y: 60, width: 68, height: 16 }, color: [30, 80, 140, 255] },
    { column: 1, row: 1, rect: { x: 44, y: 82, width: 40, height: 14 }, color: [180, 60, 80, 255] },
    { column: 2, row: 1, rect: { x: 34, y: 8, width: 60, height: 112 }, color: [40, 80, 150, 255] },
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

async function writeOversizedFeatureAtlas(filePath) {
  const cellWidth = 128;
  const cellHeight = 128;
  const width = cellWidth * 3;
  const height = cellHeight * 2;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < rgba.length; offset += 4) {
    rgba[offset] = 0;
    rgba[offset + 1] = 255;
    rgba[offset + 2] = 0;
    rgba[offset + 3] = 255;
  }

  const shapes = [
    { column: 0, row: 0, rect: { x: 36, y: 3, width: 56, height: 124 }, color: [140, 140, 140, 255] },
    { column: 1, row: 0, rect: { x: 32, y: 16, width: 64, height: 78 }, color: [236, 188, 150, 255] },
    { column: 2, row: 0, rect: { x: 26, y: 18, width: 76, height: 106 }, color: [176, 176, 198, 255] },
    { column: 0, row: 1, rect: { x: 36, y: 0, width: 56, height: 80 }, color: [30, 80, 140, 255] },
    { column: 1, row: 1, rect: { x: 52, y: 70, width: 24, height: 8 }, color: [180, 60, 80, 255] },
    { column: 2, row: 1, rect: { x: 34, y: 0, width: 60, height: 126 }, color: [40, 80, 150, 255] },
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

test('Codex Image2 layer workflow normalizes generated atlas and runs image-input gates', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'nimi2d-image2-layer-workflow-'));
  const imagePath = path.join(tempDir, 'generated-atlas.png');
  const outDir = path.join(tempDir, 'run');
  await writeGeneratedLikeAtlas(imagePath);

  const { exitStatus, result } = await runWorkflowCli([
    '--image', imagePath,
    '--out-dir', outDir,
    '--surface', 'codex_cli',
    '--grid-size', '4',
  ]);
  assert.equal(exitStatus, 'error');
  assert.equal(result.status, 'ok');
  assert.equal(result.verdict, 'fail');
  assert.equal(result.producerVerdict, 'not_recorded');
  assert.equal(result.upstreamQualityVerdict, 'fail');
  assert.equal(result.normalizedQualityVerdict, 'pass');
  assert.equal(result.atlasQualityVerdict, 'pass');
  assert.equal(result.transparentAtlasVerdict, 'pass');
  assert.equal(result.repairedWorkflowVerdict, 'pass');
  assert.equal(result.sourceToLayerPipelineVerdict, 'fail');
  assert.equal(result.rawProviderAtlasAdmissionVerdict, 'fail');
  assert.equal(result.formalAdmissionVerdict, 'fail');

  const manifest = await readYaml(result.manifestPath);
  assert.equal(manifest.verdict, 'fail');
  assert.equal(manifest.quality_summary.upstream_producer, 'not_recorded');
  assert.equal(manifest.quality_summary.repaired_workflow, 'pass');
  assert.equal(manifest.quality_summary.source_to_layer_pipeline, 'fail');
  assert.equal(manifest.quality_summary.raw_provider_atlas_admission, 'fail');
  assert.equal(manifest.quality_summary.formal_admission_model, 'raw_plus_repaired_evidence');
  assert.equal(manifest.quality_summary.formal_nimi2d_admission, 'fail');
  assert.equal(manifest.upstream_producer.verdict, 'not_recorded');
  assert.equal(manifest.upstream_quality.decision.verdict, 'fail');
  assert.equal(manifest.upstream_quality.gates.pure_chroma_key_background.status, 'fail');
  assert.equal(manifest.upstream_quality.gates.no_visible_grid_lines.status, 'fail');
  assert.equal(manifest.normalized_quality.decision.verdict, 'pass');
  assert.equal(manifest.normalized_quality.gates.pure_chroma_key_background.status, 'pass');
  assert.equal(manifest.normalized_quality.gates.no_visible_grid_lines.status, 'pass');
  assert.equal(manifest.atlas_quality.decision.verdict, 'pass');
  assert.equal(manifest.transparent_atlas.decision.verdict, 'pass');
  assert.equal(manifest.normalized_atlas.width_px, 384);
  assert.equal(manifest.normalized_atlas.height_px, 256);
  assert.equal(manifest.normalized_atlas.cell_width_px, 128);
  assert.equal(manifest.normalized_atlas.cell_height_px, 128);
  assert.equal(manifest.normalized_atlas.quality.cellStats.length, 6);
  assert.equal(manifest.workflow_bench.decision.verdict, 'pass');
  assert.match(manifest.outputs.layer_input_manifest_path, /layer-input\.yaml$/);
  const upstreamQuality = await readYaml(result.upstreamQualityReportPath);
  assert.equal(upstreamQuality.gates.facial_feature_registration.status, 'pass');
  assert.equal(upstreamQuality.gates.cell_foreground_present.status, 'pass');
  const normalizedQuality = await readYaml(result.normalizedQualityReportPath);
  assert.equal(normalizedQuality.gates.cell_foreground_retained.status, 'pass');
  const atlasQuality = await readYaml(result.atlasQualityReportPath);
  assert.equal(atlasQuality.hard_gate_results.declared_visible_bounds_match, 'pass');
  assert.equal(atlasQuality.hard_gate_results.anchors_inside_measured_layer_bounds, 'pass');
  assert.equal(atlasQuality.quality_gate_results.mouth_expressive_geometry.status, 'pass');
  const transparentAtlas = await decodePngRgba(result.transparentAtlasPath);
  assert.ok(countTransparentPixels(transparentAtlas) > 0);
});

test('Codex Image2 layer workflow admits source-to-layer pipeline from raw plus repaired provider evidence', async () => {
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
    '--grid-size', '4',
  ]);
  assert.equal(exitStatus, 'ok');
  assert.equal(result.status, 'ok');
  assert.equal(result.verdict, 'pass');
  assert.equal(result.producerVerdict, 'admit');
  assert.equal(result.qualitySummary.upstream_producer, 'admit');
  assert.equal(result.qualitySummary.repaired_workflow, 'pass');
  assert.equal(result.qualitySummary.raw_provider_atlas_admission, 'fail');
  assert.equal(result.qualitySummary.source_to_layer_pipeline, 'pass');
  assert.equal(result.qualitySummary.formal_admission_model, 'raw_plus_repaired_evidence');
  assert.equal(result.qualitySummary.formal_nimi2d_admission, 'pass');
  assert.equal(result.sourceToLayerPipelineVerdict, 'pass');
  assert.equal(result.rawProviderAtlasAdmissionVerdict, 'fail');
  assert.match(result.producerManifestPath, /codex-image2-producer-manifest\.yaml$/);

  const manifest = await readYaml(result.manifestPath);
  assert.equal(manifest.verdict, 'pass');
  assert.equal(manifest.source.surface, 'codex_cli');
  assert.equal(manifest.source.producer_manifest_path, result.producerManifestPath);
  assert.equal(manifest.upstream_producer.verdict, 'admit');
  assert.equal(manifest.upstream_producer.manifest_kind, 'nimi.nimi2d.codex-image2.artifact');
  assert.equal(manifest.upstream_producer.artifact.file_sha256, manifest.source.file_sha256);
  assert.equal(manifest.upstream_producer.evidence.pixel_identity_status, 'pass');
  assert.equal(manifest.upstream_producer.authority_boundary.includes('Provider evidence admits provenance, not raw-only package input'), true);
  assert.equal(manifest.quality_summary.atlas_quality, 'pass');
  assert.equal(manifest.admission_model.kind, 'raw_plus_repaired_evidence');
  assert.equal(manifest.admission_model.raw_atlas_quality_role, 'diagnostic_not_blocking_when_repaired_pipeline_passes');
  assert.equal(result.layerInputFullChainVerdict, 'pass');
  assert.match(manifest.outputs.layer_input_full_chain_report_path, /layer-input-full-chain-report\.yaml$/);
  assert.equal(manifest.layer_input_full_chain.status, 'ok');
  assert.equal(manifest.layer_input_full_chain.decision.verdict, 'pass');
  assert.equal(manifest.layer_input_full_chain.boundary.closes_production_avatar_readiness, false);
  const fullChain = await readYaml(manifest.outputs.layer_input_full_chain_report_path);
  assert.equal(fullChain.gates.layer_input_valid, 'pass');
  assert.equal(fullChain.gates.package_solved, 'pass');
  assert.equal(fullChain.gates.visual_proof_passed, 'pass');
  assert.equal(fullChain.gates.reference_action_passed, 'pass');
});

test('Codex Image2 layer workflow rejects atlas cells with independent semantic centering', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'nimi2d-image2-layer-workflow-misregistered-'));
  const imagePath = path.join(tempDir, 'independent-centering-atlas.png');
  const producerManifestPath = path.join(tempDir, 'codex-image2.artifact.yaml');
  const outDir = path.join(tempDir, 'run');
  await writeIndependentlyCenteredAtlas(imagePath);

  const producerResult = await runNimi2D([
    'image2-register-output',
    '--image', imagePath,
    '--evidence-image', imagePath,
    '--surface', 'codex_cli',
    '--source-note', 'unit test admitted provider atlas with independently centered semantic cells',
    '--out', producerManifestPath,
  ]);
  assert.equal(producerResult.verdict, 'admit');

  const { exitStatus, result } = await runWorkflowCli([
    '--producer-manifest', producerManifestPath,
    '--out-dir', outDir,
    '--grid-size', '4',
  ]);
  assert.equal(exitStatus, 'error');
  assert.equal(result.status, 'ok');
  assert.equal(result.verdict, 'fail');
  assert.equal(result.producerVerdict, 'admit');
  assert.equal(result.normalizedQualityVerdict, 'fail');
  assert.equal(result.repairedWorkflowVerdict, 'fail');
  assert.equal(result.sourceToLayerPipelineVerdict, 'fail');
  assert.equal(result.formalAdmissionVerdict, 'fail');

  const manifest = await readYaml(result.manifestPath);
  assert.equal(manifest.normalized_quality.gates.shared_avatar_registration.status, 'fail');
  assert.equal(manifest.normalized_quality.gates.shared_avatar_registration.metrics.head_center_body_y_ratio > 0.55, true);
  assert.equal(manifest.quality_summary.source_to_layer_pipeline, 'fail');
});

test('Codex Image2 layer workflow rejects oversized facial feature layers', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'nimi2d-image2-layer-workflow-oversized-feature-'));
  const imagePath = path.join(tempDir, 'oversized-feature-atlas.png');
  const producerManifestPath = path.join(tempDir, 'codex-image2.artifact.yaml');
  const outDir = path.join(tempDir, 'run');
  await writeOversizedFeatureAtlas(imagePath);

  const producerResult = await runNimi2D([
    'image2-register-output',
    '--image', imagePath,
    '--evidence-image', imagePath,
    '--surface', 'codex_cli',
    '--source-note', 'unit test admitted provider atlas with oversized eyes layer',
    '--out', producerManifestPath,
  ]);
  assert.equal(producerResult.verdict, 'admit');

  const { exitStatus, result } = await runWorkflowCli([
    '--producer-manifest', producerManifestPath,
    '--out-dir', outDir,
    '--grid-size', '4',
  ]);
  assert.equal(exitStatus, 'error');
  assert.equal(result.status, 'ok');
  assert.equal(result.verdict, 'fail');
  assert.equal(result.normalizedQualityVerdict, 'fail');
  assert.equal(result.repairedWorkflowVerdict, 'fail');
  assert.equal(result.formalAdmissionVerdict, 'fail');

  const manifest = await readYaml(result.manifestPath);
  const registration = manifest.normalized_quality.gates.shared_avatar_registration;
  assert.equal(registration.status, 'fail');
  assert.equal(registration.metrics.failures.includes('eye_feature_layer_too_tall'), true);
  assert.equal(registration.metrics.eye_height_head_ratio > 0.75, true);
});

test('Codex Image2 layer workflow treats provider artifacts without pixel identity as recorded-only evidence', async () => {
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
    '--grid-size', '4',
  ]);
  assert.equal(exitStatus, 'error');
  assert.equal(result.status, 'ok');
  assert.equal(result.verdict, 'fail');
  assert.equal(result.producerVerdict, 'recorded_only');
  assert.equal(result.qualitySummary.upstream_producer, 'recorded_only');
  assert.equal(result.qualitySummary.repaired_workflow, 'pass');
  assert.equal(result.qualitySummary.source_to_layer_pipeline, 'fail');
  assert.equal(result.qualitySummary.raw_provider_atlas_admission, 'fail');
  assert.equal(result.qualitySummary.formal_nimi2d_admission, 'fail');

  const manifest = await readYaml(result.manifestPath);
  assert.equal(manifest.upstream_producer.verdict, 'recorded_only');
  assert.equal(manifest.upstream_producer.evidence.pixel_identity_status, 'not_provided');
  assert.equal(manifest.quality_summary.source_to_layer_pipeline, 'fail');
  assert.equal(manifest.quality_summary.formal_nimi2d_admission, 'fail');
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
    '--surface', 'codex_cli',
    '--grid-size', '4',
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
    '--grid-size', '4',
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
    '--grid-size', '4',
  ]);
  assert.equal(exitStatus, 'error');
  assert.equal(result.status, 'error');
  assert.match(result.message, /NIMI2D_IMAGE2_PRODUCER_ARTIFACT_MISMATCH/);
  assert.match(result.message, /decoded_pixel_sha256/);
});
