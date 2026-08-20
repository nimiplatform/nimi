import { MessageSquareText, Sparkles, TextCursorInput } from 'lucide-react';
import type { AIStudioModuleRegistration } from '../../ai-studio-core/module-registration.js';
import { studioCreateDescriptors, type StudioCreateCapabilityId } from './descriptors.js';
import { studioChatStreamParameters, studioTextEmbedParameters, studioTextGenerateParameters } from './parameters.js';
import { StudioCreateParameterPanel } from './parameter-panel.js';

export const studioCreateModule = Object.freeze({
  id: 'studio-create',
  navigationLabel: 'Create',
  order: 10,
  capabilities: [
    {
      descriptor: studioCreateDescriptors[0],
      icon: Sparkles,
      profile: {
        studioTag: 'Text', inputTitleKey: 'Studio.profiles.textGenerate.inputTitle', inputPlaceholderKey: 'Studio.profiles.textGenerate.inputPlaceholder', inputKind: 'prompt', supportsAttachments: false, controls: ['tone', 'length'], primaryLabelKey: 'Studio.profiles.textGenerate.primaryLabel', primaryRunningLabelKey: 'Studio.profiles.textGenerate.primaryRunningLabel', resultTitle: 'Generated result', emptyTitleKey: 'Studio.profiles.textGenerate.emptyTitle', emptyHintKey: 'Studio.profiles.textGenerate.emptyHint', resultKind: 'text', footnoteKey: 'Studio.profiles.textGenerate.footnote',
      },
      preset: { id: 'acceptance-note', label: 'Acceptance note', prompt: 'Write a concise acceptance note for a Runtime-backed Nimi App that can generate helpful content.' },
      runtimeMethod: 'sdk.localApp.ai.text.generateCandidate',
      parameters: studioTextGenerateParameters,
      parameterPanel: StudioCreateParameterPanel,
    },
    {
      descriptor: studioCreateDescriptors[1],
      icon: MessageSquareText,
      profile: {
        studioTag: 'Chat', inputTitleKey: 'Studio.profiles.chatStream.inputTitle', inputPlaceholderKey: 'Studio.profiles.chatStream.inputPlaceholder', inputKind: 'prompt', supportsAttachments: false, controls: [], primaryLabelKey: 'Studio.profiles.chatStream.primaryLabel', primaryRunningLabelKey: 'Studio.profiles.chatStream.primaryRunningLabel', resultTitle: 'Streamed reply', emptyTitleKey: 'Studio.profiles.chatStream.emptyTitle', emptyHintKey: 'Studio.profiles.chatStream.emptyHint', resultKind: 'text', footnoteKey: 'Studio.profiles.chatStream.footnote',
      },
      preset: { id: 'stream-sample', label: 'Stream sample', prompt: 'Continue this conversation through the text.generate stream contract.' },
      runtimeMethod: 'runtime.ai.streamScenario:text_generate',
      parameters: studioChatStreamParameters,
      parameterPanel: StudioCreateParameterPanel,
    },
    {
      descriptor: studioCreateDescriptors[2],
      icon: TextCursorInput,
      profile: {
        studioTag: 'Embeddings', inputTitleKey: 'Studio.profiles.textEmbed.inputTitle', inputPlaceholderKey: 'Studio.profiles.textEmbed.inputPlaceholder', inputKind: 'prompt', supportsAttachments: false, controls: [], primaryLabelKey: 'Studio.profiles.textEmbed.primaryLabel', primaryRunningLabelKey: 'Studio.profiles.textEmbed.primaryRunningLabel', resultTitle: 'Embedding result', emptyTitleKey: 'Studio.profiles.textEmbed.emptyTitle', emptyHintKey: 'Studio.profiles.textEmbed.emptyHint', resultKind: 'embedding', footnoteKey: 'Studio.profiles.textEmbed.footnote',
      },
      preset: { id: 'embedding-sample', label: 'Embedding sample', prompt: 'Identity-neutral App embedding sample.' },
      runtimeMethod: 'runtime.ai.executeScenario:text_embed',
      parameters: studioTextEmbedParameters,
      parameterPanel: StudioCreateParameterPanel,
    },
  ],
} as const satisfies AIStudioModuleRegistration<'studio-create', StudioCreateCapabilityId>);
