function layerAssetKind(layer) {
  if (layer.semantic_labels.includes('outfit')) return 'wardrobe_layer';
  if (layer.semantic_labels.includes('accessory')) return 'accessory_layer';
  if (layer.semantic_labels.includes('prop')) return 'prop_layer';
  if (layer.semantic_labels.includes('scene')) return 'scene_layer';
  return 'base_body_layer';
}

function layerRefsWithSemantic(input, semantic) {
  return input.layers.filter((layer) => layer.semantic_labels.includes(semantic)).map((layer) => layer.layer_id);
}

function slotKindsWithPrefix(input, prefix) {
  return input.global_slot_hints.map((slot) => slot.kind).filter((kind) => kind.startsWith(prefix));
}

function buildWardrobeAssets(input, outfitLayerRefs) {
  const assets = [
    {
      wardrobe_asset_id: `n2d_default_outfit_${input.input_id}`,
      wardrobe_kind: 'default_outfit',
      compatible_topology_id: 'nimi.nimi2d.base-body.topology',
      compatible_topology_version: 1,
      owns_main_rig: false,
      slot_bindings: input.global_slot_hints.map((slot) => slot.kind).filter((kind) => kind.startsWith('outfit_') || ['torso', 'hip', 'left_arm', 'right_arm', 'left_leg', 'right_leg'].includes(kind)),
      coverage: ['full'],
      draw_order_group: 'default_outfit',
      layer_refs: outfitLayerRefs,
    },
  ];
  const accessoryLayerRefs = layerRefsWithSemantic(input, 'accessory');
  if (accessoryLayerRefs.length > 0) {
    assets.push({
      wardrobe_asset_id: `n2d_accessory_${input.input_id}`,
      wardrobe_kind: 'accessory',
      compatible_topology_id: 'nimi.nimi2d.base-body.topology',
      compatible_topology_version: 1,
      owns_main_rig: false,
      slot_bindings: slotKindsWithPrefix(input, 'accessory_'),
      coverage: ['accessory'],
      draw_order_group: 'accessory',
      layer_refs: accessoryLayerRefs,
    });
  }
  const propLayerRefs = layerRefsWithSemantic(input, 'prop');
  if (propLayerRefs.length > 0) {
    assets.push({
      wardrobe_asset_id: `n2d_held_prop_${input.input_id}`,
      wardrobe_kind: 'held_prop',
      compatible_topology_id: 'nimi.nimi2d.base-body.topology',
      compatible_topology_version: 1,
      owns_main_rig: false,
      slot_bindings: slotKindsWithPrefix(input, 'prop_'),
      coverage: ['held_prop'],
      draw_order_group: 'held_prop',
      layer_refs: propLayerRefs,
    });
  }
  const sceneLayerRefs = layerRefsWithSemantic(input, 'scene');
  if (sceneLayerRefs.length > 0) {
    assets.push({
      wardrobe_asset_id: `n2d_scene_layer_${input.input_id}`,
      wardrobe_kind: 'scene_layer',
      compatible_topology_id: 'nimi.nimi2d.base-body.topology',
      compatible_topology_version: 1,
      owns_main_rig: false,
      slot_bindings: slotKindsWithPrefix(input, 'scene_'),
      coverage: ['scene'],
      draw_order_group: 'scene',
      layer_refs: sceneLayerRefs,
    });
  }
  return assets;
}

export {
  layerAssetKind,
  layerRefsWithSemantic,
  buildWardrobeAssets,
};
