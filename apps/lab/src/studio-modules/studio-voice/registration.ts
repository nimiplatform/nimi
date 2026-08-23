import { AudioWaveform, Captions, ListMusic, Speech } from 'lucide-react';
import type { AIStudioModuleRegistration } from '../../ai-studio-core/module-registration.js';
import { studioVoiceDescriptors, type StudioVoiceCapabilityId } from './descriptors.js';
import {
  studioSpeechSynthesizeParameters,
  studioSpeechTranscribeParameters,
  studioVoiceCreateParameters,
} from './parameters.js';
import { EMPTY_STUDIO_PARAMETERS } from '../../ai-studio-core/parameters.js';
import { StudioVoiceParameterPanel } from './parameter-panel.js';

export const studioVoiceModule = Object.freeze({
  id: 'studio-voice', navigationLabel: 'Voice', order: 30,
  capabilities: [
    {
      descriptor: studioVoiceDescriptors[0],
      icon: Speech,
      profile: {
        studioTag: 'Speech', inputTitleKey: 'Studio.profiles.audioSynthesize.inputTitle', inputPlaceholderKey: 'Studio.profiles.audioSynthesize.inputPlaceholder', inputKind: 'prompt', supportsAttachments: false, controls: [], primaryLabelKey: 'Studio.profiles.audioSynthesize.primaryLabel', primaryRunningLabelKey: 'Studio.profiles.audioSynthesize.primaryRunningLabel', resultTitle: 'Synthesized audio', emptyTitleKey: 'Studio.profiles.audioSynthesize.emptyTitle', emptyHintKey: 'Studio.profiles.audioSynthesize.emptyHint', resultKind: 'artifacts', footnoteKey: 'Studio.profiles.audioSynthesize.footnote',
      },
      preset: { id: 'speech-line', label: 'Speech line', prompt: 'Synthesize a short Runtime acceptance sentence.' },
      runtimeMethod: 'runtime.ai.submitScenarioJob:speech_synthesize',
      parameters: studioSpeechSynthesizeParameters,
      parameterPanel: StudioVoiceParameterPanel,
    },
    {
      descriptor: studioVoiceDescriptors[1],
      icon: Captions,
      profile: {
        studioTag: 'Transcribe', inputTitleKey: 'Studio.profiles.audioTranscribe.inputTitle', inputPlaceholderKey: 'Studio.profiles.audioTranscribe.inputPlaceholder', inputKind: 'url', supportsAttachments: false, controls: [], primaryLabelKey: 'Studio.profiles.audioTranscribe.primaryLabel', primaryRunningLabelKey: 'Studio.profiles.audioTranscribe.primaryRunningLabel', resultTitle: 'Transcript', emptyTitleKey: 'Studio.profiles.audioTranscribe.emptyTitle', emptyHintKey: 'Studio.profiles.audioTranscribe.emptyHint', resultKind: 'transcript', footnoteKey: 'Studio.profiles.audioTranscribe.footnote',
      },
      preset: { id: 'audio-url', label: 'Audio URL', prompt: 'https://example.test/sample.wav' },
      runtimeMethod: 'kit.generation.runRuntimeSpeechTranscribe',
      parameters: studioSpeechTranscribeParameters,
      parameterPanel: StudioVoiceParameterPanel,
    },
    {
      descriptor: studioVoiceDescriptors[2],
      icon: AudioWaveform,
      profile: {
        studioTag: 'Voice', inputTitleKey: 'Studio.profiles.voiceCreate.inputTitle', inputPlaceholderKey: 'Studio.profiles.voiceCreate.inputPlaceholder', inputKind: 'prompt', supportsAttachments: false, controls: [], primaryLabelKey: 'Studio.profiles.voiceCreate.primaryLabel', primaryRunningLabelKey: 'Studio.profiles.voiceCreate.primaryRunningLabel', resultTitle: 'Created voice', emptyTitleKey: 'Studio.profiles.voiceCreate.emptyTitle', emptyHintKey: 'Studio.profiles.voiceCreate.emptyHint', resultKind: 'voice-asset', footnoteKey: 'Studio.profiles.voiceCreate.footnote',
      },
      preset: { id: 'voice-create', label: 'Voice create', prompt: 'Create a warm, clear Mandarin voice for a friendly Nimi assistant.' },
      runtimeMethod: 'sdk.localApp.ai.scenarioJobs.submit:voice-create',
      parameters: studioVoiceCreateParameters,
      parameterPanel: StudioVoiceParameterPanel,
    },
    {
      descriptor: studioVoiceDescriptors[3],
      icon: ListMusic,
      profile: {
        studioTag: 'Voices', inputTitleKey: 'Studio.profiles.speechBundle.inputTitle', inputPlaceholderKey: 'Studio.profiles.speechBundle.inputPlaceholder', inputKind: 'none', inputNoteKey: 'Studio.profiles.speechBundle.inputNote', supportsAttachments: false, controls: [], primaryLabelKey: 'Studio.profiles.speechBundle.primaryLabel', primaryRunningLabelKey: 'Studio.profiles.speechBundle.primaryRunningLabel', resultTitle: 'Voice catalog', emptyTitleKey: 'Studio.profiles.speechBundle.emptyTitle', emptyHintKey: 'Studio.profiles.speechBundle.emptyHint', resultKind: 'voice-catalog', footnoteKey: 'Studio.profiles.speechBundle.footnote',
      },
      preset: { id: 'voice-catalog', label: 'Voice catalog', prompt: 'List voices through Kit Runtime voice catalog.' },
      runtimeMethod: 'kit.generation.runRuntimeVoiceCatalog',
      parameters: EMPTY_STUDIO_PARAMETERS,
    },
  ],
} as const satisfies AIStudioModuleRegistration<'studio-voice', StudioVoiceCapabilityId>);
