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
  capabilityContract?: string;
  missingSurface?: string;
};

export const testerCapabilities: TesterCapability[] = [
  {
    id: 'text.generate',
    label: 'Text Studio',
    group: 'text',
    summary: 'Prompt → text.generate CapabilityContract → typed Runtime result.',
    surface: 'sdk.localApp.ai.text.generateCandidate → RuntimeAiService.GenerateLocalAppTextCandidate',
    execution: 'runtime-sdk',
    capabilityContract: 'text.generate',
  },
  {
    id: 'chat.stream',
    label: 'Chat Stream',
    group: 'text',
    summary: 'Conversation turn → text.generate stream semantics (currently unavailable in this carrier).',
    surface: 'CapabilityContract:text.generate → typed unavailable',
    execution: 'runtime-sdk',
    capabilityContract: 'text.generate',
  },
  {
    id: 'text.embed',
    label: 'Embeddings',
    group: 'text',
    summary: 'Input string → text.embed CapabilityContract (currently unavailable in this carrier).',
    surface: 'CapabilityContract:text.embed → typed unavailable',
    execution: 'runtime-sdk',
    capabilityContract: 'text.embed',
  },
  {
    id: 'image.generate',
    label: 'Image Generate',
    group: 'media',
    summary: 'Prompt → image.generate CapabilityContract (currently unavailable in this carrier).',
    surface: 'CapabilityContract:image.generate → typed unavailable',
    execution: 'runtime-sdk',
    capabilityContract: 'image.generate',
  },
  {
    id: 'video.generate',
    label: 'Video Generate',
    group: 'media',
    summary: 'Prompt → video.generate CapabilityContract (currently unavailable in this carrier).',
    surface: 'CapabilityContract:video.generate → typed unavailable',
    execution: 'runtime-sdk',
    capabilityContract: 'video.generate',
  },
  {
    id: 'audio.synthesize',
    label: 'Speech Synthesis',
    group: 'audio',
    summary: 'Text → audio.synthesize CapabilityContract (currently unavailable in this carrier).',
    surface: 'CapabilityContract:audio.synthesize → typed unavailable',
    execution: 'runtime-sdk',
    capabilityContract: 'audio.synthesize',
  },
  {
    id: 'audio.transcribe',
    label: 'Speech Transcribe',
    group: 'audio',
    summary: 'Audio URL → audio.transcribe CapabilityContract (currently unavailable in this carrier).',
    surface: 'CapabilityContract:audio.transcribe → typed unavailable',
    execution: 'runtime-sdk',
    capabilityContract: 'audio.transcribe',
  },
  {
    id: 'speech.bundle',
    label: 'Speech Bundle',
    group: 'audio',
    summary: 'Inspect the audio.synthesize voice catalog surface (currently unavailable in this carrier).',
    surface: 'CapabilityContract:audio.synthesize voice catalog → typed unavailable',
    execution: 'runtime-sdk',
    capabilityContract: 'audio.synthesize',
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

export function getTesterCapabilityContract(id: TesterCapabilityId): string | null {
  return getTesterCapability(id).capabilityContract ?? null;
}
