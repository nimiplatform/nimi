export type AgentVoicePlaybackVisemeId = 'aa' | 'ee' | 'ih' | 'oh' | 'ou';

export type AgentVoicePlaybackCue = {
  amplitude: number;
  visemeId: AgentVoicePlaybackVisemeId | null;
};

export type AgentVoicePlaybackEstimatorFrame = {
  cue: AgentVoicePlaybackCue;
  stableFrames: number;
};

type AgentVoicePlaybackSignalFeatures = {
  amplitude: number;
  zeroCrossingRate: number;
  deltaAverage: number;
  peak: number;
  lowBandEnergy: number;
  midBandEnergy: number;
  highBandEnergy: number;
  spectralCentroid: number;
};

function clampUnit(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(value, 1));
}

function resolveAgentVoicePlaybackSignalFeatures(samples: Uint8Array): AgentVoicePlaybackSignalFeatures {
  if (!(samples instanceof Uint8Array) || samples.length === 0) {
    return {
      amplitude: 0,
      zeroCrossingRate: 0,
      deltaAverage: 0,
      peak: 0,
      lowBandEnergy: 0,
      midBandEnergy: 0,
      highBandEnergy: 0,
      spectralCentroid: 0,
    };
  }
  let sumSquares = 0;
  let deltaSum = 0;
  let zeroCrossings = 0;
  let peak = 0;
  let previousNormalized = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index] ?? 128;
    const normalized = (sample - 128) / 128;
    sumSquares += normalized * normalized;
    peak = Math.max(peak, Math.abs(normalized));
    if (index > 0) {
      deltaSum += Math.abs(normalized - previousNormalized);
      if (Math.abs(normalized) > 0.035 && Math.abs(previousNormalized) > 0.035
        && ((normalized >= 0 && previousNormalized < 0) || (normalized < 0 && previousNormalized >= 0))) {
        zeroCrossings += 1;
      }
    }
    previousNormalized = normalized;
  }
  const rms = Math.sqrt(sumSquares / samples.length);
  return {
    amplitude: clampUnit(rms * 3.2),
    zeroCrossingRate: clampUnit(zeroCrossings / Math.max(samples.length - 1, 1)),
    deltaAverage: clampUnit(deltaSum / Math.max(samples.length - 1, 1)),
    peak: clampUnit(peak),
    lowBandEnergy: 0,
    midBandEnergy: 0,
    highBandEnergy: 0,
    spectralCentroid: 0,
  };
}

function resolveAgentVoicePlaybackFrequencyFeatures(
  frequencySamples?: Uint8Array,
): Pick<AgentVoicePlaybackSignalFeatures, 'lowBandEnergy' | 'midBandEnergy' | 'highBandEnergy' | 'spectralCentroid'> {
  if (!(frequencySamples instanceof Uint8Array) || frequencySamples.length === 0) {
    return {
      lowBandEnergy: 0,
      midBandEnergy: 0,
      highBandEnergy: 0,
      spectralCentroid: 0,
    };
  }

  const length = frequencySamples.length;
  const lowLimit = Math.max(1, Math.floor(length * 0.18));
  const midLimit = Math.max(lowLimit + 1, Math.floor(length * 0.52));
  let lowSum = 0;
  let lowCount = 0;
  let midSum = 0;
  let midCount = 0;
  let highSum = 0;
  let highCount = 0;
  let weightedIndexSum = 0;
  let total = 0;

  for (let index = 0; index < length; index += 1) {
    const energy = clampUnit((frequencySamples[index] ?? 0) / 255);
    total += energy;
    weightedIndexSum += energy * index;
    if (index < lowLimit) {
      lowSum += energy;
      lowCount += 1;
    } else if (index < midLimit) {
      midSum += energy;
      midCount += 1;
    } else {
      highSum += energy;
      highCount += 1;
    }
  }

  return {
    lowBandEnergy: clampUnit(lowCount > 0 ? lowSum / lowCount : 0),
    midBandEnergy: clampUnit(midCount > 0 ? midSum / midCount : 0),
    highBandEnergy: clampUnit(highCount > 0 ? highSum / highCount : 0),
    spectralCentroid: clampUnit(total > 0 ? (weightedIndexSum / total) / Math.max(length - 1, 1) : 0),
  };
}

export function resolveAgentVoicePlaybackAmplitude(samples: Uint8Array): number {
  return resolveAgentVoicePlaybackSignalFeatures(samples).amplitude;
}

export function resolveAgentVoicePlaybackVisemeId(
  amplitude: number,
  _currentTimeSeconds: number,
  signal: Partial<Pick<
    AgentVoicePlaybackSignalFeatures,
    'zeroCrossingRate' | 'deltaAverage' | 'peak' | 'lowBandEnergy' | 'midBandEnergy' | 'highBandEnergy' | 'spectralCentroid'
  >> = {},
): AgentVoicePlaybackCue['visemeId'] {
  if (!Number.isFinite(amplitude) || amplitude < 0.12) {
    return null;
  }

  const zeroCrossingRate = clampUnit(signal.zeroCrossingRate ?? 0.12);
  const deltaAverage = clampUnit(signal.deltaAverage ?? amplitude * 0.24);
  const peak = clampUnit(signal.peak ?? amplitude);
  const lowBandEnergy = clampUnit(signal.lowBandEnergy ?? amplitude * 0.62);
  const midBandEnergy = clampUnit(signal.midBandEnergy ?? amplitude * 0.48);
  const highBandEnergy = clampUnit(signal.highBandEnergy ?? zeroCrossingRate * 1.6);
  const spectralCentroid = clampUnit(signal.spectralCentroid ?? (highBandEnergy * 0.7 + midBandEnergy * 0.3));

  const frontness = clampUnit(
    zeroCrossingRate * 0.4
      + deltaAverage * 0.18
      + highBandEnergy * 0.28
      + spectralCentroid * 0.22,
  );
  const openness = clampUnit(
    amplitude * 0.42
      + peak * 0.18
      + lowBandEnergy * 0.3
      + midBandEnergy * 0.16
      - highBandEnergy * 0.22,
  );
  const roundness = clampUnit(
    lowBandEnergy * 0.48
      + (1 - spectralCentroid) * 0.22
      + (1 - frontness) * 0.2
      + Math.max(0, 0.42 - amplitude) * 0.1,
  );

  if (amplitude < 0.18) {
    return frontness > 0.54 ? 'ee' : frontness > 0.34 ? 'ih' : 'ou';
  }
  if (frontness > 0.7) {
    return 'ee';
  }
  if (frontness > 0.48 && openness < 0.68) {
    return 'ih';
  }
  if (roundness > 0.58 && frontness < 0.52) {
    return amplitude > 0.44 ? 'oh' : 'ou';
  }
  if (openness > 0.72) {
    return 'aa';
  }
  if (openness > 0.5) {
    return 'oh';
  }
  return frontness > 0.4 ? 'ih' : 'ou';
}

export function resolveAgentVoicePlaybackCue(
  samples: Uint8Array,
  currentTimeSeconds: number,
  frequencySamples?: Uint8Array,
): AgentVoicePlaybackCue {
  const signal = {
    ...resolveAgentVoicePlaybackSignalFeatures(samples),
    ...resolveAgentVoicePlaybackFrequencyFeatures(frequencySamples),
  };
  return {
    amplitude: signal.amplitude,
    visemeId: resolveAgentVoicePlaybackVisemeId(signal.amplitude, currentTimeSeconds, signal),
  };
}

export function resolveAgentVoicePlaybackEstimatedFrame(input: {
  previous: AgentVoicePlaybackEstimatorFrame | null;
  nextCue: AgentVoicePlaybackCue;
}): AgentVoicePlaybackEstimatorFrame {
  const previousCue = input.previous?.cue || null;
  const smoothedAmplitude = clampUnit(
    previousCue
      ? previousCue.amplitude * 0.68 + input.nextCue.amplitude * 0.32
      : input.nextCue.amplitude,
  );

  let visemeId = input.nextCue.visemeId;
  let stableFrames = 1;

  if (smoothedAmplitude < 0.11) {
    visemeId = null;
    stableFrames = 0;
  } else if (previousCue?.visemeId && !input.nextCue.visemeId && smoothedAmplitude >= 0.16) {
    visemeId = previousCue.visemeId;
    stableFrames = (input.previous?.stableFrames || 0) + 1;
  } else if (previousCue?.visemeId && input.nextCue.visemeId && previousCue.visemeId !== input.nextCue.visemeId) {
    const amplitudeDelta = Math.abs(input.nextCue.amplitude - previousCue.amplitude);
    const shouldHoldPrevious = amplitudeDelta < 0.12
      && smoothedAmplitude >= 0.16
      && (input.previous?.stableFrames || 0) < 3;
    if (shouldHoldPrevious) {
      visemeId = previousCue.visemeId;
      stableFrames = (input.previous?.stableFrames || 0) + 1;
    }
  } else if (previousCue?.visemeId && previousCue.visemeId === input.nextCue.visemeId) {
    stableFrames = (input.previous?.stableFrames || 0) + 1;
  }

  return {
    cue: {
      amplitude: smoothedAmplitude,
      visemeId,
    },
    stableFrames,
  };
}
