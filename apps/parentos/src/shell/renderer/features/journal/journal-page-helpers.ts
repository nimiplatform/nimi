export type CaptureMode = 'text' | 'voice';
export type VoiceDraftStatus =
  | 'idle'
  | 'recording'
  | 'ready'
  | 'transcribing'
  | 'transcribed'
  | 'transcription-failed';
export type TagSuggestionStatus = 'idle' | 'suggesting' | 'ready' | 'failed';

export interface VoiceDraft {
  status: VoiceDraftStatus;
  blob: Blob | null;
  mimeType: string | null;
  previewUrl: string | null;
  transcript: string;
  error: string | null;
}

export const EMPTY_VOICE_DRAFT: VoiceDraft = {
  status: 'idle',
  blob: null,
  mimeType: null,
  previewUrl: null,
  transcript: '',
  error: null,
};

export function describeVoiceStatus(status: VoiceDraftStatus) {
  switch (status) {
    case 'recording':
      return 'Recording';
    case 'ready':
      return 'Ready to transcribe';
    case 'transcribing':
      return 'Transcribing';
    case 'transcribed':
      return 'Ready to save';
    case 'transcription-failed':
      return 'Transcription failed, voice-only save is still available';
    default:
      return 'No voice draft yet';
  }
}

export function blobToBase64(blob: Blob) {
  return blob.arrayBuffer().then((buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    }
    return btoa(binary);
  });
}

export function parseSelectedTags(selectedTags: string | null) {
  if (!selectedTags) return [];
  try {
    const parsed = JSON.parse(selectedTags) as unknown;
    return Array.isArray(parsed) ? parsed.map((tag) => String(tag)) : [];
  } catch {
    return [];
  }
}
