export type {
  AvatarPresentationProfile,
  RuntimeAgentPresentationAdapter,
  RuntimeAgentPresentationRecord,
} from './types.js';

import type {
  AvatarPresentationProfile,
  RuntimeAgentPresentationRecord,
} from './types.js';
import type {
  AgentVoicePlaybackCue,
  AgentVoicePlaybackEstimatorFrame,
  AgentVoicePlaybackVisemeId,
} from './voice-playback.js';
import {
  resolveAgentVoicePlaybackCue,
  resolveAgentVoicePlaybackEstimatedFrame,
} from './voice-playback.js';

export type AgentVoicePlaybackCuePoint = {
  offsetMs: number;
  durationMs: number;
  amplitude: number;
  visemeId: AgentVoicePlaybackVisemeId | null;
};

export type AgentVoicePlaybackCueEnvelope = {
  version: 'v1';
  source: 'runtime' | 'provider' | 'desktop-local';
  cues: AgentVoicePlaybackCuePoint[];
};

export type AgentVoicePlaybackCueEnvelopeJson = {
  version: 'v1';
  source: AgentVoicePlaybackCueEnvelope['source'];
  cues: Array<{
    offsetMs: number;
    durationMs: number;
    amplitude: number;
    visemeId: AgentVoicePlaybackVisemeId | null;
  }>;
};

export type RuntimeVoicePlaybackFrameCue = {
  source: 'envelope' | 'estimator';
  cue: AgentVoicePlaybackCue;
  estimatorFrame: AgentVoicePlaybackEstimatorFrame | null;
};

function parseOptionalJsonObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseOptionalString(value: unknown): string | null {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized || null;
}

function parseOptionalNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseVisemeId(value: unknown): AgentVoicePlaybackVisemeId | null {
  const normalized = parseOptionalString(value);
  if (
    normalized === 'aa'
    || normalized === 'ee'
    || normalized === 'ih'
    || normalized === 'oh'
    || normalized === 'ou'
  ) {
    return normalized;
  }
  return null;
}

function parseCuePoint(value: unknown): AgentVoicePlaybackCuePoint | null {
  const record = parseOptionalJsonObject(value);
  if (!record) {
    return null;
  }
  const offsetMs = parseOptionalNumber(record.offsetMs);
  const durationMs = parseOptionalNumber(record.durationMs);
  const amplitude = parseOptionalNumber(record.amplitude);
  if (offsetMs == null || durationMs == null || durationMs <= 0 || amplitude == null) {
    return null;
  }
  return {
    offsetMs: Math.max(0, offsetMs),
    durationMs,
    amplitude: Math.max(0, Math.min(amplitude, 1)),
    visemeId: parseVisemeId(record.visemeId),
  };
}

export function createRuntimeAgentPresentationRecord(
  agentId: string,
  presentation: AvatarPresentationProfile,
): RuntimeAgentPresentationRecord {
  return {
    agentId,
    presentation,
  };
}

export function parseAgentVoicePlaybackCueEnvelope(value: unknown): AgentVoicePlaybackCueEnvelope | null {
  const record = parseOptionalJsonObject(value);
  if (!record) {
    return null;
  }
  const version = parseOptionalString(record.version);
  const source = parseOptionalString(record.source);
  if (
    version !== 'v1'
    || (source !== 'runtime' && source !== 'provider' && source !== 'desktop-local')
  ) {
    return null;
  }
  const cues = Array.isArray(record.cues)
    ? record.cues
      .map((cue) => parseCuePoint(cue))
      .filter((cue): cue is AgentVoicePlaybackCuePoint => Boolean(cue))
      .sort((left, right) => left.offsetMs - right.offsetMs)
    : [];
  if (cues.length === 0) {
    return null;
  }
  return {
    version,
    source,
    cues,
  };
}

export function toAgentVoicePlaybackCueEnvelopeJson(
  envelope: AgentVoicePlaybackCueEnvelope,
): AgentVoicePlaybackCueEnvelopeJson {
  return {
    version: envelope.version,
    source: envelope.source,
    cues: envelope.cues.map((cue) => ({
      offsetMs: cue.offsetMs,
      durationMs: cue.durationMs,
      amplitude: cue.amplitude,
      visemeId: cue.visemeId,
    })),
  };
}

export function resolveAgentVoicePlaybackCueFromEnvelope(
  envelope: AgentVoicePlaybackCueEnvelope | null | undefined,
  currentTimeSeconds: number,
): AgentVoicePlaybackCue {
  if (!envelope || envelope.cues.length === 0) {
    return {
      amplitude: 0,
      visemeId: null,
    };
  }
  const currentTimeMs = Math.max(
    0,
    Math.round((Number.isFinite(currentTimeSeconds) ? currentTimeSeconds : 0) * 1000),
  );
  for (const cue of envelope.cues) {
    if (currentTimeMs < cue.offsetMs) {
      break;
    }
    if (currentTimeMs < cue.offsetMs + cue.durationMs) {
      return {
        amplitude: cue.amplitude,
        visemeId: cue.visemeId,
      };
    }
  }
  return {
    amplitude: 0,
    visemeId: null,
  };
}

export function resolveRuntimeVoicePlaybackFrameCue(input: {
  playbackCueEnvelope: AgentVoicePlaybackCueEnvelope | null;
  currentTimeSeconds: number;
  timeDomainSamples: Uint8Array;
  frequencySamples?: Uint8Array;
  previousEstimatorFrame?: AgentVoicePlaybackEstimatorFrame | null;
}): RuntimeVoicePlaybackFrameCue {
  if (input.playbackCueEnvelope) {
    return {
      source: 'envelope',
      cue: resolveAgentVoicePlaybackCueFromEnvelope(
        input.playbackCueEnvelope,
        input.currentTimeSeconds,
      ),
      estimatorFrame: null,
    };
  }
  const estimatorFrame = resolveAgentVoicePlaybackEstimatedFrame({
    previous: input.previousEstimatorFrame || null,
    nextCue: resolveAgentVoicePlaybackCue(
      input.timeDomainSamples,
      input.currentTimeSeconds,
      input.frequencySamples,
    ),
  });
  return {
    source: 'estimator',
    cue: estimatorFrame.cue,
    estimatorFrame,
  };
}
