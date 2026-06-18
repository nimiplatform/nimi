import { clamp01, NIMI2D_RUNTIME_SCOPE } from './common.mjs';
import { createNimi2DReferenceActionStream, Nimi2DReferenceActionStreamEventError } from './live-action-stream.mjs';

function frameFromStream(stream, layerRefs) {
  const snapshot = stream.snapshot();
  return {
    timestampMs: snapshot.schedulerTimeMs,
    layerRefs,
    activity: snapshot.activity,
    expression: snapshot.expression,
    motion: snapshot.motion,
    motionQueueLength: snapshot.motionQueueLength,
    motionCompletedCount: snapshot.motionCompletedCount,
    motionInterruptedCount: snapshot.motionInterruptedCount,
    expressionWeight: snapshot.expressionWeight,
    motionWeight: snapshot.motionWeight,
    mouthOpen: clamp01(snapshot.mouthOpen),
    sequence: snapshot.sequence,
  };
}

function stableFrame(frame) {
  return Array.isArray(frame.layerRefs)
    && frame.layerRefs.length > 0
    && Number.isFinite(frame.timestampMs)
    && Number.isFinite(frame.mouthOpen)
    && frame.mouthOpen >= 0
    && frame.mouthOpen <= 1
    && Number.isFinite(frame.expressionWeight)
    && frame.expressionWeight >= 0
    && frame.expressionWeight <= 1
    && Number.isFinite(frame.motionWeight)
    && frame.motionWeight >= 0
    && frame.motionWeight <= 1
    && typeof frame.activity === 'string'
    && frame.activity.length > 0
    && typeof frame.expression === 'string'
    && frame.expression.length > 0
    && typeof frame.motion === 'string'
    && frame.motion.length > 0;
}

function monotonic(values) {
  for (let index = 1; index < values.length; index += 1) {
    if (values[index] < values[index - 1]) return false;
  }
  return true;
}

function capture(observations, stream, layerRefs) {
  const frame = frameFromStream(stream, layerRefs);
  observations.push(frame);
  return frame;
}

function apply(stream, event, counters) {
  counters.eventCount += 1;
  return stream.applyEvent(event);
}

function advance(stream, observations, layerRefs, deltaMs, frames = 1) {
  let frame = null;
  for (let index = 0; index < frames; index += 1) {
    stream.advanceFrame(deltaMs);
    frame = capture(observations, stream, layerRefs);
  }
  return frame;
}

function assertInvalidEventRejected(stream, counters, failures) {
  const before = stream.snapshot();
  try {
    stream.applyEvent({ type: 'motion', routeId: 'lean_in', x: 0.25 });
    failures.push('low_level_event_not_rejected');
  } catch (error) {
    if (error instanceof Nimi2DReferenceActionStreamEventError && error.code === 'NIMI2D_REFERENCE_EVENT_FIELD_FORBIDDEN') {
      counters.rejectedInvalidEventCount += 1;
    } else {
      failures.push('unexpected_invalid_event_error');
    }
  }
  const after = stream.snapshot();
  if (after.sequence !== before.sequence || after.motion !== before.motion || after.mouthOpen !== before.mouthOpen) {
    failures.push('invalid_event_mutated_state');
  }
}

async function runNimi2DReferenceActionStress(input = {}) {
  const failures = [];
  const observations = [];
  const stream = input.stream ?? createNimi2DReferenceActionStream();
  const layerRefs = input.layerRefs ?? [];
  const defaultOutfitLayerRefs = input.defaultOutfitLayerRefs ?? [];
  const frameDeltaMs = Math.max(1, Number(input.frameDeltaMs ?? 16));
  const counters = {
    eventCount: 0,
    rejectedInvalidEventCount: 0,
  };

  if (input.backendKind !== 'nimi2d') {
    failures.push('backend_kind_not_nimi2d');
  }
  if (!defaultOutfitLayerRefs.every((layerRef) => layerRefs.includes(layerRef))) {
    failures.push('default_outfit_not_visible');
  }
  if (layerRefs.length === defaultOutfitLayerRefs.length) {
    failures.push('base_body_layers_absent_from_composite');
  }

  capture(observations, stream, layerRefs);
  assertInvalidEventRejected(stream, counters, failures);

  stream.applyEvents([
    { type: 'activity', name: 'listen', intensity: 0.92 },
    { type: 'emotion', current: 'curious' },
    { type: 'expression', name: 'focused', weight: 0.82, fade: 0.02 },
    { type: 'motion', routeId: 'wave', durationMs: 96, fade: 0.02 },
    { type: 'mouth_amplitude', value: 0.35 },
  ]);
  counters.eventCount += 5;
  capture(observations, stream, layerRefs);

  apply(stream, { type: 'motion', routeId: 'nod', durationMs: 96, fade: 0.02, queue: true }, counters);
  apply(stream, { type: 'motion', routeId: 'lean_in', durationMs: 96, fade: 0.02, queue: true }, counters);
  capture(observations, stream, layerRefs);
  advance(stream, observations, layerRefs, frameDeltaMs, 10);

  const mouthValues = [0, 0.25, 0.8, 1, 0.45, 0.1, 0.9, 0.2];
  for (const value of mouthValues) {
    apply(stream, { type: 'mouth_amplitude', value }, counters);
    advance(stream, observations, layerRefs, frameDeltaMs, 1);
  }

  apply(stream, { type: 'motion', routeId: 'turn_attention', durationMs: 160, fade: 0.01, interrupt: true }, counters);
  apply(stream, { type: 'expression', name: 'surprised', weight: 1, fade: 0.01 }, counters);
  capture(observations, stream, layerRefs);
  advance(stream, observations, layerRefs, frameDeltaMs, 4);

  const burst = [
    { type: 'activity', name: 'think', intensity: 0.7 },
    { type: 'expression', name: 'thoughtful', weight: 0.75, fade: 0.02 },
    { type: 'activity', name: 'speak', intensity: 1 },
    { type: 'mouth_amplitude', value: 1 },
    { type: 'motion', routeId: 'emphasis', durationMs: 80, fade: 0.01, interrupt: true },
    { type: 'mouth_amplitude', value: 0.55 },
  ];
  stream.applyEvents(burst);
  counters.eventCount += burst.length;
  advance(stream, observations, layerRefs, frameDeltaMs, 6);

  apply(stream, { type: 'silence' }, counters);
  advance(stream, observations, layerRefs, frameDeltaMs, 1);
  apply(stream, { type: 'reset' }, counters);
  const finalFrame = capture(observations, stream, layerRefs);

  const maxQueueLength = Math.max(...observations.map((frame) => frame.motionQueueLength));
  const maxCompletedCount = Math.max(...observations.map((frame) => frame.motionCompletedCount));
  const maxInterruptedCount = Math.max(...observations.map((frame) => frame.motionInterruptedCount));
  const maxMouthOpen = Math.max(...observations.map((frame) => frame.mouthOpen));
  const minPostSilenceMouthOpen = Math.min(...observations.slice(-2).map((frame) => frame.mouthOpen));
  const stableFrames = observations.filter(stableFrame).length;
  const schedulerMonotonic = monotonic(observations.map((frame) => frame.timestampMs));
  const sequenceMonotonic = monotonic(observations.map((frame) => frame.sequence));
  const finalNeutral = finalFrame.activity === 'idle'
    && finalFrame.expression === 'neutral'
    && finalFrame.motion === 'idle'
    && finalFrame.motionQueueLength === 0
    && finalFrame.mouthOpen <= 0.05;

  if (observations.length < 24) failures.push('stress_frame_count_insufficient');
  if (maxQueueLength < 2) failures.push('motion_queue_not_exercised');
  if (maxCompletedCount < 2) failures.push('queued_motion_completion_not_observed');
  if (maxInterruptedCount < 1) failures.push('motion_interrupt_not_observed');
  if (maxMouthOpen < 0.9) failures.push('mouth_peak_not_observed');
  if (minPostSilenceMouthOpen > 0.05) failures.push('mouth_silence_not_observed');
  if (stableFrames !== observations.length) failures.push('blend_stability_failed');
  if (!schedulerMonotonic) failures.push('scheduler_time_not_monotonic');
  if (!sequenceMonotonic) failures.push('state_sequence_not_monotonic');
  if (!finalNeutral) failures.push('reset_not_neutral');

  return {
    verdict: failures.length === 0 ? 'pass_stream_stress_tier1' : 'fail',
    scope: NIMI2D_RUNTIME_SCOPE,
    closesGenerationBench: false,
    closesMountedVisualProof: false,
    metrics: {
      eventCount: counters.eventCount,
      rejectedInvalidEventCount: counters.rejectedInvalidEventCount,
      frameCount: observations.length,
      stableFrameRate: observations.length === 0 ? 0 : stableFrames / observations.length,
      maxQueueLength,
      maxCompletedCount,
      maxInterruptedCount,
      maxMouthOpen,
      minPostSilenceMouthOpen,
      schedulerMonotonic,
      sequenceMonotonic,
      finalNeutral,
    },
    observations,
    failures,
  };
}

export {
  runNimi2DReferenceActionStress,
  runNimi2DReferenceActionStress as runNimi2DLiveActionStress,
};
