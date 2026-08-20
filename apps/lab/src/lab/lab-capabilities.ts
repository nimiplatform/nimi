export type LabCapabilityId =
  | 'text.generate'
  | 'chat.stream'
  | 'text.embed'
  | 'image.generate'
  | 'audio.synthesize'
  | 'audio.transcribe'
  | 'voice.create'
  | 'video.generate'
  | 'speech.bundle'
  | 'world.generate';

export type LabCapability = {
  id: LabCapabilityId;
  /** English technical identity; also persisted into run records and results. */
  label: string;
  /** Locale key for the rendering-layer label (side nav, panels). */
  labelKey: string;
  group: 'text' | 'media' | 'audio' | 'world';
  /** English technical summary; persisted/diagnostic surfaces only. */
  summary: string;
  /** Locale key for the rendering-layer summary. */
  summaryKey: string;
  surface: string;
  execution: 'runtime-sdk' | 'standalone-tauri' | 'typed-unavailable';
  capabilityContract?: string;
  missingSurface?: string;
};

export const labCapabilities: LabCapability[] = [
  {
    id: 'text.generate',
    label: 'Text Studio',
    labelKey: 'Capabilities.textGenerate.label',
    group: 'text',
    summary: 'Prompt → text.generate CapabilityContract → typed Runtime result.',
    summaryKey: 'Capabilities.textGenerate.summary',
    surface: 'sdk.localApp.ai.text.generateCandidate → RuntimeAiService.GenerateLocalAppTextCandidate',
    execution: 'runtime-sdk',
    capabilityContract: 'text.generate',
  },
  {
    id: 'chat.stream',
    label: 'Chat Stream',
    labelKey: 'Capabilities.chatStream.label',
    group: 'text',
    summary: 'Conversation turn → protected text.generate stream → incremental typed Runtime result.',
    summaryKey: 'Capabilities.chatStream.summary',
    surface: 'kit.runRuntimeAIConsumeCapability → sdk.localApp.ai.text.streamTurn',
    execution: 'runtime-sdk',
    capabilityContract: 'text.generate',
  },
  {
    id: 'text.embed',
    label: 'Embeddings',
    labelKey: 'Capabilities.textEmbed.label',
    group: 'text',
    summary: 'Input string → protected scenario.execute text.embed → typed vector result.',
    summaryKey: 'Capabilities.textEmbed.summary',
    surface: 'sdk.localApp.ai.scenario.execute:text-embed',
    execution: 'runtime-sdk',
    capabilityContract: 'text.embed',
  },
  {
    id: 'image.generate',
    label: 'Image Generate',
    labelKey: 'Capabilities.imageGenerate.label',
    group: 'media',
    summary: 'Prompt → image.generate Scenario Job → typed artifact preview result.',
    summaryKey: 'Capabilities.imageGenerate.summary',
    surface: 'kit.runRuntimeImageGenerate → sdk.localApp.ai.scenarioJobs + artifacts',
    execution: 'runtime-sdk',
    capabilityContract: 'image.generate',
  },
  {
    id: 'video.generate',
    label: 'Video Generate',
    labelKey: 'Capabilities.videoGenerate.label',
    group: 'media',
    summary: 'Prompt → video.generate Scenario Job → typed artifact preview result.',
    summaryKey: 'Capabilities.videoGenerate.summary',
    surface: 'kit.runRuntimeVideoGenerate → sdk.localApp.ai.scenarioJobs + artifacts',
    execution: 'runtime-sdk',
    capabilityContract: 'video.generate',
  },
  {
    id: 'audio.synthesize',
    label: 'Speech Synthesis',
    labelKey: 'Capabilities.audioSynthesize.label',
    group: 'audio',
    summary: 'Text → audio.synthesize Scenario Job → typed audio artifact result.',
    summaryKey: 'Capabilities.audioSynthesize.summary',
    surface: 'kit.runRuntimeSpeechSynthesize → sdk.localApp.ai.scenarioJobs + artifacts',
    execution: 'runtime-sdk',
    capabilityContract: 'audio.synthesize',
  },
  {
    id: 'audio.transcribe',
    label: 'Speech Transcribe',
    labelKey: 'Capabilities.audioTranscribe.label',
    group: 'audio',
    summary: 'Audio URL → audio.transcribe Scenario Job → typed transcript result.',
    summaryKey: 'Capabilities.audioTranscribe.summary',
    surface: 'kit.runRuntimeSpeechTranscribe → sdk.localApp.ai.scenarioJobs + artifacts',
    execution: 'runtime-sdk',
    capabilityContract: 'audio.transcribe',
  },
  {
    id: 'voice.create',
    label: 'Voice Create',
    labelKey: 'Capabilities.voiceCreate.label',
    group: 'audio',
    summary: 'Typed reference audio or text description → voice.create Scenario Job → VoiceAsset.',
    summaryKey: 'Capabilities.voiceCreate.summary',
    surface: 'sdk.localApp.ai.scenarioJobs.submit:voice-create',
    execution: 'runtime-sdk',
    capabilityContract: 'voice.create',
  },
  {
    id: 'speech.bundle',
    label: 'Speech Bundle',
    labelKey: 'Capabilities.speechBundle.label',
    group: 'audio',
    summary: 'Inspect owner-scoped voice references through the protected Runtime voice catalog.',
    summaryKey: 'Capabilities.speechBundle.summary',
    surface: 'kit.runRuntimeVoiceCatalog → sdk.localApp.ai.voiceAssets.list',
    execution: 'runtime-sdk',
    capabilityContract: 'audio.synthesize',
  },
  {
    id: 'world.generate',
    label: 'World Tour',
    labelKey: 'Capabilities.worldGenerate.label',
    group: 'world',
    summary: 'Standalone Tauri viewer launch via app-owned open_world_tour_window command.',
    summaryKey: 'Capabilities.worldGenerate.summary',
    surface: 'app-owned tauri: resolve_world_tour_fixture + open_world_tour_window',
    execution: 'standalone-tauri',
  },
];

export const labModelConfigCapabilityContracts: readonly string[] = Object.freeze(
  labCapabilities
    .flatMap((capability) => (
      capability.execution === 'runtime-sdk' && capability.capabilityContract
        ? [capability.capabilityContract]
        : []
    ))
    .filter((capabilityContract, index, contracts) => contracts.indexOf(capabilityContract) === index),
);

export function getLabCapability(id: LabCapabilityId): LabCapability {
  const capability = labCapabilities.find((item) => item.id === id);
  if (!capability) {
    throw new Error(`Unknown lab capability: ${id}`);
  }
  return capability;
}

export function getLabCapabilityContract(id: LabCapabilityId): string | null {
  return getLabCapability(id).capabilityContract ?? null;
}
