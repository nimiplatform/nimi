import type {
  AppConversationHostImagePickResult,
  AppConversationHostPlaybackResult,
  AppConversationHostPort,
  AppConversationHostPreviewResult,
  AppConversationHostRecordingResult,
  AppConversationHostUnavailable,
} from './app-conversation-entry-session.js';

const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;

function unavailable(reasonCode: string, message: string): AppConversationHostUnavailable {
  return Object.freeze({ status: 'unavailable', reasonCode, message });
}

function copyBytes(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

function microphoneUnavailable(error: unknown): AppConversationHostUnavailable {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return unavailable('MICROPHONE_PERMISSION_DENIED', 'Microphone permission was not granted.');
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return unavailable('MICROPHONE_DEVICE_UNAVAILABLE', 'No microphone is available.');
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return unavailable('MICROPHONE_DEVICE_BUSY', 'The microphone could not be opened.');
  }
  return unavailable('MICROPHONE_UNAVAILABLE', 'Microphone recording is unavailable.');
}

type ActiveBrowserRecording = {
  readonly recorder: MediaRecorder;
  readonly stream: MediaStream;
  readonly chunks: Blob[];
  readonly completion: Promise<AppConversationHostRecordingResult>;
  readonly resolve: (result: AppConversationHostRecordingResult) => void;
  cancelled: boolean;
  completed: boolean;
};

// @nimi-authority: rule.nimi.platform.ui-design-system.p-kit-061
export function createBrowserAppConversationHostPort(): AppConversationHostPort {
  const previewUrls = new Map<string, string>();
  let previewSequence = 0;
  let playbackAudio: HTMLAudioElement | null = null;
  let playbackUrl: string | null = null;
  let activeRecording: ActiveBrowserRecording | null = null;
  let recordingGeneration = 0;
  let recordingStarting = false;

  const releaseObjectUrl = (url: string) => {
    if (typeof globalThis.URL?.revokeObjectURL === 'function') {
      globalThis.URL.revokeObjectURL(url);
    }
  };

  const stopPlayback = async () => {
    const audio = playbackAudio;
    const url = playbackUrl;
    playbackAudio = null;
    playbackUrl = null;
    if (audio) {
      try {
        audio.pause();
        audio.src = '';
      } catch {
        // Host cleanup failure does not alter canonical Conversation truth.
      }
    }
    if (url) releaseObjectUrl(url);
  };

  const finishRecording = (
    recording: ActiveBrowserRecording,
    result: AppConversationHostRecordingResult,
  ) => {
    if (recording.completed) return;
    recording.completed = true;
    for (const track of recording.stream.getTracks()) track.stop();
    if (activeRecording === recording) activeRecording = null;
    recording.resolve(result);
  };

  const cancelRecording = async () => {
    recordingGeneration += 1;
    const recording = activeRecording;
    if (!recording) return;
    recording.cancelled = true;
    if (recording.recorder.state !== 'inactive') {
      try {
        recording.recorder.stop();
      } catch {
        finishRecording(recording, unavailable('RECORDING_CANCELLED', 'Voice recording was cancelled.'));
      }
    } else {
      finishRecording(recording, unavailable('RECORDING_CANCELLED', 'Voice recording was cancelled.'));
    }
    await recording.completion;
  };

  const record = async (): Promise<AppConversationHostRecordingResult> => {
    if (activeRecording) {
      const recording = activeRecording;
      if (recording.recorder.state !== 'inactive') {
        try {
          recording.recorder.stop();
        } catch {
          finishRecording(
            recording,
            unavailable('MICROPHONE_UNAVAILABLE', 'Voice recording could not be stopped.'),
          );
        }
      }
      return recording.completion;
    }
    if (recordingStarting) {
      return unavailable('MICROPHONE_BUSY', 'Microphone recording is already starting.');
    }
    const mediaDevices = globalThis.navigator?.mediaDevices;
    const MediaRecorderConstructor = globalThis.MediaRecorder;
    if (!mediaDevices || typeof mediaDevices.getUserMedia !== 'function'
      || typeof MediaRecorderConstructor !== 'function' || typeof globalThis.Blob !== 'function') {
      return unavailable('MEDIA_RECORDER_UNAVAILABLE', 'Browser voice recording APIs are unavailable.');
    }
    recordingStarting = true;
    const generation = ++recordingGeneration;
    let stream: MediaStream;
    try {
      stream = await mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      recordingStarting = false;
      return microphoneUnavailable(error);
    }
    recordingStarting = false;
    if (generation !== recordingGeneration) {
      for (const track of stream.getTracks()) track.stop();
      return unavailable('RECORDING_CANCELLED', 'Voice recording was cancelled.');
    }

    let recorder: MediaRecorder;
    try {
      recorder = new MediaRecorderConstructor(stream);
    } catch (error) {
      for (const track of stream.getTracks()) track.stop();
      return microphoneUnavailable(error);
    }
    let resolveCompletion!: (result: AppConversationHostRecordingResult) => void;
    const completion = new Promise<AppConversationHostRecordingResult>((resolve) => {
      resolveCompletion = resolve;
    });
    const recording: ActiveBrowserRecording = {
      recorder,
      stream,
      chunks: [],
      completion,
      resolve: resolveCompletion,
      cancelled: false,
      completed: false,
    };
    activeRecording = recording;
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) recording.chunks.push(event.data);
    };
    recorder.onerror = () => {
      finishRecording(recording, unavailable('MICROPHONE_UNAVAILABLE', 'Voice recording failed.'));
    };
    recorder.onstop = () => {
      void (async () => {
        if (recording.cancelled) {
          finishRecording(recording, unavailable('RECORDING_CANCELLED', 'Voice recording was cancelled.'));
          return;
        }
        const mimeType = recorder.mimeType || recording.chunks.find((chunk) => chunk.type)?.type || '';
        if (!mimeType.startsWith('audio/') || recording.chunks.length === 0) {
          finishRecording(recording, unavailable('RECORDED_AUDIO_UNAVAILABLE', 'Recorded audio is unavailable.'));
          return;
        }
        try {
          const blob = new Blob(recording.chunks, { type: mimeType });
          const bytes = new Uint8Array(await blob.arrayBuffer());
          if (bytes.byteLength === 0) {
            finishRecording(recording, unavailable('RECORDED_AUDIO_UNAVAILABLE', 'Recorded audio is empty.'));
            return;
          }
          finishRecording(recording, Object.freeze({ status: 'recorded', mimeType, bytes }));
        } catch {
          finishRecording(recording, unavailable('RECORDED_AUDIO_UNAVAILABLE', 'Recorded audio could not be read.'));
        }
      })();
    };
    try {
      recorder.start();
    } catch (error) {
      finishRecording(recording, microphoneUnavailable(error));
      return completion;
    }
    return Object.freeze({ status: 'recording' as const });
  };

  return Object.freeze({
    playback: Object.freeze({
      play: async (
        input: Parameters<AppConversationHostPort['playback']['play']>[0],
      ): Promise<AppConversationHostPlaybackResult> => {
        await stopPlayback();
        if (typeof globalThis.Blob !== 'function'
          || typeof globalThis.URL?.createObjectURL !== 'function'
          || typeof globalThis.Audio !== 'function') {
          return unavailable('AUDIO_PLAYBACK_UNAVAILABLE', 'Browser audio playback APIs are unavailable.');
        }
        if (!input.mimeType.startsWith('audio/') || input.bytes.byteLength === 0) {
          return unavailable('AUDIO_PLAYBACK_UNAVAILABLE', 'Conversation audio is unavailable.');
        }
        let url: string;
        let audio: HTMLAudioElement;
        try {
          url = globalThis.URL.createObjectURL(new Blob([copyBytes(input.bytes)], { type: input.mimeType }));
          audio = new globalThis.Audio(url);
        } catch {
          return unavailable('AUDIO_PLAYBACK_UNAVAILABLE', 'Conversation audio could not be materialized.');
        }
        playbackUrl = url;
        playbackAudio = audio;
        audio.onended = () => { void stopPlayback(); };
        audio.onerror = () => { void stopPlayback(); };
        try {
          await audio.play();
          return Object.freeze({ status: 'playing' as const });
        } catch {
          await stopPlayback();
          return unavailable('AUDIO_PLAYBACK_UNAVAILABLE', 'Conversation audio playback was not allowed.');
        }
      },
      stop: stopPlayback,
    }),
    preview: Object.freeze({
      materialize: async (
        input: Parameters<AppConversationHostPort['preview']['materialize']>[0],
      ): Promise<AppConversationHostPreviewResult> => {
        if (typeof globalThis.Blob !== 'function' || typeof globalThis.URL?.createObjectURL !== 'function') {
          return unavailable('IMAGE_PREVIEW_UNAVAILABLE', 'Browser image preview APIs are unavailable.');
        }
        if (!IMAGE_MIME_TYPES.has(input.mimeType) || input.bytes.byteLength === 0) {
          return unavailable('IMAGE_PREVIEW_UNAVAILABLE', 'Conversation image preview is unavailable.');
        }
        try {
          const mediaUrl = globalThis.URL.createObjectURL(
            new Blob([copyBytes(input.bytes)], { type: input.mimeType }),
          );
          const previewHandle = `browser-preview-${++previewSequence}`;
          previewUrls.set(previewHandle, mediaUrl);
          return Object.freeze({ status: 'ready' as const, previewHandle, mediaUrl });
        } catch {
          return unavailable('IMAGE_PREVIEW_UNAVAILABLE', 'Conversation image preview could not be materialized.');
        }
      },
      release: async ({ previewHandle }: Parameters<AppConversationHostPort['preview']['release']>[0]) => {
        const mediaUrl = previewUrls.get(previewHandle);
        if (!mediaUrl) return;
        previewUrls.delete(previewHandle);
        releaseObjectUrl(mediaUrl);
      },
    }),
    attachments: Object.freeze({
      pickImage: async (): Promise<AppConversationHostImagePickResult> => {
        if (typeof globalThis.document?.createElement !== 'function') {
          return unavailable('IMAGE_PICKER_UNAVAILABLE', 'Browser image picker is unavailable.');
        }
        return new Promise<AppConversationHostImagePickResult>((resolve) => {
          const picker = globalThis.document.createElement('input');
          picker.type = 'file';
          picker.accept = 'image/png,image/jpeg,image/webp,image/gif';
          picker.multiple = false;
          let settled = false;
          const finish = (result: AppConversationHostImagePickResult) => {
            if (settled) return;
            settled = true;
            picker.removeEventListener('change', onChange);
            picker.removeEventListener('cancel', onCancel);
            resolve(result);
          };
          const onCancel = () => {
            finish(unavailable('IMAGE_PICKER_CANCELLED', 'Image selection was cancelled.'));
          };
          const onChange = () => {
            void (async () => {
              const file = picker.files?.[0];
              if (!file) {
                onCancel();
                return;
              }
              if (!IMAGE_MIME_TYPES.has(file.type) || file.size <= 0 || file.size > MAX_IMAGE_BYTES
                || typeof file.arrayBuffer !== 'function') {
                finish(unavailable('IMAGE_SELECTION_INVALID', 'The selected image is unavailable.'));
                return;
              }
              try {
                const bytes = new Uint8Array(await file.arrayBuffer());
                if (bytes.byteLength !== file.size) {
                  finish(unavailable('IMAGE_SELECTION_INVALID', 'The selected image could not be read.'));
                  return;
                }
                finish(Object.freeze({
                  status: 'selected' as const,
                  mimeType: file.type as 'image/png' | 'image/jpeg' | 'image/webp' | 'image/gif',
                  displayName: file.name,
                  bytes,
                }));
              } catch {
                finish(unavailable('IMAGE_SELECTION_INVALID', 'The selected image could not be read.'));
              }
            })();
          };
          picker.addEventListener('change', onChange);
          picker.addEventListener('cancel', onCancel);
          try {
            picker.click();
          } catch {
            finish(unavailable('IMAGE_PICKER_UNAVAILABLE', 'Browser image picker could not be opened.'));
          }
        });
      },
    }),
    voiceInput: Object.freeze({ record, cancel: cancelRecording }),
  });
}
