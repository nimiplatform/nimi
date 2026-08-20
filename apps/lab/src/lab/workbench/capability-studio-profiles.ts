import type { LabCapabilityId } from '../lab-capabilities.js';

// App-owned presentation config for the capability studio. It drives only the
// product copy, control set, and result framing per capability — it never owns
// runtime/admission truth, which still flows through the SDK invokers.

export type StudioControlId = 'tone' | 'length';
export type StudioInputKind = 'prompt' | 'url' | 'none';
export type StudioResultKind = 'text' | 'transcript' | 'embedding' | 'artifacts' | 'voice-asset' | 'voice-catalog';

export type CapabilityStudioProfile = {
  /** Short header chip label rendered as "Capability: <tag>". */
  studioTag: string;
  /** Left card heading (locale key; resolved with t() at render). */
  inputTitleKey: string;
  inputPlaceholderKey: string;
  inputKind: StudioInputKind;
  /** Note shown in place of the textarea when inputKind === 'none' (locale key). */
  inputNoteKey?: string;
  supportsAttachments: boolean;
  controls: StudioControlId[];
  primaryLabelKey: string;
  primaryRunningLabelKey: string;
  resultTitle: string;
  emptyTitleKey: string;
  emptyHintKey: string;
  resultKind: StudioResultKind;
  footnoteKey: string;
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

const STUDIO_PROFILES: Record<LabCapabilityId, CapabilityStudioProfile> = {
  'text.generate': {
    studioTag: 'Text',
    inputTitleKey: 'Studio.profiles.textGenerate.inputTitle',
    inputPlaceholderKey: 'Studio.profiles.textGenerate.inputPlaceholder',
    inputKind: 'prompt',
    supportsAttachments: false,
    controls: ['tone', 'length'],
    primaryLabelKey: 'Studio.profiles.textGenerate.primaryLabel',
    primaryRunningLabelKey: 'Studio.profiles.textGenerate.primaryRunningLabel',
    resultTitle: 'Generated result',
    emptyTitleKey: 'Studio.profiles.textGenerate.emptyTitle',
    emptyHintKey: 'Studio.profiles.textGenerate.emptyHint',
    resultKind: 'text',
    footnoteKey: 'Studio.profiles.textGenerate.footnote',
  },
  'chat.stream': {
    studioTag: 'Chat',
    inputTitleKey: 'Studio.profiles.chatStream.inputTitle',
    inputPlaceholderKey: 'Studio.profiles.chatStream.inputPlaceholder',
    inputKind: 'prompt',
    supportsAttachments: false,
    controls: [],
    primaryLabelKey: 'Studio.profiles.chatStream.primaryLabel',
    primaryRunningLabelKey: 'Studio.profiles.chatStream.primaryRunningLabel',
    resultTitle: 'Streamed reply',
    emptyTitleKey: 'Studio.profiles.chatStream.emptyTitle',
    emptyHintKey: 'Studio.profiles.chatStream.emptyHint',
    resultKind: 'text',
    footnoteKey: 'Studio.profiles.chatStream.footnote',
  },
  'text.embed': {
    studioTag: 'Embeddings',
    inputTitleKey: 'Studio.profiles.textEmbed.inputTitle',
    inputPlaceholderKey: 'Studio.profiles.textEmbed.inputPlaceholder',
    inputKind: 'prompt',
    supportsAttachments: false,
    controls: [],
    primaryLabelKey: 'Studio.profiles.textEmbed.primaryLabel',
    primaryRunningLabelKey: 'Studio.profiles.textEmbed.primaryRunningLabel',
    resultTitle: 'Embedding result',
    emptyTitleKey: 'Studio.profiles.textEmbed.emptyTitle',
    emptyHintKey: 'Studio.profiles.textEmbed.emptyHint',
    resultKind: 'embedding',
    footnoteKey: 'Studio.profiles.textEmbed.footnote',
  },
  'image.generate': {
    studioTag: 'Image',
    inputTitleKey: 'Studio.profiles.imageGenerate.inputTitle',
    inputPlaceholderKey: 'Studio.profiles.imageGenerate.inputPlaceholder',
    inputKind: 'prompt',
    supportsAttachments: false,
    controls: [],
    primaryLabelKey: 'Studio.profiles.imageGenerate.primaryLabel',
    primaryRunningLabelKey: 'Studio.profiles.imageGenerate.primaryRunningLabel',
    resultTitle: 'Generated image',
    emptyTitleKey: 'Studio.profiles.imageGenerate.emptyTitle',
    emptyHintKey: 'Studio.profiles.imageGenerate.emptyHint',
    resultKind: 'artifacts',
    footnoteKey: 'Studio.profiles.imageGenerate.footnote',
  },
  'video.generate': {
    studioTag: 'Video',
    inputTitleKey: 'Studio.profiles.videoGenerate.inputTitle',
    inputPlaceholderKey: 'Studio.profiles.videoGenerate.inputPlaceholder',
    inputKind: 'prompt',
    supportsAttachments: false,
    controls: [],
    primaryLabelKey: 'Studio.profiles.videoGenerate.primaryLabel',
    primaryRunningLabelKey: 'Studio.profiles.videoGenerate.primaryRunningLabel',
    resultTitle: 'Generated clip',
    emptyTitleKey: 'Studio.profiles.videoGenerate.emptyTitle',
    emptyHintKey: 'Studio.profiles.videoGenerate.emptyHint',
    resultKind: 'artifacts',
    footnoteKey: 'Studio.profiles.videoGenerate.footnote',
  },
  'audio.synthesize': {
    studioTag: 'Speech',
    inputTitleKey: 'Studio.profiles.audioSynthesize.inputTitle',
    inputPlaceholderKey: 'Studio.profiles.audioSynthesize.inputPlaceholder',
    inputKind: 'prompt',
    supportsAttachments: false,
    controls: [],
    primaryLabelKey: 'Studio.profiles.audioSynthesize.primaryLabel',
    primaryRunningLabelKey: 'Studio.profiles.audioSynthesize.primaryRunningLabel',
    resultTitle: 'Synthesized audio',
    emptyTitleKey: 'Studio.profiles.audioSynthesize.emptyTitle',
    emptyHintKey: 'Studio.profiles.audioSynthesize.emptyHint',
    resultKind: 'artifacts',
    footnoteKey: 'Studio.profiles.audioSynthesize.footnote',
  },
  'audio.transcribe': {
    studioTag: 'Transcribe',
    inputTitleKey: 'Studio.profiles.audioTranscribe.inputTitle',
    inputPlaceholderKey: 'Studio.profiles.audioTranscribe.inputPlaceholder',
    inputKind: 'url',
    supportsAttachments: false,
    controls: [],
    primaryLabelKey: 'Studio.profiles.audioTranscribe.primaryLabel',
    primaryRunningLabelKey: 'Studio.profiles.audioTranscribe.primaryRunningLabel',
    resultTitle: 'Transcript',
    emptyTitleKey: 'Studio.profiles.audioTranscribe.emptyTitle',
    emptyHintKey: 'Studio.profiles.audioTranscribe.emptyHint',
    resultKind: 'transcript',
    footnoteKey: 'Studio.profiles.audioTranscribe.footnote',
  },
  'voice.create': {
    studioTag: 'Voice',
    inputTitleKey: 'Studio.profiles.voiceCreate.inputTitle',
    inputPlaceholderKey: 'Studio.profiles.voiceCreate.inputPlaceholder',
    inputKind: 'prompt',
    supportsAttachments: false,
    controls: [],
    primaryLabelKey: 'Studio.profiles.voiceCreate.primaryLabel',
    primaryRunningLabelKey: 'Studio.profiles.voiceCreate.primaryRunningLabel',
    resultTitle: 'Created voice',
    emptyTitleKey: 'Studio.profiles.voiceCreate.emptyTitle',
    emptyHintKey: 'Studio.profiles.voiceCreate.emptyHint',
    resultKind: 'voice-asset',
    footnoteKey: 'Studio.profiles.voiceCreate.footnote',
  },
  'speech.bundle': {
    studioTag: 'Voices',
    inputTitleKey: 'Studio.profiles.speechBundle.inputTitle',
    inputPlaceholderKey: 'Studio.profiles.speechBundle.inputPlaceholder',
    inputKind: 'none',
    inputNoteKey: 'Studio.profiles.speechBundle.inputNote',
    supportsAttachments: false,
    controls: [],
    primaryLabelKey: 'Studio.profiles.speechBundle.primaryLabel',
    primaryRunningLabelKey: 'Studio.profiles.speechBundle.primaryRunningLabel',
    resultTitle: 'Voice catalog',
    emptyTitleKey: 'Studio.profiles.speechBundle.emptyTitle',
    emptyHintKey: 'Studio.profiles.speechBundle.emptyHint',
    resultKind: 'voice-catalog',
    footnoteKey: 'Studio.profiles.speechBundle.footnote',
  },
  'world.generate': {
    studioTag: 'World',
    inputTitleKey: 'Studio.profiles.worldGenerate.inputTitle',
    inputPlaceholderKey: 'Studio.profiles.worldGenerate.inputPlaceholder',
    inputKind: 'none',
    inputNoteKey: 'Studio.profiles.worldGenerate.inputNote',
    supportsAttachments: false,
    controls: [],
    primaryLabelKey: 'Studio.profiles.worldGenerate.primaryLabel',
    primaryRunningLabelKey: 'Studio.profiles.worldGenerate.primaryRunningLabel',
    resultTitle: 'Viewer',
    emptyTitleKey: 'Studio.profiles.worldGenerate.emptyTitle',
    emptyHintKey: 'Studio.profiles.worldGenerate.emptyHint',
    resultKind: 'text',
    footnoteKey: 'Studio.profiles.worldGenerate.footnote',
  },
};

export function getCapabilityStudioProfile(id: LabCapabilityId): CapabilityStudioProfile {
  return STUDIO_PROFILES[id];
}

const RUNTIME_METHODS: Record<LabCapabilityId, string> = {
  'text.generate': 'sdk.localApp.ai.text.generateCandidate',
  'chat.stream': 'runtime.ai.streamScenario:text_generate',
  'text.embed': 'runtime.ai.executeScenario:text_embed',
  'image.generate': 'runtime.ai.submitScenarioJob:image_generate',
  'video.generate': 'kit.generation.runRuntimeVideoGenerate',
  'audio.synthesize': 'runtime.ai.submitScenarioJob:speech_synthesize',
  'audio.transcribe': 'kit.generation.runRuntimeSpeechTranscribe',
  'voice.create': 'sdk.localApp.ai.scenarioJobs.submit:voice-create',
  'speech.bundle': 'kit.generation.runRuntimeVoiceCatalog',
  'world.generate': 'tauri.open_world_tour_window',
};

export function runtimeMethodFor(id: LabCapabilityId): string {
  return RUNTIME_METHODS[id];
}
