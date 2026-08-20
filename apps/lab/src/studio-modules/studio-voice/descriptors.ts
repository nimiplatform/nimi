export type StudioVoiceCapabilityId = 'audio.synthesize' | 'audio.transcribe' | 'voice.create' | 'speech.bundle';

export const studioVoiceDescriptors = Object.freeze([
  {
    id: 'audio.synthesize', label: 'Speech Synthesis', labelKey: 'Capabilities.audioSynthesize.label', group: 'audio',
    section: 'tts',
    summary: 'Text → audio.synthesize Scenario Job → typed audio artifact result.', summaryKey: 'Capabilities.audioSynthesize.summary',
    surface: 'kit.runRuntimeSpeechSynthesize → sdk.localApp.ai.scenarioJobs + artifacts', execution: 'runtime-sdk', capabilityContract: 'audio.synthesize',
  },
  {
    id: 'audio.transcribe', label: 'Speech Transcribe', labelKey: 'Capabilities.audioTranscribe.label', group: 'audio',
    section: 'stt',
    summary: 'Audio URL → audio.transcribe Scenario Job → typed transcript result.', summaryKey: 'Capabilities.audioTranscribe.summary',
    surface: 'kit.runRuntimeSpeechTranscribe → sdk.localApp.ai.scenarioJobs + artifacts', execution: 'runtime-sdk', capabilityContract: 'audio.transcribe',
  },
  {
    id: 'voice.create', label: 'Voice Create', labelKey: 'Capabilities.voiceCreate.label', group: 'audio',
    section: 'voice',
    summary: 'Typed reference audio or text description → voice.create Scenario Job → VoiceAsset.', summaryKey: 'Capabilities.voiceCreate.summary',
    surface: 'sdk.localApp.ai.scenarioJobs.submit:voice-create', execution: 'runtime-sdk', capabilityContract: 'voice.create',
  },
  {
    id: 'speech.bundle', label: 'Speech Bundle', labelKey: 'Capabilities.speechBundle.label', group: 'audio',
    section: 'voice',
    summary: 'Inspect owner-scoped voice references through the protected Runtime voice catalog.', summaryKey: 'Capabilities.speechBundle.summary',
    surface: 'kit.runRuntimeVoiceCatalog → sdk.localApp.ai.voiceAssets.list', execution: 'runtime-sdk', capabilityContract: 'audio.synthesize',
  },
] as const);
