import type { BackendAudioConsumer, WLipSyncSnapshot } from '../carrier/backend-branch.js';

const EMPTY_WEIGHTS: WLipSyncSnapshot['weights'] = { A: 0, E: 0, I: 0, O: 0, U: 0, S: 0 };

type Nimi2DAudioState = {
  source: AudioBufferSourceNode | null;
  analyser: AnalyserNode | null;
  samples: Uint8Array<ArrayBuffer> | null;
};

function emptySnapshot(): WLipSyncSnapshot {
  return {
    weights: { ...EMPTY_WEIGHTS },
    volume: 0,
  };
}

function rmsVolume(samples: Uint8Array<ArrayBuffer>): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (const sample of samples) {
    const normalized = (sample - 128) / 128;
    sum += normalized * normalized;
  }
  return Math.max(0, Math.min(1, Math.sqrt(sum / samples.length) * 2));
}

export function createNimi2DAudioConsumer(): BackendAudioConsumer {
  const state: Nimi2DAudioState = {
    source: null,
    analyser: null,
    samples: null,
  };

  function detach(): void {
    if (state.source && state.analyser) {
      try {
        state.source.disconnect(state.analyser);
      } catch {
        // Disconnect can throw when the node has already been disconnected.
      }
    }
    state.source = null;
  }

  return {
    async attachAudioSource(source, audioContext) {
      detach();
      const analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      state.analyser = analyser;
      state.samples = new Uint8Array(analyser.fftSize);
      try {
        source.connect(analyser);
        state.source = source;
      } catch (error) {
        console.warn('[avatar:nimi2d:audio] source.connect(analyser) failed; mouth lane silent', error);
        state.source = null;
      }
    },
    detachAudioSource() {
      detach();
    },
    silent() {
      detach();
    },
    snapshot() {
      if (!state.analyser || !state.samples || !state.source) return null;
      state.analyser.getByteTimeDomainData(state.samples);
      return {
        ...emptySnapshot(),
        volume: rmsVolume(state.samples),
      };
    },
  };
}
