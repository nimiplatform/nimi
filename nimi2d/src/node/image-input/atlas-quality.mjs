import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';

import { decodePngRgba } from '../png-rgba.mjs';
import { validateAtlasSpec } from './atlas-spec.mjs';

function passFail(value) {
  return value ? 'pass' : 'fail';
}

function relativeReportPath(fromDir, targetPath) {
  const relative = path.relative(fromDir, path.resolve(targetPath)).replaceAll('\\', '/');
  return relative.length === 0 ? '.' : relative;
}

function rectArea(rect) {
  return Math.max(0, rect?.width ?? 0) * Math.max(0, rect?.height ?? 0);
}

function intersection(left, right) {
  const x = Math.max(left.x, right.x);
  const y = Math.max(left.y, right.y);
  const x2 = Math.min(left.x + left.width, right.x + right.width);
  const y2 = Math.min(left.y + left.height, right.y + right.height);
  return {
    x,
    y,
    width: Math.max(0, x2 - x),
    height: Math.max(0, y2 - y),
  };
}

function rectIou(left, right) {
  const overlap = rectArea(intersection(left, right));
  const union = rectArea(left) + rectArea(right) - overlap;
  return union > 0 ? overlap / union : 0;
}

function pointInside(point, rect) {
  return point.x >= rect.x
    && point.y >= rect.y
    && point.x < rect.x + rect.width
    && point.y < rect.y + rect.height;
}

function layerCellBounds(spec, layer) {
  const { cell } = spec;
  return {
    x: cell.origin_px.x + (layer.cell.column * (cell.width_px + cell.gap_px.x)),
    y: cell.origin_px.y + (layer.cell.row * (cell.height_px + cell.gap_px.y)),
    width: cell.width_px,
    height: cell.height_px,
  };
}

function chromaDistance(rgba, offset, key) {
  return Math.max(
    Math.abs(rgba[offset] - key[0]),
    Math.abs(rgba[offset + 1] - key[1]),
    Math.abs(rgba[offset + 2] - key[2]),
  );
}

function isVisiblePixel(spec, rgba, offset) {
  if ((rgba[offset + 3] ?? 0) <= 0) return false;
  if (spec.background.kind === 'transparent') return true;
  return chromaDistance(rgba, offset, spec.background.chroma_key_rgb) > spec.background.tolerance;
}

function measureLayer(spec, atlas, layer) {
  const bounds = layerCellBounds(spec, layer);
  let visiblePixels = 0;
  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (let y = 0; y < bounds.height; y += 1) {
    for (let x = 0; x < bounds.width; x += 1) {
      const sourceOffset = (((bounds.y + y) * atlas.width) + bounds.x + x) * 4;
      if (!isVisiblePixel(spec, atlas.rgba, sourceOffset)) continue;
      visiblePixels += 1;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }

  const measuredVisibleBounds = visiblePixels > 0
    ? { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
    : null;

  return {
    layer_id: layer.layer_id,
    semantic_labels: layer.semantic_labels,
    declared_visible_bounds_px: layer.visible_bounds_px,
    measured_visible_bounds_px: measuredVisibleBounds,
    visible_pixels: visiblePixels,
    visible_ratio: visiblePixels / (bounds.width * bounds.height),
    declared_bounds_iou: measuredVisibleBounds ? rectIou(layer.visible_bounds_px, measuredVisibleBounds) : 0,
  };
}

function measureAtlasBackground(spec, atlas) {
  let visiblePixels = 0;
  let sampledPixels = 0;
  for (const layer of spec.layers) {
    const bounds = layerCellBounds(spec, layer);
    for (let y = 0; y < bounds.height; y += 1) {
      for (let x = 0; x < bounds.width; x += 1) {
        const sourceOffset = (((bounds.y + y) * atlas.width) + bounds.x + x) * 4;
        sampledPixels += 1;
        if (isVisiblePixel(spec, atlas.rgba, sourceOffset)) visiblePixels += 1;
      }
    }
  }
  return {
    sampled_pixels: sampledPixels,
    visible_pixels: visiblePixels,
    background_ratio: sampledPixels > 0 ? 1 - (visiblePixels / sampledPixels) : 0,
  };
}

function bySemantic(layerMeasurements, labels) {
  return layerMeasurements.filter((layer) => layer.semantic_labels.some((label) => labels.includes(label)));
}

function mergedBounds(layers) {
  const bounds = layers
    .map((layer) => layer.measured_visible_bounds_px)
    .filter(Boolean);
  if (bounds.length === 0) return null;
  const minX = Math.min(...bounds.map((rect) => rect.x));
  const minY = Math.min(...bounds.map((rect) => rect.y));
  const maxX = Math.max(...bounds.map((rect) => rect.x + rect.width));
  const maxY = Math.max(...bounds.map((rect) => rect.y + rect.height));
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

const anchorSemanticMap = {
  body_root: ['body', 'torso'],
  neck_base: ['body', 'torso', 'head', 'face'],
  head_center: ['head', 'face'],
  face_center: ['head', 'face'],
  left_eye_center: ['eye'],
  right_eye_center: ['eye'],
  mouth_center: ['mouth'],
};

function evaluateAnchorCoverage(spec, layerMeasurements) {
  const failed = [];
  for (const anchor of spec.global_anchor_hints) {
    const labels = anchorSemanticMap[anchor.kind] ?? [];
    const relatedBounds = mergedBounds(bySemantic(layerMeasurements, labels));
    if (!relatedBounds || !pointInside(anchor.point_px, relatedBounds)) {
      failed.push({
        anchor_id: anchor.anchor_id,
        kind: anchor.kind,
        point_px: anchor.point_px,
        related_semantic_labels: labels,
      });
    }
  }
  return {
    status: failed.length === 0 ? 'pass' : 'fail',
    failed,
  };
}

const slotSemanticMap = {
  torso: ['body', 'torso'],
  hip: ['body', 'torso', 'outfit'],
  outfit_upper: ['outfit'],
  outfit_lower: ['outfit'],
  outfit_full: ['outfit'],
  accessory_head: ['accessory', 'hair', 'head'],
  accessory_face: ['accessory', 'face'],
  accessory_hand: ['accessory', 'hand'],
  prop_hand: ['prop', 'hand'],
  scene_back: ['scene'],
  scene_front: ['scene'],
};

function evaluateSlotCoverage(spec, layerMeasurements) {
  const failed = [];
  for (const slot of spec.global_slot_hints) {
    const labels = slotSemanticMap[slot.kind] ?? [];
    const relatedBounds = mergedBounds(bySemantic(layerMeasurements, labels));
    const overlapRatio = relatedBounds
      ? rectArea(intersection(slot.bounds_px, relatedBounds)) / rectArea(slot.bounds_px)
      : 0;
    if (overlapRatio < 0.25) {
      failed.push({
        slot_hint_id: slot.slot_hint_id,
        kind: slot.kind,
        bounds_px: slot.bounds_px,
        related_semantic_labels: labels,
        overlap_ratio: overlapRatio,
      });
    }
  }
  return {
    status: failed.length === 0 ? 'pass' : 'fail',
    failed,
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

function evaluateQuality(spec, layerMeasurements, atlasBackground) {
  const canvas = spec.canvas;
  const mouthLayers = bySemantic(layerMeasurements, ['mouth']);
  const mouthBounds = mergedBounds(mouthLayers);
  const mouthPixels = mouthLayers.reduce((total, layer) => total + layer.visible_pixels, 0);
  const eyeLayers = bySemantic(layerMeasurements, ['eye']);
  const eyeBounds = mergedBounds(eyeLayers);
  const eyePixels = eyeLayers.reduce((total, layer) => total + layer.visible_pixels, 0);
  const bodyBounds = mergedBounds(bySemantic(layerMeasurements, ['body', 'torso']));
  const outfitBounds = mergedBounds(bySemantic(layerMeasurements, ['outfit']));

  return {
    mouth_expressive_geometry: geometryGate({
      name: 'mouth_expressive_geometry',
      bounds: mouthBounds,
      pixels: mouthPixels,
      minWidth: Math.max(16, Math.ceil(canvas.width_px * 0.08)),
      minHeight: Math.max(8, Math.ceil(canvas.height_px * 0.025)),
      minPixels: Math.max(32, Math.ceil(canvas.width_px * canvas.height_px * 0.00035)),
    }),
    eye_readability_geometry: geometryGate({
      name: 'eye_readability_geometry',
      bounds: eyeBounds,
      pixels: eyePixels,
      minWidth: Math.max(24, Math.ceil(canvas.width_px * 0.16)),
      minHeight: Math.max(6, Math.ceil(canvas.height_px * 0.025)),
      minPixels: Math.max(48, Math.ceil(canvas.width_px * canvas.height_px * 0.001)),
    }),
    body_geometry: geometryGate({
      name: 'body_geometry',
      bounds: bodyBounds,
      pixels: bySemantic(layerMeasurements, ['body', 'torso']).reduce((total, layer) => total + layer.visible_pixels, 0),
      minWidth: Math.max(32, Math.ceil(canvas.width_px * 0.16)),
      minHeight: Math.max(48, Math.ceil(canvas.height_px * 0.5)),
      minPixels: Math.max(256, Math.ceil(canvas.width_px * canvas.height_px * 0.03)),
    }),
    outfit_geometry: geometryGate({
      name: 'outfit_geometry',
      bounds: outfitBounds,
      pixels: bySemantic(layerMeasurements, ['outfit']).reduce((total, layer) => total + layer.visible_pixels, 0),
      minWidth: Math.max(32, Math.ceil(canvas.width_px * 0.16)),
      minHeight: Math.max(48, Math.ceil(canvas.height_px * 0.45)),
      minPixels: Math.max(256, Math.ceil(canvas.width_px * canvas.height_px * 0.03)),
    }),
    chroma_background_separation: {
      status: atlasBackground.background_ratio >= 0.5 && atlasBackground.background_ratio <= 0.98 ? 'pass' : 'fail',
      background_ratio: atlasBackground.background_ratio,
      thresholds: {
        min_background_ratio: 0.5,
        max_background_ratio: 0.98,
      },
    },
  };
}

function qualityResultsPass(results) {
  return Object.values(results).every((value) => value.status === 'pass');
}

function failureAttribution(hardGateResults, qualityGateResults) {
  const attribution = {};
  if (hardGateResults.declared_visible_bounds_match === 'fail'
    || hardGateResults.anchors_inside_measured_layer_bounds === 'fail'
    || hardGateResults.slots_overlap_measured_layer_bounds === 'fail') {
    attribution.atlas_spec_mismatch = true;
  }
  const failedQuality = Object.entries(qualityGateResults)
    .filter(([, value]) => value.status === 'fail')
    .map(([key]) => key);
  if (failedQuality.length > 0) {
    attribution.upstream_image_quality = failedQuality;
  }
  return attribution;
}

async function runAtlasQualityGate(atlasSpecPath, options = {}) {
  const specResult = await validateAtlasSpec(atlasSpecPath);
  if (specResult.status !== 'ok') {
    return {
      status: 'reject',
      kind: 'atlas_quality_gate',
      codes: specResult.codes,
      issues: specResult.issues,
    };
  }
  const spec = specResult.value;
  const specDir = path.dirname(path.resolve(atlasSpecPath));
  const atlasPath = path.resolve(specDir, spec.atlas_image_ref);
  const atlas = await decodePngRgba(atlasPath);
  const layerMeasurements = spec.layers.map((layer) => measureLayer(spec, atlas, layer));
  const atlasBackground = measureAtlasBackground(spec, atlas);
  const anchorCoverage = evaluateAnchorCoverage(spec, layerMeasurements);
  const slotCoverage = evaluateSlotCoverage(spec, layerMeasurements);
  const declaredBoundsMatch = layerMeasurements.every((layer) => layer.declared_bounds_iou >= 0.95);
  const hardGateResults = {
    atlas_spec_valid: 'pass',
    atlas_image_loaded: 'pass',
    required_layers_visible: passFail(layerMeasurements.every((layer) => layer.visible_pixels > 0)),
    declared_visible_bounds_match: passFail(declaredBoundsMatch),
    anchors_inside_measured_layer_bounds: anchorCoverage.status,
    slots_overlap_measured_layer_bounds: slotCoverage.status,
  };
  const qualityGateResults = evaluateQuality(spec, layerMeasurements, atlasBackground);
  const hardPass = Object.values(hardGateResults).every((value) => value === 'pass');
  const qualityPass = qualityResultsPass(qualityGateResults);
  const reportBaseDir = options.outPath ? path.dirname(path.resolve(options.outPath)) : process.cwd();
  const report = {
    run_id: `n2d_atlas_quality_${spec.atlas_id.replaceAll('-', '_')}`,
    atlas: {
      atlas_id: spec.atlas_id,
      atlas_spec_path: relativeReportPath(reportBaseDir, atlasSpecPath),
      atlas_image_ref: spec.atlas_image_ref,
      atlas_width_px: atlas.width,
      atlas_height_px: atlas.height,
      canvas: spec.canvas,
    },
    layer_measurements: layerMeasurements,
    atlas_background: atlasBackground,
    anchor_coverage: anchorCoverage,
    slot_coverage: slotCoverage,
    hard_gate_results: hardGateResults,
    quality_gate_results: qualityGateResults,
    tracking_metrics: {
      real_atlas_sample_count: {
        value: options.sampleCount ?? 1,
        status: 'single_atlas_not_distribution_gate',
      },
      manual_correction_minutes: {
        status: 'not_measured',
      },
      subjective_liveliness: {
        status: 'not_measured',
      },
    },
    failure_attribution: failureAttribution(hardGateResults, qualityGateResults),
    decision: {
      verdict: hardPass && qualityPass ? 'pass' : 'fail',
      reason: hardPass && qualityPass
        ? 'Atlas quality gates passed for tier-1 image-input use.'
        : 'One or more atlas quality gates failed; see failure_attribution.',
    },
  };
  if (options.outPath) {
    await writeFile(path.resolve(options.outPath), YAML.stringify(report), 'utf8');
  }
  return {
    status: 'ok',
    kind: 'atlas_quality_gate',
    decision: report.decision,
    result: report,
    codes: [],
    issues: [],
  };
}

export { runAtlasQualityGate };
