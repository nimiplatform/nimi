import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import YAML from 'yaml';

import {
  runGenerationBench,
  solvePackageFromLayerInput,
  validateBenchResult,
  validateLayerInput,
  validatePackageManifest,
  writeSolvedPackage,
} from '../src/index.mjs';

const rgbaPng = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360f8ffff3f0005fe02fea73581e30000000049454e44ae426082',
  'hex',
);

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

async function fixtureDir() {
  const dir = await mkdtemp(path.join(tmpdir(), 'nimi2d-'));
  await writeFile(path.join(dir, 'pixel.png'), rgbaPng);
  return dir;
}

function layer(id, labels) {
  return {
    layer_id: id,
    asset: {
      ref: 'pixel.png',
      sha256: sha256(rgbaPng),
      format: 'png',
      width_px: 1,
      height_px: 1,
      byte_size: rgbaPng.length,
      color_space: 'srgb',
      alpha_mode: 'straight',
      premultiplied_alpha: false,
    },
    placement_px: { x: 0, y: 0 },
    texture_bounds_px: { x: 0, y: 0, width: 1, height: 1 },
    visible_bounds_px: { x: 0, y: 0, width: 1, height: 1 },
    semantic_labels: labels,
    occlusion_fill: 'not_applicable',
  };
}

function baseLayerInput(overrides = {}) {
  const layers = [
    layer('layer_body', ['body']),
    layer('layer_head', ['head', 'face']),
    layer('layer_eye', ['eye']),
    layer('layer_mouth', ['mouth']),
    layer('layer_outfit', ['outfit']),
  ];
  return {
    manifest_kind: 'nimi.nimi2d.layer-input',
    schema_version: 1,
    input_id: 'n2d_layer_input_test_case',
    input_kind: 'character_skin',
    canvas: { width_px: 8, height_px: 8, background: 'transparent' },
    coordinate_space: { origin: 'top_left', unit: 'px', axis: 'x_right_y_down', overflow_policy: 'reject' },
    source_evidence: {
      layer_generation_ref: 'upstream_layer_generation_test',
      identity_preservation_ref: 'upstream_identity_test',
      content_admission_ref: 'upstream_content_test',
    },
    layers,
    draw_order: layers.map((item) => item.layer_id),
    global_anchor_hints: [
      'body_root',
      'neck_base',
      'head_center',
      'face_center',
      'left_eye_center',
      'right_eye_center',
      'mouth_center',
    ].map((kind, index) => ({
      anchor_id: `anchor_${kind}`,
      kind,
      point_px: { x: index % 2, y: index % 2 },
      source: 'upstream_manual',
    })),
    global_slot_hints: [
      'torso',
      'hip',
      'outfit_upper',
      'outfit_lower',
      'outfit_full',
    ].map((kind, index) => ({
      slot_hint_id: `slot_hint_${kind}`,
      kind,
      bounds_px: { x: index % 2, y: index % 2, width: 1, height: 1 },
      source: 'upstream_manual',
    })),
    ...overrides,
  };
}

async function writeYaml(dir, name, value) {
  const file = path.join(dir, name);
  await writeFile(file, YAML.stringify(value), 'utf8');
  return file;
}

test('validates strict layer input and rejects raw image fields', async () => {
  const dir = await fixtureDir();
  const validFile = await writeYaml(dir, 'layer-input.yaml', baseLayerInput());
  const valid = await validateLayerInput(validFile);
  assert.equal(valid.status, 'ok');

  const invalidFile = await writeYaml(dir, 'raw.yaml', baseLayerInput({ raw_image_ref: 'source.png' }));
  const invalid = await validateLayerInput(invalidFile);
  assert.equal(invalid.status, 'reject');
  assert.ok(invalid.codes.includes('NIMI2D_LAYER_INPUT_RAW_IMAGE_FORBIDDEN'));
});

test('solves a real tier-1 package from admitted character skin input', async () => {
  const dir = await fixtureDir();
  const inputFile = await writeYaml(dir, 'layer-input.yaml', baseLayerInput());
  const solved = await solvePackageFromLayerInput(inputFile);
  assert.equal(solved.status, 'ok');
  assert.equal(solved.manifest.base_body.renderable, false);
  assert.ok(solved.manifest.base_body.anchors.length > 0);
  assert.ok(solved.manifest.base_body.slots.length > 0);
  assert.equal(solved.manifest.wardrobe.assets[0].wardrobe_kind, 'default_outfit');
  assert.equal(solved.manifest.capability.requested_tier, 'tier-1_agent_basic');
  assert.equal(solved.manifest.capability.proven_tier, 'tier-1_agent_basic');
  assert.equal(solved.manifest.capability.channel_evidence.jaw_amplitude_mouth.status, 'proven');
  assert.equal(solved.manifest.capability.channel_evidence.aeiou_viseme_shapes.status, 'unsupported');
  assert.equal(solved.manifest.canvas.width_px, 8);
  assert.deepEqual(solved.manifest.render_layers.map((item) => item.layer_ref), [
    'layer_body',
    'layer_head',
    'layer_eye',
    'layer_mouth',
    'layer_outfit',
  ]);
  assert.deepEqual(solved.manifest.render_layers.map((item) => item.draw_order_index), [0, 1, 2, 3, 4]);
  assert.deepEqual(solved.manifest.render_layers[0].placement_px, { x: 0, y: 0 });
  assert.deepEqual(solved.manifest.assets[0], {
    asset_id: 'asset_layer_body',
    asset_kind: 'base_body_layer',
    ref: 'pixel.png',
    sha256: sha256(rgbaPng),
    format: 'png',
    width_px: 1,
    height_px: 1,
    byte_size: rgbaPng.length,
    color_space: 'srgb',
    alpha_mode: 'straight',
    premultiplied_alpha: false,
  });

  const outFile = path.join(dir, 'package.yaml');
  const written = await writeSolvedPackage(inputFile, outFile);
  assert.equal(written.status, 'ok');
  const packageResult = await validatePackageManifest(outFile);
  assert.equal(packageResult.status, 'ok');
});

test('can intentionally solve a tier-0 fallback package without tier-1 channel evidence', async () => {
  const dir = await fixtureDir();
  const inputFile = await writeYaml(dir, 'layer-input.yaml', baseLayerInput());
  const solved = await solvePackageFromLayerInput(inputFile, { requestedTier: 'tier-0_static_layered' });
  assert.equal(solved.status, 'ok');
  assert.equal(solved.manifest.capability.requested_tier, 'tier-0_static_layered');
  assert.equal(solved.manifest.capability.proven_tier, 'tier-0_static_layered');
  assert.equal(solved.manifest.capability.channel_evidence.jaw_amplitude_mouth, undefined);
});

test('package manifest validates asset bytes, metadata, and texture bounds', async () => {
  const dir = await fixtureDir();
  const inputFile = await writeYaml(dir, 'layer-input.yaml', baseLayerInput());
  const solved = await solvePackageFromLayerInput(inputFile);

  const hashMismatch = structuredClone(solved.manifest);
  hashMismatch.assets[0].sha256 = '0'.repeat(64);
  const hashFile = await writeYaml(dir, 'package-hash-mismatch.yaml', hashMismatch);
  const hashResult = await validatePackageManifest(hashFile);
  assert.equal(hashResult.status, 'reject');
  assert.ok(hashResult.codes.includes('NIMI2D_PACKAGE_ASSET_HASH_MISMATCH'));

  const metadataMismatch = structuredClone(solved.manifest);
  metadataMismatch.assets[0].width_px = 2;
  const metadataFile = await writeYaml(dir, 'package-metadata-mismatch.yaml', metadataMismatch);
  const metadataResult = await validatePackageManifest(metadataFile);
  assert.equal(metadataResult.status, 'reject');
  assert.ok(metadataResult.codes.includes('NIMI2D_PACKAGE_ASSET_METADATA_MISMATCH'));

  const boundsOutOfRange = structuredClone(solved.manifest);
  boundsOutOfRange.render_layers[0].texture_bounds_px = { x: 1, y: 0, width: 1, height: 1 };
  const boundsFile = await writeYaml(dir, 'package-bounds-out-of-range.yaml', boundsOutOfRange);
  const boundsResult = await validatePackageManifest(boundsFile);
  assert.equal(boundsResult.status, 'reject');
  assert.ok(boundsResult.codes.includes('NIMI2D_PACKAGE_RENDER_LAYER_TEXTURE_BOUNDS_OUT_OF_RANGE'));

  const masked = structuredClone(solved.manifest);
  masked.assets.push({
    asset_id: 'asset_mask_layer_body',
    asset_kind: 'alpha_mask_layer',
    ref: 'pixel.png',
    sha256: sha256(rgbaPng),
    format: 'png',
    width_px: 1,
    height_px: 1,
    byte_size: rgbaPng.length,
    color_space: 'srgb',
    alpha_mode: 'straight',
    premultiplied_alpha: false,
  });
  masked.render_layers[0].mask = {
    mask_kind: 'alpha_mask_asset',
    asset_id: 'asset_mask_layer_body',
    channel: 'alpha',
    texture_bounds_px: { x: 0, y: 0, width: 1, height: 1 },
  };
  const maskedFile = await writeYaml(dir, 'package-masked.yaml', masked);
  const maskedResult = await validatePackageManifest(maskedFile);
  assert.equal(maskedResult.status, 'ok');

  const missingMaskAsset = structuredClone(masked);
  missingMaskAsset.render_layers[0].mask.asset_id = 'asset_missing_mask';
  const missingMaskFile = await writeYaml(dir, 'package-missing-mask.yaml', missingMaskAsset);
  const missingMaskResult = await validatePackageManifest(missingMaskFile);
  assert.equal(missingMaskResult.status, 'reject');
  assert.ok(missingMaskResult.codes.includes('NIMI2D_PACKAGE_RENDER_LAYER_MASK_INVALID'));

  const wrongMaskKind = structuredClone(masked);
  wrongMaskKind.assets.find((asset) => asset.asset_id === 'asset_mask_layer_body').asset_kind = 'wardrobe_layer';
  const wrongMaskKindFile = await writeYaml(dir, 'package-wrong-mask-kind.yaml', wrongMaskKind);
  const wrongMaskKindResult = await validatePackageManifest(wrongMaskKindFile);
  assert.equal(wrongMaskKindResult.status, 'reject');
  assert.ok(wrongMaskKindResult.codes.includes('NIMI2D_PACKAGE_RENDER_LAYER_MASK_INVALID'));

  const maskSizeMismatch = structuredClone(masked);
  maskSizeMismatch.render_layers[0].texture_bounds_px = { x: 0, y: 0, width: 1, height: 1 };
  maskSizeMismatch.render_layers[0].mask.texture_bounds_px = { x: 0, y: 0, width: 2, height: 1 };
  const maskSizeMismatchFile = await writeYaml(dir, 'package-mask-size-mismatch.yaml', maskSizeMismatch);
  const maskSizeMismatchResult = await validatePackageManifest(maskSizeMismatchFile);
  assert.equal(maskSizeMismatchResult.status, 'reject');
  assert.ok(maskSizeMismatchResult.codes.includes('NIMI2D_PACKAGE_RENDER_LAYER_MASK_INVALID'));
});

test('rejects tier-1 true viseme overclaim in package manifest', async () => {
  const dir = await fixtureDir();
  const inputFile = await writeYaml(dir, 'layer-input.yaml', baseLayerInput());
  const solved = await solvePackageFromLayerInput(inputFile);
  const manifest = structuredClone(solved.manifest);
  manifest.capability.requested_tier = 'tier-1_agent_basic';
  manifest.capability.proven_tier = 'tier-1_agent_basic';
  manifest.capability.channel_evidence.aeiou_viseme_shapes = { status: 'proven' };
  const packageFile = await writeYaml(dir, 'package-overclaim.yaml', manifest);
  const result = await validatePackageManifest(packageFile);
  assert.equal(result.status, 'reject');
  assert.ok(result.codes.includes('NIMI2D_PACKAGE_TIER1_TRUE_VISEME_FORBIDDEN'));
});

test('bench result rejects missing selected case coverage', async () => {
  const dir = await fixtureDir();
  const resultFile = await writeYaml(dir, 'bench-result.yaml', {
    run_id: 'n2d_generation_bench_run_test',
    started_at: '2026-06-17T00:00:00Z',
    corpus: { corpus_id: 'n2d_generation_corpus_test', corpus_version: '0.0.0', corpus_digest_sha256: sha256(Buffer.from('corpus')) },
    generator: { generator_id: 'test', generator_version: '0.0.0', config_digest_sha256: sha256(Buffer.from('config')) },
    validator: { validator_id: 'test', validator_version: '0.0.0' },
    deterministic_replay: { seed: 1, environment_digest_sha256: sha256(Buffer.from('env')), command_ref: 'test' },
    selected_cases: ['n2d_case_a', 'n2d_case_b'],
    case_results: [{ case_id: 'n2d_case_a', split: 'certified_good_tier1', status: 'admitted', target_tier: 'tier-1_agent_basic', proven_tier: 'tier-1_agent_basic', package_manifest_ref: 'pkg', reject_codes: [], metrics: {}, failure_attribution: 'none' }],
    hard_gate_results: {},
    quality_gate_results: {},
    tracking_metrics: {},
    failure_attribution: {},
    decision: { verdict: 'no_go', reason: 'coverage test' },
  });
  const result = await validateBenchResult(resultFile);
  assert.equal(result.status, 'reject');
  assert.ok(result.codes.includes('NIMI2D_BENCH_RESULT_CASE_COVERAGE_INVALID'));
});

test('generation bench reports go when solver proves tier-1 channels from conformant layer input', async () => {
  const dir = await fixtureDir();
  await writeYaml(dir, 'layer-input.yaml', baseLayerInput());
  const corpusFile = await writeYaml(dir, 'corpus.yaml', {
    corpus_id: 'n2d_generation_corpus_test',
    corpus_version: '0.0.0',
    corpus_digest_sha256: sha256(Buffer.from('corpus')),
    frozen: true,
    created_at: '2026-06-17T00:00:00Z',
    case_splits: {
      certified_good_tier1: ['n2d_case_valid'],
      invalid_contract: [],
    },
    cases: [
      {
        case_id: 'n2d_case_valid',
        split: 'certified_good_tier1',
        layer_input_manifest_ref: 'layer-input.yaml',
        content_hash_sha256: sha256(Buffer.from('case')),
        expected_outcome: 'admit',
        target_tier: 'tier-1_agent_basic',
        source_evidence: {
          layer_generation_ref: 'upstream_layer_generation_test',
          identity_preservation_ref: 'upstream_identity_test',
          content_admission_ref: 'upstream_content_test',
        },
      },
    ],
  });

  const result = await runGenerationBench(corpusFile);
  assert.equal(result.status, 'ok');
  assert.equal(result.decision.verdict, 'go');
  assert.equal(result.result.quality_gate_results.expression_usability_rate.status, 'pass');
  assert.equal(result.result.quality_gate_results.jaw_amplitude_speech_mouth_usability_rate.status, 'pass');
  assert.equal(result.result.quality_gate_results.motion_primitive_binding_success_rate.status, 'pass');
});
