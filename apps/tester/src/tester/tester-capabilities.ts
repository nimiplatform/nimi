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
    summary: 'Prompt → SDK vNext Runtime Scenario text_generate.',
    surface: 'sdk.ai.runNimiTextGenerate → runtime.ai.executeScenario',
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
    summary: 'Input string → SDK vNext Runtime Scenario text_embed.',
    surface: 'sdk.ai.createNimiRuntimeEmbeddingClient → runtime.ai.executeScenario',
    execution: 'runtime-sdk',
    runtimeBindingCapabilityId: 'text.embed',
  },
  {
    id: 'image.generate',
    label: 'Image Generate',
    group: 'media',
    summary: 'Prompt → runtime.ai.submitScenarioJob image_generate (artifacts).',
    surface: 'client.runtime.ai.submitScenarioJob:image_generate',
    execution: 'runtime-sdk',
    runtimeBindingCapabilityId: 'image.generate',
  },
  {
    id: 'video.generate',
    label: 'Video Generate',
    group: 'media',
    summary: 'Prompt → runtime.ai.submitScenarioJob video_generate (artifacts).',
    surface: 'client.runtime.ai.submitScenarioJob:video_generate',
    execution: 'runtime-sdk',
    runtimeBindingCapabilityId: 'video.generate',
  },
  {
    id: 'audio.synthesize',
    label: 'Speech Synthesis',
    group: 'audio',
    summary: 'Text → runtime.ai.submitScenarioJob speech_synthesize (audio artifacts).',
    surface: 'client.runtime.ai.submitScenarioJob:speech_synthesize',
    execution: 'runtime-sdk',
    runtimeBindingCapabilityId: 'audio.synthesize',
  },
  {
    id: 'audio.transcribe',
    label: 'Speech Transcribe',
    group: 'audio',
    summary: 'Audio URL → runtime.ai.submitScenarioJob speech_transcribe (transcript text + artifacts).',
    surface: 'client.runtime.ai.submitScenarioJob:speech_transcribe',
    execution: 'runtime-sdk',
    runtimeBindingCapabilityId: 'audio.transcribe',
  },
  {
    id: 'speech.bundle',
    label: 'Speech Bundle',
    group: 'audio',
    summary: 'Probe → runtime.ai.listPresetVoices (catalog readiness + voice sample).',
    surface: 'client.runtime.ai.listPresetVoices',
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
