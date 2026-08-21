import type { TFunction } from 'i18next';
export function displayRuntimeConfigCapabilityLabel(
  capabilityContract: string,
  t: TFunction,
): string {
  if (capabilityContract === 'text.generate') {
    return t('runtimeConfig.capabilityLabels.textGenerate');
  }
  if (capabilityContract === 'text.embed') {
    return t('runtimeConfig.capabilityLabels.textEmbed');
  }
  if (capabilityContract === 'audio.synthesize') {
    return t('runtimeConfig.capabilityLabels.audioSynthesize');
  }
  if (capabilityContract === 'audio.transcribe') {
    return t('runtimeConfig.capabilityLabels.audioTranscribe');
  }
  if (capabilityContract === 'image.generate') {
    return t('runtimeConfig.capabilityLabels.imageGenerate');
  }
  if (capabilityContract === 'video.generate') {
    return t('runtimeConfig.capabilityLabels.videoGenerate');
  }
  if (capabilityContract === 'voice.create') {
    return t('runtimeConfig.capabilityLabels.voiceCreate');
  }
  if (capabilityContract === 'music.generate') {
    return t('runtimeConfig.capabilityLabels.musicGenerate');
  }
  return capabilityContract;
}
