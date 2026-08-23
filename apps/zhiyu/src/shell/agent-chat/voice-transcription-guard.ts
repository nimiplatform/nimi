export async function runZhiyuVoiceTranscriptionAttempt(input: {
  readonly audioBytes: Uint8Array;
  readonly mimeType: string;
  readonly signal: AbortSignal;
  readonly isCurrent: () => boolean;
  readonly transcribe: (audioBytes: Uint8Array, mimeType: string, signal: AbortSignal) => Promise<string>;
  readonly submit: (text: string) => Promise<void> | void;
}): Promise<'submitted' | 'stale'> {
  if (input.signal.aborted || !input.isCurrent()) return 'stale';
  const text = await input.transcribe(input.audioBytes, input.mimeType, input.signal);
  if (input.signal.aborted || !input.isCurrent()) return 'stale';
  await input.submit(text);
  return 'submitted';
}
