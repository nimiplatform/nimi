import type { TFunction } from 'i18next';
import {
  NIMI_MACHINE_LOCAL_AUDIO_SYNTHESIZE_CAPABILITY_CONTRACT,
  NIMI_MACHINE_LOCAL_AUDIO_TRANSCRIBE_CAPABILITY_CONTRACT,
  NIMI_MACHINE_LOCAL_IMAGE_GENERATE_CAPABILITY_CONTRACT,
  NIMI_MACHINE_LOCAL_TEXT_EMBED_CAPABILITY_CONTRACT,
  NIMI_MACHINE_LOCAL_TEXT_GENERATE_CAPABILITY_CONTRACT,
  NIMI_MACHINE_LOCAL_VIDEO_GENERATE_CAPABILITY_CONTRACT,
  NIMI_MACHINE_LOCAL_VOICE_CREATE_CAPABILITY_CONTRACT,
} from '@nimiplatform/sdk/runtime';

export function displayRuntimeConfigCapabilityLabel(
  capabilityContract: string,
  t: TFunction,
): string {
  if (capabilityContract === NIMI_MACHINE_LOCAL_TEXT_GENERATE_CAPABILITY_CONTRACT) {
    return t('runtimeConfig.capabilityLabels.textGenerate');
  }
  if (capabilityContract === NIMI_MACHINE_LOCAL_TEXT_EMBED_CAPABILITY_CONTRACT) {
    return t('runtimeConfig.capabilityLabels.textEmbed');
  }
  if (capabilityContract === NIMI_MACHINE_LOCAL_AUDIO_SYNTHESIZE_CAPABILITY_CONTRACT) {
    return t('runtimeConfig.capabilityLabels.audioSynthesize');
  }
  if (capabilityContract === NIMI_MACHINE_LOCAL_AUDIO_TRANSCRIBE_CAPABILITY_CONTRACT) {
    return t('runtimeConfig.capabilityLabels.audioTranscribe');
  }
  if (capabilityContract === NIMI_MACHINE_LOCAL_IMAGE_GENERATE_CAPABILITY_CONTRACT) {
    return t('runtimeConfig.capabilityLabels.imageGenerate');
  }
  if (capabilityContract === NIMI_MACHINE_LOCAL_VIDEO_GENERATE_CAPABILITY_CONTRACT) {
    return t('runtimeConfig.capabilityLabels.videoGenerate');
  }
  if (capabilityContract === NIMI_MACHINE_LOCAL_VOICE_CREATE_CAPABILITY_CONTRACT) {
    return t('runtimeConfig.capabilityLabels.voiceCreate');
  }
  return capabilityContract;
}
