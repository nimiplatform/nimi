const LAYER_MANIFEST_KIND = 'nimi.nimi2d.layer-input';
const PACKAGE_MANIFEST_KIND = 'nimi.nimi2d.package';

const layerTopLevelFields = new Set([
  'manifest_kind',
  'schema_version',
  'input_id',
  'input_kind',
  'canvas',
  'coordinate_space',
  'source_evidence',
  'layers',
  'draw_order',
  'global_anchor_hints',
  'global_slot_hints',
]);

const packageTopLevelFields = new Set([
  'manifest_kind',
  'schema_version',
  'package_id',
  'package_version',
  'package_kind',
  'canvas',
  'source',
  'integrity',
  'governance',
  'capability',
  'base_body',
  'wardrobe',
  'render_layers',
  'scenes',
  'assets',
]);

const layerInputKinds = new Set([
  'character_skin',
  'wardrobe_item',
  'accessory_item',
  'prop_item',
  'scene_item',
]);

const semanticLabels = new Set([
  'head',
  'face',
  'eye',
  'brow',
  'mouth',
  'nose',
  'ear',
  'hair',
  'neck',
  'torso',
  'arm',
  'hand',
  'leg',
  'foot',
  'body',
  'outfit',
  'accessory',
  'prop',
  'scene',
  'shadow',
  'effect',
]);

const requiredCharacterAnchors = [
  'body_root',
  'neck_base',
  'head_center',
  'face_center',
  'left_eye_center',
  'right_eye_center',
  'mouth_center',
];

const anchorKinds = new Set([
  ...requiredCharacterAnchors,
  'attachment_point',
  'scene_origin',
]);

const slotKinds = new Set([
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
  'scene_back',
  'scene_front',
]);

const packageKinds = new Set([
  'character_package',
  'wardrobe_asset_package',
  'prop_package',
  'scene_package',
]);

const tiers = new Set([
  'tier-0_static_layered',
  'tier-1_agent_basic',
  'tier-2_viseme_gesture',
  'tier-3_full_body_semantic',
]);

const wardrobeKinds = new Set([
  'default_outfit',
  'outfit',
  'accessory',
  'hair_variant',
  'held_prop',
  'scene_layer',
]);

const forbiddenLayerFields = new Set([
  'raw_image_ref',
  'source_image_ref',
  'prompt',
  'segmentation_mask_generator',
  'inpainting_model',
  'runtime_channel',
  'avatar_route_id',
  'apml',
  'raw_apml',
  'pixi_runtime',
  'blend_tree',
  'composer',
]);

const forbiddenPackageFields = new Set([
  'blend_tree',
  'runtime_composer',
  'performance_stream',
  'avatar_route_id',
  'backend_kind',
  'pixi_runtime',
  'raw_apml',
  'apml',
  'runtime_timeline',
  'audio_consumer',
  'hit_region_runtime',
]);

const benchForbiddenFields = new Set([
  'raw_image_ref',
  'source_image_ref',
  'segmentation_prompt',
  'inpainting_prompt',
  'adult_fixture_v1',
  'partial_success',
  'selected_successful_cases_only',
  'manual_unrecorded_correction',
  'raw_image_input',
  'tier1_true_viseme_success',
  'occlusion_pass_rate_nimi2d_owned',
]);

const packageAssetFields = new Set([
  'asset_id',
  'asset_kind',
  'ref',
  'sha256',
  'format',
  'width_px',
  'height_px',
  'byte_size',
  'color_space',
  'alpha_mode',
  'premultiplied_alpha',
]);

const packageRenderLayerMaskFields = new Set([
  'mask_kind',
  'asset_id',
  'channel',
  'texture_bounds_px',
]);

export {
  LAYER_MANIFEST_KIND,
  PACKAGE_MANIFEST_KIND,
  layerTopLevelFields,
  packageTopLevelFields,
  layerInputKinds,
  semanticLabels,
  requiredCharacterAnchors,
  anchorKinds,
  slotKinds,
  packageKinds,
  tiers,
  wardrobeKinds,
  forbiddenLayerFields,
  forbiddenPackageFields,
  benchForbiddenFields,
  packageAssetFields,
  packageRenderLayerMaskFields,
};
