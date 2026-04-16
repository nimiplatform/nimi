import {
  parseOptionalJsonObject,
  parseOptionalNumber,
  parseOptionalString,
} from '@renderer/bridge/runtime-bridge/shared';
import type { JsonObject } from '@renderer/bridge/runtime-bridge/shared';
import type {
  AgentVoicePlaybackCue,
  AgentVoicePlaybackVisemeId,
} from './chat-agent-voice-playback-state';

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
  const offsetMs = parseOptionalNumber(record?.offsetMs);
  const durationMs = parseOptionalNumber(record?.durationMs);
  const amplitude = parseOptionalNumber(record?.amplitude);
  if (offsetMs == null || durationMs == null || durationMs <= 0 || amplitude == null) {
    return null;
  }
  return {
    offsetMs: Math.max(0, offsetMs),
    durationMs,
    amplitude: Math.max(0, Math.min(amplitude, 1)),
    visemeId: parseVisemeId(record?.visemeId),
  };
}

export function parseAgentVoicePlaybackCueEnvelope(value: unknown): AgentVoicePlaybackCueEnvelope | null {
  const record = parseOptionalJsonObject(value);
  if (!record) {
    return null;
  }
  const version = parseOptionalString(record?.version);
  const source = parseOptionalString(record?.source);
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
): JsonObject {
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
