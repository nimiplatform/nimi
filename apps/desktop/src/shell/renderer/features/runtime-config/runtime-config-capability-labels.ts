import type { TFunction } from 'i18next';
export function displayRuntimeConfigCapabilityLabel(
  capabilityContract: string,
  t: TFunction,
): string {
  if (capabilityContract === 'image.face_swap') return t('runtimeConfig.capabilityLabels.imageFaceSwap');
  if (capabilityContract === 'video.face_swap') return t('runtimeConfig.capabilityLabels.videoFaceSwap');
  if (capabilityContract === 'vision.locate') return t('runtimeConfig.capabilityLabels.visionLocate');
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
  if (capabilityContract === 'text.annotate') return t('runtimeConfig.capabilityLabels.textAnnotate');
  if (capabilityContract === 'text.decide') return t('runtimeConfig.capabilityLabels.textDecide');
  if (capabilityContract === 'audio.separate') return t('runtimeConfig.capabilityLabels.audioSeparate');
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
  if (capabilityContract === 'music.transcribe') return t('runtimeConfig.capabilityLabels.musicTranscribe');
  if (capabilityContract === 'audio.voice.convert') return t('runtimeConfig.capabilityLabels.audioVoiceConvert');
  return capabilityContract;
}

/** One plain sentence on what a person uses the capability for. */
export function displayRuntimeConfigCapabilityUsage(
  capabilityContract: string,
  t: TFunction,
): string {
  return t(`runtimeConfig.capabilities.uses.${capabilityContract.replace(/[._]/g, '-')}`, {
    defaultValue: t('runtimeConfig.capabilities.description', {
      capability: displayRuntimeConfigCapabilityLabel(capabilityContract, t),
    }),
  });
}
