import { parseNimi2DPackageManifest } from './package-manifest.mjs';
import { parseNimi2DBackendCapabilityProfile } from './capability-profile.mjs';

function dirname(filePath) {
  const normalized = String(filePath).replace(/\\/g, '/');
  const index = normalized.lastIndexOf('/');
  return index === -1 ? '' : normalized.slice(0, index);
}

function joinPath(base, ref) {
  if (/^[a-z][a-z0-9+.-]*:/iu.test(ref) || ref.startsWith('/') || ref.startsWith('\\\\')) {
    return ref;
  }
  const prefix = base ? `${base.replace(/\/+$/u, '')}/` : '';
  return `${prefix}${ref.replace(/^\/+/u, '')}`;
}

function assetForLayerRef(assets, layerRef) {
  return assets.find((asset) => asset.asset_id === layerRef || asset.asset_id === `asset_${layerRef}`) ?? null;
}

function assetForRenderLayer(assets, renderLayer) {
  return assets.find((asset) => asset.asset_id === renderLayer.asset_id) ?? assetForLayerRef(assets, renderLayer.layer_ref);
}

function defaultRenderableWardrobeAssets(manifest, defaultOutfit) {
  return manifest.wardrobe.assets.filter((asset) => (
    asset.wardrobe_asset_id === defaultOutfit.wardrobe_asset_id
    || ['accessory', 'hair_variant', 'held_prop', 'scene_layer'].includes(asset.wardrobe_kind)
  ));
}

function createNimi2DRenderPlan(input) {
  const manifest = parseNimi2DPackageManifest(input.packageManifestRaw);
  const capabilityProfile = input.capabilityProfileRaw
    ? parseNimi2DBackendCapabilityProfile(input.capabilityProfileRaw)
    : null;
  const defaultOutfit = manifest.wardrobe.assets.find(
    (asset) => asset.wardrobe_asset_id === manifest.wardrobe.default_outfit_ref,
  );
  if (!defaultOutfit) {
    throw new Error('Nimi2D package default outfit is missing');
  }
  const selectedWardrobeAssets = defaultRenderableWardrobeAssets(manifest, defaultOutfit);
  const manifestDir = dirname(input.packageManifestRef ?? '');
  const requiredLayerRefs = new Set([
    ...manifest.base_body.layer_refs,
    ...selectedWardrobeAssets.flatMap((asset) => asset.layer_refs),
  ]);
  const renderLayers = manifest.render_layers
    .filter((layer) => requiredLayerRefs.has(layer.layer_ref))
    .sort((left, right) => left.draw_order_index - right.draw_order_index)
    .map((layer) => {
    const asset = assetForRenderLayer(manifest.assets, layer);
    if (!asset) {
      throw new Error(`Nimi2D package layer ${layer.layer_ref} has no asset`);
    }
    const maskAsset = layer.mask ? manifest.assets.find((item) => item.asset_id === layer.mask.asset_id) : null;
    if (layer.mask && !maskAsset) {
      throw new Error(`Nimi2D package layer ${layer.layer_ref} mask has no asset`);
    }
    return {
      layerRef: layer.layer_ref,
      asset,
      src: joinPath(manifestDir, asset.ref),
      drawOrderIndex: layer.draw_order_index,
      placementPx: layer.placement_px,
      textureBoundsPx: layer.texture_bounds_px,
      visibleBoundsPx: layer.visible_bounds_px,
      mask: layer.mask && maskAsset ? {
        maskKind: layer.mask.mask_kind,
        asset: maskAsset,
        src: joinPath(manifestDir, maskAsset.ref),
        channel: layer.mask.channel,
        textureBoundsPx: layer.mask.texture_bounds_px,
      } : null,
    };
  });
  if (renderLayers.length !== requiredLayerRefs.size) {
    throw new Error('Nimi2D package render_layers do not cover default renderable layers');
  }
  return {
    manifest,
    capabilityProfile,
    renderLayers,
    sourceCanvas: {
      width: manifest.canvas.width_px,
      height: manifest.canvas.height_px,
    },
    canvas: {
      width: capabilityProfile?.renderer.canvas.width_px ?? manifest.canvas.width_px,
      height: capabilityProfile?.renderer.canvas.height_px ?? manifest.canvas.height_px,
    },
  };
}

export { createNimi2DRenderPlan };
