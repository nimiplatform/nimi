export type StudioMediaCapabilityId = 'image.generate' | 'video.generate' | 'music.generate' | 'vision.locate' | 'music.transcribe' | 'audio.voice.convert' | 'audio.separate';

export const studioMediaDescriptors = Object.freeze([
  {
    id: 'image.generate', label: 'Image Generate', labelKey: 'Capabilities.imageGenerate.label', group: 'media',
    section: 'image',
    summary: 'Prompt → image.generate Scenario Job → typed artifact preview result.', summaryKey: 'Capabilities.imageGenerate.summary',
    surface: 'kit.runRuntimeImageGenerate → sdk.localApp.ai.scenarioJobs + artifacts', execution: 'runtime-sdk', capabilityContract: 'image.generate',
  },
  {
    id: 'video.generate', label: 'Video Generate', labelKey: 'Capabilities.videoGenerate.label', group: 'media',
    section: 'video',
    summary: 'Prompt → video.generate Scenario Job → typed artifact preview result.', summaryKey: 'Capabilities.videoGenerate.summary',
    surface: 'kit.runRuntimeVideoGenerate → sdk.localApp.ai.scenarioJobs + artifacts', execution: 'runtime-sdk', capabilityContract: 'video.generate',
  },
  {
    id: 'music.generate', label: 'Music Generate', labelKey: 'Capabilities.musicGenerate.label', group: 'media',
    section: 'music',
    summary: 'Prompt + lyrics → protected music.generate Scenario Job → adopted WAV.', summaryKey: 'Capabilities.musicGenerate.summary',
    surface: 'kit.runRuntimeMusicGenerate → sdk.localApp.ai.scenarioJobs + artifact adoption', execution: 'runtime-sdk', capabilityContract: 'music.generate',
  },
  {
    id: 'vision.locate', label: 'Visual localization', labelKey: 'Capabilities.visionLocate.label', group: 'media', section: 'image',
    summary: 'Locate objects or controls in one image using boxes or points.', summaryKey: 'Capabilities.visionLocate.summary',
    surface: 'sdk.localApp.ai.scenarioJobs + artifact upload', execution: 'runtime-sdk', capabilityContract: 'vision.locate',
  },
  {
    id: 'music.transcribe', label: 'Music transcription', labelKey: 'Capabilities.musicTranscribe.label', group: 'media', section: 'music',
    summary: 'Audio → canonical PCM → estimated score and source-aligned musical events.', summaryKey: 'Capabilities.musicTranscribe.summary',
    surface: 'kit.runRuntimeMusicTranscribe → sdk.localApp.ai.scenarioJobs + artifact adoption', execution: 'runtime-sdk', capabilityContract: 'music.transcribe',
  },
  {
    id: 'audio.voice.convert', label: 'Voice conversion', labelKey: 'Capabilities.voiceConvert.label', group: 'media', section: 'music',
    summary: 'Singing + target voice → canonical PCM → converted vocal with a reported length relation.', summaryKey: 'Capabilities.voiceConvert.summary',
    surface: 'kit.runRuntimeVoiceConvert → sdk.localApp.ai.scenarioJobs + artifact adoption', execution: 'runtime-sdk', capabilityContract: 'audio.voice.convert',
  },
  {
    id: 'audio.separate', label: 'Audio separation', labelKey: 'Capabilities.audioSeparate.label', group: 'media', section: 'music',
    summary: 'Recording → canonical PCM → vocals and background stems, with optional real instrument parts.', summaryKey: 'Capabilities.audioSeparate.summary',
    surface: 'kit.runRuntimeAudioSeparation → sdk.localApp.ai.scenarioJobs + artifact adoption', execution: 'runtime-sdk', capabilityContract: 'audio.separate',
  },
] as const);
