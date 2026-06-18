const EMPTY_WEIGHTS = Object.freeze({ A: 0, E: 0, I: 0, O: 0, U: 0, S: 0 });

function clamp01(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function emptySnapshot(volume = 0) {
  return {
    weights: { ...EMPTY_WEIGHTS },
    volume: clamp01(volume),
    mouthOpen: clamp01(volume),
    lane: 'amplitude',
  };
}

export function calculateNimi2DRmsVolume(samples) {
  if (!samples || samples.length === 0) return 0;
  let sum = 0;
  for (const sample of samples) {
    const normalized = (Number(sample) - 128) / 128;
    sum += normalized * normalized;
  }
  return clamp01(Math.sqrt(sum / samples.length) * 2);
}

export function createNimi2DAmplitudeMouthLane(input = {}) {
  const state = {
    source: null,
    analyser: null,
    samples: null,
    manualVolume: null,
    lastAttachResult: { status: 'detached' },
  };

  function applyVolume(volume) {
    const snapshot = emptySnapshot(volume);
    input.composer?.setMouthOpen?.(snapshot.mouthOpen);
    return snapshot;
  }

  function detach() {
    if (state.source && state.analyser) {
      try {
        state.source.disconnect(state.analyser);
      } catch {
        // WebAudio disconnect can throw after external teardown; the lane still fails closed to silence.
      }
    }
    state.source = null;
    state.manualVolume = null;
  }

  return {
    async attachAudioSource(source, audioContext) {
      detach();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = input.fftSize ?? 256;
      state.analyser = analyser;
      state.samples = new Uint8Array(analyser.fftSize);
      try {
        source.connect(analyser);
        state.source = source;
        state.lastAttachResult = { status: 'ok' };
      } catch (error) {
        state.source = null;
        state.lastAttachResult = {
          status: 'silent',
          reason: 'audio_source_connect_failed',
          error: error instanceof Error ? error.message : String(error),
        };
      }
      return state.lastAttachResult;
    },
    detachAudioSource() {
      detach();
      state.lastAttachResult = { status: 'detached' };
      return applyVolume(0);
    },
    silent() {
      detach();
      state.lastAttachResult = { status: 'silent', reason: 'explicit_silence' };
      return applyVolume(0);
    },
    setAmplitude(value) {
      state.manualVolume = clamp01(Number(value));
      return applyVolume(state.manualVolume);
    },
    snapshot() {
      if (state.manualVolume !== null) {
        return emptySnapshot(state.manualVolume);
      }
      if (!state.analyser || !state.samples || !state.source) return null;
      state.analyser.getByteTimeDomainData(state.samples);
      return emptySnapshot(calculateNimi2DRmsVolume(state.samples));
    },
    poll() {
      const snapshot = this.snapshot() ?? emptySnapshot(0);
      input.composer?.setMouthOpen?.(snapshot.mouthOpen);
      return snapshot;
    },
    attachResult() {
      return state.lastAttachResult;
    },
  };
}
