import { Image as ImageIcon, Music2, Video, ScanSearch, AudioWaveform, AudioLines } from 'lucide-react';
import { StudioVisionParameterPanel, studioVisionLocateParameters } from './vision-parameters.js';
import type { AIStudioModuleRegistration } from '../../ai-studio-core/module-registration.js';
import { studioMediaDescriptors, type StudioMediaCapabilityId } from './descriptors.js';
import { studioImageGenerateParameters, studioMusicGenerateParameters, studioVideoGenerateParameters } from './parameters.js';
import { StudioMediaParameterPanel } from './parameter-panel.js';
import { MusicTranscriptionFields } from './music-transcription-parameters.js';
import { VoiceConvertFields } from './voice-convert-parameters.js';
import { AudioSeparateFields } from './audio-separate-parameters.js';
import { studioAudioSeparateParameters, studioMusicTranscribeParameters, studioVoiceConvertParameters } from './parameters.js';

export const studioMediaModule = Object.freeze({
  id: 'studio-media', navigationLabel: 'Media', order: 20,
  capabilities: [
    {
      descriptor: studioMediaDescriptors[4], icon: Music2,
      profile: {
        studioTag: 'Music', inputTitleKey: 'Studio.profiles.musicTranscribe.inputTitle', inputPlaceholderKey: 'Studio.profiles.musicTranscribe.inputPlaceholder', inputKind: 'none', supportsAttachments: false, controls: [], primaryLabelKey: 'Studio.profiles.musicTranscribe.primaryLabel', primaryRunningLabelKey: 'Studio.profiles.musicTranscribe.primaryRunningLabel', resultTitle: 'Estimated score', emptyTitleKey: 'Studio.profiles.musicTranscribe.emptyTitle', emptyHintKey: 'Studio.profiles.musicTranscribe.emptyHint', resultKind: 'artifacts', footnoteKey: 'Studio.profiles.musicTranscribe.footnote',
      },
      preset: { id: 'transcribe-recording', label: 'Transcribe a recording', prompt: '' },
      runtimeMethod: 'kit.generation.runRuntimeMusicTranscribe', parameters: studioMusicTranscribeParameters, parameterPanel: MusicTranscriptionFields,
    },
    {
      descriptor: studioMediaDescriptors[5], icon: AudioWaveform,
      profile: {
        studioTag: 'Music', inputTitleKey: 'Studio.profiles.voiceConvert.inputTitle', inputPlaceholderKey: 'Studio.profiles.voiceConvert.inputPlaceholder', inputKind: 'none', supportsAttachments: false, controls: [], primaryLabelKey: 'Studio.profiles.voiceConvert.primaryLabel', primaryRunningLabelKey: 'Studio.profiles.voiceConvert.primaryRunningLabel', resultTitle: 'Converted vocal', emptyTitleKey: 'Studio.profiles.voiceConvert.emptyTitle', emptyHintKey: 'Studio.profiles.voiceConvert.emptyHint', resultKind: 'artifacts', footnoteKey: 'Studio.profiles.voiceConvert.footnote',
      },
      preset: { id: 'convert-singing-voice', label: 'Convert a singing voice', prompt: '' },
      runtimeMethod: 'kit.generation.runRuntimeVoiceConvert', parameters: studioVoiceConvertParameters, parameterPanel: VoiceConvertFields,
    },
    {
      descriptor: studioMediaDescriptors[6], icon: AudioLines,
      profile: {
        studioTag: 'Music', inputTitleKey: 'Studio.profiles.audioSeparate.inputTitle', inputPlaceholderKey: 'Studio.profiles.audioSeparate.inputPlaceholder', inputKind: 'none', supportsAttachments: false, controls: [], primaryLabelKey: 'Studio.profiles.audioSeparate.primaryLabel', primaryRunningLabelKey: 'Studio.profiles.audioSeparate.primaryRunningLabel', resultTitle: 'Separated stems', emptyTitleKey: 'Studio.profiles.audioSeparate.emptyTitle', emptyHintKey: 'Studio.profiles.audioSeparate.emptyHint', resultKind: 'artifacts', footnoteKey: 'Studio.profiles.audioSeparate.footnote',
      },
      preset: { id: 'separate-vocals-background', label: 'Separate vocals and background', prompt: '' },
      runtimeMethod: 'kit.generation.runRuntimeAudioSeparation', parameters: studioAudioSeparateParameters, parameterPanel: AudioSeparateFields,
    },
    {
      descriptor: studioMediaDescriptors[3], icon: ScanSearch,
      profile: {
        studioTag: 'Vision', inputTitleKey: 'Studio.profiles.visionLocate.inputTitle', inputPlaceholderKey: 'Studio.profiles.visionLocate.inputPlaceholder', inputKind: 'prompt', supportsAttachments: true, controls: [], primaryLabelKey: 'Studio.profiles.visionLocate.primaryLabel', primaryRunningLabelKey: 'Studio.profiles.visionLocate.primaryRunningLabel', resultTitle: 'Locations', emptyTitleKey: 'Studio.profiles.visionLocate.emptyTitle', emptyHintKey: 'Studio.profiles.visionLocate.emptyHint', resultKind: 'vision-locate', footnoteKey: 'Studio.profiles.visionLocate.footnote',
      },
      preset: { id: 'locate-object', label: 'Locate an object', prompt: '' },
      runtimeMethod: 'runtime.ai.submitScenarioJob:vision_locate', parameters: studioVisionLocateParameters, parameterPanel: StudioVisionParameterPanel,
    },
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
    {
      descriptor: studioMediaDescriptors[2],
      icon: Music2,
      profile: {
        studioTag: 'Music', inputTitleKey: 'Studio.profiles.musicGenerate.inputTitle', inputPlaceholderKey: 'Studio.profiles.musicGenerate.inputPlaceholder', inputKind: 'prompt', supportsAttachments: false, controls: [], primaryLabelKey: 'Studio.profiles.musicGenerate.primaryLabel', primaryRunningLabelKey: 'Studio.profiles.musicGenerate.primaryRunningLabel', resultTitle: 'Generated music', emptyTitleKey: 'Studio.profiles.musicGenerate.emptyTitle', emptyHintKey: 'Studio.profiles.musicGenerate.emptyHint', resultKind: 'artifacts', footnoteKey: 'Studio.profiles.musicGenerate.footnote',
      },
      preset: { id: 'music-sample', label: 'Music sample', prompt: 'Upbeat synth-pop with bright arpeggios, driving drums, and a soaring female vocal.' },
      runtimeMethod: 'kit.generation.runRuntimeMusicGenerate',
      parameters: studioMusicGenerateParameters,
      parameterPanel: StudioMediaParameterPanel,
    },
  ],
} as const satisfies AIStudioModuleRegistration<'studio-media', StudioMediaCapabilityId>);
