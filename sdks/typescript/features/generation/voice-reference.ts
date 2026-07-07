import type { NimiRuntimeGenerationRoutePolicy } from './index';
import type { NimiRuntimeSpeechVoiceReference } from '../../runtime/speech';
import { createNimiError, ReasonCode } from '../../types';

export function toNimiRuntimeVoiceReferenceFromInput(input: unknown): NimiRuntimeSpeechVoiceReference | undefined {
  if (!input) return undefined;
  if (typeof input === 'object' && !Array.isArray(input)) {
    return voiceReferenceFromRecord(input as Readonly<Record<string, unknown>>);
  }
  const text = normalizedText(input);
  if (!text) return undefined;
  const lower = text.toLowerCase();
  if (lower === 'default' || lower === 'auto') return undefined;
  const [rawPrefix, ...rest] = text.split(':');
  const prefix = normalizedText(rawPrefix).toLowerCase();
  const payload = rest.join(':').trim();
  if (prefix === 'preset_voice_id') {
    return { kind: 'preset_voice_id', presetVoiceId: requireVoicePayload(payload, prefix) };
  }
  if (prefix === 'voice_asset_id') {
    return { kind: 'voice_asset_id', voiceAssetId: requireVoicePayload(payload, prefix) };
  }
  if (prefix === 'provider_voice_ref') {
    throw providerVoiceRefRejectedError();
  }
  throw publicVoiceReferenceError();
}

export function requireNimiRuntimeVoiceReferenceForLocalTts<TVoiceRef = NimiRuntimeSpeechVoiceReference>(input: {
  readonly routePolicy?: NimiRuntimeGenerationRoutePolicy | string;
  readonly voiceRef?: TVoiceRef;
}): TVoiceRef | undefined {
  if (input.routePolicy !== 'local' || input.voiceRef) {
    return input.voiceRef;
  }
  throw voiceReferenceError(
    'SDK_GENERATION_LOCAL_TTS_VOICE_REFERENCE_REQUIRED',
    'audio.synthesize local model requires an explicit admitted Voice reference (preset_voice_id or voice_asset_id). Select a preset voice or bind a Runtime VoiceAsset before using Default.',
    'select_admitted_voice_reference',
  );
}

function voiceReferenceFromRecord(record: Readonly<Record<string, unknown>>): NimiRuntimeSpeechVoiceReference | undefined {
  const kind = normalizedText(record.kind).toLowerCase();
  if (kind === 'preset_voice_id') {
    return { kind, presetVoiceId: requireVoicePayload(record.presetVoiceId ?? record.preset_voice_id, kind) };
  }
  if (kind === 'voice_asset_id') {
    return { kind, voiceAssetId: requireVoicePayload(record.voiceAssetId ?? record.voice_asset_id, kind) };
  }
  if (kind === 'provider_voice_ref') {
    throw providerVoiceRefRejectedError();
  }
  if (kind) {
    throw publicVoiceReferenceError();
  }
  const providerVoiceRef = normalizedText(record.providerVoiceRef ?? record.provider_voice_ref);
  if (providerVoiceRef) throw providerVoiceRefRejectedError();
  const presetVoiceId = normalizedText(record.presetVoiceId ?? record.preset_voice_id);
  if (presetVoiceId) return { kind: 'preset_voice_id', presetVoiceId };
  const voiceAssetId = normalizedText(record.voiceAssetId ?? record.voice_asset_id);
  if (voiceAssetId) return { kind: 'voice_asset_id', voiceAssetId };
  return undefined;
}

function requireVoicePayload(value: unknown, kind: string): string {
  const text = normalizedText(value);
  if (!text) {
    throw voiceReferenceError(
      'SDK_GENERATION_VOICE_REFERENCE_INVALID',
      `Runtime voice reference ${kind} requires a non-empty value.`,
      'provide_voice_reference',
    );
  }
  return text;
}

function normalizedText(value: unknown): string {
  return String(value ?? '').trim();
}

function publicVoiceReferenceError(): Error {
  return voiceReferenceError(
    'SDK_GENERATION_VOICE_REFERENCE_KIND_UNSUPPORTED',
    'Ordinary SDK voice reference input must use explicit preset_voice_id or voice_asset_id.',
    'use_preset_or_voice_asset_reference',
  );
}

function providerVoiceRefRejectedError(): Error {
  return voiceReferenceError(
    'SDK_GENERATION_PROVIDER_VOICE_REF_FORBIDDEN',
    'provider_voice_ref is not accepted on ordinary SDK voice reference input; bind a Runtime VoiceAsset and pass voice_asset_id instead.',
    'bind_runtime_voice_asset',
  );
}

function voiceReferenceError(code: string, message: string, actionHint: string): Error {
  return createNimiError({
    message,
    code,
    reasonCode: ReasonCode.SDK_AI_INPUT_INVALID,
    actionHint,
    source: 'sdk',
  });
}
