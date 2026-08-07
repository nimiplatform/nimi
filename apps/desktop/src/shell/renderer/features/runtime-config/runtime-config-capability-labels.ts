import type { TFunction } from 'i18next';
import {
  NIMI_MACHINE_LOCAL_IMAGE_GENERATE_CAPABILITY_CONTRACT,
  NIMI_MACHINE_LOCAL_TEXT_GENERATE_CAPABILITY_CONTRACT,
  NIMI_MACHINE_LOCAL_VIDEO_GENERATE_CAPABILITY_CONTRACT,
} from '@nimiplatform/sdk/runtime';

export function displayRuntimeConfigCapabilityLabel(
  capabilityContract: string,
  t: TFunction,
): string {
  if (capabilityContract === NIMI_MACHINE_LOCAL_TEXT_GENERATE_CAPABILITY_CONTRACT) {
    return t('runtimeConfig.capabilityLabels.textGenerate');
  }
  if (capabilityContract === NIMI_MACHINE_LOCAL_IMAGE_GENERATE_CAPABILITY_CONTRACT) {
    return t('runtimeConfig.capabilityLabels.imageGenerate');
  }
  if (capabilityContract === NIMI_MACHINE_LOCAL_VIDEO_GENERATE_CAPABILITY_CONTRACT) {
    return t('runtimeConfig.capabilityLabels.videoGenerate');
  }
  return capabilityContract;
}
