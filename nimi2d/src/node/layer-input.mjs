import path from 'node:path';

import {
  LAYER_MANIFEST_KIND,
  layerTopLevelFields,
  forbiddenLayerFields,
  layerInputKinds,
  semanticLabels,
  anchorKinds,
  requiredCharacterAnchors,
  slotKinds,
  issue,
  result,
  readManifest,
  isObject,
  requireFields,
  rejectUnknownFields,
  findForbiddenFields,
  assertCanvasPoint,
  assertRect,
  validatePngAsset,
} from './common.mjs';

export async function validateLayerInput(manifestPath) {
  const absoluteManifest = path.resolve(manifestPath);
  const manifestDir = path.dirname(absoluteManifest);
  const { value, parseError } = await readManifest(absoluteManifest);
  const issues = [];
  if (parseError || !isObject(value)) {
    issues.push(issue('NIMI2D_LAYER_INPUT_MANIFEST_INVALID', '$', 'Manifest cannot parse as an object.'));
    return result('layer_input', absoluteManifest, issues);
  }

  rejectUnknownFields(value, layerTopLevelFields, 'NIMI2D_LAYER_INPUT_MANIFEST_INVALID', '$', issues);
  findForbiddenFields(value, forbiddenLayerFields, 'NIMI2D_LAYER_INPUT_RAW_IMAGE_FORBIDDEN', '$', issues);
  requireFields(value, [...layerTopLevelFields], 'NIMI2D_LAYER_INPUT_MANIFEST_INVALID', '$', issues);

  if (value.manifest_kind !== LAYER_MANIFEST_KIND) {
    issues.push(issue('NIMI2D_LAYER_INPUT_MANIFEST_INVALID', '$.manifest_kind', 'Invalid layer input manifest kind.'));
  }
  if (value.schema_version !== 1) {
    issues.push(issue('NIMI2D_LAYER_INPUT_SCHEMA_VERSION_UNSUPPORTED', '$.schema_version', 'Unsupported layer input schema version.'));
  }
  if (!layerInputKinds.has(value.input_kind)) {
    issues.push(issue('NIMI2D_LAYER_INPUT_MANIFEST_INVALID', '$.input_kind', 'Unknown input kind.'));
  }

  const canvas = value.canvas;
  if (!isObject(canvas) || !Number.isInteger(canvas.width_px) || !Number.isInteger(canvas.height_px) || canvas.width_px <= 0 || canvas.height_px <= 0) {
    issues.push(issue('NIMI2D_LAYER_INPUT_CANVAS_INVALID', '$.canvas', 'Canvas dimensions must be positive integers.'));
  }
  if (!isObject(value.coordinate_space) || value.coordinate_space.origin !== 'top_left' || value.coordinate_space.unit !== 'px' || value.coordinate_space.axis !== 'x_right_y_down' || value.coordinate_space.overflow_policy !== 'reject') {
    issues.push(issue('NIMI2D_LAYER_INPUT_CANVAS_INVALID', '$.coordinate_space', 'Unsupported coordinate space.'));
  }

  requireFields(value.source_evidence, ['layer_generation_ref', 'identity_preservation_ref', 'content_admission_ref'], 'NIMI2D_LAYER_INPUT_SOURCE_EVIDENCE_MISSING', '$.source_evidence', issues);

  const layers = Array.isArray(value.layers) ? value.layers : [];
  if (layers.length === 0) {
    issues.push(issue('NIMI2D_LAYER_INPUT_MANIFEST_INVALID', '$.layers', 'layers must be a non-empty array.'));
  }
  const layerIds = new Set();
  const semanticSet = new Set();
  let anyFilledOcclusion = false;
  for (const [index, layer] of layers.entries()) {
    const layerPath = `$.layers[${index}]`;
    requireFields(layer, ['layer_id', 'asset', 'placement_px', 'texture_bounds_px', 'visible_bounds_px', 'semantic_labels', 'occlusion_fill'], 'NIMI2D_LAYER_INPUT_MANIFEST_INVALID', layerPath, issues);
    if (typeof layer.layer_id !== 'string' || layerIds.has(layer.layer_id)) {
      issues.push(issue('NIMI2D_LAYER_INPUT_LAYER_ID_DUPLICATE', `${layerPath}.layer_id`, 'Layer id is missing or duplicated.'));
    } else {
      layerIds.add(layer.layer_id);
    }
    if (!Array.isArray(layer.semantic_labels) || layer.semantic_labels.length === 0) {
      issues.push(issue('NIMI2D_LAYER_INPUT_SEMANTIC_LABEL_MISSING', `${layerPath}.semantic_labels`, 'Semantic labels are required.'));
    } else {
      for (const label of layer.semantic_labels) {
        if (!semanticLabels.has(label)) {
          issues.push(issue('NIMI2D_LAYER_INPUT_SEMANTIC_LABEL_UNKNOWN', `${layerPath}.semantic_labels`, `Unknown semantic label ${label}.`));
        } else {
          semanticSet.add(label);
        }
      }
    }
    if (layer.occlusion_fill !== 'not_applicable' && layer.occlusion_fill !== 'filled_by_upstream') {
      issues.push(issue('NIMI2D_LAYER_INPUT_OCCLUSION_FILL_INVALID', `${layerPath}.occlusion_fill`, 'Invalid occlusion fill state.'));
    }
    if (layer.occlusion_fill === 'filled_by_upstream') {
      anyFilledOcclusion = true;
      if (!layer.occlusion_evidence_ref) {
        issues.push(issue('NIMI2D_LAYER_INPUT_OCCLUSION_EVIDENCE_MISSING', `${layerPath}.occlusion_evidence_ref`, 'Layer occlusion evidence is required.'));
      }
    }
    if (isObject(canvas)) {
      assertCanvasPoint(layer.placement_px, canvas, `${layerPath}.placement_px`, issues, 'NIMI2D_LAYER_INPUT_LAYER_BOUNDS_INVALID');
    }
    assertRect(layer.texture_bounds_px, `${layerPath}.texture_bounds_px`, issues, 'NIMI2D_LAYER_INPUT_LAYER_BOUNDS_INVALID');
    assertRect(layer.visible_bounds_px, `${layerPath}.visible_bounds_px`, issues, 'NIMI2D_LAYER_INPUT_LAYER_BOUNDS_INVALID');
    await validatePngAsset(layer, manifestDir, layerPath, issues);
  }
  if (anyFilledOcclusion && !value.source_evidence?.occlusion_completion_ref) {
    issues.push(issue('NIMI2D_LAYER_INPUT_OCCLUSION_EVIDENCE_MISSING', '$.source_evidence.occlusion_completion_ref', 'Global occlusion completion evidence is required.'));
  }

  const draw = Array.isArray(value.draw_order) ? value.draw_order : [];
  if (draw.length !== layerIds.size || new Set(draw).size !== draw.length || draw.some((id) => !layerIds.has(id))) {
    issues.push(issue('NIMI2D_LAYER_INPUT_DRAW_ORDER_INVALID', '$.draw_order', 'Draw order must list every layer exactly once.'));
  }

  validateSemanticCoverage(value.input_kind, semanticSet, issues);
  validateAnchors(value, canvas, issues);
  validateSlots(value, canvas, issues);

  return result('layer_input', absoluteManifest, issues, value);
}

function hasAny(set, labels) {
  return labels.some((label) => set.has(label));
}

function validateSemanticCoverage(kind, semanticSet, issues) {
  const groupsByKind = {
    character_skin: [['body', 'torso'], ['head', 'face'], ['eye'], ['mouth'], ['outfit']],
    wardrobe_item: [['outfit']],
    accessory_item: [['accessory']],
    prop_item: [['prop']],
    scene_item: [['scene']],
  };
  for (const group of groupsByKind[kind] ?? []) {
    if (!hasAny(semanticSet, group)) {
      issues.push(issue('NIMI2D_LAYER_INPUT_REQUIRED_SEMANTIC_COVERAGE_MISSING', '$.layers', `Missing required semantic coverage: ${group.join('|')}.`));
    }
  }
}

function validateAnchors(value, canvas, issues) {
  const anchors = Array.isArray(value.global_anchor_hints) ? value.global_anchor_hints : [];
  if (anchors.length === 0) {
    issues.push(issue('NIMI2D_LAYER_INPUT_ANCHOR_HINT_MISSING', '$.global_anchor_hints', 'Anchor hints are required.'));
    return;
  }
  const kinds = new Set();
  for (const [index, anchor] of anchors.entries()) {
    const base = `$.global_anchor_hints[${index}]`;
    if (!anchorKinds.has(anchor.kind)) {
      issues.push(issue('NIMI2D_LAYER_INPUT_ANCHOR_HINT_MISSING', `${base}.kind`, 'Unknown anchor kind.'));
    } else {
      kinds.add(anchor.kind);
    }
    if (isObject(canvas)) assertCanvasPoint(anchor.point_px, canvas, `${base}.point_px`, issues, 'NIMI2D_LAYER_INPUT_ANCHOR_OUT_OF_BOUNDS');
  }
  if (value.input_kind === 'character_skin') {
    for (const required of requiredCharacterAnchors) {
      if (!kinds.has(required)) {
        issues.push(issue('NIMI2D_LAYER_INPUT_ANCHOR_HINT_MISSING', '$.global_anchor_hints', `Missing required anchor ${required}.`));
      }
    }
  }
}

function validateSlots(value, canvas, issues) {
  const slots = Array.isArray(value.global_slot_hints) ? value.global_slot_hints : [];
  if (slots.length === 0) {
    issues.push(issue('NIMI2D_LAYER_INPUT_SLOT_HINT_INVALID', '$.global_slot_hints', 'Slot hints are required.'));
    return;
  }
  const kinds = new Set();
  for (const [index, slot] of slots.entries()) {
    const base = `$.global_slot_hints[${index}]`;
    if (!slotKinds.has(slot.kind)) {
      issues.push(issue('NIMI2D_LAYER_INPUT_SLOT_HINT_INVALID', `${base}.kind`, 'Unknown slot kind.'));
    } else {
      kinds.add(slot.kind);
    }
    assertRect(slot.bounds_px, `${base}.bounds_px`, issues, 'NIMI2D_LAYER_INPUT_SLOT_HINT_INVALID');
    if (isObject(canvas) && isObject(slot.bounds_px)) {
      const rect = slot.bounds_px;
      if (rect.x < 0 || rect.y < 0 || rect.x + rect.width > canvas.width_px || rect.y + rect.height > canvas.height_px) {
        issues.push(issue('NIMI2D_LAYER_INPUT_SLOT_HINT_INVALID', `${base}.bounds_px`, 'Slot bounds are outside canvas.'));
      }
    }
  }
  const requiredByKind = {
    wardrobe_item: ['outfit_upper', 'outfit_lower', 'outfit_full'],
    accessory_item: ['accessory_head', 'accessory_face', 'accessory_hand'],
    prop_item: ['prop_hand'],
    scene_item: ['scene_back', 'scene_front'],
  };
  const requiredAny = requiredByKind[value.input_kind];
  if (requiredAny && !requiredAny.some((kind) => kinds.has(kind))) {
    issues.push(issue('NIMI2D_LAYER_INPUT_SLOT_HINT_INVALID', '$.global_slot_hints', `Missing one of ${requiredAny.join(', ')}.`));
  }
}
