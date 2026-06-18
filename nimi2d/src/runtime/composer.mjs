import { clamp01 } from './common.mjs';

function positiveDurationMs(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.max(1, number);
}

function fadeSecondsToMs(value, fallbackMs) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return fallbackMs;
  return Math.max(0, number * 1000);
}

function easeOutCubic(value) {
  const t = clamp01(value);
  return 1 - ((1 - t) ** 3);
}

function neutralSnapshot(schedulerTimeMs = 0) {
  return {
    activity: 'idle',
    activityIntensity: null,
    activityWeight: 1,
    emotion: 'neutral',
    expression: 'neutral',
    expressionWeight: 0,
    motion: 'idle',
    motionWeight: 0,
    motionQueueLength: 0,
    motionCompletedCount: 0,
    motionInterruptedCount: 0,
    mouthOpen: 0,
    schedulerTimeMs,
    sequence: 0,
  };
}

function createNimi2DComposer() {
  let state = neutralSnapshot();
  let schedulerTimeMs = 0;
  let expressionTransition = null;
  let motionRuntime = null;
  let motionQueue = [];
  const listeners = new Set();

  function currentSnapshot() {
    return {
      ...state,
      schedulerTimeMs,
    };
  }

  function publish(next) {
    state = {
      ...next,
      schedulerTimeMs,
      sequence: state.sequence + 1,
    };
    for (const listener of listeners) {
      listener(state);
    }
  }

  function update(patch) {
    publish({
      activity: patch.activity ?? state.activity,
      activityIntensity: patch.activityIntensity ?? state.activityIntensity,
      activityWeight: patch.activityWeight ?? state.activityWeight,
      emotion: patch.emotion ?? state.emotion,
      expression: patch.expression ?? state.expression,
      expressionWeight: patch.expressionWeight ?? state.expressionWeight,
      motion: patch.motion ?? state.motion,
      motionWeight: patch.motionWeight ?? state.motionWeight,
      motionQueueLength: patch.motionQueueLength ?? motionQueue.length,
      motionCompletedCount: patch.motionCompletedCount ?? state.motionCompletedCount,
      motionInterruptedCount: patch.motionInterruptedCount ?? state.motionInterruptedCount,
      mouthOpen: patch.mouthOpen ?? state.mouthOpen,
    });
  }

  function clearExpressionTransition() {
    expressionTransition = null;
  }

  function clearMotionRuntime() {
    motionRuntime = null;
  }

  function createMotionRuntime(input) {
    return {
      routeId: input.routeId,
      elapsedMs: 0,
      durationMs: positiveDurationMs(input.durationMs, 800),
      fadeMs: fadeSecondsToMs(input.fade, 120),
      loop: input.loop === true,
    };
  }

  function startMotion(request) {
    motionRuntime = createMotionRuntime(request);
    update({
      motion: request.routeId,
      motionWeight: 0,
      motionQueueLength: motionQueue.length,
    });
  }

  function scheduleExpression(input) {
    const target = clamp01(input.weight ?? 1);
    const durationMs = fadeSecondsToMs(input.fade, 180);
    if (durationMs === 0) {
      clearExpressionTransition();
      update({
        expression: input.name || 'neutral',
        expressionWeight: target,
      });
      return;
    }
    expressionTransition = {
      elapsedMs: 0,
      durationMs,
      from: state.expressionWeight,
      to: target,
    };
    update({
      expression: input.name || 'neutral',
      expressionWeight: state.expressionWeight,
    });
  }

  function scheduleMotion(input) {
    const routeId = input.routeId || 'idle';
    if (routeId === 'idle') {
      const interrupted = motionRuntime ? 1 : 0;
      clearMotionRuntime();
      motionQueue = [];
      update({
        motion: 'idle',
        motionWeight: 0,
        motionQueueLength: 0,
        motionInterruptedCount: state.motionInterruptedCount + interrupted,
      });
      return;
    }
    const request = {
      routeId,
      durationMs: input.durationMs,
      fade: input.fade,
      loop: input.loop,
    };
    if (motionRuntime && input.queue === true && input.interrupt !== true) {
      motionQueue.push(request);
      update({ motionQueueLength: motionQueue.length });
      return;
    }
    const interrupted = motionRuntime ? 1 : 0;
    if (input.interrupt === true) {
      motionQueue = [];
    }
    const nextInterruptedCount = state.motionInterruptedCount + interrupted;
    motionRuntime = createMotionRuntime(request);
    update({
      motion: routeId,
      motionWeight: 0,
      motionQueueLength: motionQueue.length,
      motionInterruptedCount: nextInterruptedCount,
    });
  }

  return {
    applyActivity(input) {
      update({
        activity: input.name || 'idle',
        activityIntensity: typeof input.intensity === 'number' ? clamp01(input.intensity) : null,
        activityWeight: input.name && input.name !== 'idle' ? clamp01(input.intensity ?? 1) : 1,
      });
    },
    applyEmotion(input) {
      const emotion = input.current || 'neutral';
      update({
        emotion: input.current || 'neutral',
      });
      scheduleExpression({
        name: emotion,
        weight: emotion !== 'neutral' ? 1 : 0,
        fade: 0.18,
      });
    },
    applyMotion(input) {
      scheduleMotion(input);
    },
    applyExpression(input) {
      scheduleExpression(input);
    },
    advanceFrame(deltaMs = 16) {
      const delta = positiveDurationMs(deltaMs, 16);
      schedulerTimeMs += delta;
      const patch = {};
      let changed = false;

      if (expressionTransition) {
        expressionTransition.elapsedMs += delta;
        const progress = expressionTransition.durationMs === 0
          ? 1
          : expressionTransition.elapsedMs / expressionTransition.durationMs;
        const eased = easeOutCubic(progress);
        patch.expressionWeight = expressionTransition.from
          + ((expressionTransition.to - expressionTransition.from) * eased);
        changed = true;
        if (progress >= 1) {
          patch.expressionWeight = expressionTransition.to;
          clearExpressionTransition();
        }
      }

      if (motionRuntime) {
        motionRuntime.elapsedMs += delta;
        const fadeMs = motionRuntime.fadeMs;
        if (motionRuntime.loop) {
          patch.motionWeight = fadeMs === 0 ? 1 : easeOutCubic(motionRuntime.elapsedMs / fadeMs);
          changed = true;
        } else {
          const remainingMs = motionRuntime.durationMs - motionRuntime.elapsedMs;
          const fadeIn = fadeMs === 0 ? 1 : easeOutCubic(motionRuntime.elapsedMs / fadeMs);
          const fadeOut = fadeMs === 0 ? 1 : clamp01(remainingMs / fadeMs);
          patch.motionWeight = Math.min(fadeIn, fadeOut);
          changed = true;
          if (motionRuntime.elapsedMs >= motionRuntime.durationMs) {
            const completedCount = state.motionCompletedCount + 1;
            const nextRequest = motionQueue.shift() ?? null;
            if (nextRequest) {
              motionRuntime = createMotionRuntime(nextRequest);
              patch.motion = nextRequest.routeId;
              patch.motionWeight = 0;
              patch.motionQueueLength = motionQueue.length;
              patch.motionCompletedCount = completedCount;
            } else {
              patch.motion = 'idle';
              patch.motionWeight = 0;
              patch.motionQueueLength = 0;
              patch.motionCompletedCount = completedCount;
              clearMotionRuntime();
            }
          }
        }
      }

      if (changed) {
        update(patch);
      }
      return currentSnapshot();
    },
    subscribe(listener) {
      listeners.add(listener);
      listener(currentSnapshot());
      return () => {
        listeners.delete(listener);
      };
    },
    snapshot() {
      return currentSnapshot();
    },
    setMouthOpen(value) {
      const mouthOpen = clamp01(value);
      if (Math.abs(mouthOpen - state.mouthOpen) < 0.01) return;
      update({ mouthOpen });
    },
    reset() {
      clearExpressionTransition();
      clearMotionRuntime();
      motionQueue = [];
      publish(neutralSnapshot(schedulerTimeMs));
    },
  };
}

export { createNimi2DComposer };
