import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import YAML from 'yaml';
import { validatePackageAssets } from '../src/node/common-assets.mjs';
import { computeProvenTier } from '../src/node/package-capability.mjs';
import { rgbaPng, unverifiedCharacterPackage, wardrobePackage } from './package-fixture.mjs';

import {
  solvePackageFromLayerInput,
  validateLayerInput,
  validatePackageManifest,
  writeSolvedPackage,
} from '../src/index.mjs';

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
      'head',
      'face',
      'hair',
      'neck',
      'torso',
      'hip',
      'left_arm',
      'right_arm',
      'left_hand',
      'right_hand',
      'left_leg',
      'right_leg',
      'left_foot',
      'right_foot',
      'outfit_upper',
      'outfit_lower',
      'outfit_full',
      'accessory_head',
      'accessory_face',
      'accessory_hand',
      'prop_hand',
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

test('layer input rejects nested unknown fields', async () => {
  const dir = await fixtureDir();
  const manifest = baseLayerInput();
  manifest.layers[0].asset.generator_note = 'not admitted';
  const file = await writeYaml(dir, 'layer-input-nested-unknown.yaml', manifest);

  const result = await validateLayerInput(file);

  assert.equal(result.status, 'reject');
  assert.ok(result.issues.some((item) => item.path === '$.layers[0].asset.generator_note'));
  assert.ok(result.codes.includes('NIMI2D_LAYER_INPUT_MANIFEST_INVALID'));
});

test('complete layer hints cannot mint a character package or overwrite an output', async () => {
  const dir = await fixtureDir();
  const inputFile = await writeYaml(dir, 'layer-input.yaml', baseLayerInput());
  for (const requestedTier of ['tier-0_static_layered', 'tier-1_agent_basic']) {
    const solved = await solvePackageFromLayerInput(inputFile, { requestedTier });
    assert.equal(solved.status, 'reject');
    assert.ok(solved.codes.includes('NIMI2D_PACKAGE_TOPOLOGY_UNAVAILABLE'));
    assert.equal(solved.manifest, undefined);
  }
  const outFile = path.join(dir, 'package.yaml');
  const written = await writeSolvedPackage(inputFile, outFile);
  assert.equal(written.status, 'reject');
  await assert.rejects(access(outFile), { code: 'ENOENT' });
  await writeFile(outFile, 'existing user output');
  await writeSolvedPackage(inputFile, outFile);
  assert.equal(await readFile(outFile, 'utf8'), 'existing user output');
});

test('non-empty topology IDs cannot admit a character package', async () => {
  const dir = await fixtureDir();
  const file = await writeYaml(dir, 'unverified.yaml', await unverifiedCharacterPackage());
  const validation = await validatePackageManifest(file);
  assert.equal(validation.status, 'reject');
  assert.ok(validation.codes.includes('NIMI2D_PACKAGE_TOPOLOGY_UNAVAILABLE'));
});

test('package manifest validates asset bytes, metadata, and texture bounds', async () => {
  const dir = await fixtureDir();
  const solved = { manifest: await wardrobePackage() };

  const baselineFile = await writeYaml(dir, 'wardrobe.yaml', solved.manifest);
  const baseline = await validatePackageManifest(baselineFile);
  assert.equal(baseline.status, 'reject');
  assert.ok(baseline.codes.includes('NIMI2D_PACKAGE_PROVEN_TIER_UNVERIFIED'));
  const assetIssues = [];
  await validatePackageAssets(solved.manifest, dir, assetIssues);
  assert.deepEqual(assetIssues, []);

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
  assert.equal(maskedResult.status, 'reject');
  assert.deepEqual(maskedResult.codes, ['NIMI2D_PACKAGE_PROVEN_TIER_UNVERIFIED']);

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

test('package manifest rejects nested unknown fields', async () => {
  const dir = await fixtureDir();
  const solved = { manifest: await unverifiedCharacterPackage() };
  const manifest = structuredClone(solved.manifest);
  manifest.base_body.anchors[0].confidence = 1;
  const packageFile = await writeYaml(dir, 'package-nested-unknown.yaml', manifest);

  const result = await validatePackageManifest(packageFile);

  assert.equal(result.status, 'reject');
  assert.ok(result.issues.some((item) => item.path === '$.base_body.anchors[0].confidence'));
  assert.ok(result.codes.includes('NIMI2D_PACKAGE_MANIFEST_INVALID'));
});

test('rejects tier-1 true viseme overclaim in package manifest', async () => {
  const dir = await fixtureDir();
  const solved = { manifest: await unverifiedCharacterPackage() };
  const manifest = structuredClone(solved.manifest);
  manifest.capability.requested_tier = 'tier-1_agent_basic';
  manifest.capability.proven_tier = 'tier-1_agent_basic';
  manifest.capability.channel_evidence.aeiou_viseme_shapes = { status: 'proven' };
  const packageFile = await writeYaml(dir, 'package-overclaim.yaml', manifest);
  const result = await validatePackageManifest(packageFile);
  assert.equal(result.status, 'reject');
  assert.ok(result.codes.includes('NIMI2D_PACKAGE_TIER1_TRUE_VISEME_FORBIDDEN'));
});

test('solve rejects character skin input that lacks required base-body topology', async () => {
  const dir = await fixtureDir();
  const manifest = baseLayerInput();
  manifest.global_slot_hints = manifest.global_slot_hints.filter((hint) => !['head', 'prop_hand'].includes(hint.kind));
  const inputFile = await writeYaml(dir, 'layer-input-partial-topology.yaml', manifest);
  const solved = await solvePackageFromLayerInput(inputFile);
  assert.equal(solved.status, 'reject');
  assert.ok(solved.codes.includes('NIMI2D_PACKAGE_TOPOLOGY_UNAVAILABLE'));
  assert.equal(solved.manifest, undefined);
});

test('package manifest rejects base body missing a required resolved slot', async () => {
  const dir = await fixtureDir();
  const solved = { manifest: await unverifiedCharacterPackage() };
  const manifest = structuredClone(solved.manifest);
  manifest.base_body.slots = manifest.base_body.slots.filter((slot) => slot.kind !== 'prop_hand');
  const packageFile = await writeYaml(dir, 'package-missing-slot.yaml', manifest);
  const result = await validatePackageManifest(packageFile);
  assert.equal(result.status, 'reject');
  assert.ok(result.codes.includes('NIMI2D_PACKAGE_BASE_BODY_INVALID'));
  assert.ok(result.issues.some((item) => item.path === '$.base_body.slots' && item.message.includes('prop_hand')));
});

test('package manifest rejects proven channels without retained attestation', async () => {
  const dir = await fixtureDir();
  const solved = { manifest: await unverifiedCharacterPackage() };

  const bareTier0 = structuredClone(solved.manifest);
  bareTier0.capability.channel_evidence.static_draw_order = { status: 'proven' };
  const bareTier0File = await writeYaml(dir, 'package-bare-proven.yaml', bareTier0);
  const bareTier0Result = await validatePackageManifest(bareTier0File);
  assert.equal(bareTier0Result.status, 'reject');
  assert.ok(bareTier0Result.codes.includes('NIMI2D_PACKAGE_CAPABILITY_INVALID'));

  const fabricatedTier1 = structuredClone(solved.manifest);
  fabricatedTier1.capability.proven_tier = 'tier-1_agent_basic';
  for (const channel of ['wardrobe_reuse', 'discrete_expression_set', 'blink_eye_open_close', 'gaze_anchor_channels', 'jaw_amplitude_mouth', 'motion_primitive_refs', 'safe_motion_bounds']) {
    fabricatedTier1.capability.channel_evidence[channel] = { status: 'proven' };
  }
  const fabricatedFile = await writeYaml(dir, 'package-fabricated-tier1.yaml', fabricatedTier1);
  const fabricatedResult = await validatePackageManifest(fabricatedFile);
  assert.equal(fabricatedResult.status, 'reject');
  assert.ok(fabricatedResult.codes.includes('NIMI2D_PACKAGE_CAPABILITY_INVALID'));
});

test('package manifest rejects source fields outside the closed lineage set', async () => {
  const dir = await fixtureDir();
  const solved = { manifest: await unverifiedCharacterPackage() };
  const manifest = structuredClone(solved.manifest);
  manifest.source.validator_evidence_ref = 'n2d_validator_forged';
  const packageFile = await writeYaml(dir, 'package-forged-source.yaml', manifest);
  const result = await validatePackageManifest(packageFile);
  assert.equal(result.status, 'reject');
  assert.ok(result.codes.includes('NIMI2D_PACKAGE_MANIFEST_INVALID'));
  assert.ok(result.issues.some((item) => item.path === '$.source.validator_evidence_ref'));
});

test('package manifest rejects self-declared tier-3 without validator-owned verification', async () => {
  const dir = await fixtureDir();
  const solved = { manifest: await unverifiedCharacterPackage() };
  const manifest = structuredClone(solved.manifest);
  manifest.capability.requested_tier = 'tier-3_full_body_semantic';
  manifest.capability.proven_tier = 'tier-3_full_body_semantic';
  for (const channel of [
    'wardrobe_reuse',
    'discrete_expression_set',
    'expression_interpolation',
    'blink_eye_open_close',
    'gaze_anchor_channels',
    'jaw_amplitude_mouth',
    'aeiou_viseme_shapes',
    'motion_primitive_refs',
    'safe_motion_bounds',
    'gesture_overlay_channels',
    'local_attachment_secondary_motion',
    'full_body_pose_families',
    'full_body_gesture_primitives',
    'wardrobe_aware_deformation_masks',
  ]) {
    manifest.capability.channel_evidence[channel] = {
      status: 'proven',
      attestation: { evidence_ref: 'no-validation-was-performed' },
    };
  }
  const packageFile = await writeYaml(dir, 'package-unverified-tier3.yaml', manifest);
  const result = await validatePackageManifest(packageFile);
  assert.equal(result.status, 'reject');
  assert.ok(result.issues.some((item) => item.code === 'NIMI2D_PACKAGE_PROVEN_TIER_UNVERIFIED' && item.path === '$.capability.channel_evidence.full_body_gesture_primitives'));
});

test('package manifest rejects null or missing required topology references', async () => {
  const dir = await fixtureDir();
  const solved = { manifest: await unverifiedCharacterPackage() };

  const nulled = structuredClone(solved.manifest);
  nulled.base_body.morphology_profile_id = null;
  nulled.base_body.deformation_topology_id = null;
  nulled.base_body.action_topology_ref = null;
  const nulledFile = await writeYaml(dir, 'package-null-topology.yaml', nulled);
  const nulledResult = await validatePackageManifest(nulledFile);
  assert.equal(nulledResult.status, 'reject');
  assert.ok(nulledResult.codes.includes('NIMI2D_PACKAGE_BASE_BODY_INVALID'));
  assert.ok(nulledResult.issues.some((item) => item.path === '$.base_body.morphology_profile_id'));

  const missing = structuredClone(solved.manifest);
  delete missing.base_body.morphology_profile_id;
  delete missing.base_body.deformation_topology_id;
  delete missing.base_body.action_topology_ref;
  const missingFile = await writeYaml(dir, 'package-missing-topology.yaml', missing);
  const missingResult = await validatePackageManifest(missingFile);
  assert.equal(missingResult.status, 'reject');
  assert.ok(missingResult.codes.includes('NIMI2D_PACKAGE_BASE_BODY_INVALID'));
  assert.ok(missingResult.issues.some((item) => item.path === '$.base_body.morphology_profile_id'));
});

test('character layer hints need no outfit slot while wardrobe hints require one', async () => {
  const dir = await fixtureDir();
  const manifest = baseLayerInput();
  manifest.global_slot_hints = manifest.global_slot_hints.filter((hint) => !hint.kind.startsWith('outfit_'));
  const file = await writeYaml(dir, 'layer-input-no-outfit-slot.yaml', manifest);
  const result = await validateLayerInput(file);
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.codes, []);

  manifest.input_kind = 'wardrobe_item';
  manifest.global_anchor_hints = [{
    anchor_id: 'anchor_attachment_point', kind: 'attachment_point',
    point_px: { x: 0, y: 0 }, source: 'upstream_manual',
  }];
  const wardrobeFile = await writeYaml(dir, 'wardrobe-input-no-outfit-slot.yaml', manifest);
  const wardrobeResult = await validateLayerInput(wardrobeFile);
  assert.equal(wardrobeResult.status, 'reject');
  assert.ok(wardrobeResult.codes.includes('NIMI2D_LAYER_INPUT_SLOT_HINT_INVALID'));
});

test('a non-character package cannot count absent mandatory channels as proven', async () => {
  const dir = await fixtureDir();
  const manifest = await wardrobePackage();
  assert.equal(computeProvenTier(manifest), null);
  const file = await writeYaml(dir, 'wardrobe-unverified.yaml', manifest);
  const validation = await validatePackageManifest(file);
  assert.equal(validation.status, 'reject');
  assert.ok(validation.issues.some((item) => item.code === 'NIMI2D_PACKAGE_PROVEN_TIER_UNVERIFIED' && item.path === '$.capability.channel_evidence.base_body_topology'));
});

test('asset validation decodes PNG bodies and rejects unadmitted asset kinds', async () => {
  const dir = await fixtureDir();
  const manifest = await wardrobePackage();
  const truncated = rgbaPng.subarray(0, 33);
  await writeFile(path.join(dir, 'pixel.png'), truncated);
  manifest.assets[0].sha256 = sha256(truncated);
  manifest.assets[0].byte_size = truncated.length;
  const truncatedIssues = [];
  await validatePackageAssets(manifest, dir, truncatedIssues);
  assert.ok(truncatedIssues.some((item) => item.code === 'NIMI2D_PACKAGE_ASSET_FORMAT_UNSUPPORTED'));

  const input = baseLayerInput();
  for (const layer of input.layers) { layer.asset.sha256 = sha256(truncated); layer.asset.byte_size = truncated.length; }
  const inputFile = await writeYaml(dir, 'truncated-layer.yaml', input);
  const layerValidation = await validateLayerInput(inputFile);
  assert.equal(layerValidation.status, 'reject');
  assert.ok(layerValidation.codes.includes('NIMI2D_LAYER_INPUT_ASSET_FORMAT_UNSUPPORTED'));

  await writeFile(path.join(dir, 'pixel.png'), rgbaPng);
  const unknownKind = await wardrobePackage();
  unknownKind.assets[0].asset_kind = 'unadmitted_pixel_kind';
  unknownKind.render_layers[0].layer_kind = 'unadmitted_pixel_kind';
  const kindIssues = [];
  await validatePackageAssets(unknownKind, dir, kindIssues);
  assert.ok(kindIssues.some((item) => item.path === '$.assets[0].asset_kind'));
});
