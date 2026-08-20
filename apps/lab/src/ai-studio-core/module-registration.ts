import type { ComponentType } from 'react';
import type { LucideIcon } from 'lucide-react';
import type { StudioParameterContract } from './parameters.js';
import type { StudioParameterPanelProps } from './parameter-fields.js';

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-scaf-019c

export type StudioControlId = 'tone' | 'length';
export type StudioInputKind = 'prompt' | 'url' | 'none';
export type StudioResultKind = 'text' | 'transcript' | 'embedding' | 'artifacts' | 'voice-asset' | 'voice-catalog';

export type CapabilityStudioProfile = {
  readonly studioTag: string;
  readonly inputTitleKey: string;
  readonly inputPlaceholderKey: string;
  readonly inputKind: StudioInputKind;
  readonly inputNoteKey?: string;
  readonly supportsAttachments: boolean;
  readonly controls: readonly StudioControlId[];
  readonly primaryLabelKey: string;
  readonly primaryRunningLabelKey: string;
  readonly resultTitle: string;
  readonly emptyTitleKey: string;
  readonly emptyHintKey: string;
  readonly resultKind: StudioResultKind;
  readonly footnoteKey: string;
  readonly statusLabelKey?: string;
  readonly pendingLabelKey?: string;
};

export type ScenarioPreset = {
  readonly id: string;
  readonly label: string;
  readonly prompt: string;
};

export type StudioCapabilityDescriptor<TCapabilityId extends string = string> = {
  readonly id: TCapabilityId;
  readonly label: string;
  readonly labelKey: string;
  readonly group: 'text' | 'media' | 'audio' | 'world';
  readonly section: 'chat' | 'embed' | 'image' | 'video' | 'tts' | 'stt' | 'voice' | 'world';
  readonly summary: string;
  readonly summaryKey: string;
  readonly surface: string;
  readonly execution: 'runtime-sdk' | 'standalone-tauri' | 'typed-unavailable';
  readonly capabilityContract?: string;
  readonly missingSurface?: string;
};

export type StudioCapabilityRegistration<TCapabilityId extends string = string> = {
  readonly descriptor: StudioCapabilityDescriptor<TCapabilityId>;
  readonly icon: LucideIcon;
  readonly profile: CapabilityStudioProfile;
  readonly preset: ScenarioPreset;
  readonly runtimeMethod: string;
  readonly parameters: StudioParameterContract;
  readonly parameterPanel?: ComponentType<StudioParameterPanelProps>;
};

export type AIStudioModuleRegistration<
  TModuleId extends string = string,
  TCapabilityId extends string = string,
> = {
  readonly id: TModuleId;
  readonly navigationLabel: string;
  readonly order: number;
  readonly capabilities: readonly StudioCapabilityRegistration<TCapabilityId>[];
};

export function composeAIStudioModules(
  registrations: readonly AIStudioModuleRegistration[],
) {
  const ordered = [...registrations].sort((left, right) => left.order - right.order);
  const moduleIds: string[] = [];
  const capabilityIds: string[] = [];
  const capabilities: StudioCapabilityRegistration[] = [];
  for (const registration of ordered) {
    if (!registration.id || moduleIds.includes(registration.id)) {
      throw new Error(`Duplicate or empty AI studio module id: ${registration.id || 'missing'}`);
    }
    moduleIds.push(registration.id);
    if (registration.capabilities.length === 0) {
      throw new Error(`AI studio module has no capabilities: ${registration.id}`);
    }
    for (const capability of registration.capabilities) {
      const id = capability.descriptor.id;
      if (!id || capabilityIds.includes(id)) {
        throw new Error(`Duplicate or empty AI studio capability id: ${id || 'missing'}`);
      }
      capabilityIds.push(id);
      capabilities.push(capability);
    }
  }
  return Object.freeze({
    modules: Object.freeze(ordered),
    capabilities: Object.freeze(capabilities),
    getCapability(id: string) {
      const capability = capabilities.find((candidate) => candidate.descriptor.id === id);
      if (!capability) throw new Error(`Unknown AI studio capability: ${id}`);
      return capability;
    },
    createInitialParameterState() {
      return Object.freeze(Object.fromEntries(
        capabilities.map((capability) => [capability.descriptor.id, capability.parameters.initial()]),
      ));
    },
  });
}
