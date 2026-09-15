import { asRecord, assertExactProjectionKeys, localAppProjectionError } from './local-app-runtime-platform-validation.js';

const utf8Length = (value: string) => new TextEncoder().encode(value).length;

export type NimiLocalAppSpeechTranscript = {
  readonly status: 'transcribed' | 'no-speech';
  readonly text: string;
  readonly language: string;
  readonly words: readonly { readonly text: string; readonly startSeconds: number; readonly endSeconds: number }[];
};

// @nimi-authority: rule.nimi.runtime.ai-provider.speech-transcription-result
export function validateNimiLocalAppSpeechTranscript(value: unknown): NimiLocalAppSpeechTranscript {
  const record = asRecord(value);
  assertExactProjectionKeys(record, ['status', 'text', 'language', 'words'], 'speech transcription');
  if (!['transcribed', 'no-speech'].includes(String(record.status)) || typeof record.text !== 'string' || record.text !== record.text.trim()
    || typeof record.language !== 'string' || record.language !== record.language.trim() || utf8Length(record.language) > 64
    || !Array.isArray(record.words) || record.words.length > 16384) localAppProjectionError('speech transcription');
  if (record.status === 'no-speech' ? record.text !== '' || record.language !== '' || record.words.length !== 0 : !record.text) localAppProjectionError('speech transcription status');
  let previousStart = 0;
  const words = record.words.map((value: unknown) => {
    const word = asRecord(value);
    assertExactProjectionKeys(word, ['text', 'startSeconds', 'endSeconds'], 'transcription word');
    if (typeof word.text !== 'string' || !word.text.trim() || typeof word.startSeconds !== 'number' || typeof word.endSeconds !== 'number'
      || !Number.isFinite(word.startSeconds) || !Number.isFinite(word.endSeconds) || word.startSeconds < previousStart || word.endSeconds < word.startSeconds) localAppProjectionError('transcription word timing');
    previousStart = word.startSeconds;
    return Object.freeze({ text: word.text, startSeconds: word.startSeconds, endSeconds: word.endSeconds });
  });
  const result = { status: record.status as NimiLocalAppSpeechTranscript['status'], text: record.text, language: record.language, words: Object.freeze(words) };
  if (utf8Length(JSON.stringify(result)) > 1 << 20) localAppProjectionError('speech transcription size');
  return Object.freeze(result);
}
