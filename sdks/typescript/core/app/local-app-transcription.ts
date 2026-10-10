import { asRecord, assertExactProjectionKeys, localAppProjectionError } from './local-app-runtime-platform-validation.js';

const utf8Length = (value: string) => new TextEncoder().encode(value).length;

export type NimiLocalAppSpeechTranscript = {
  readonly status: 'transcribed' | 'no-speech';
  readonly text: string;
  readonly language: string;
  readonly words: readonly { readonly text: string; readonly startSeconds: number; readonly endSeconds: number }[];
  readonly diarization?: NimiLocalAppSpeechDiarization;
};

export type NimiLocalAppSpeechDiarization = {
  readonly status: 'diarized' | 'no-speakers';
  readonly durationSeconds: number;
  readonly intervals: readonly { readonly speakerId: string; readonly startSeconds: number; readonly endSeconds: number }[];
};

export function validateNimiLocalAppSpeechDiarization(value: unknown): NimiLocalAppSpeechDiarization {
  const result=asRecord(value);
  assertExactProjectionKeys(result,['status','durationSeconds','intervals'],'speech diarization');
  if (!['diarized','no-speakers'].includes(String(result.status))||typeof result.durationSeconds!=='number'||!Number.isFinite(result.durationSeconds)||result.durationSeconds<=0||!Array.isArray(result.intervals)||result.intervals.length>16384||(result.status==='diarized' ? result.intervals.length===0 : result.intervals.length!==0)) localAppProjectionError('speech diarization status or source');
  const durationSeconds=result.durationSeconds;
  let previous=0;
  const intervals=result.intervals.map((value: unknown)=>{
    const entry=asRecord(value);assertExactProjectionKeys(entry,['speakerId','startSeconds','endSeconds'],'speaker interval');
    if (typeof entry.speakerId!=='string'||!entry.speakerId||entry.speakerId.trim()!==entry.speakerId||utf8Length(entry.speakerId)>128||typeof entry.startSeconds!=='number'||typeof entry.endSeconds!=='number'||!Number.isFinite(entry.startSeconds)||!Number.isFinite(entry.endSeconds)||entry.startSeconds<previous||entry.endSeconds<=entry.startSeconds||entry.endSeconds>durationSeconds) localAppProjectionError('speaker interval source timing');
    previous=entry.startSeconds;
    return Object.freeze({speakerId:entry.speakerId,startSeconds:entry.startSeconds,endSeconds:entry.endSeconds});
  });
  return Object.freeze({status:result.status as NimiLocalAppSpeechDiarization['status'],durationSeconds:result.durationSeconds,intervals:Object.freeze(intervals)});
}

// @nimi-authority: rule.nimi.runtime.ai-provider.speech-transcription-result
export function validateNimiLocalAppSpeechTranscript(value: unknown): NimiLocalAppSpeechTranscript {
  const record = asRecord(value);
  assertExactProjectionKeys(record, ['status', 'text', 'language', 'words', ...(record?.diarization!==undefined ? ['diarization'] : [])], 'speech transcription');
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
  const diarization=record.diarization===undefined?undefined:validateNimiLocalAppSpeechDiarization(record.diarization);
  if (record.status==='no-speech'&&diarization?.status==='diarized') localAppProjectionError('no-speech speaker contradiction');
  const result = { status: record.status as NimiLocalAppSpeechTranscript['status'], text: record.text, language: record.language, words: Object.freeze(words),...(diarization?{diarization}:{}) };
  if (utf8Length(JSON.stringify(result)) > 1 << 20) localAppProjectionError('speech transcription size');
  return Object.freeze(result);
}
