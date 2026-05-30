import type { TesterCapabilityId } from '../tester-capabilities.js';

// App-owned presentation config for the capability studio. It drives only the
// product copy, control set, and result framing per capability — it never owns
// runtime/admission truth, which still flows through the SDK invokers.

export type StudioControlId = 'tone' | 'length';
export type StudioInputKind = 'prompt' | 'url' | 'none';
export type StudioResultKind = 'text' | 'transcript' | 'embedding' | 'artifacts' | 'voice-catalog';

export type CapabilityStudioProfile = {
  /** Short header chip label rendered as "Capability: <tag>". */
  studioTag: string;
  /** Left card heading. */
  inputTitle: string;
  inputPlaceholder: string;
  inputKind: StudioInputKind;
  /** Note shown in place of the textarea when inputKind === 'none'. */
  inputNote?: string;
  supportsAttachments: boolean;
  controls: StudioControlId[];
  primaryLabel: string;
  primaryRunningLabel: string;
  resultTitle: string;
  emptyTitle: string;
  emptyHint: string;
  resultKind: StudioResultKind;
  footnote: string;
};

export type StudioDirectiveOption = {
  value: string;
  label: string;
  /** Natural-language fragment composed into the real runtime prompt. */
  directive: string;
};

// Tone + length are the only runtime-shaping controls. text.generate has no
// dedicated SDK tone/length fields, so the studio composes the selection into a
// single instruction line that is prepended to the prompt and sent verbatim to
// the runtime — real input shaping, not a fabricated knob.
export const TONE_OPTIONS: StudioDirectiveOption[] = [
  { value: 'clear', label: 'Clear', directive: 'a clear, plain tone' },
  { value: 'warm', label: 'Warm', directive: 'a warm, friendly tone' },
  { value: 'formal', label: 'Formal', directive: 'a formal, professional tone' },
  { value: 'short', label: 'Short', directive: 'a concise, direct tone' },
];

export const LENGTH_OPTIONS: StudioDirectiveOption[] = [
  { value: 'short', label: 'Short', directive: 'short' },
  { value: 'medium', label: 'Medium', directive: 'medium length' },
  { value: 'detailed', label: 'Detailed', directive: 'detailed and thorough' },
];

export const DEFAULT_TONE_VALUE = 'clear';
export const DEFAULT_LENGTH_VALUE = 'medium';

export function composeStudioDirective(toneValue: string, lengthValue: string): string {
  const tone = TONE_OPTIONS.find((item) => item.value === toneValue) ?? TONE_OPTIONS[0];
  const length = LENGTH_OPTIONS.find((item) => item.value === lengthValue) ?? LENGTH_OPTIONS[1];
  return `Write the response in ${tone.directive} and keep it ${length.directive}.`;
}

export function countStudioWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).filter(Boolean).length;
}

const STUDIO_PROFILES: Record<TesterCapabilityId, CapabilityStudioProfile> = {
  'text.generate': {
    studioTag: 'Text',
    inputTitle: 'What should Nimi write?',
    inputPlaceholder: 'Describe what you want Nimi to write…',
    inputKind: 'prompt',
    supportsAttachments: true,
    controls: ['tone', 'length'],
    primaryLabel: 'Generate text',
    primaryRunningLabel: 'Generating…',
    resultTitle: 'Generated result',
    emptyTitle: 'Waiting for generation',
    emptyHint: 'Your generated text will appear here.',
    resultKind: 'text',
    footnote: 'Your request will be sent to the runtime to generate content.',
  },
  'chat.stream': {
    studioTag: 'Chat',
    inputTitle: 'Start a conversation turn',
    inputPlaceholder: 'Type a message for Nimi to continue…',
    inputKind: 'prompt',
    supportsAttachments: true,
    controls: [],
    primaryLabel: 'Stream reply',
    primaryRunningLabel: 'Streaming…',
    resultTitle: 'Streamed reply',
    emptyTitle: 'Waiting for stream',
    emptyHint: 'Streamed tokens will appear here as they arrive from the runtime.',
    resultKind: 'text',
    footnote: 'Deltas stream live from the runtime; nothing is fabricated locally.',
  },
  'text.embed': {
    studioTag: 'Embeddings',
    inputTitle: 'Text to embed',
    inputPlaceholder: 'Enter the text to convert into an embedding vector…',
    inputKind: 'prompt',
    supportsAttachments: false,
    controls: [],
    primaryLabel: 'Generate embedding',
    primaryRunningLabel: 'Embedding…',
    resultTitle: 'Vector summary',
    emptyTitle: 'Waiting for embedding',
    emptyHint: 'The vector shape and a sample slice will appear here.',
    resultKind: 'embedding',
    footnote: 'The runtime returns the vector shape; the app surfaces a sample slice only.',
  },
  'image.generate': {
    studioTag: 'Image',
    inputTitle: 'Describe the image',
    inputPlaceholder: 'Describe the image you want the runtime to render…',
    inputKind: 'prompt',
    supportsAttachments: false,
    controls: [],
    primaryLabel: 'Generate image',
    primaryRunningLabel: 'Generating…',
    resultTitle: 'Generated image',
    emptyTitle: 'Waiting for render',
    emptyHint: 'The generated image will appear here once the job returns.',
    resultKind: 'artifacts',
    footnote: 'The runtime queues a render job and returns typed artifacts.',
  },
  'video.generate': {
    studioTag: 'Video',
    inputTitle: 'Describe the clip',
    inputPlaceholder: 'Describe the short clip you want to generate…',
    inputKind: 'prompt',
    supportsAttachments: false,
    controls: [],
    primaryLabel: 'Generate video',
    primaryRunningLabel: 'Generating…',
    resultTitle: 'Generated clip',
    emptyTitle: 'Waiting for render',
    emptyHint: 'The generated clip will appear here once the job returns.',
    resultKind: 'artifacts',
    footnote: 'Text-to-video runs as a runtime job; typed artifacts are returned.',
  },
  'audio.synthesize': {
    studioTag: 'Speech',
    inputTitle: 'Text to speak',
    inputPlaceholder: 'Enter the text to synthesize into speech…',
    inputKind: 'prompt',
    supportsAttachments: false,
    controls: [],
    primaryLabel: 'Synthesize speech',
    primaryRunningLabel: 'Synthesizing…',
    resultTitle: 'Synthesized audio',
    emptyTitle: 'Waiting for audio',
    emptyHint: 'The synthesized audio will appear here once the job returns.',
    resultKind: 'artifacts',
    footnote: 'The runtime returns audio artifacts from the TTS job.',
  },
  'audio.transcribe': {
    studioTag: 'Transcribe',
    inputTitle: 'Audio URL',
    inputPlaceholder: 'https://… or file://… pointing at the audio asset',
    inputKind: 'url',
    supportsAttachments: false,
    controls: [],
    primaryLabel: 'Transcribe audio',
    primaryRunningLabel: 'Transcribing…',
    resultTitle: 'Transcript',
    emptyTitle: 'Waiting for transcript',
    emptyHint: 'The transcript text will appear here once the job returns.',
    resultKind: 'transcript',
    footnote: 'Provide an http(s):// or file:// URL; the runtime returns the transcript.',
  },
  'speech.bundle': {
    studioTag: 'Voices',
    inputTitle: 'Voice catalog',
    inputPlaceholder: '',
    inputKind: 'none',
    inputNote: 'No input required — this lists the runtime voice catalog.',
    supportsAttachments: false,
    controls: [],
    primaryLabel: 'List voices',
    primaryRunningLabel: 'Loading…',
    resultTitle: 'Voice catalog',
    emptyTitle: 'Waiting for catalog',
    emptyHint: 'Available runtime voices will appear here.',
    resultKind: 'voice-catalog',
    footnote: 'Probes runtime.media.tts.listVoices for catalog readiness.',
  },
  'world.generate': {
    studioTag: 'World',
    inputTitle: 'World viewer',
    inputPlaceholder: '',
    inputKind: 'none',
    inputNote: 'Opens a standalone Tauri window for the local world fixture.',
    supportsAttachments: false,
    controls: [],
    primaryLabel: 'Open viewer',
    primaryRunningLabel: 'Opening…',
    resultTitle: 'Viewer',
    emptyTitle: 'Viewer idle',
    emptyHint: 'Open the viewer to record a local fixture run. No runtime artifact is implied.',
    resultKind: 'text',
    footnote: 'Opens the standalone Tauri viewer for a local fixture; this is not a runtime artifact.',
  },
};

export function getCapabilityStudioProfile(id: TesterCapabilityId): CapabilityStudioProfile {
  return STUDIO_PROFILES[id];
}

const RUNTIME_METHODS: Record<TesterCapabilityId, string> = {
  'text.generate': 'runtime.ai.text.generate',
  'chat.stream': 'runtime.ai.text.stream',
  'text.embed': 'runtime.ai.embedding.generate',
  'image.generate': 'runtime.media.image.generate',
  'video.generate': 'runtime.media.video.generate',
  'audio.synthesize': 'runtime.media.tts.synthesize',
  'audio.transcribe': 'runtime.media.stt.transcribe',
  'speech.bundle': 'runtime.media.tts.listVoices',
  'world.generate': 'tauri.open_world_tour_window',
};

export function runtimeMethodFor(id: TesterCapabilityId): string {
  return RUNTIME_METHODS[id];
}
