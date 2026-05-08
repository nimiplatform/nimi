export type JournalContentType = 'text' | 'voice' | 'photo' | 'mixed';

function hasValue(value: string | null | undefined) {
  return (value ?? '').trim().length > 0;
}

export function resolveJournalContentType(input: {
  textContent: string | null;
  voicePath: string | null;
  photoPaths: string | null;
}): JournalContentType {
  const channels = [
    hasValue(input.textContent),
    hasValue(input.voicePath),
    hasValue(input.photoPaths),
  ].filter(Boolean).length;

  if (channels >= 2) {
    return 'mixed';
  }
  if (hasValue(input.voicePath)) {
    return 'voice';
  }
  if (hasValue(input.photoPaths)) {
    return 'photo';
  }
  if (hasValue(input.textContent)) {
    return 'text';
  }
  throw new Error('journal entry requires text, voice, or photo content');
}
