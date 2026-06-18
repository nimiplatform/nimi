import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import YAML from 'yaml';

import { runAtlasQualityGate } from '../src/index.mjs';
import { encodePngRgba } from '../src/node/png-rgba-encode.mjs';

const cellSize = 64;
const key = [0, 255, 0, 255];
const layers = [
  ['layer_body', 0, 0, ['body', 'torso'], { x: 14, y: 5, width: 36, height: 54 }, [45, 45, 48, 255]],
  ['layer_head', 1, 0, ['head', 'face'], { x: 16, y: 8, width: 32, height: 40 }, [230, 178, 142, 255]],
  ['layer_hair', 2, 0, ['hair'], { x: 10, y: 4, width: 44, height: 20 }, [32, 30, 38, 255]],
  ['layer_eye', 0, 1, ['eye', 'brow'], { x: 10, y: 30, width: 44, height: 8 }, [30, 56, 84, 255]],
  ['layer_mouth', 1, 1, ['mouth'], { x: 12, y: 40, width: 40, height: 1 }, [148, 42, 70, 255]],
  ['layer_outfit', 2, 1, ['outfit'], { x: 14, y: 10, width: 36, height: 50 }, [48, 94, 180, 255]],
];

function setPixel(rgba, width, x, y, color) {
  const offset = ((y * width) + x) * 4;
  rgba[offset] = color[0];
  rgba[offset + 1] = color[1];
  rgba[offset + 2] = color[2];
  rgba[offset + 3] = color[3];
}

function fillRect(rgba, width, cellColumn, cellRow, bounds, color) {
  const originX = cellColumn * cellSize;
  const originY = cellRow * cellSize;
  for (let y = bounds.y; y < bounds.y + bounds.height; y += 1) {
    for (let x = bounds.x; x < bounds.x + bounds.width; x += 1) {
      setPixel(rgba, width, originX + x, originY + y, color);
    }
  }
}

async function writeThinMouthAtlas(dir) {
  const width = cellSize * 3;
  const height = cellSize * 2;
  const rgba = new Uint8ClampedArray(width * height * 4);
  for (let index = 0; index < rgba.length; index += 4) {
    rgba[index] = key[0];
    rgba[index + 1] = key[1];
    rgba[index + 2] = key[2];
    rgba[index + 3] = key[3];
  }
  for (const [, column, row, , visibleBounds, color] of layers) {
    fillRect(rgba, width, column, row, visibleBounds, color);
  }

  const atlasPath = path.join(dir, 'atlas.png');
  await writeFile(atlasPath, encodePngRgba({ width, height, rgba }));
  const layerContracts = layers.map(([layerId, column, row, semanticLabels, visibleBounds]) => ({
    layer_id: layerId,
    cell: { column, row },
    semantic_labels: semanticLabels,
    placement_px: { x: 0, y: 0 },
    texture_bounds_px: { x: 0, y: 0, width: cellSize, height: cellSize },
    visible_bounds_px: visibleBounds,
    occlusion_fill: 'not_applicable',
  }));
  const spec = {
    manifest_kind: 'nimi.nimi2d.image-input.layer-atlas',
    schema_version: 1,
    atlas_id: 'test_thin_mouth_atlas',
    atlas_image_ref: 'atlas.png',
    input_id: 'n2d_layer_input_test_thin_mouth_atlas',
    input_kind: 'character_skin',
    canvas: { width_px: cellSize, height_px: cellSize, background: 'transparent' },
    cell: {
      width_px: cellSize,
      height_px: cellSize,
      columns: 3,
      rows: 2,
      origin_px: { x: 0, y: 0 },
      gap_px: { x: 0, y: 0 },
    },
    background: {
      kind: 'chroma_key',
      chroma_key_rgb: key.slice(0, 3),
      tolerance: 0,
    },
    source_evidence: {
      layer_generation_ref: 'upstream.test.thin_mouth.layer_generation',
      identity_preservation_ref: 'upstream.test.thin_mouth.identity',
      content_admission_ref: 'upstream.test.thin_mouth.content',
    },
    layers: layerContracts,
    draw_order: layerContracts.map((layer) => layer.layer_id),
    global_anchor_hints: [
      ['body_root', { x: 32, y: 55 }],
      ['neck_base', { x: 32, y: 20 }],
      ['head_center', { x: 32, y: 28 }],
      ['face_center', { x: 32, y: 30 }],
      ['left_eye_center', { x: 24, y: 34 }],
      ['right_eye_center', { x: 40, y: 34 }],
      ['mouth_center', { x: 32, y: 40 }],
    ].map(([kind, point]) => ({
      anchor_id: `anchor_${kind}`,
      kind,
      point_px: point,
      source: 'test_thin_mouth_atlas',
    })),
    global_slot_hints: [
      ['torso', { x: 14, y: 20, width: 36, height: 32 }],
      ['hip', { x: 18, y: 42, width: 28, height: 12 }],
      ['outfit_upper', { x: 14, y: 10, width: 36, height: 25 }],
      ['outfit_lower', { x: 14, y: 35, width: 36, height: 25 }],
      ['outfit_full', { x: 14, y: 10, width: 36, height: 50 }],
    ].map(([kind, bounds]) => ({
      slot_hint_id: `slot_${kind}`,
      kind,
      bounds_px: bounds,
      source: 'test_thin_mouth_atlas',
    })),
  };
  const specPath = path.join(dir, 'atlas-spec.yaml');
  await writeFile(specPath, YAML.stringify(spec), 'utf8');
  return specPath;
}

test('atlas quality gate separates admission pass from upstream mouth quality failure', async () => {
  const outputDir = await mkdtemp(path.join(tmpdir(), 'nimi2d-atlas-quality-'));
  const atlasSpecPath = await writeThinMouthAtlas(outputDir);
  const reportPath = path.join(outputDir, 'quality-report.yaml');

  const result = await runAtlasQualityGate(atlasSpecPath, { outPath: reportPath });

  assert.equal(result.status, 'ok');
  assert.equal(result.decision.verdict, 'fail');
  assert.equal(result.result.hard_gate_results.declared_visible_bounds_match, 'pass');
  assert.equal(result.result.hard_gate_results.anchors_inside_measured_layer_bounds, 'pass');
  assert.equal(result.result.hard_gate_results.slots_overlap_measured_layer_bounds, 'pass');
  assert.equal(result.result.quality_gate_results.mouth_expressive_geometry.status, 'fail');
  assert.deepEqual(result.result.quality_gate_results.mouth_expressive_geometry.failures, ['height_below_threshold']);
  assert.deepEqual(result.result.failure_attribution, {
    upstream_image_quality: ['mouth_expressive_geometry'],
  });

  assert.equal(path.isAbsolute(result.result.atlas.atlas_spec_path), false);
});
