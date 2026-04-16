export type AgentVoicePlaybackVisemeId = 'aa' | 'ee' | 'ih' | 'oh' | 'ou';

export type AgentVoicePlaybackCue = {
  amplitude: number;
  visemeId: AgentVoicePlaybackVisemeId | null;
};

export function resolveAgentVoicePlaybackAmplitude(samples: Uint8Array): number {
  if (!(samples instanceof Uint8Array) || samples.length === 0) {
    return 0;
  }
  let sumSquares = 0;
  for (const sample of samples) {
    const normalized = (sample - 128) / 128;
    sumSquares += normalized * normalized;
  }
  const rms = Math.sqrt(sumSquares / samples.length);
  return Math.max(0, Math.min(rms * 3.2, 1));
}

export function resolveAgentVoicePlaybackVisemeId(
  amplitude: number,
  currentTimeSeconds: number,
): AgentVoicePlaybackCue['visemeId'] {
  if (!Number.isFinite(amplitude) || amplitude < 0.12) {
    return null;
  }
  const cycle = Math.abs(Math.floor((Number.isFinite(currentTimeSeconds) ? currentTimeSeconds : 0) * 10)) % 5;
  switch (cycle) {
    case 0:
      return 'aa';
    case 1:
      return 'ee';
    case 2:
      return 'ih';
    case 3:
      return 'oh';
    case 4:
    default:
      return 'ou';
  }
}

export function resolveAgentVoicePlaybackCue(
  samples: Uint8Array,
  currentTimeSeconds: number,
): AgentVoicePlaybackCue {
  const amplitude = resolveAgentVoicePlaybackAmplitude(samples);
  return {
    amplitude,
    visemeId: resolveAgentVoicePlaybackVisemeId(amplitude, currentTimeSeconds),
  };
}
