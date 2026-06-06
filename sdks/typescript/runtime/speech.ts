import {
  VoiceReferenceKind,
  type VoiceReference,
} from '../core-generated/runtime-typed-client';
import { createNimiError } from '../types';

export type NimiRuntimeSpeechVoiceReference =
  | { readonly kind: 'preset_voice_id'; readonly presetVoiceId: string }
  | { readonly kind: 'voice_asset_id'; readonly voiceAssetId: string }
  | { readonly kind: 'provider_voice_ref'; readonly providerVoiceRef: string };

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
  return {
    kind: VoiceReferenceKind.PROVIDER_VOICE_REF,
    reference: {
      oneofKind: 'providerVoiceRef',
      providerVoiceRef: requireVoiceRefText(input.providerVoiceRef, 'provider_voice_ref'),
    },
  };
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
