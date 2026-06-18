import {
  asRecord,
  stringField,
  optionalString,
  stringArray,
  nonEmptyStringArray,
  positiveInteger,
  nonNegativeInteger,
  pointField,
  rectField,
  assertAssetMetadata,
  rectFitsDimensions,
  rectSameSize,
  parseYamlObject,
  isTier,
} from './common.mjs';

function optionalRenderLayerMask(value, path) {
  if (value === undefined || value === null) return null;
  const mask = asRecord(value, path);
  const maskKind = stringField(mask.mask_kind, `${path}.mask_kind`);
  if (maskKind !== 'alpha_mask_asset') {
    throw new Error(`Nimi2D package ${path}.mask_kind must be alpha_mask_asset`);
  }
  const channel = stringField(mask.channel, `${path}.channel`);
  if (channel !== 'alpha') {
    throw new Error(`Nimi2D package ${path}.channel must be alpha`);
  }
  return {
    mask_kind: maskKind,
    asset_id: stringField(mask.asset_id, `${path}.asset_id`),
    channel,
    texture_bounds_px: rectField(mask.texture_bounds_px, `${path}.texture_bounds_px`),
  };
}

function parseNimi2DPackageManifest(raw) {
  const value = parseYamlObject(raw, 'manifest');
  if (value.manifest_kind !== 'nimi.nimi2d.package') {
    throw new Error('Nimi2D package manifest_kind is invalid');
  }
  if (value.schema_version !== 1) {
    throw new Error('Nimi2D package schema_version is unsupported');
  }
  if (value.package_kind !== 'character_package') {
    throw new Error('Nimi2D runtime only admits character_package');
  }
  const governance = asRecord(value.governance, 'governance');
  if (governance.base_body_renderable !== false) {
    throw new Error('Nimi2D package base_body_renderable must be false');
  }
  if (governance.default_outfit_required !== true) {
    throw new Error('Nimi2D package default outfit is required');
  }
  if (governance.adult_capability !== 'unavailable_v1') {
    throw new Error('Nimi2D package adult capability is unavailable in v1');
  }
  if (governance.underage_body_content !== 'rejected_or_not_present') {
    throw new Error('Nimi2D package underage body content must be rejected or not present');
  }
  const capability = asRecord(value.capability, 'capability');
  if (!isTier(capability.proven_tier) || !isTier(capability.requested_tier)) {
    throw new Error('Nimi2D package capability tier is invalid');
  }
  const canvas = asRecord(value.canvas, 'canvas');
  const baseBody = asRecord(value.base_body, 'base_body');
  if (baseBody.renderable !== false || baseBody.detail_neutral !== true) {
    throw new Error('Nimi2D base body must be non-renderable and detail-neutral');
  }
  const wardrobe = asRecord(value.wardrobe, 'wardrobe');
  const defaultOutfitRef = stringField(wardrobe.default_outfit_ref, 'wardrobe.default_outfit_ref');
  const wardrobeAssets = Array.isArray(wardrobe.assets) ? wardrobe.assets.map((item, index) => {
    const asset = asRecord(item, `wardrobe.assets[${index}]`);
    return {
      wardrobe_asset_id: stringField(asset.wardrobe_asset_id, `wardrobe.assets[${index}].wardrobe_asset_id`),
      wardrobe_kind: stringField(asset.wardrobe_kind, `wardrobe.assets[${index}].wardrobe_kind`),
      layer_refs: stringArray(asset.layer_refs, `wardrobe.assets[${index}].layer_refs`),
    };
  }) : [];
  const defaultOutfit = wardrobeAssets.find((asset) => asset.wardrobe_asset_id === defaultOutfitRef);
  if (!defaultOutfit || defaultOutfit.wardrobe_kind !== 'default_outfit') {
    throw new Error('Nimi2D package default outfit is missing');
  }
  if (defaultOutfit.layer_refs.length === 0) {
    throw new Error('Nimi2D package default outfit has no visible layers');
  }
  const source = asRecord(value.source ?? {}, 'source');
  const integrity = value.integrity == null ? null : asRecord(value.integrity, 'integrity');
  const assets = Array.isArray(value.assets) ? value.assets.map((item, index) => {
    const asset = asRecord(item, `assets[${index}]`);
    return {
      asset_id: stringField(asset.asset_id, `assets[${index}].asset_id`),
      asset_kind: stringField(asset.asset_kind, `assets[${index}].asset_kind`),
      ref: stringField(asset.ref, `assets[${index}].ref`),
      sha256: stringField(asset.sha256, `assets[${index}].sha256`),
      ...assertAssetMetadata(asset, index),
    };
  }) : [];
  if (assets.length === 0) {
    throw new Error('Nimi2D package assets are required');
  }
  const renderLayers = Array.isArray(value.render_layers) ? value.render_layers.map((item, index) => {
    const layer = asRecord(item, `render_layers[${index}]`);
    return {
      layer_ref: stringField(layer.layer_ref, `render_layers[${index}].layer_ref`),
      asset_id: stringField(layer.asset_id, `render_layers[${index}].asset_id`),
      layer_kind: stringField(layer.layer_kind, `render_layers[${index}].layer_kind`),
      draw_order_index: nonNegativeInteger(layer.draw_order_index, `render_layers[${index}].draw_order_index`),
      placement_px: pointField(layer.placement_px, `render_layers[${index}].placement_px`),
      texture_bounds_px: rectField(layer.texture_bounds_px, `render_layers[${index}].texture_bounds_px`),
      visible_bounds_px: rectField(layer.visible_bounds_px, `render_layers[${index}].visible_bounds_px`),
      mask: optionalRenderLayerMask(layer.mask, `render_layers[${index}].mask`),
    };
  }) : [];
  if (renderLayers.length === 0) {
    throw new Error('Nimi2D package render_layers are required');
  }
  const assetsById = new Map(assets.map((asset) => [asset.asset_id, asset]));
  for (const layer of renderLayers) {
    const asset = assetsById.get(layer.asset_id);
    if (!asset) {
      throw new Error(`Nimi2D package render layer ${layer.layer_ref} references a missing asset`);
    }
    if (!rectFitsDimensions(layer.texture_bounds_px, asset.width_px, asset.height_px)) {
      throw new Error(`Nimi2D package render layer ${layer.layer_ref} texture bounds exceed asset dimensions`);
    }
    if (layer.mask) {
      const maskAsset = assetsById.get(layer.mask.asset_id);
      if (!maskAsset) {
        throw new Error(`Nimi2D package render layer ${layer.layer_ref} mask references a missing asset`);
      }
      if (maskAsset.asset_kind !== 'alpha_mask_layer') {
        throw new Error(`Nimi2D package render layer ${layer.layer_ref} mask asset must be alpha_mask_layer`);
      }
      if (!rectFitsDimensions(layer.mask.texture_bounds_px, maskAsset.width_px, maskAsset.height_px)) {
        throw new Error(`Nimi2D package render layer ${layer.layer_ref} mask bounds exceed asset dimensions`);
      }
      if (!rectSameSize(layer.mask.texture_bounds_px, layer.texture_bounds_px)) {
        throw new Error(`Nimi2D package render layer ${layer.layer_ref} mask size must match texture bounds`);
      }
    }
  }
  return {
    manifest_kind: 'nimi.nimi2d.package',
    schema_version: 1,
    package_id: stringField(value.package_id, 'package_id'),
    package_kind: 'character_package',
    canvas: {
      width_px: positiveInteger(canvas.width_px, 'canvas.width_px'),
      height_px: positiveInteger(canvas.height_px, 'canvas.height_px'),
    },
    source: {
      layer_input_ref: optionalString(source.layer_input_ref),
      layer_generation_ref: optionalString(source.layer_generation_ref),
      identity_preservation_ref: optionalString(source.identity_preservation_ref),
      content_admission_ref: optionalString(source.content_admission_ref),
      validator_evidence_ref: optionalString(source.validator_evidence_ref),
    },
    integrity: integrity ? {
      package_digest_sha256: optionalString(integrity.package_digest_sha256),
      asset_count: Number.isInteger(integrity.asset_count) ? integrity.asset_count : null,
    } : null,
    governance,
    capability,
    base_body: {
      renderable: false,
      detail_neutral: true,
      layer_refs: nonEmptyStringArray(baseBody.layer_refs, 'base_body.layer_refs'),
    },
    wardrobe: {
      default_outfit_ref: defaultOutfitRef,
      assets: wardrobeAssets,
    },
    render_layers: renderLayers,
    assets,
  };
}

export { parseNimi2DPackageManifest };
