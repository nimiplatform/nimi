import path from 'node:path';

import {
  issue,
  isObject,
  readManifest,
  rejectUnknownFields,
  requireFields,
  result,
  isSafeRelativePath,
  assertCanvasPoint,
  assertRect,
} from '../common-utils.mjs';
import {
  anchorKinds,
  layerInputKinds,
  semanticLabels,
  slotKinds,
} from '../common-constants.mjs';

const ATLAS_SPEC_KIND = 'nimi.nimi2d.image-input.layer-atlas';

const atlasTopLevelFields = new Set([
  'manifest_kind',
  'schema_version',
  'atlas_id',
  'atlas_image_ref',
  'input_id',
  'input_kind',
  'canvas',
  'cell',
  'background',
  'source_evidence',
  'layers',
  'draw_order',
  'global_anchor_hints',
  'global_slot_hints',
]);

const cellFields = new Set([
  'width_px',
  'height_px',
  'columns',
  'rows',
  'origin_px',
  'gap_px',
]);

const backgroundFields = new Set([
  'kind',
  'chroma_key_rgb',
  'tolerance',
]);

const layerFields = new Set([
  'layer_id',
  'cell',
  'semantic_labels',
  'placement_px',
  'texture_bounds_px',
  'visible_bounds_px',
  'occlusion_fill',
  'occlusion_evidence_ref',
]);

function positiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function nonNegativeInteger(value) {
  return Number.isInteger(value) && value >= 0;
}

function validateCell(value, issues) {
  requireFields(value, [...cellFields], 'NIMI2D_ATLAS_SPEC_INVALID', '$.cell', issues);
  rejectUnknownFields(value, cellFields, 'NIMI2D_ATLAS_SPEC_INVALID', '$.cell', issues);
  for (const field of ['width_px', 'height_px', 'columns', 'rows']) {
    if (!positiveInteger(value?.[field])) {
      issues.push(issue('NIMI2D_ATLAS_SPEC_INVALID', `$.cell.${field}`, 'Cell field must be a positive integer.'));
    }
  }
  for (const [field, base] of [['origin_px', '$.cell.origin_px'], ['gap_px', '$.cell.gap_px']]) {
    const point = value?.[field];
    if (!isObject(point) || !nonNegativeInteger(point.x) || !nonNegativeInteger(point.y)) {
      issues.push(issue('NIMI2D_ATLAS_SPEC_INVALID', base, 'Cell point must use non-negative integer x/y.'));
    }
  }
}

function validateBackground(value, issues) {
  requireFields(value, ['kind'], 'NIMI2D_ATLAS_SPEC_INVALID', '$.background', issues);
  rejectUnknownFields(value, backgroundFields, 'NIMI2D_ATLAS_SPEC_INVALID', '$.background', issues);
  if (value?.kind !== 'transparent' && value?.kind !== 'chroma_key') {
    issues.push(issue('NIMI2D_ATLAS_SPEC_INVALID', '$.background.kind', 'Background kind must be transparent or chroma_key.'));
  }
  if (value?.kind === 'chroma_key') {
    const rgb = value.chroma_key_rgb;
    if (!Array.isArray(rgb) || rgb.length !== 3 || rgb.some((channel) => !Number.isInteger(channel) || channel < 0 || channel > 255)) {
      issues.push(issue('NIMI2D_ATLAS_SPEC_INVALID', '$.background.chroma_key_rgb', 'Chroma key must be [r,g,b] 8-bit channels.'));
    }
    if (!Number.isInteger(value.tolerance) || value.tolerance < 0 || value.tolerance > 255) {
      issues.push(issue('NIMI2D_ATLAS_SPEC_INVALID', '$.background.tolerance', 'Chroma tolerance must be an integer between 0 and 255.'));
    }
  }
}

function validateLayer(layer, index, value, issues) {
  const base = `$.layers[${index}]`;
  requireFields(layer, ['layer_id', 'cell', 'semantic_labels', 'placement_px', 'texture_bounds_px', 'visible_bounds_px', 'occlusion_fill'], 'NIMI2D_ATLAS_SPEC_INVALID', base, issues);
  rejectUnknownFields(layer, layerFields, 'NIMI2D_ATLAS_SPEC_INVALID', base, issues);
  if (typeof layer?.layer_id !== 'string' || layer.layer_id.length === 0) {
    issues.push(issue('NIMI2D_ATLAS_SPEC_INVALID', `${base}.layer_id`, 'Layer id must be a non-empty string.'));
  }
  const cell = layer?.cell;
  if (!isObject(cell) || !Number.isInteger(cell.column) || !Number.isInteger(cell.row)) {
    issues.push(issue('NIMI2D_ATLAS_SPEC_INVALID', `${base}.cell`, 'Layer cell must include integer column and row.'));
  } else if (isObject(value.cell) && (cell.column < 0 || cell.row < 0 || cell.column >= value.cell.columns || cell.row >= value.cell.rows)) {
    issues.push(issue('NIMI2D_ATLAS_SPEC_INVALID', `${base}.cell`, 'Layer cell is outside atlas grid.'));
  }
  if (!Array.isArray(layer?.semantic_labels) || layer.semantic_labels.length === 0) {
    issues.push(issue('NIMI2D_ATLAS_SPEC_INVALID', `${base}.semantic_labels`, 'Semantic labels are required.'));
  } else {
    for (const label of layer.semantic_labels) {
      if (!semanticLabels.has(label)) {
        issues.push(issue('NIMI2D_ATLAS_SPEC_INVALID', `${base}.semantic_labels`, `Unknown semantic label ${label}.`));
      }
    }
  }
  if (isObject(value.canvas)) {
    assertCanvasPoint(layer.placement_px, value.canvas, `${base}.placement_px`, issues, 'NIMI2D_ATLAS_SPEC_INVALID');
  }
  assertRect(layer.texture_bounds_px, `${base}.texture_bounds_px`, issues, 'NIMI2D_ATLAS_SPEC_INVALID');
  assertRect(layer.visible_bounds_px, `${base}.visible_bounds_px`, issues, 'NIMI2D_ATLAS_SPEC_INVALID');
  if (layer.occlusion_fill !== 'not_applicable' && layer.occlusion_fill !== 'filled_by_upstream') {
    issues.push(issue('NIMI2D_ATLAS_SPEC_INVALID', `${base}.occlusion_fill`, 'Invalid occlusion fill state.'));
  }
  if (layer.occlusion_fill === 'filled_by_upstream' && !layer.occlusion_evidence_ref) {
    issues.push(issue('NIMI2D_ATLAS_SPEC_INVALID', `${base}.occlusion_evidence_ref`, 'Filled occlusion layers require evidence.'));
  }
}

function validateAnchors(value, issues) {
  const anchors = Array.isArray(value.global_anchor_hints) ? value.global_anchor_hints : [];
  if (anchors.length === 0) {
    issues.push(issue('NIMI2D_ATLAS_SPEC_INVALID', '$.global_anchor_hints', 'Anchor hints are required.'));
    return;
  }
  for (const [index, anchor] of anchors.entries()) {
    const base = `$.global_anchor_hints[${index}]`;
    if (!anchorKinds.has(anchor?.kind)) {
      issues.push(issue('NIMI2D_ATLAS_SPEC_INVALID', `${base}.kind`, 'Unknown anchor kind.'));
    }
    if (isObject(value.canvas)) assertCanvasPoint(anchor?.point_px, value.canvas, `${base}.point_px`, issues, 'NIMI2D_ATLAS_SPEC_INVALID');
  }
}

function validateSlots(value, issues) {
  const slots = Array.isArray(value.global_slot_hints) ? value.global_slot_hints : [];
  if (slots.length === 0) {
    issues.push(issue('NIMI2D_ATLAS_SPEC_INVALID', '$.global_slot_hints', 'Slot hints are required.'));
    return;
  }
  for (const [index, slot] of slots.entries()) {
    const base = `$.global_slot_hints[${index}]`;
    if (!slotKinds.has(slot?.kind)) {
      issues.push(issue('NIMI2D_ATLAS_SPEC_INVALID', `${base}.kind`, 'Unknown slot kind.'));
    }
    assertRect(slot?.bounds_px, `${base}.bounds_px`, issues, 'NIMI2D_ATLAS_SPEC_INVALID');
  }
}

function validateAtlasSpecObject(value, manifestPath = '<inline>') {
  const issues = [];
  if (!isObject(value)) {
    issues.push(issue('NIMI2D_ATLAS_SPEC_INVALID', '$', 'Atlas spec must be an object.'));
    return result('image_input_atlas_spec', manifestPath, issues);
  }
  requireFields(value, [...atlasTopLevelFields], 'NIMI2D_ATLAS_SPEC_INVALID', '$', issues);
  rejectUnknownFields(value, atlasTopLevelFields, 'NIMI2D_ATLAS_SPEC_INVALID', '$', issues);
  if (value.manifest_kind !== ATLAS_SPEC_KIND) {
    issues.push(issue('NIMI2D_ATLAS_SPEC_INVALID', '$.manifest_kind', 'Invalid atlas spec kind.'));
  }
  if (value.schema_version !== 1) {
    issues.push(issue('NIMI2D_ATLAS_SPEC_INVALID', '$.schema_version', 'Unsupported atlas spec schema version.'));
  }
  if (typeof value.atlas_image_ref !== 'string' || !isSafeRelativePath(value.atlas_image_ref)) {
    issues.push(issue('NIMI2D_ATLAS_SPEC_INVALID', '$.atlas_image_ref', 'Atlas image ref must be a safe relative path.'));
  }
  if (!layerInputKinds.has(value.input_kind)) {
    issues.push(issue('NIMI2D_ATLAS_SPEC_INVALID', '$.input_kind', 'Unsupported layer input kind.'));
  }
  if (!isObject(value.canvas) || !positiveInteger(value.canvas.width_px) || !positiveInteger(value.canvas.height_px) || value.canvas.background !== 'transparent') {
    issues.push(issue('NIMI2D_ATLAS_SPEC_INVALID', '$.canvas', 'Canvas must use positive dimensions and transparent background.'));
  }
  validateCell(value.cell, issues);
  validateBackground(value.background, issues);
  requireFields(value.source_evidence, ['layer_generation_ref', 'identity_preservation_ref', 'content_admission_ref'], 'NIMI2D_ATLAS_SPEC_INVALID', '$.source_evidence', issues);
  const layers = Array.isArray(value.layers) ? value.layers : [];
  if (layers.length === 0) {
    issues.push(issue('NIMI2D_ATLAS_SPEC_INVALID', '$.layers', 'Atlas layers are required.'));
  }
  const layerIds = new Set();
  for (const [index, layer] of layers.entries()) {
    validateLayer(layer, index, value, issues);
    if (typeof layer?.layer_id === 'string') {
      if (layerIds.has(layer.layer_id)) issues.push(issue('NIMI2D_ATLAS_SPEC_INVALID', `$.layers[${index}].layer_id`, 'Duplicate layer id.'));
      layerIds.add(layer.layer_id);
    }
  }
  const drawOrder = Array.isArray(value.draw_order) ? value.draw_order : [];
  if (drawOrder.length !== layerIds.size || new Set(drawOrder).size !== drawOrder.length || drawOrder.some((id) => !layerIds.has(id))) {
    issues.push(issue('NIMI2D_ATLAS_SPEC_INVALID', '$.draw_order', 'Draw order must list every atlas layer exactly once.'));
  }
  validateAnchors(value, issues);
  validateSlots(value, issues);
  return result('image_input_atlas_spec', manifestPath, issues, value);
}

async function validateAtlasSpec(manifestPath) {
  const absoluteManifest = path.resolve(manifestPath);
  const { value, parseError } = await readManifest(absoluteManifest);
  if (parseError) {
    const issues = [issue('NIMI2D_ATLAS_SPEC_INVALID', '$', 'Atlas spec cannot parse as YAML.')];
    return result('image_input_atlas_spec', absoluteManifest, issues);
  }
  return validateAtlasSpecObject(value, absoluteManifest);
}

export {
  ATLAS_SPEC_KIND,
  validateAtlasSpec,
  validateAtlasSpecObject,
};
