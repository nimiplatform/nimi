import type { TFunction } from 'i18next';
import {
  NIMI_MACHINE_LOCAL_IMAGE_GENERATE_CAPABILITY_CONTRACT,
  NIMI_MACHINE_LOCAL_LLAMA_CPP_TEXT_IMPLEMENTATION,
  NIMI_MACHINE_LOCAL_STABLE_DIFFUSION_IMAGE_IMPLEMENTATION,
  NIMI_MACHINE_LOCAL_STABLE_DIFFUSION_VIDEO_IMPLEMENTATION,
  NIMI_MACHINE_LOCAL_TEXT_GENERATE_CAPABILITY_CONTRACT,
  NIMI_MACHINE_LOCAL_VIDEO_GENERATE_CAPABILITY_CONTRACT,
  type NimiMachineLocalCapabilityConfiguration,
  type NimiMachineLocalCapabilityRequirement,
  type NimiRuntimeLocalAssetEntry,
} from '@nimiplatform/sdk/runtime';
import type { RuntimeConfigMachineLocalAIAddDraft } from './runtime-config-machine-local-ai-state.js';

/**
 * Fixed product order for machine-local capability rows: text, image, video.
 * Any additional contracts projected by Runtime are appended in first-seen
 * order instead of relying on locale-sensitive string sorting.
 */
export const MACHINE_LOCAL_AI_CAPABILITY_PRODUCT_ORDER = Object.freeze([
  NIMI_MACHINE_LOCAL_TEXT_GENERATE_CAPABILITY_CONTRACT,
  NIMI_MACHINE_LOCAL_IMAGE_GENERATE_CAPABILITY_CONTRACT,
  NIMI_MACHINE_LOCAL_VIDEO_GENERATE_CAPABILITY_CONTRACT,
] as const);

export function orderMachineLocalCapabilityContracts(
  capabilityContracts: Iterable<string>,
): readonly string[] {
  const seen = new Set<string>();
  const extras: string[] = [];
  for (const contract of capabilityContracts) {
    if (seen.has(contract)) continue;
    seen.add(contract);
    if (!(MACHINE_LOCAL_AI_CAPABILITY_PRODUCT_ORDER as readonly string[]).includes(contract)) {
      extras.push(contract);
    }
  }
  const ordered = MACHINE_LOCAL_AI_CAPABILITY_PRODUCT_ORDER.filter((contract) => seen.has(contract));
  return [...ordered, ...extras];
}

export function displayMachineLocalConfigurationName(
  configuration: NimiMachineLocalCapabilityConfiguration,
  t: TFunction,
): string {
  return configuration.displayName
    || t('runtimeConfig.machineLocalAIConfigurations.unnamedConfiguration');
}

export function isMachineLocalLlamaTextConfiguration(
  configuration: NimiMachineLocalCapabilityConfiguration,
): boolean {
  return configuration.capabilityContract === NIMI_MACHINE_LOCAL_TEXT_GENERATE_CAPABILITY_CONTRACT
    && configuration.implementation.implementationId === NIMI_MACHINE_LOCAL_LLAMA_CPP_TEXT_IMPLEMENTATION.implementationId
    && configuration.implementation.driverId === NIMI_MACHINE_LOCAL_LLAMA_CPP_TEXT_IMPLEMENTATION.driverId
    && configuration.implementation.driverDialect === NIMI_MACHINE_LOCAL_LLAMA_CPP_TEXT_IMPLEMENTATION.driverDialect;
}

export function isMachineLocalStableDiffusionVideoConfiguration(
  configuration: NimiMachineLocalCapabilityConfiguration,
): boolean {
  return configuration.capabilityContract === NIMI_MACHINE_LOCAL_VIDEO_GENERATE_CAPABILITY_CONTRACT
    && configuration.implementation.implementationId === NIMI_MACHINE_LOCAL_STABLE_DIFFUSION_VIDEO_IMPLEMENTATION.implementationId
    && configuration.implementation.driverId === NIMI_MACHINE_LOCAL_STABLE_DIFFUSION_VIDEO_IMPLEMENTATION.driverId
    && configuration.implementation.driverDialect === NIMI_MACHINE_LOCAL_STABLE_DIFFUSION_VIDEO_IMPLEMENTATION.driverDialect;
}

export function configuredMachineLocalFixedContextSize(
  configuration: NimiMachineLocalCapabilityConfiguration,
): number | undefined {
  const value = configuration.portableConfig?.contextSize;
  return typeof value === 'number' && Number.isInteger(value) && value > 0
    ? value
    : undefined;
}

export function machineLocalEngineDisplayName(
  configuration: NimiMachineLocalCapabilityConfiguration,
  t: TFunction,
): string {
  const implementation = configuration.implementation;
  if (
    implementation.implementationId
      === NIMI_MACHINE_LOCAL_LLAMA_CPP_TEXT_IMPLEMENTATION.implementationId
    && implementation.driverId
      === NIMI_MACHINE_LOCAL_LLAMA_CPP_TEXT_IMPLEMENTATION.driverId
  ) {
    return 'llama.cpp';
  }
  if (
    implementation.implementationId
      === NIMI_MACHINE_LOCAL_STABLE_DIFFUSION_IMAGE_IMPLEMENTATION.implementationId
    && implementation.driverId
      === NIMI_MACHINE_LOCAL_STABLE_DIFFUSION_IMAGE_IMPLEMENTATION.driverId
  ) {
    return 'stable-diffusion.cpp';
  }
  return t('runtimeConfig.machineLocalAIConfigurations.otherEngine');
}

export function machineLocalAssetDisplayName(
  asset: NimiRuntimeLocalAssetEntry | undefined,
  t: TFunction,
  bound = false,
): string {
  const name = asset?.displayName
    || asset?.sourceFileName
    || (bound
      ? t('runtimeConfig.machineLocalAIConfigurations.boundLocalFile')
      : t('runtimeConfig.machineLocalAIConfigurations.unnamedLocalFile'));
  return asset?.exactContent?.kind === 'sharded-bundle'
    ? `${name} · ${t('runtimeConfig.machineLocalAIConfigurations.fileBundle')}`
    : name;
}

export function machineLocalModelFamilyDisplayName(
  family: RuntimeConfigMachineLocalAIAddDraft['modelFamily'],
): string {
  switch (family) {
    case 'z-image':
      return 'Z-Image';
    case 'z-image-turbo':
      return 'Z-Image Turbo';
    case 'ideogram4':
      return 'Ideogram 4';
  }
}

export function machineLocalRequirementGroupDisplay(
  role: NimiMachineLocalCapabilityRequirement['role'],
  occurrenceOrdinal: number,
  t: TFunction,
): string {
  const roleLabel = role === 'main'
    ? t('runtimeConfig.machineLocalAIConfigurations.roleMain')
    : t('runtimeConfig.machineLocalAIConfigurations.roleCompanion');
  return occurrenceOrdinal > 0
    ? t('runtimeConfig.machineLocalAIConfigurations.roleOrdinal', {
      role: roleLabel,
      position: occurrenceOrdinal,
    })
    : t('runtimeConfig.machineLocalAIConfigurations.roleSingleton', { role: roleLabel });
}

export const machineLocalReadOnlyFieldClassName = 'flex min-h-10 items-center rounded-xl border border-[var(--nimi-field-border)] bg-[var(--nimi-field-bg)] px-3 text-sm text-[var(--nimi-field-text)]';
