import { Image as ImageIcon, Video } from 'lucide-react';
import type { AIStudioModuleRegistration } from '../../ai-studio-core/module-registration.js';
import { studioMediaDescriptors, type StudioMediaCapabilityId } from './descriptors.js';
import { studioImageGenerateParameters, studioVideoGenerateParameters } from './parameters.js';
import { StudioMediaParameterPanel } from './parameter-panel.js';

export const studioMediaModule = Object.freeze({
  id: 'studio-media', navigationLabel: 'Media', order: 20,
  capabilities: [
    {
      descriptor: studioMediaDescriptors[0],
      icon: ImageIcon,
      profile: {
        studioTag: 'Image', inputTitleKey: 'Studio.profiles.imageGenerate.inputTitle', inputPlaceholderKey: 'Studio.profiles.imageGenerate.inputPlaceholder', inputKind: 'prompt', supportsAttachments: false, controls: [], primaryLabelKey: 'Studio.profiles.imageGenerate.primaryLabel', primaryRunningLabelKey: 'Studio.profiles.imageGenerate.primaryRunningLabel', resultTitle: 'Generated image', emptyTitleKey: 'Studio.profiles.imageGenerate.emptyTitle', emptyHintKey: 'Studio.profiles.imageGenerate.emptyHint', resultKind: 'artifacts', footnoteKey: 'Studio.profiles.imageGenerate.footnote',
      },
      preset: { id: 'ui-preview', label: 'UI preview', prompt: 'Generate a product-grade UI inspection image for a Nimi App workbench.' },
      runtimeMethod: 'runtime.ai.submitScenarioJob:image_generate',
      parameters: studioImageGenerateParameters,
      parameterPanel: StudioMediaParameterPanel,
    },
    {
      descriptor: studioMediaDescriptors[1],
      icon: Video,
      profile: {
        studioTag: 'Video', inputTitleKey: 'Studio.profiles.videoGenerate.inputTitle', inputPlaceholderKey: 'Studio.profiles.videoGenerate.inputPlaceholder', inputKind: 'prompt', supportsAttachments: false, controls: [], primaryLabelKey: 'Studio.profiles.videoGenerate.primaryLabel', primaryRunningLabelKey: 'Studio.profiles.videoGenerate.primaryRunningLabel', resultTitle: 'Generated clip', emptyTitleKey: 'Studio.profiles.videoGenerate.emptyTitle', emptyHintKey: 'Studio.profiles.videoGenerate.emptyHint', resultKind: 'artifacts', footnoteKey: 'Studio.profiles.videoGenerate.footnote',
      },
      preset: { id: 'clip-sample', label: 'Clip sample', prompt: 'Create a short inspection clip for a Nimi App glass UI workflow.' },
      runtimeMethod: 'kit.generation.runRuntimeVideoGenerate',
      parameters: studioVideoGenerateParameters,
      parameterPanel: StudioMediaParameterPanel,
    },
  ],
} as const satisfies AIStudioModuleRegistration<'studio-media', StudioMediaCapabilityId>);
