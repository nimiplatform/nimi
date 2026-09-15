import {
  tiers,
  isObject,
  issue,
  requireFields,
} from './common.mjs';

const channelMatrixRef = '.nimi/spec/nimi2d/asset-package.authority.yaml';

const tierRank = {
  'tier-0_static_layered': 0,
  'tier-1_agent_basic': 1,
  'tier-2_viseme_gesture': 2,
  'tier-3_full_body_semantic': 3,
};

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

function hasRetainedAttestation(evidence) {
  return isObject(evidence?.attestation)
    && typeof evidence.attestation.evidence_ref === 'string'
    && evidence.attestation.evidence_ref.length > 0;
}

function verifyLayerInputLineage(value) {
  const source = value.source;
  return isObject(source)
    && ['layer_input_ref', 'layer_generation_ref', 'identity_preservation_ref', 'content_admission_ref']
      .every((field) => typeof source[field] === 'string' && source[field].length > 0);
}

function verifyDefaultOutfitBinding(value) {
  if (value.package_kind !== 'character_package') return false;
  const wardrobe = value.wardrobe;
  if (!isObject(wardrobe) || typeof wardrobe.default_outfit_ref !== 'string' || wardrobe.default_outfit_ref.length === 0) {
    return false;
  }
  const assets = Array.isArray(wardrobe.assets) ? wardrobe.assets : [];
  return assets.some((asset) => asset?.wardrobe_asset_id === wardrobe.default_outfit_ref && asset?.wardrobe_kind === 'default_outfit');
}

function verifyStaticDrawOrder(value) {
  const layers = Array.isArray(value.render_layers) ? value.render_layers : [];
  if (layers.length === 0) return false;
  const orders = new Set();
  for (const layer of layers) {
    if (!Number.isInteger(layer?.draw_order_index) || layer.draw_order_index < 0 || orders.has(layer.draw_order_index)) {
      return false;
    }
    orders.add(layer.draw_order_index);
  }
  for (let index = 0; index < layers.length; index += 1) {
    if (!orders.has(index)) return false;
  }
  return true;
}

// The validator only counts a channel as proven when it owns an actual
// verification for that channel. Channels without a validator-owned
// verification cannot be claimed proven; claiming them is self-declared
// success (rule.nimi.nimi2d.asset-package.r036/r044).
const channelVerifiers = {
  layer_input_lineage: verifyLayerInputLineage,
  default_outfit_binding: verifyDefaultOutfitBinding,
  static_draw_order: verifyStaticDrawOrder,
};

function computeProvenTier(value) {
  const evidenceMap = isObject(value.capability?.channel_evidence) ? value.capability.channel_evidence : {};
  const orderedTiers = ['tier-3_full_body_semantic', 'tier-2_viseme_gesture', 'tier-1_agent_basic', 'tier-0_static_layered'];
  for (const tier of orderedTiers) {
    const proven = tierMandatoryChannels[tier].every((channel) => {
      const verify = channelVerifiers[channel];
      const evidence = evidenceMap[channel];
      return typeof verify === 'function'
        && verify(value)
        && isObject(evidence)
        && evidence.status === 'proven'
        && hasRetainedAttestation(evidence);
    });
    if (proven) return tier;
  }
  return null;
}

function validateCapability(value, issues) {
  const cap = value.capability;
  requireFields(cap, ['requested_tier', 'proven_tier', 'channel_matrix_ref', 'channel_evidence'], 'NIMI2D_PACKAGE_CAPABILITY_INVALID', '$.capability', issues);
  if (!tiers.has(cap?.requested_tier)) issues.push(issue('NIMI2D_PACKAGE_CAPABILITY_INVALID', '$.capability.requested_tier', 'Unknown requested tier.'));
  if (!tiers.has(cap?.proven_tier)) issues.push(issue('NIMI2D_PACKAGE_CAPABILITY_INVALID', '$.capability.proven_tier', 'Unknown proven tier.'));
  if (cap?.channel_matrix_ref !== channelMatrixRef) issues.push(issue('NIMI2D_PACKAGE_CAPABILITY_INVALID', '$.capability.channel_matrix_ref', 'Channel matrix ref must be the admitted literal.'));
  const evidenceMap = isObject(cap?.channel_evidence) ? cap.channel_evidence : {};
  if (!isObject(cap?.channel_evidence)) {
    issues.push(issue('NIMI2D_PACKAGE_CAPABILITY_INVALID', '$.capability.channel_evidence', 'Channel evidence must be an object.'));
  }
  for (const channel of Object.keys(evidenceMap)) {
    if (!admittedCapabilityChannels.has(channel)) {
      issues.push(issue('NIMI2D_PACKAGE_CAPABILITY_INVALID', `$.capability.channel_evidence.${channel}`, 'Unknown capability channel.'));
    }
    const evidence = evidenceMap[channel];
    if (isObject(evidence) && evidence.status === 'proven' && !hasRetainedAttestation(evidence)) {
      issues.push(issue('NIMI2D_PACKAGE_CAPABILITY_INVALID', `$.capability.channel_evidence.${channel}`, `Proven channel ${channel} requires a retained attestation.`));
    }
  }
  for (const channel of Object.keys(evidenceMap)) {
    const evidence = evidenceMap[channel];
    if (!isObject(evidence) || evidence.status !== 'proven') continue;
    const verify = channelVerifiers[channel];
    if (typeof verify !== 'function') {
      issues.push(issue('NIMI2D_PACKAGE_PROVEN_TIER_UNVERIFIED', `$.capability.channel_evidence.${channel}`, `Channel ${channel} has no validator-owned verification and cannot be claimed proven.`));
    } else if (!verify(value)) {
      issues.push(issue('NIMI2D_PACKAGE_PROVEN_TIER_UNVERIFIED', `$.capability.channel_evidence.${channel}`, `Channel ${channel} does not satisfy validator-owned verification.`));
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
  const computedTier = computeProvenTier(value);
  if (tiers.has(cap?.proven_tier) && (computedTier === null || tierRank[cap.proven_tier] > tierRank[computedTier])) {
    issues.push(issue('NIMI2D_PACKAGE_PROVEN_TIER_UNVERIFIED', '$.capability.proven_tier', 'Proven tier is validator-computed; declared tier exceeds the fully proven tier.'));
  }
}

export {
  tierMandatoryChannels,
  channelMatrixRef,
  computeProvenTier,
  validateCapability,
};
