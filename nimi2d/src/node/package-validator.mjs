import {
  PACKAGE_MANIFEST_KIND,
  packageTopLevelFields,
  forbiddenPackageFields,
  packageKinds,
  anchorKinds,
  requiredCharacterAnchors,
  slotKinds,
  wardrobeKinds,
  packageRenderLayerMaskFields,
  issue,
  result,
  isObject,
  requireFields,
  rejectUnknownFields,
  findForbiddenFields,
  assertRect,
  assertNonNegativePoint,
  rectContains,
  rectFitsDimensions,
  rectSameSize,
  validatePackageAssets,
} from './common.mjs';
import { validateCapability } from './package-capability.mjs';

function validateGovernance(value, issues) {
  const gov = value.governance;
  requireFields(gov, ['base_body_renderable', 'default_outfit_required', 'adult_capability', 'content_admission_ref', 'underage_body_content'], 'NIMI2D_PACKAGE_GOVERNANCE_INVALID', '$.governance', issues);
  if (gov?.base_body_renderable !== false) issues.push(issue('NIMI2D_PACKAGE_BASE_BODY_RENDERABLE_FORBIDDEN', '$.governance.base_body_renderable', 'Base body renderable must be false.'));
  if (value.package_kind === 'character_package' && gov?.default_outfit_required !== true) {
    issues.push(issue('NIMI2D_PACKAGE_DEFAULT_OUTFIT_REQUIRED', '$.governance.default_outfit_required', 'Character packages require default outfit.'));
  }
  if (gov?.adult_capability !== 'unavailable_v1') issues.push(issue('NIMI2D_PACKAGE_ADULT_CAPABILITY_FORBIDDEN', '$.governance.adult_capability', 'Adult capability is unavailable in v1.'));
  if (gov?.underage_body_content !== 'rejected_or_not_present') issues.push(issue('NIMI2D_PACKAGE_CONTENT_EVIDENCE_INVALID', '$.governance.underage_body_content', 'Underage body content must be rejected or absent.'));
}

function validateBaseBody(value, issues) {
  if (value.package_kind === 'character_package') {
    const body = value.base_body;
    requireFields(body, ['base_body_id', 'topology_id', 'topology_version', 'slot_taxonomy_ref', 'skeleton_id', 'anchor_set_id', 'slot_set_id', 'anchors', 'slots', 'morphology_profile_id', 'deformation_topology_id', 'action_topology_ref', 'owns_main_rig', 'renderable', 'detail_neutral', 'layer_refs'], 'NIMI2D_PACKAGE_BASE_BODY_INVALID', '$.base_body', issues);
    if (body?.owns_main_rig !== true) issues.push(issue('NIMI2D_PACKAGE_BASE_BODY_INVALID', '$.base_body.owns_main_rig', 'Base body must own main rig.'));
    if (body?.renderable !== false) issues.push(issue('NIMI2D_PACKAGE_BASE_BODY_RENDERABLE_FORBIDDEN', '$.base_body.renderable', 'Base body must be non-renderable.'));
    if (body?.detail_neutral !== true) issues.push(issue('NIMI2D_PACKAGE_BASE_BODY_INVALID', '$.base_body.detail_neutral', 'Base body must be detail-neutral.'));
    const anchors = Array.isArray(body?.anchors) ? body.anchors : [];
    const anchorKindSet = new Set();
    for (const [index, anchor] of anchors.entries()) {
      if (!anchorKinds.has(anchor?.kind) || !isObject(anchor.point_px)) {
        issues.push(issue('NIMI2D_PACKAGE_BASE_BODY_INVALID', `$.base_body.anchors[${index}]`, 'Resolved anchor must use admitted anchor kind and point.'));
      } else {
        anchorKindSet.add(anchor.kind);
      }
    }
    for (const requiredAnchor of requiredCharacterAnchors) {
      if (!anchorKindSet.has(requiredAnchor)) {
        issues.push(issue('NIMI2D_PACKAGE_BASE_BODY_INVALID', '$.base_body.anchors', `Missing resolved anchor ${requiredAnchor}.`));
      }
    }
    const slots = Array.isArray(body?.slots) ? body.slots : [];
    if (slots.length === 0) {
      issues.push(issue('NIMI2D_PACKAGE_BASE_BODY_INVALID', '$.base_body.slots', 'Resolved slots are required.'));
    }
    for (const [index, slot] of slots.entries()) {
      if (!slotKinds.has(slot?.kind) || !isObject(slot.bounds_px)) {
        issues.push(issue('NIMI2D_PACKAGE_BASE_BODY_INVALID', `$.base_body.slots[${index}]`, 'Resolved slot must use admitted slot kind and bounds.'));
      }
    }
  } else if (value.base_body !== null) {
    issues.push(issue('NIMI2D_PACKAGE_BASE_BODY_INVALID', '$.base_body', 'Only character_package may contain non-null base_body.'));
  }
}

function validateWardrobe(value, issues) {
  const wardrobe = value.wardrobe;
  if (!isObject(wardrobe)) {
    issues.push(issue('NIMI2D_PACKAGE_WARDROBE_INVALID', '$.wardrobe', 'Wardrobe object is required.'));
    return;
  }
  const assets = Array.isArray(wardrobe.assets) ? wardrobe.assets : [];
  if (value.package_kind === 'character_package') {
    if (!wardrobe.default_outfit_ref) issues.push(issue('NIMI2D_PACKAGE_DEFAULT_OUTFIT_REQUIRED', '$.wardrobe.default_outfit_ref', 'Default outfit ref is required.'));
    const defaultOutfit = assets.find((asset) => asset.wardrobe_asset_id === wardrobe.default_outfit_ref);
    if (!defaultOutfit || defaultOutfit.wardrobe_kind !== 'default_outfit') {
      issues.push(issue('NIMI2D_PACKAGE_DEFAULT_OUTFIT_REQUIRED', '$.wardrobe.default_outfit_ref', 'Default outfit must reference a default_outfit asset.'));
    }
  }
  for (const [index, asset] of assets.entries()) {
    const base = `$.wardrobe.assets[${index}]`;
    requireFields(asset, ['wardrobe_asset_id', 'wardrobe_kind', 'compatible_topology_id', 'compatible_topology_version', 'owns_main_rig', 'slot_bindings', 'coverage', 'draw_order_group', 'layer_refs'], 'NIMI2D_PACKAGE_WARDROBE_INVALID', base, issues);
    if (!wardrobeKinds.has(asset.wardrobe_kind)) issues.push(issue('NIMI2D_PACKAGE_WARDROBE_INVALID', `${base}.wardrobe_kind`, 'Unknown wardrobe kind.'));
    if (asset.owns_main_rig !== false) issues.push(issue('NIMI2D_PACKAGE_WARDROBE_OWNS_MAIN_RIG_FORBIDDEN', `${base}.owns_main_rig`, 'Wardrobe must not own main rig.'));
    if (!Array.isArray(asset.slot_bindings) || asset.slot_bindings.some((slot) => !slotKinds.has(slot))) {
      issues.push(issue('NIMI2D_PACKAGE_WARDROBE_SLOT_INVALID', `${base}.slot_bindings`, 'Wardrobe binds unknown slot.'));
    }
  }
}

function packageLayerRefs(value) {
  const refs = new Set(Array.isArray(value.base_body?.layer_refs) ? value.base_body.layer_refs : []);
  const wardrobeAssets = Array.isArray(value.wardrobe?.assets) ? value.wardrobe.assets : [];
  for (const asset of wardrobeAssets) {
    for (const layerRef of Array.isArray(asset.layer_refs) ? asset.layer_refs : []) {
      refs.add(layerRef);
    }
  }
  return refs;
}

function validateRenderLayerMask(mask, base, layer, assets, issues) {
  if (mask === undefined || mask === null) return;
  const maskPath = `${base}.mask`;
  if (!isObject(mask)) {
    issues.push(issue('NIMI2D_PACKAGE_RENDER_LAYER_MASK_INVALID', maskPath, 'Render layer mask must be an object.'));
    return;
  }
  requireFields(mask, ['mask_kind', 'asset_id', 'channel', 'texture_bounds_px'], 'NIMI2D_PACKAGE_RENDER_LAYER_MASK_INVALID', maskPath, issues);
  rejectUnknownFields(mask, packageRenderLayerMaskFields, 'NIMI2D_PACKAGE_RENDER_LAYER_MASK_INVALID', maskPath, issues);
  if (mask.mask_kind !== 'alpha_mask_asset') {
    issues.push(issue('NIMI2D_PACKAGE_RENDER_LAYER_MASK_INVALID', `${maskPath}.mask_kind`, 'Only alpha_mask_asset is admitted.'));
  }
  if (mask.channel !== 'alpha') {
    issues.push(issue('NIMI2D_PACKAGE_RENDER_LAYER_MASK_INVALID', `${maskPath}.channel`, 'Only alpha channel masks are admitted.'));
  }
  const maskAsset = assets.get(mask.asset_id);
  if (typeof mask.asset_id !== 'string' || mask.asset_id.length === 0 || !maskAsset) {
    issues.push(issue('NIMI2D_PACKAGE_RENDER_LAYER_MASK_INVALID', `${maskPath}.asset_id`, 'Render layer mask references missing asset.'));
  } else if (maskAsset.asset_kind !== 'alpha_mask_layer') {
    issues.push(issue('NIMI2D_PACKAGE_RENDER_LAYER_MASK_INVALID', `${maskPath}.asset_id`, 'Render layer mask asset must use alpha_mask_layer kind.'));
  }
  assertRect(mask.texture_bounds_px, `${maskPath}.texture_bounds_px`, issues, 'NIMI2D_PACKAGE_RENDER_LAYER_MASK_INVALID');
  if (maskAsset && isObject(mask.texture_bounds_px) && !rectFitsDimensions(mask.texture_bounds_px, maskAsset.width_px, maskAsset.height_px)) {
    issues.push(issue('NIMI2D_PACKAGE_RENDER_LAYER_MASK_BOUNDS_OUT_OF_RANGE', `${maskPath}.texture_bounds_px`, 'Mask texture bounds must fit inside the referenced mask asset dimensions.'));
  }
  if (isObject(mask.texture_bounds_px) && isObject(layer.texture_bounds_px) && !rectSameSize(mask.texture_bounds_px, layer.texture_bounds_px)) {
    issues.push(issue('NIMI2D_PACKAGE_RENDER_LAYER_MASK_INVALID', `${maskPath}.texture_bounds_px`, 'Mask bounds must match render layer texture bounds size.'));
  }
}

function validateRenderLayers(value, issues) {
  const layers = Array.isArray(value.render_layers) ? value.render_layers : [];
  if (layers.length === 0) {
    issues.push(issue('NIMI2D_PACKAGE_RENDER_LAYER_INVALID', '$.render_layers', 'Render layers are required.'));
    return;
  }
  const requiredRefs = packageLayerRefs(value);
  const assets = new Map((Array.isArray(value.assets) ? value.assets : []).map((asset) => [asset.asset_id, asset]));
  const seenRefs = new Set();
  const seenOrders = new Set();
  for (const [index, layer] of layers.entries()) {
    const base = `$.render_layers[${index}]`;
    requireFields(layer, ['layer_ref', 'asset_id', 'layer_kind', 'draw_order_index', 'placement_px', 'texture_bounds_px', 'visible_bounds_px'], 'NIMI2D_PACKAGE_RENDER_LAYER_INVALID', base, issues);
    if (typeof layer.layer_ref !== 'string' || layer.layer_ref.length === 0) {
      issues.push(issue('NIMI2D_PACKAGE_RENDER_LAYER_INVALID', `${base}.layer_ref`, 'Render layer ref is required.'));
    } else {
      if (seenRefs.has(layer.layer_ref)) {
        issues.push(issue('NIMI2D_PACKAGE_RENDER_LAYER_INVALID', `${base}.layer_ref`, 'Render layer ref is duplicated.'));
      }
      seenRefs.add(layer.layer_ref);
      if (!requiredRefs.has(layer.layer_ref)) {
        issues.push(issue('NIMI2D_PACKAGE_RENDER_LAYER_INVALID', `${base}.layer_ref`, 'Render layer ref is not referenced by base body or wardrobe.'));
      }
    }
    const asset = assets.get(layer.asset_id);
    if (!asset) {
      issues.push(issue('NIMI2D_PACKAGE_RENDER_LAYER_INVALID', `${base}.asset_id`, 'Render layer references missing asset.'));
    } else if (asset.asset_kind !== layer.layer_kind) {
      issues.push(issue('NIMI2D_PACKAGE_RENDER_LAYER_INVALID', `${base}.layer_kind`, 'Render layer kind must match asset kind.'));
    }
    if (!Number.isInteger(layer.draw_order_index) || layer.draw_order_index < 0) {
      issues.push(issue('NIMI2D_PACKAGE_RENDER_LAYER_INVALID', `${base}.draw_order_index`, 'Draw order index must be a non-negative integer.'));
    } else {
      if (seenOrders.has(layer.draw_order_index)) {
        issues.push(issue('NIMI2D_PACKAGE_RENDER_LAYER_INVALID', `${base}.draw_order_index`, 'Draw order index is duplicated.'));
      }
      seenOrders.add(layer.draw_order_index);
    }
    assertNonNegativePoint(layer.placement_px, `${base}.placement_px`, issues, 'NIMI2D_PACKAGE_RENDER_LAYER_INVALID');
    assertRect(layer.texture_bounds_px, `${base}.texture_bounds_px`, issues, 'NIMI2D_PACKAGE_RENDER_LAYER_INVALID');
    assertRect(layer.visible_bounds_px, `${base}.visible_bounds_px`, issues, 'NIMI2D_PACKAGE_RENDER_LAYER_INVALID');
    if (asset && isObject(layer.texture_bounds_px) && !rectFitsDimensions(layer.texture_bounds_px, asset.width_px, asset.height_px)) {
      issues.push(issue('NIMI2D_PACKAGE_RENDER_LAYER_TEXTURE_BOUNDS_OUT_OF_RANGE', `${base}.texture_bounds_px`, 'Texture bounds must fit inside the referenced asset dimensions.'));
    }
    if (isObject(layer.texture_bounds_px) && isObject(layer.visible_bounds_px) && !rectContains(layer.texture_bounds_px, layer.visible_bounds_px)) {
      issues.push(issue('NIMI2D_PACKAGE_RENDER_LAYER_INVALID', `${base}.visible_bounds_px`, 'Visible bounds must be inside texture bounds.'));
    }
    validateRenderLayerMask(layer.mask, base, layer, assets, issues);
  }
  for (const ref of requiredRefs) {
    if (!seenRefs.has(ref)) {
      issues.push(issue('NIMI2D_PACKAGE_RENDER_LAYER_INVALID', '$.render_layers', `Missing render layer ${ref}.`));
    }
  }
  if (seenOrders.size === layers.length) {
    for (let index = 0; index < layers.length; index += 1) {
      if (!seenOrders.has(index)) {
        issues.push(issue('NIMI2D_PACKAGE_RENDER_LAYER_INVALID', '$.render_layers', 'Draw order indexes must be contiguous from zero.'));
        break;
      }
    }
  }
}

async function validatePackageObject(value, options = {}) {
  const temp = options.manifestPath ?? `inline:${value.package_id ?? 'unknown'}`;
  const issues = [];
  rejectUnknownFields(value, packageTopLevelFields, 'NIMI2D_PACKAGE_MANIFEST_INVALID', '$', issues);
  findForbiddenFields(value, forbiddenPackageFields, 'NIMI2D_PACKAGE_FORBIDDEN_RUNTIME_FIELD', '$', issues);
  requireFields(value, ['manifest_kind', 'schema_version', 'package_id', 'package_version', 'package_kind', 'canvas', 'source', 'integrity', 'governance', 'capability', 'base_body', 'wardrobe', 'render_layers', 'assets'], 'NIMI2D_PACKAGE_MANIFEST_INVALID', '$', issues);
  if (value.manifest_kind !== PACKAGE_MANIFEST_KIND) issues.push(issue('NIMI2D_PACKAGE_MANIFEST_INVALID', '$.manifest_kind', 'Invalid package manifest kind.'));
  if (value.schema_version !== 1) issues.push(issue('NIMI2D_PACKAGE_SCHEMA_VERSION_UNSUPPORTED', '$.schema_version', 'Unsupported schema version.'));
  if (!packageKinds.has(value.package_kind)) issues.push(issue('NIMI2D_PACKAGE_MANIFEST_INVALID', '$.package_kind', 'Unknown package kind.'));
  if (!isObject(value.canvas) || !Number.isInteger(value.canvas.width_px) || !Number.isInteger(value.canvas.height_px) || value.canvas.width_px <= 0 || value.canvas.height_px <= 0) {
    issues.push(issue('NIMI2D_PACKAGE_MANIFEST_INVALID', '$.canvas', 'Package canvas dimensions must be positive integers.'));
  }
  validateGovernance(value, issues);
  validateCapability(value, issues);
  validateBaseBody(value, issues);
  validateWardrobe(value, issues);
  await validatePackageAssets(value, options.manifestDir, issues);
  validateRenderLayers(value, issues);
  return result('package_manifest', temp, issues, value);
}

export { validatePackageObject };
