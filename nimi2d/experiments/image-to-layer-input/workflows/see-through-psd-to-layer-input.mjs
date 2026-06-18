#!/usr/bin/env node
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';

import { LAYER_MANIFEST_KIND } from '../../../src/node/common-constants.mjs';
import { sha256 } from '../../../src/node/common-utils.mjs';
import { decodePngRgba } from '../../../src/node/png-rgba.mjs';

function usage() {
  return [
    'Usage:',
    '  node nimi2d/experiments/image-to-layer-input/workflows/see-through-psd-to-layer-input.mjs \\',
    '    --run-dir <see-through-run-dir> --out <output-dir>',
  ].join('\n');
}

function getFlag(args, name) {
  const index = args.indexOf(name);
  return index === -1 ? null : (args[index + 1] ?? null);
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'layer';
}

function rectFromLayer(layer) {
  const local = layer.visible_bounds_local;
  return {
    x: layer.left + local.x,
    y: layer.top + local.y,
    width: local.width,
    height: local.height,
  };
}

function rectArea(rect) {
  return Math.max(0, rect?.width ?? 0) * Math.max(0, rect?.height ?? 0);
}

function mergeRects(rects) {
  const valid = rects.filter(Boolean);
  if (valid.length === 0) return null;
  const minX = Math.min(...valid.map((rect) => rect.x));
  const minY = Math.min(...valid.map((rect) => rect.y));
  const maxX = Math.max(...valid.map((rect) => rect.x + rect.width));
  const maxY = Math.max(...valid.map((rect) => rect.y + rect.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function center(rect) {
  return {
    x: Math.round(rect.x + rect.width / 2),
    y: Math.round(rect.y + rect.height / 2),
  };
}

function clampRect(rect, canvas) {
  const x = Math.max(0, Math.min(canvas.width_px - 1, Math.round(rect.x)));
  const y = Math.max(0, Math.min(canvas.height_px - 1, Math.round(rect.y)));
  const maxWidth = canvas.width_px - x;
  const maxHeight = canvas.height_px - y;
  return {
    x,
    y,
    width: Math.max(1, Math.min(maxWidth, Math.round(rect.width))),
    height: Math.max(1, Math.min(maxHeight, Math.round(rect.height))),
  };
}

function splitRect(rect, side) {
  const half = Math.max(1, Math.floor(rect.width / 2));
  if (side === 'left') return { x: rect.x, y: rect.y, width: half, height: rect.height };
  return { x: rect.x + half, y: rect.y, width: Math.max(1, rect.width - half), height: rect.height };
}

const semanticBySeeThroughName = new Map([
  ['back hair', ['hair']],
  ['front hair', ['hair']],
  ['headwear', ['accessory']],
  ['face', ['head', 'face']],
  ['eyebrow', ['brow']],
  ['eyelash', ['eye']],
  ['irides', ['eye']],
  ['eyewhite', ['eye']],
  ['ears', ['ear']],
  ['nose', ['nose']],
  ['mouth', ['mouth']],
  ['neck', ['neck', 'body', 'torso']],
  ['neckwear', ['outfit', 'accessory']],
  ['topwear', ['outfit']],
  ['bottomwear', ['outfit']],
  ['legwear', ['outfit', 'leg']],
  ['footwear', ['outfit', 'foot']],
  ['handwear', ['outfit', 'arm', 'hand']],
]);

function labelsFor(name) {
  const labels = semanticBySeeThroughName.get(name);
  if (!labels) {
    throw new Error(`No Nimi2D semantic mapping for see-through layer "${name}".`);
  }
  return labels;
}

function bySemantic(layers, labels) {
  return layers.filter((layer) => layer.semantic_labels.some((label) => labels.includes(label)));
}

function mergedSemanticBounds(layers, labels) {
  return mergeRects(bySemantic(layers, labels).map((layer) => layer.visible_bounds_global));
}

function layerIdFor(name, existing) {
  let candidate = `layer_${slug(name)}`;
  let suffix = 2;
  while (existing.has(candidate)) {
    candidate = `layer_${slug(name)}_${suffix}`;
    suffix += 1;
  }
  existing.add(candidate);
  return candidate;
}

function assetManifest(ref, bytes, pngInfo) {
  return {
    ref,
    sha256: sha256(bytes),
    format: 'png',
    width_px: pngInfo.width,
    height_px: pngInfo.height,
    byte_size: bytes.length,
    color_space: 'srgb',
    alpha_mode: 'straight',
    premultiplied_alpha: false,
  };
}

function geometryGate({ name, bounds, pixels, minWidth, minHeight, minPixels }) {
  const failures = [];
  if (!bounds) failures.push('missing_visible_bounds');
  if (bounds && bounds.width < minWidth) failures.push('width_below_threshold');
  if (bounds && bounds.height < minHeight) failures.push('height_below_threshold');
  if (pixels < minPixels) failures.push('visible_pixels_below_threshold');
  return {
    status: failures.length === 0 ? 'pass' : 'fail',
    name,
    measured_bounds_px: bounds,
    measured_visible_pixels: pixels,
    thresholds: {
      min_width_px: minWidth,
      min_height_px: minHeight,
      min_visible_pixels: minPixels,
    },
    failures,
  };
}

function directQualityReport({ runDir, outputDir, canvas, layers, psdJson, meta }) {
  const mouth = bySemantic(layers, ['mouth']);
  const eyes = bySemantic(layers, ['eye']);
  const body = bySemantic(layers, ['body', 'torso']);
  const outfit = bySemantic(layers, ['outfit']);
  const qualityGateResults = {
    mouth_expressive_geometry: geometryGate({
      name: 'mouth_expressive_geometry',
      bounds: mergedSemanticBounds(layers, ['mouth']),
      pixels: mouth.reduce((total, layer) => total + layer.visible_pixels, 0),
      minWidth: Math.max(16, Math.ceil(canvas.width_px * 0.08)),
      minHeight: Math.max(8, Math.ceil(canvas.height_px * 0.025)),
      minPixels: Math.max(32, Math.ceil(canvas.width_px * canvas.height_px * 0.00035)),
    }),
    eye_readability_geometry: geometryGate({
      name: 'eye_readability_geometry',
      bounds: mergedSemanticBounds(layers, ['eye']),
      pixels: eyes.reduce((total, layer) => total + layer.visible_pixels, 0),
      minWidth: Math.max(24, Math.ceil(canvas.width_px * 0.16)),
      minHeight: Math.max(6, Math.ceil(canvas.height_px * 0.025)),
      minPixels: Math.max(48, Math.ceil(canvas.width_px * canvas.height_px * 0.001)),
    }),
    body_geometry: geometryGate({
      name: 'body_geometry',
      bounds: mergedSemanticBounds(layers, ['body', 'torso']),
      pixels: body.reduce((total, layer) => total + layer.visible_pixels, 0),
      minWidth: Math.max(32, Math.ceil(canvas.width_px * 0.16)),
      minHeight: Math.max(48, Math.ceil(canvas.height_px * 0.5)),
      minPixels: Math.max(256, Math.ceil(canvas.width_px * canvas.height_px * 0.03)),
    }),
    outfit_geometry: geometryGate({
      name: 'outfit_geometry',
      bounds: mergedSemanticBounds(layers, ['outfit']),
      pixels: outfit.reduce((total, layer) => total + layer.visible_pixels, 0),
      minWidth: Math.max(32, Math.ceil(canvas.width_px * 0.16)),
      minHeight: Math.max(48, Math.ceil(canvas.height_px * 0.45)),
      minPixels: Math.max(256, Math.ceil(canvas.width_px * canvas.height_px * 0.03)),
    }),
  };
  const failedQuality = Object.entries(qualityGateResults)
    .filter(([, value]) => value.status === 'fail')
    .map(([key]) => key);
  const emptySourceLayers = meta.layers
    .filter((layer) => layer.visible_pixels === 0)
    .map((layer) => layer.name);
  const tightEdges = layers
    .filter((layer) => {
      const bounds = layer.visible_bounds_px;
      return bounds.x === 0
        || bounds.y === 0
        || bounds.x + bounds.width >= layer.asset.width_px
        || bounds.y + bounds.height >= layer.asset.height_px;
    })
    .map((layer) => layer.layer_id);
  return {
    run_id: 'n2d_see_through_direct_layer_quality_primary_anime_fullbody_001',
    source: {
      upstream: 'see-through',
      run_dir: path.relative(outputDir, runDir).replaceAll('\\', '/'),
      psd: path.relative(outputDir, meta.psd).replaceAll('\\', '/'),
      depth_psd: path.relative(outputDir, meta.depth_psd).replaceAll('\\', '/'),
      psd_json: path.relative(outputDir, meta.psd_json).replaceAll('\\', '/'),
      psd_json_frame_size: psdJson.frame_size,
      extracted_layer_count: meta.layers.length,
      admitted_layer_count: layers.length,
    },
    layer_measurements: layers.map((layer) => ({
      layer_id: layer.layer_id,
      see_through_name: layer.source_see_through_name,
      semantic_labels: layer.semantic_labels,
      placement_px: layer.placement_px,
      texture_bounds_px: layer.texture_bounds_px,
      visible_bounds_px: layer.visible_bounds_px,
      visible_bounds_global_px: layer.visible_bounds_global,
      visible_pixels: layer.visible_pixels,
      touches_local_edge: tightEdges.includes(layer.layer_id),
    })),
    hard_gate_observations: {
      source_psd_json_present: 'pass',
      extracted_rgba_layers_present: layers.length > 0 ? 'pass' : 'fail',
      source_empty_layers_excluded: emptySourceLayers.length === 0 ? 'pass' : 'warn',
      source_empty_layer_names: emptySourceLayers,
      all_layers_have_semantic_mapping: 'pass',
      direct_layer_contract_written: 'pass',
    },
    quality_gate_results: qualityGateResults,
    failure_attribution: failedQuality.length > 0
      ? { upstream_layer_quality: failedQuality }
      : {},
    notes: [
      'This report measures direct see-through PSD layers; it is not an atlas quality gate.',
      'Validator success only proves contract shape and asset integrity.',
      'Mouth, eye, and body failures are upstream output quality or semantic coverage failures.',
    ],
    decision: {
      verdict: failedQuality.length === 0 ? 'pass' : 'fail',
      reason: failedQuality.length === 0
        ? 'Direct see-through layer quality gates passed.'
        : 'One or more direct see-through layer quality gates failed; see failure_attribution.',
    },
  };
}

function writeSingleCaseCorpus({ outputDir, contentHashSha256, sourceEvidence }) {
  const corpus = {
    corpus_id: 'n2d_generation_corpus_see_through_primary_anime_fullbody_001',
    corpus_version: '0.0.0',
    corpus_digest_sha256: sha256(JSON.stringify({
      source: 'see-through',
      layer_input_hash: contentHashSha256,
    })),
    frozen: true,
    created_at: '2026-06-18T00:00:00Z',
    case_splits: {
      certified_good_tier1: ['n2d_case_see_through_primary_anime_fullbody_001'],
      invalid_contract: [],
    },
    cases: [
      {
        case_id: 'n2d_case_see_through_primary_anime_fullbody_001',
        split: 'certified_good_tier1',
        layer_input_manifest_ref: 'layer-input.yaml',
        content_hash_sha256: contentHashSha256,
        expected_outcome: 'admit',
        target_tier: 'tier-1_agent_basic',
        source_evidence: sourceEvidence,
        distribution_tags: ['see_through', 'single_image_layer_decomposition', 'psd_layers'],
      },
    ],
  };
  return writeFile(path.join(outputDir, 'corpus.yaml'), YAML.stringify(corpus), 'utf8').then(() => corpus);
}

async function main() {
  const args = process.argv.slice(2);
  const runDir = getFlag(args, '--run-dir');
  const outDir = getFlag(args, '--out');
  if (!runDir || !outDir) {
    process.stderr.write(`${usage()}\n`);
    process.exitCode = 2;
    return;
  }

  const absoluteRunDir = path.resolve(runDir);
  const absoluteOutDir = path.resolve(outDir);
  const metaPath = path.join(absoluteRunDir, 'extracted-psd-layers.json');
  const meta = JSON.parse(await readFile(metaPath, 'utf8'));
  const psdJson = JSON.parse(await readFile(meta.psd_json, 'utf8'));
  const canvas = {
    width_px: meta.canvas.width,
    height_px: meta.canvas.height,
    background: 'transparent',
  };
  await mkdir(path.join(absoluteOutDir, 'layers'), { recursive: true });

  const layerIds = new Set();
  const manifestLayers = [];
  for (const sourceLayer of meta.layers) {
    if (!sourceLayer.visible_bounds_local || sourceLayer.visible_pixels <= 0) continue;
    const semanticLabels = labelsFor(sourceLayer.name);
    const layerId = layerIdFor(sourceLayer.name, layerIds);
    const sourcePng = path.resolve(absoluteRunDir, sourceLayer.png_ref);
    const targetRef = `layers/${layerId}.png`;
    const targetPng = path.join(absoluteOutDir, targetRef);
    await copyFile(sourcePng, targetPng);
    const bytes = await readFile(targetPng);
    const png = await decodePngRgba(targetPng);
    const visibleBoundsGlobal = rectFromLayer(sourceLayer);
    manifestLayers.push({
      layer_id: layerId,
      source_see_through_name: sourceLayer.name,
      source_psd_layer_index: sourceLayer.index,
      asset: assetManifest(targetRef, bytes, png),
      placement_px: { x: sourceLayer.left, y: sourceLayer.top },
      texture_bounds_px: { x: 0, y: 0, width: png.width, height: png.height },
      visible_bounds_px: sourceLayer.visible_bounds_local,
      visible_bounds_global: visibleBoundsGlobal,
      semantic_labels: semanticLabels,
      visible_pixels: sourceLayer.visible_pixels,
      occlusion_fill: 'filled_by_upstream',
      occlusion_evidence_ref: `upstream.see_through.layer.${slug(sourceLayer.name)}.psd_json_depth_png`,
    });
  }

  const faceBounds = mergedSemanticBounds(manifestLayers, ['face', 'head']);
  const headBounds = mergeRects([
    mergedSemanticBounds(manifestLayers, ['face', 'head']),
    mergedSemanticBounds(manifestLayers, ['hair']),
    mergedSemanticBounds(manifestLayers, ['ear']),
  ]);
  const eyeBounds = mergedSemanticBounds(manifestLayers, ['eye']);
  const mouthBounds = mergedSemanticBounds(manifestLayers, ['mouth']);
  const neckBounds = mergedSemanticBounds(manifestLayers, ['neck']);
  const outfitBounds = mergedSemanticBounds(manifestLayers, ['outfit']);
  if (!faceBounds || !headBounds || !eyeBounds || !mouthBounds || !neckBounds || !outfitBounds) {
    throw new Error('Cannot derive required Nimi2D anchors from see-through output layers.');
  }
  const leftEyeBounds = splitRect(eyeBounds, 'left');
  const rightEyeBounds = splitRect(eyeBounds, 'right');
  const sourceEvidence = {
    layer_generation_ref: 'upstream.see_through.e4cb250dc69defe6f982168dab684aa461552b5b.inference_psd.run_1280_logged',
    identity_preservation_ref: 'upstream.see_through.primary_anime_fullbody_001.sha256.7bb4daf0d5f93805d7fa9bb186781327364eb99a05fff5a1df02293d9b205cd6',
    content_admission_ref: 'upstream.see_through.primary_anime_fullbody_001.psd_json',
    occlusion_completion_ref: 'upstream.see_through.layerdiff3d_marigold_depth_psd',
  };
  const manifest = {
    manifest_kind: LAYER_MANIFEST_KIND,
    schema_version: 1,
    input_id: 'n2d_layer_input_see_through_primary_anime_fullbody_001',
    input_kind: 'character_skin',
    canvas,
    coordinate_space: {
      origin: 'top_left',
      unit: 'px',
      axis: 'x_right_y_down',
      overflow_policy: 'reject',
    },
    source_evidence: sourceEvidence,
    layers: manifestLayers.map(({ source_see_through_name, source_psd_layer_index, visible_bounds_global, visible_pixels, ...layer }) => layer),
    draw_order: manifestLayers.map((layer) => layer.layer_id),
    global_anchor_hints: [
      { anchor_id: 'anchor_body_root', kind: 'body_root', point_px: center({ x: outfitBounds.x, y: outfitBounds.y + outfitBounds.height * 0.62, width: outfitBounds.width, height: outfitBounds.height * 0.25 }), source: 'see_through_geometry' },
      { anchor_id: 'anchor_neck_base', kind: 'neck_base', point_px: center({ x: neckBounds.x, y: neckBounds.y + neckBounds.height * 0.65, width: neckBounds.width, height: neckBounds.height * 0.25 }), source: 'see_through_geometry' },
      { anchor_id: 'anchor_head_center', kind: 'head_center', point_px: center(headBounds), source: 'see_through_geometry' },
      { anchor_id: 'anchor_face_center', kind: 'face_center', point_px: center(faceBounds), source: 'see_through_geometry' },
      { anchor_id: 'anchor_left_eye_center', kind: 'left_eye_center', point_px: center(leftEyeBounds), source: 'see_through_geometry' },
      { anchor_id: 'anchor_right_eye_center', kind: 'right_eye_center', point_px: center(rightEyeBounds), source: 'see_through_geometry' },
      { anchor_id: 'anchor_mouth_center', kind: 'mouth_center', point_px: center(mouthBounds), source: 'see_through_geometry' },
    ],
    global_slot_hints: [
      { slot_hint_id: 'slot_head', kind: 'head', bounds_px: clampRect(headBounds, canvas), source: 'see_through_geometry' },
      { slot_hint_id: 'slot_face', kind: 'face', bounds_px: clampRect(faceBounds, canvas), source: 'see_through_geometry' },
      { slot_hint_id: 'slot_hair', kind: 'hair', bounds_px: clampRect(mergedSemanticBounds(manifestLayers, ['hair']), canvas), source: 'see_through_geometry' },
      { slot_hint_id: 'slot_neck', kind: 'neck', bounds_px: clampRect(neckBounds, canvas), source: 'see_through_geometry' },
      { slot_hint_id: 'slot_torso', kind: 'torso', bounds_px: clampRect(mergeRects([neckBounds, mergedSemanticBounds(manifestLayers, ['outfit'])]), canvas), source: 'see_through_geometry' },
      { slot_hint_id: 'slot_hip', kind: 'hip', bounds_px: clampRect(mergedSemanticBounds(manifestLayers, ['outfit', 'leg']), canvas), source: 'see_through_geometry' },
      { slot_hint_id: 'slot_left_hand', kind: 'left_hand', bounds_px: clampRect(splitRect(mergedSemanticBounds(manifestLayers, ['hand', 'arm']), 'left'), canvas), source: 'see_through_geometry' },
      { slot_hint_id: 'slot_right_hand', kind: 'right_hand', bounds_px: clampRect(splitRect(mergedSemanticBounds(manifestLayers, ['hand', 'arm']), 'right'), canvas), source: 'see_through_geometry' },
      { slot_hint_id: 'slot_left_leg', kind: 'left_leg', bounds_px: clampRect(splitRect(mergedSemanticBounds(manifestLayers, ['leg']), 'left'), canvas), source: 'see_through_geometry' },
      { slot_hint_id: 'slot_right_leg', kind: 'right_leg', bounds_px: clampRect(splitRect(mergedSemanticBounds(manifestLayers, ['leg']), 'right'), canvas), source: 'see_through_geometry' },
      { slot_hint_id: 'slot_left_foot', kind: 'left_foot', bounds_px: clampRect(splitRect(mergedSemanticBounds(manifestLayers, ['foot']), 'left'), canvas), source: 'see_through_geometry' },
      { slot_hint_id: 'slot_right_foot', kind: 'right_foot', bounds_px: clampRect(splitRect(mergedSemanticBounds(manifestLayers, ['foot']), 'right'), canvas), source: 'see_through_geometry' },
      { slot_hint_id: 'slot_outfit_upper', kind: 'outfit_upper', bounds_px: clampRect(mergeRects([mergedSemanticBounds(manifestLayers, ['outfit']), neckBounds]), canvas), source: 'see_through_geometry' },
      { slot_hint_id: 'slot_outfit_lower', kind: 'outfit_lower', bounds_px: clampRect(mergedSemanticBounds(manifestLayers, ['outfit', 'leg', 'foot']), canvas), source: 'see_through_geometry' },
      { slot_hint_id: 'slot_outfit_full', kind: 'outfit_full', bounds_px: clampRect(outfitBounds, canvas), source: 'see_through_geometry' },
      { slot_hint_id: 'slot_accessory_head', kind: 'accessory_head', bounds_px: clampRect(mergedSemanticBounds(manifestLayers, ['accessory']), canvas), source: 'see_through_geometry' },
    ],
  };
  const serialized = YAML.stringify(manifest);
  await writeFile(path.join(absoluteOutDir, 'layer-input.yaml'), serialized, 'utf8');
  const contentHashSha256 = sha256(serialized);
  await writeSingleCaseCorpus({ outputDir: absoluteOutDir, contentHashSha256, sourceEvidence });

  const qualityReport = directQualityReport({
    runDir: absoluteRunDir,
    outputDir: absoluteOutDir,
    canvas,
    layers: manifestLayers,
    psdJson,
    meta,
  });
  await writeFile(path.join(absoluteOutDir, 'direct-layer-quality-report.yaml'), YAML.stringify(qualityReport), 'utf8');

  process.stdout.write(`${JSON.stringify({
    status: 'ok',
    layerInputManifestPath: path.join(absoluteOutDir, 'layer-input.yaml'),
    corpusPath: path.join(absoluteOutDir, 'corpus.yaml'),
    qualityReportPath: path.join(absoluteOutDir, 'direct-layer-quality-report.yaml'),
    layerCount: manifest.layers.length,
    qualityDecision: qualityReport.decision,
  }, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({
    status: 'error',
    message: error instanceof Error ? error.message : String(error),
  }, null, 2)}\n`);
  process.exitCode = 1;
});
