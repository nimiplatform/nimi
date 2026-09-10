export type StudioMediaCapabilityId = 'image.generate' | 'video.generate' | 'music.generate' | 'vision.locate';

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
] as const);
