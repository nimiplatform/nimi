import {
  tiers,
  isObject,
  issue,
  requireFields,
} from './common.mjs';

const tierMandatoryChannels = {
  'tier-0_static_layered': [
    'layer_input_lineage',
    'base_body_topology',
    'default_outfit_binding',
    'static_draw_order',
  ],
  'tier-1_agent_basic': [
    'layer_input_lineage',
    'base_body_topology',
    'default_outfit_binding',
    'static_draw_order',
    'wardrobe_reuse',
    'discrete_expression_set',
    'blink_eye_open_close',
    'gaze_anchor_channels',
    'jaw_amplitude_mouth',
    'motion_primitive_refs',
    'safe_motion_bounds',
  ],
  'tier-2_viseme_gesture': [
    'layer_input_lineage',
    'base_body_topology',
    'default_outfit_binding',
    'static_draw_order',
    'wardrobe_reuse',
    'discrete_expression_set',
    'expression_interpolation',
    'blink_eye_open_close',
    'gaze_anchor_channels',
    'jaw_amplitude_mouth',
    'aeiou_viseme_shapes',
    'motion_primitive_refs',
    'safe_motion_bounds',
    'gesture_overlay_channels',
    'local_attachment_secondary_motion',
  ],
  'tier-3_full_body_semantic': [
    'layer_input_lineage',
    'base_body_topology',
    'default_outfit_binding',
    'static_draw_order',
    'wardrobe_reuse',
    'discrete_expression_set',
    'expression_interpolation',
    'blink_eye_open_close',
    'gaze_anchor_channels',
    'jaw_amplitude_mouth',
    'aeiou_viseme_shapes',
    'motion_primitive_refs',
    'safe_motion_bounds',
    'gesture_overlay_channels',
    'local_attachment_secondary_motion',
    'full_body_pose_families',
    'full_body_gesture_primitives',
    'wardrobe_aware_deformation_masks',
  ],
};

const admittedCapabilityChannels = new Set([
  ...Object.values(tierMandatoryChannels).flat(),
  'expression_interpolation',
  'aeiou_viseme_shapes',
  'gesture_overlay_channels',
  'local_attachment_secondary_motion',
  'full_body_pose_families',
  'full_body_gesture_primitives',
  'wardrobe_aware_deformation_masks',
]);

function validateCapability(value, issues) {
  const cap = value.capability;
  requireFields(cap, ['requested_tier', 'proven_tier', 'channel_matrix_ref', 'channel_evidence'], 'NIMI2D_PACKAGE_CAPABILITY_INVALID', '$.capability', issues);
  if (!tiers.has(cap?.requested_tier)) issues.push(issue('NIMI2D_PACKAGE_CAPABILITY_INVALID', '$.capability.requested_tier', 'Unknown requested tier.'));
  if (!tiers.has(cap?.proven_tier)) issues.push(issue('NIMI2D_PACKAGE_CAPABILITY_INVALID', '$.capability.proven_tier', 'Unknown proven tier.'));
  const evidenceMap = isObject(cap?.channel_evidence) ? cap.channel_evidence : {};
  if (!isObject(cap?.channel_evidence)) {
    issues.push(issue('NIMI2D_PACKAGE_CAPABILITY_INVALID', '$.capability.channel_evidence', 'Channel evidence must be an object.'));
  }
  for (const channel of Object.keys(evidenceMap)) {
    if (!admittedCapabilityChannels.has(channel)) {
      issues.push(issue('NIMI2D_PACKAGE_CAPABILITY_INVALID', `$.capability.channel_evidence.${channel}`, 'Unknown capability channel.'));
    }
  }
  for (const channel of tierMandatoryChannels[cap?.proven_tier] ?? []) {
    const evidence = evidenceMap[channel];
    if (!isObject(evidence) || evidence.status !== 'proven') {
      issues.push(issue('NIMI2D_PACKAGE_CAPABILITY_INVALID', `$.capability.channel_evidence.${channel}`, `Missing proven mandatory channel ${channel}.`));
    }
  }
  if (cap?.proven_tier === 'tier-1_agent_basic') {
    const evidence = cap.channel_evidence?.aeiou_viseme_shapes;
    if (evidence && evidence.status !== 'unsupported' && evidence.status !== false) {
      issues.push(issue('NIMI2D_PACKAGE_TIER1_TRUE_VISEME_FORBIDDEN', '$.capability.channel_evidence.aeiou_viseme_shapes', 'Tier-1 must not claim true AEIOU viseme.'));
    }
  }
}

function tierRank(tier) {
  return [
    'tier-0_static_layered',
    'tier-1_agent_basic',
    'tier-2_viseme_gesture',
    'tier-3_full_body_semantic',
  ].indexOf(tier);
}

function hasSemanticLayer(input, semantic) {
  return input.layers.some((layer) => layer.semantic_labels.includes(semantic));
}

function hasAnchor(input, kind) {
  return input.global_anchor_hints.some((anchor) => anchor.kind === kind);
}

function hasSlot(input, kind) {
  return input.global_slot_hints.some((slot) => slot.kind === kind);
}

function canProveTier1(input) {
  return hasSemanticLayer(input, 'eye')
    && hasSemanticLayer(input, 'mouth')
    && hasSemanticLayer(input, 'outfit')
    && hasAnchor(input, 'left_eye_center')
    && hasAnchor(input, 'right_eye_center')
    && hasAnchor(input, 'head_center')
    && hasAnchor(input, 'mouth_center')
    && (hasSlot(input, 'outfit_upper') || hasSlot(input, 'outfit_lower') || hasSlot(input, 'outfit_full'));
}

function tier1ChannelEvidence(input) {
  const mouthLayers = input.layers.filter((layer) => layer.semantic_labels.includes('mouth')).map((layer) => layer.layer_id);
  const eyeLayers = input.layers.filter((layer) => layer.semantic_labels.includes('eye')).map((layer) => layer.layer_id);
  const faceLayers = input.layers.filter((layer) => layer.semantic_labels.some((label) => ['face', 'mouth', 'eye', 'brow'].includes(label))).map((layer) => layer.layer_id);
  const outfitLayers = input.layers.filter((layer) => layer.semantic_labels.includes('outfit')).map((layer) => layer.layer_id);
  return {
    wardrobe_reuse: {
      status: 'proven',
      default_outfit_layer_refs: outfitLayers,
      topology_ref: 'nimi.nimi2d.base-body.topology@1',
    },
    discrete_expression_set: {
      status: 'proven',
      implementation: 'layer_group_opacity_and_transform',
      expressions: ['neutral', 'listen', 'think', 'curious'],
      layer_refs: faceLayers,
    },
    blink_eye_open_close: {
      status: 'proven',
      implementation: 'eye_layer_opacity_channel',
      layer_refs: eyeLayers,
      anchors: ['left_eye_center', 'right_eye_center'],
    },
    gaze_anchor_channels: {
      status: 'proven',
      implementation: 'anchor_relative_gaze_offset',
      anchors: ['head_center', 'left_eye_center', 'right_eye_center'],
      safe_offset_px: { x: [-2, 2], y: [-1, 1] },
    },
    jaw_amplitude_mouth: {
      status: 'proven',
      implementation: 'mouth_layer_scale_y_channel',
      layer_refs: mouthLayers,
      anchor: 'mouth_center',
      scale_y_range: [1, 1.32],
      safe_closed_reset: true,
    },
    motion_primitive_refs: {
      status: 'proven',
      primitives: ['idle', 'listen', 'speak', 'think', 'greet'],
      implementation: 'safe_layer_transform_routes',
    },
    safe_motion_bounds: {
      status: 'proven',
      translate_x_range_px: [-4, 4],
      translate_y_range_px: [-8, 4],
      scale_range: [0.98, 1.04],
      opacity_range: [0.72, 1],
    },
    aeiou_viseme_shapes: {
      status: 'unsupported',
      reason: 'tier-1 uses jaw/amplitude mouth only',
    },
  };
}

function solveProvenTier(input, requestedTier) {
  if (tierRank(requestedTier) >= tierRank('tier-1_agent_basic') && canProveTier1(input)) {
    return 'tier-1_agent_basic';
  }
  return 'tier-0_static_layered';
}

export {
  tierMandatoryChannels,
  validateCapability,
  solveProvenTier,
  tier1ChannelEvidence,
};
