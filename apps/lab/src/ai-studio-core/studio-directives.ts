export type StudioDirectiveOption = {
  readonly value: string;
  readonly label: string;
  readonly directive: string;
};

export const TONE_OPTIONS: readonly StudioDirectiveOption[] = Object.freeze([
  { value: 'clear', label: 'Clear', directive: 'a clear, plain tone' },
  { value: 'warm', label: 'Warm', directive: 'a warm, friendly tone' },
  { value: 'formal', label: 'Formal', directive: 'a formal, professional tone' },
  { value: 'short', label: 'Short', directive: 'a concise, direct tone' },
]);

export const LENGTH_OPTIONS: readonly StudioDirectiveOption[] = Object.freeze([
  { value: 'short', label: 'Short', directive: 'short' },
  { value: 'medium', label: 'Medium', directive: 'medium length' },
  { value: 'detailed', label: 'Detailed', directive: 'detailed and thorough' },
]);

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
