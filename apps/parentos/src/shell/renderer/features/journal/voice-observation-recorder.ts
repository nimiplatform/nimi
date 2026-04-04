export interface VoiceRecordingResult {
  blob: Blob;
  mimeType: string;
  previewUrl: string;
}

export interface VoiceRecordingSession {
  stop: () => Promise<VoiceRecordingResult>;
  cancel: () => void;
}

const PREFERRED_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/ogg;codecs=opus',
  'audio/mp4',
] as const;

function pickRecordingMimeType() {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') {
    return '';
  }
  return PREFERRED_MIME_TYPES.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ?? '';
}

export function supportsVoiceRecording() {
  return typeof window !== 'undefined'
    && typeof navigator !== 'undefined'
    && typeof navigator.mediaDevices?.getUserMedia === 'function'
    && typeof MediaRecorder !== 'undefined';
}

export async function startVoiceRecording(): Promise<VoiceRecordingSession> {
  if (!supportsVoiceRecording()) {
    throw new Error('voice recording is unavailable in this environment');
  }

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mimeType = pickRecordingMimeType();
  const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
  const chunks: BlobPart[] = [];
  let settled = false;

  recorder.addEventListener('dataavailable', (event) => {
    if (event.data && event.data.size > 0) {
      chunks.push(event.data);
    }
  });

  recorder.start();

  const stopTracks = () => {
    stream.getTracks().forEach((track) => track.stop());
  };

  return {
    stop: () => new Promise<VoiceRecordingResult>((resolve, reject) => {
      recorder.addEventListener('stop', () => {
        if (settled) {
          return;
        }
        settled = true;
        stopTracks();
        const finalMimeType = recorder.mimeType || mimeType || 'audio/webm';
        const blob = new Blob(chunks, { type: finalMimeType });
        if (blob.size === 0) {
          reject(new Error('voice recording completed without audio data'));
          return;
        }
        resolve({
          blob,
          mimeType: finalMimeType,
          previewUrl: URL.createObjectURL(blob),
        });
      }, { once: true });
      recorder.addEventListener('error', () => {
        if (!settled) {
          settled = true;
          stopTracks();
          reject(new Error('voice recording failed'));
        }
      }, { once: true });
      recorder.stop();
    }),
    cancel: () => {
      if (settled) {
        return;
      }
      settled = true;
      if (recorder.state !== 'inactive') {
        recorder.stop();
      }
      stopTracks();
    },
  };
}

export function revokeVoicePreviewUrl(url: string | null) {
  if (url) {
    URL.revokeObjectURL(url);
  }
}
