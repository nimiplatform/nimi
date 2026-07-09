export type TesterCapabilityId =
  | 'text.generate'
  | 'chat.stream'
  | 'text.embed'
  | 'image.generate'
  | 'audio.synthesize'
  | 'audio.transcribe'
  | 'video.generate'
  | 'speech.bundle'
  | 'world.generate';

export type TesterCapability = {
  id: TesterCapabilityId;
  label: string;
  group: 'text' | 'media' | 'audio' | 'world';
  summary: string;
  surface: string;
  execution: 'runtime-sdk' | 'standalone-tauri' | 'typed-unavailable';
  runtimeBindingCapabilityId?: string;
  missingSurface?: string;
};

export const testerCapabilities: TesterCapability[] = [
  {
    id: 'text.generate',
    label: 'Text Studio',
    group: 'text',
    summary: 'Prompt → Kit generation Runtime consumer text_generate.',
    surface: 'kit.generation.runRuntimeAIConsumeCapability:text.generate → runtime.ai.executeScenario',
    execution: 'runtime-sdk',
    runtimeBindingCapabilityId: 'text.generate',
  },
  {
    id: 'chat.stream',
    label: 'Chat Stream',
    group: 'text',
    summary: 'Conversation turn → Kit provider over Runtime Scenario stream.',
    surface: 'kit.chat.createSdkConversationRuntimeAdapter → runtime.ai.streamScenario',
    execution: 'runtime-sdk',
    runtimeBindingCapabilityId: 'text.generate',
  },
  {
    id: 'text.embed',
    label: 'Embeddings',
    group: 'text',
    summary: 'Input string → Kit generation Runtime consumer text_embed.',
    surface: 'kit.generation.runRuntimeAIConsumeCapability:text.embed → runtime.ai.executeScenario',
    execution: 'runtime-sdk',
    runtimeBindingCapabilityId: 'text.embed',
  },
  {
    id: 'image.generate',
    label: 'Image Generate',
    group: 'media',
    summary: 'Prompt → Kit image generation Runtime consumer (artifacts).',
    surface: 'kit.generation.runRuntimeImageGenerate → runtime.ai.submitScenarioJob:image_generate',
    execution: 'runtime-sdk',
    runtimeBindingCapabilityId: 'image.generate',
  },
  {
    id: 'video.generate',
    label: 'Video Generate',
    group: 'media',
    summary: 'Prompt → Kit video generation Runtime consumer (artifacts).',
    surface: 'kit.generation.runRuntimeVideoGenerate → runtime.ai.submitScenarioJob:video_generate',
    execution: 'runtime-sdk',
    runtimeBindingCapabilityId: 'video.generate',
  },
  {
    id: 'audio.synthesize',
    label: 'Speech Synthesis',
    group: 'audio',
    summary: 'Text → Kit speech synthesis Runtime consumer (audio artifacts).',
    surface: 'kit.generation.runRuntimeSpeechSynthesize → runtime.ai.submitScenarioJob:speech_synthesize',
    execution: 'runtime-sdk',
    runtimeBindingCapabilityId: 'audio.synthesize',
  },
  {
    id: 'audio.transcribe',
    label: 'Speech Transcribe',
    group: 'audio',
    summary: 'Audio URL → Kit speech transcription Runtime consumer (transcript text + artifacts).',
    surface: 'kit.generation.runRuntimeSpeechTranscribe → runtime.ai.submitScenarioJob:speech_transcribe',
    execution: 'runtime-sdk',
    runtimeBindingCapabilityId: 'audio.transcribe',
  },
  {
    id: 'speech.bundle',
    label: 'Speech Bundle',
    group: 'audio',
    summary: 'Probe → Kit Runtime voice catalog consumer (catalog readiness + voice sample).',
    surface: 'kit.generation.runRuntimeVoiceCatalog → runtime.ai.listPresetVoices',
    execution: 'runtime-sdk',
    runtimeBindingCapabilityId: 'audio.synthesize',
  },
  {
    id: 'world.generate',
    label: 'World Tour',
    group: 'world',
    summary: 'Standalone Tauri viewer launch via app-owned open_world_tour_window command.',
    surface: 'app-owned tauri: resolve_world_tour_fixture + open_world_tour_window',
    execution: 'standalone-tauri',
  },
];

export function getTesterCapability(id: TesterCapabilityId): TesterCapability {
  const capability = testerCapabilities.find((item) => item.id === id);
  if (!capability) {
    throw new Error(`Unknown tester capability: ${id}`);
  }
  return capability;
}

export function getTesterRuntimeBindingCapabilityId(id: TesterCapabilityId): string | null {
  return getTesterCapability(id).runtimeBindingCapabilityId ?? null;
}
