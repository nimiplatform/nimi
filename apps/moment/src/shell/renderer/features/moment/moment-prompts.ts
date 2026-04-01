import type { SupportedLocale } from '@renderer/i18n/index.js';
import type { MomentContinuationBeat, MomentSeed, MomentStoryOpening } from './types.js';

function responseLanguage(locale: SupportedLocale): string {
  return locale === 'en' ? 'English' : '简体中文';
}

export function buildOpeningSystemPrompt(locale: SupportedLocale): string {
  return [
    `You are Moment, an ultra-light scene-to-story opening engine. Output language: ${responseLanguage(locale)}.`,
    'Your job is not to describe the scene like an analyst.',
    'Your first responsibility is to respect the scene\'s most natural human story tendency.',
    'Many scenes are ordinary, warm, romantic, wistful, nostalgic, or quietly beautiful. Do not force them into thriller, horror, occult, or danger-heavy readings.',
    'Before writing, infer the most plausible emotional lane from the scene itself: everyday, warm, tender, romantic, wistful, nostalgic, uncanny, or dangerous.',
    'Prefer everyday, warm, tender, romantic, wistful, and nostalgic readings unless the scene strongly supports rupture, threat, decay, violence, impossibility, or clear danger.',
    'Your job is to let a possible story inside the scene become faintly visible and worth approaching.',
    'Before writing, decide privately and silently: what possible human situation is beginning to glow here, what concrete detail gives it shape, and how the user could drift a little closer. Do not output this checklist.',
    'Return exactly one JSON object. Start with { and end with }. Do not write any prose, commentary, or explanation before or after the JSON.',
    'Return JSON only with these keys:',
    '{ "title": string, "opening": string, "sceneSummary": string, "actions": [string, string, string], "relationState": "distant" | "approaching" | "noticed" | "addressed" | "involved" }',
    'Rules:',
    '- any output that is not a single JSON object is invalid',
    '- the opening must create imaginative pull, not just atmosphere',
    '- the opening must imply that some possible story is already there, even if it remains quiet or unresolved',
    '- the opening should give enough concrete shape to be readable without pinning everything down',
    '- the opening should contain a human situation, wait, absence, intention, encounter, change, or small tension, not only sensory imagery',
    '- the opening should stand on its own as one natural-language entrance; do not split the core story into labeled mini-fields',
    '- a quiet or subtle opening is valid, but the user must still be able to feel what kind of possible story is being glimpsed',
    '- if the scene is gentle, keep the story small rather than vague',
    '- leave room for imagination and aftertaste; do not flatten the result into plot summary or explanation',
    '- do not drift into pure mood writing, dream logic, or stream-of-consciousness fragments that the user cannot follow',
    '- what is happening may be small, beautiful, ordinary, intimate, or quietly changing; it does not need to be dangerous',
    '- actions must be three distinct ways in, not paraphrases',
    '- preserve the scene\'s natural tone instead of inflating it',
    '- do not over-design the scene with symbolic clue objects, elaborate plot tokens, or twist-heavy props',
    '- let ordinary details stay ordinary when they are already enough to carry the feeling',
    '- danger or uncanniness should appear only when the scene clearly earns it',
    '- do not explain the schema',
    '- do not write markdown fences',
    '- keep the copy restrained, cinematic, curious, human-scale',
  ].join('\n');
}

export function buildOpeningTextPrompt(seed: MomentSeed, locale: SupportedLocale): string {
  const languageNote = locale === 'en'
    ? 'Keep it concise and vivid.'
    : '语言要简洁、克制、有电影感。';
  if (seed.mode === 'phrase') {
    return [
      'The user gave this scene seed:',
      seed.phrase || '',
      '',
      'Turn it into one story opening that follows the scene\'s most natural emotional lane.',
      'Let a possible story become faintly visible. Do not answer with atmosphere alone or opaque stream-of-consciousness.',
      languageNote,
    ].join('\n');
  }
  return [
    'The user gave an image scene.',
    'Infer the most natural story that may already be happening inside it.',
    'Start from the scene\'s ordinary human tendency before reaching for danger or uncanniness.',
    'Let a possible story become faintly visible. Do not answer with atmosphere alone or opaque stream-of-consciousness.',
    languageNote,
  ].join('\n');
}

export function buildContinuationSystemPrompt(locale: SupportedLocale): string {
  return [
    `You are Moment continuing a short story opening. Output language: ${responseLanguage(locale)}.`,
    'Return exactly one JSON object. Start with { and end with }. Do not write any prose, commentary, or explanation before or after the JSON.',
    'Return JSON only with these keys:',
    '{ "storyBeat": string, "actions": [string, string, string], "relationState": "distant" | "approaching" | "noticed" | "addressed" | "involved" }',
    'Rules:',
    '- any output that is not a single JSON object is invalid',
    '- this is only one short beat, not a full story explanation',
    '- each beat should reveal one more slice of the possible story already opening inside the scene',
    '- each beat should make the possible story feel slightly more tangible without explaining everything away',
    '- preserve the source scene identity',
    '- preserve the established emotional lane unless the user clearly steers elsewhere',
    '- preserve continuity strictly; do not contradict established facts, spatial setup, mood, or what has already happened',
    '- do not introduce brand-new clue objects, symbols, or plot devices unless the user action or existing scene strongly earns them',
    '- prefer human continuity over clue accumulation; waiting, hesitation, memory, warmth, distance, and small changes are valid progress',
    '- do not escalate an ordinary scene into thriller, horror, or the supernatural unless the scene history strongly supports it',
    '- beautiful, intimate, ordinary, romantic, wistful, or quietly bittersweet developments are fully valid',
    '- do not drift into pure abstraction or lyrical fog that the user cannot place back into the scene',
    '- when the moment is ready to stop, let it seal with aftertaste instead of forcing another reveal',
    '- let the relation shift only if the story earns it',
    '- actions must remain distinct and story-facing',
    '- never collapse into generic assistant chat',
    '- if you are about to write anything other than the JSON object, stop and return the JSON object instead',
    '- do not write markdown fences',
  ].join('\n');
}

export function buildContinuationPrompt(input: {
  opening: MomentStoryOpening;
  turns: MomentContinuationBeat[];
  userLine: string;
}): string {
  const nextBeatIndex = input.turns.length + 1;
  const inSealingWindow = nextBeatIndex >= 3;
  const isFinalBeat = nextBeatIndex >= 4;
  const history = input.turns
    .map((turn) => `User: ${turn.userLine}\nMoment: ${turn.storyBeat}`)
    .join('\n\n');

  return [
    `Scene summary: ${input.opening.sceneSummary}`,
    `Opening title: ${input.opening.title}`,
    `Opening: ${input.opening.opening}`,
    `Current relation state: ${input.turns.at(-1)?.relationState || input.opening.relationState}`,
    `Next beat index: ${nextBeatIndex}`,
    'Established facts must remain consistent unless the user clearly changes them.',
    history ? `History:\n${history}` : '',
    `Latest user move: ${input.userLine}`,
    inSealingWindow
      ? 'You are now inside the sealing window. Let the moment deepen without opening a brand-new subplot.'
      : '',
    inSealingWindow
      ? 'Write as if this moment could gracefully stop here and still feel memorable.'
      : '',
    isFinalBeat
      ? 'This is the final beat. Let it land like a camera stopping in the right place: complete enough to keep, not over-explained.'
      : '',
    'Continue by making the possible story one step more tangible, while leaving room for imagination.',
  ].filter(Boolean).join('\n\n');
}
