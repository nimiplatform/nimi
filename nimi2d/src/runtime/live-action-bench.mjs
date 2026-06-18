import { clamp01, NIMI2D_RUNTIME_SCOPE } from './common.mjs';

function latencyMs(nowMs, startedAt) {
  return Math.max(0, nowMs() - startedAt);
}

function legibilityScore(checks) {
  if (checks.length === 0) return 0;
  return checks.filter(Boolean).length / checks.length;
}

function blendStabilityScore(frames) {
  if (frames.length === 0) return 0;
  const stable = frames.every((frame) => (
    frame.layerRefs.length > 0
    && Number.isFinite(frame.timestampMs)
    && Number.isFinite(frame.mouthOpen)
    && frame.mouthOpen >= 0
    && frame.mouthOpen <= 1
    && frame.activity.length > 0
    && frame.expression.length > 0
    && frame.motion.length > 0
  ));
  return stable ? 1 : 0;
}

async function runNimi2DLiveActionBench(input) {
  const failures = [];
  const observations = [];
  const latencies = [];
  const nowMs = input.nowMs ?? (() => performance.now());

  if (input.backendKind !== 'nimi2d') {
    failures.push('backend_kind_not_nimi2d');
  }

  const capture = () => {
    const frame = input.captureFrame();
    const observation = {
      ...frame,
      mouthOpen: clamp01(frame.mouthOpen),
    };
    observations.push(observation);
    return observation;
  };

  await input.flush();
  const initial = capture();
  const hasDefaultOutfit = input.defaultOutfitLayerRefs.every((layerRef) => initial.layerRefs.includes(layerRef));
  if (!hasDefaultOutfit) {
    failures.push('default_outfit_not_visible');
  }
  if (initial.layerRefs.length === input.defaultOutfitLayerRefs.length) {
    failures.push('base_body_layers_absent_from_composite');
  }

  const applyProjection = async (label, apply) => {
    const startedAt = nowMs();
    apply();
    await input.flush();
    latencies.push(latencyMs(nowMs, startedAt));
    const frame = capture();
    if (frame.layerRefs.length === 0) failures.push(`${label}_render_layers_missing`);
    return frame;
  };

  const listen = await applyProjection('listen_activity', () => input.projection.applyActivity({ name: 'listen', intensity: 0.9 }));
  const expression = await applyProjection('curious_expression', () => input.projection.applyExpression({ name: 'curious', weight: 0.85 }));
  const motion = await applyProjection('lean_in_motion', () => input.projection.applyMotion({ routeId: 'lean_in' }));

  input.mouth.setAmplitude(1);
  await input.mouth.attach();
  await input.flush();
  const speech = capture();

  const interruptStartedAt = nowMs();
  input.mouth.silent();
  input.mouth.setAmplitude(0);
  input.projection.reset();
  await input.flush();
  const interruptRecoveryMs = latencyMs(nowMs, interruptStartedAt);
  const interrupted = capture();

  const maxProjectionLatencyMs = latencies.length > 0 ? Math.max(...latencies) : 0;
  const jawActive = speech.mouthOpen >= 0.2;
  const jawSilentAfterInterrupt = interrupted.mouthOpen <= 0.05;
  const jawAlignmentScore = legibilityScore([jawActive, jawSilentAfterInterrupt]);
  const stateLegibilityScore = legibilityScore([
    listen.activity === 'listen',
    expression.expression === 'curious',
    motion.motion === 'lean_in',
    jawActive,
    interrupted.activity === 'idle',
    interrupted.expression === 'neutral',
    interrupted.motion === 'idle',
  ]);
  const blendScore = blendStabilityScore(observations);

  if (maxProjectionLatencyMs > 50) failures.push('projection_latency_over_50ms');
  if (interruptRecoveryMs > 50) failures.push('interrupt_recovery_over_50ms');
  if (stateLegibilityScore < 1) failures.push('state_legibility_incomplete');
  if (blendScore < 1) failures.push('blend_stability_failed');
  if (jawAlignmentScore < 1) failures.push('jaw_alignment_failed');

  return {
    verdict: failures.length === 0 ? 'pass_minimal_tier1' : 'fail',
    scope: NIMI2D_RUNTIME_SCOPE,
    closesGenerationBench: false,
    closesMountedVisualProof: false,
    metrics: {
      maxProjectionLatencyMs,
      stateLegibilityScore,
      blendStabilityScore: blendScore,
      jawAlignmentScore,
      interruptRecoveryMs,
      gazeBehavior: 'unsupported_v1',
    },
    observations,
    failures,
  };
}

export { runNimi2DLiveActionBench };
