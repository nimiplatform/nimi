import { ReasonCode } from '../types/index.js';
import type { JsonObject } from '../internal/utils.js';
import { createNimiError } from './errors.js';
import { normalizeText } from './helpers.js';

export interface ProfileEntryOverride {
  entryId: string;
  localAssetId: string;
}

export interface LocalProfileExtensionInput {
  entryOverrides?: ProfileEntryOverride[];
  profileOverrides?: JsonObject;
}

const MUSIC_ITERATION_MODES = new Set(['extend', 'remix', 'reference']);

export function buildMusicIterationExtensions(
  input: {
    mode: string;
    sourceAudioBase64: string;
    sourceMimeType?: string;
    trimStartSec?: number;
    trimEndSec?: number;
  },
): JsonObject {
  const mode = normalizeText(input.mode).toLowerCase();
  const sourceAudioBase64 = normalizeText(input.sourceAudioBase64);
  const trimStartSec = normalizeOptionalMusicIterationSecond(input.trimStartSec, 'trimStartSec');
  const trimEndSec = normalizeOptionalMusicIterationSecond(input.trimEndSec, 'trimEndSec');

  if (!MUSIC_ITERATION_MODES.has(mode)) {
    throw createMusicIterationValidationError('music iteration mode must be extend, remix, or reference');
  }
  if (!sourceAudioBase64 || !isValidMusicIterationBase64(sourceAudioBase64)) {
    throw createMusicIterationValidationError('music iteration sourceAudioBase64 must be valid base64 audio content');
  }
  if (
    trimStartSec !== undefined
    && trimEndSec !== undefined
    && trimEndSec <= trimStartSec
  ) {
    throw createMusicIterationValidationError('music iteration trimEndSec must be greater than trimStartSec');
  }

  const payload: JsonObject = {
    mode,
    source_audio_base64: sourceAudioBase64,
  };
  if (input.sourceMimeType) {
    payload.source_mime_type = normalizeText(input.sourceMimeType);
  }
  if (trimStartSec !== undefined) {
    payload.trim_start_sec = trimStartSec;
  }
  if (trimEndSec !== undefined) {
    payload.trim_end_sec = trimEndSec;
  }
  return payload;
}

function normalizeOptionalMusicIterationSecond(
  value: number | undefined,
  field: 'trimStartSec' | 'trimEndSec',
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  const normalized = Number(value);
  if (!Number.isFinite(normalized) || normalized < 0) {
    throw createMusicIterationValidationError(`music iteration ${field} must be a non-negative finite number`);
  }
  return normalized;
}

function createMusicIterationValidationError(message: string) {
  return createNimiError({
    message,
    reasonCode: ReasonCode.AI_MEDIA_SPEC_INVALID,
    actionHint: 'fix_music_iteration_input',
    source: 'sdk',
  });
}

function isValidMusicIterationBase64(value: string): boolean {
  const normalized = value.replace(/\s+/g, '');
  if (!normalized) {
    return false;
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(normalized) || normalized.length % 4 === 1) {
    return false;
  }
  if (typeof Buffer !== 'undefined') {
    try {
      const decoded = Buffer.from(normalized, 'base64');
      if (decoded.length === 0) {
        return false;
      }
      const canonical = decoded.toString('base64').replace(/=+$/u, '');
      return canonical === normalized.replace(/=+$/u, '');
    } catch {
      return false;
    }
  }
  if (typeof atob !== 'undefined') {
    try {
      return atob(normalized).length > 0;
    } catch {
      return false;
    }
  }
  return false;
}

export function buildLocalProfileExtensions(
  workflow: LocalProfileExtensionInput,
  baseExtensions?: JsonObject,
): JsonObject {
  const merged: JsonObject = { ...(baseExtensions || {}) };
  const entryOverrides = Array.isArray(workflow.entryOverrides)
    ? workflow.entryOverrides
      .map((item) => ({
        entry_id: normalizeText(item.entryId),
        local_asset_id: normalizeText(item.localAssetId),
      }))
      .filter((item) => item.entry_id && item.local_asset_id)
    : [];
  if (entryOverrides.length > 0) {
    merged.entry_overrides = entryOverrides;
  }
  if (workflow.profileOverrides && Object.keys(workflow.profileOverrides).length > 0) {
    merged.profile_overrides = workflow.profileOverrides;
  }
  return merged;
}
