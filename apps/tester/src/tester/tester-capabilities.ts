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
  missingSurface?: string;
};

export const testerCapabilities: TesterCapability[] = [
  {
    id: 'text.generate',
    label: 'Text Generate',
    group: 'text',
    summary: 'Prompt → runtime.ai.text.generate (single-shot completion).',
    surface: 'client.runtime.ai.text.generate',
    execution: 'runtime-sdk',
  },
  {
    id: 'chat.stream',
    label: 'Chat Stream',
    group: 'text',
    summary: 'Conversation turn → runtime.ai.text.stream (streamed deltas).',
    surface: 'client.runtime.ai.text.stream',
    execution: 'runtime-sdk',
  },
  {
    id: 'text.embed',
    label: 'Embeddings',
    group: 'text',
    summary: 'Input string → runtime.ai.embedding.generate (vector shape probe).',
    surface: 'client.runtime.ai.embedding.generate',
    execution: 'runtime-sdk',
  },
  {
    id: 'image.generate',
    label: 'Image Generate',
    group: 'media',
    summary: 'Prompt → runtime.media.image.generate (scenario job + artifacts).',
    surface: 'client.runtime.media.image.generate',
    execution: 'runtime-sdk',
  },
  {
    id: 'video.generate',
    label: 'Video Generate',
    group: 'media',
    summary: 'Prompt → runtime.media.video.generate (t2v mode, scenario job + artifacts).',
    surface: 'client.runtime.media.video.generate',
    execution: 'runtime-sdk',
  },
  {
    id: 'audio.synthesize',
    label: 'Speech Synthesis',
    group: 'audio',
    summary: 'Text → runtime.media.tts.synthesize (TTS scenario job + audio artifacts).',
    surface: 'client.runtime.media.tts.synthesize',
    execution: 'runtime-sdk',
  },
  {
    id: 'audio.transcribe',
    label: 'Speech Transcribe',
    group: 'audio',
    summary: 'Audio URL → runtime.media.stt.transcribe (transcript text + artifacts).',
    surface: 'client.runtime.media.stt.transcribe',
    execution: 'runtime-sdk',
  },
  {
    id: 'speech.bundle',
    label: 'Speech Bundle',
    group: 'audio',
    summary: 'Probe → runtime.media.tts.listVoices (catalog readiness + voice sample).',
    surface: 'client.runtime.media.tts.listVoices',
    execution: 'runtime-sdk',
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
