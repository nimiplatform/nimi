import { requiredCharacterAnchors } from './common.mjs';

function scorePackage(manifest) {
  const anchorKindsPresent = new Set((manifest.base_body?.anchors ?? []).map((anchor) => anchor.kind));
  const requiredSlotKinds = ['torso', 'hip', 'outfit_upper', 'outfit_lower', 'outfit_full'];
  const slotKindsPresent = new Set((manifest.base_body?.slots ?? []).map((slot) => slot.kind));
  const anchorHits = requiredCharacterAnchors.filter((kind) => anchorKindsPresent.has(kind)).length;
  const slotHits = requiredSlotKinds.filter((kind) => slotKindsPresent.has(kind)).length;
  const channelEvidence = manifest.capability?.channel_evidence ?? {};
  const defaultOutfitBinding = Boolean(manifest.wardrobe?.default_outfit_ref)
    && (manifest.wardrobe.assets ?? []).some((asset) => asset.wardrobe_asset_id === manifest.wardrobe.default_outfit_ref && asset.wardrobe_kind === 'default_outfit');
  const provenTier = manifest.capability?.proven_tier;
  const expressionUsable = channelEvidence.discrete_expression_set?.status === 'proven';
  const jawAmplitudeUsable = channelEvidence.jaw_amplitude_mouth?.status === 'proven'
    && channelEvidence.aeiou_viseme_shapes?.status !== 'proven';
  const motionPrimitiveUsable = channelEvidence.motion_primitive_refs?.status === 'proven'
    && channelEvidence.safe_motion_bounds?.status === 'proven';
  const runtimeReady = manifest.base_body?.renderable === false && defaultOutfitBinding;
  const failures = [];
  if (anchorHits !== requiredCharacterAnchors.length || slotHits !== requiredSlotKinds.length) failures.push('nimi2d_anchor_slot_solving');
  if (!defaultOutfitBinding) failures.push('nimi2d_wardrobe_binding');
  if (!expressionUsable || !jawAmplitudeUsable || !motionPrimitiveUsable) failures.push('nimi2d_capability_validation');
  if (!runtimeReady) failures.push('nimi2d_package_manifest');
  return {
    anchor_accuracy: anchorHits / requiredCharacterAnchors.length,
    slot_accuracy: slotHits / requiredSlotKinds.length,
    default_outfit_binding_success: defaultOutfitBinding,
    expression_usable: expressionUsable,
    jaw_amplitude_speech_mouth_usable: jawAmplitudeUsable,
    motion_primitive_binding_success: motionPrimitiveUsable,
    package_runtime_admission_ready: runtimeReady,
    no_outfit_no_render: manifest.base_body?.renderable === false && defaultOutfitBinding,
    base_body_only_rejected: manifest.base_body?.renderable === false,
    metrics: {
      anchor_accuracy: anchorHits / requiredCharacterAnchors.length,
      slot_accuracy: slotHits / requiredSlotKinds.length,
      default_outfit_binding_success: defaultOutfitBinding,
      expression_usable: expressionUsable,
      jaw_amplitude_speech_mouth_usable: jawAmplitudeUsable,
      motion_primitive_binding_success: motionPrimitiveUsable,
      package_runtime_admission_ready: runtimeReady,
      proven_tier: provenTier,
    },
    failure_attribution: failures,
  };
}

function aggregateMetrics(counters) {
  return {
    anchor_accuracy: ratioMetric(counters.anchorScore, counters.valid, 0.95),
    slot_accuracy: ratioMetric(counters.slotScore, counters.valid, 0.93),
    default_outfit_binding_success_rate: ratioMetric(counters.defaultOutfitPass, counters.valid, 0.98),
    expression_usability_rate: ratioMetric(counters.expressionPass, counters.valid, 0.90),
    jaw_amplitude_speech_mouth_usability_rate: ratioMetric(counters.jawAmplitudePass, counters.valid, 0.85),
    motion_primitive_binding_success_rate: ratioMetric(counters.motionPass, counters.valid, 0.90),
    package_runtime_admission_readiness: ratioMetric(counters.runtimeReadyPass, counters.valid, 0.98),
    wardrobe_reuse_rate: counters.valid === 0 ? 0 : 1,
  };
}

function ratioMetric(numerator, denominator, threshold) {
  const value = denominator === 0 ? 0 : numerator / denominator;
  return { value, threshold, status: value >= threshold ? 'pass' : 'fail' };
}

function buildQualityGateResults(metrics) {
  return {
    anchor_accuracy_overall: metrics.anchor_accuracy,
    slot_accuracy: metrics.slot_accuracy,
    default_outfit_binding_success_rate: metrics.default_outfit_binding_success_rate,
    expression_usability_rate: metrics.expression_usability_rate,
    jaw_amplitude_speech_mouth_usability_rate: metrics.jaw_amplitude_speech_mouth_usability_rate,
    motion_primitive_binding_success_rate: metrics.motion_primitive_binding_success_rate,
    package_runtime_admission_readiness: metrics.package_runtime_admission_readiness,
  };
}

function passFail(value) {
  return value ? 'pass' : 'fail';
}

function increment(map, key) {
  map.set(key, (map.get(key) ?? 0) + 1);
}

export {
  scorePackage,
  aggregateMetrics,
  buildQualityGateResults,
  passFail,
  increment,
};
