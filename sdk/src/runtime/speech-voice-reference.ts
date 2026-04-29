import { VoiceReferenceKind, type VoiceReference } from './generated/runtime/v1/voice';
import { normalizeText } from './helpers.js';
import type { SpeechVoiceReference } from './types-media.js';

export function toRuntimeVoiceReference(input: SpeechVoiceReference | undefined): VoiceReference | undefined {
  if (!input) {
    return undefined;
  }
  switch (input.kind) {
    case 'preset_voice_id': {
      const presetVoiceId = normalizeText(input.presetVoiceId);
      if (!presetVoiceId) {
        return undefined;
      }
      return {
        kind: VoiceReferenceKind.PRESET,
        reference: {
          oneofKind: 'presetVoiceId',
          presetVoiceId,
        },
      };
    }
    case 'voice_asset_id': {
      const voiceAssetId = normalizeText(input.voiceAssetId);
      if (!voiceAssetId) {
        return undefined;
      }
      return {
        kind: VoiceReferenceKind.VOICE_ASSET,
        reference: {
          oneofKind: 'voiceAssetId',
          voiceAssetId,
        },
      };
    }
    case 'provider_voice_ref': {
      const providerVoiceRef = normalizeText(input.providerVoiceRef);
      if (!providerVoiceRef) {
        return undefined;
      }
      return {
        kind: VoiceReferenceKind.PROVIDER_VOICE_REF,
        reference: {
          oneofKind: 'providerVoiceRef',
          providerVoiceRef,
        },
      };
    }
  }
}
