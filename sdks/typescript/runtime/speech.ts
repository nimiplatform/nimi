import {
  VoiceReferenceKind,
  type VoiceReference,
} from '../core-generated/runtime-typed-client';
import { createNimiError } from '../types';

export type NimiRuntimeSpeechVoiceReference =
  | { readonly kind: 'preset_voice_id'; readonly presetVoiceId: string }
  | { readonly kind: 'voice_asset_id'; readonly voiceAssetId: string };

export function toNimiRuntimeVoiceReference(
  input: NimiRuntimeSpeechVoiceReference | undefined,
): VoiceReference | undefined {
  if (!input) {
    return undefined;
  }
  if (input.kind === 'preset_voice_id') {
    return {
      kind: VoiceReferenceKind.PRESET,
      reference: {
        oneofKind: 'presetVoiceId',
        presetVoiceId: requireVoiceRefText(input.presetVoiceId, 'preset_voice_id'),
      },
    };
  }
  if (input.kind === 'voice_asset_id') {
    return {
      kind: VoiceReferenceKind.VOICE_ASSET,
      reference: {
        oneofKind: 'voiceAssetId',
        voiceAssetId: requireVoiceRefText(input.voiceAssetId, 'voice_asset_id'),
      },
    };
  }
  throw createNimiError({
    message: 'Ordinary Runtime voice references must use preset_voice_id or voice_asset_id',
    reasonCode: 'SDK_RUNTIME_VOICE_REF_KIND_UNSUPPORTED',
    actionHint: 'use_preset_or_voice_asset_reference',
    source: 'sdk',
  });
}

function requireVoiceRefText(value: unknown, field: string): string {
  const normalized = String(value || '').trim();
  if (!normalized) {
    throw createNimiError({
      message: `Runtime voice reference ${field} is required`,
      reasonCode: 'SDK_RUNTIME_VOICE_REF_INVALID',
      actionHint: 'provide_voice_reference',
      source: 'sdk',
    });
  }
  return normalized;
}
