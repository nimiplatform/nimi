import { afterEach, describe, expect, it, vi } from 'vitest';
import { createBrowserAppConversationHostPort } from '../src/headless/browser-app-conversation-host-port.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('browser App Conversation Host port', () => {
  it('does not invoke picker or microphone APIs until their explicit user actions', async () => {
    const getUserMedia = vi.fn();
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    const click = vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function pickerCancel(this: HTMLInputElement) {
      this.dispatchEvent(new Event('cancel'));
    });
    const port = createBrowserAppConversationHostPort();
    expect(click).not.toHaveBeenCalled();
    expect(getUserMedia).not.toHaveBeenCalled();

    await expect(port.attachments.pickImage()).resolves.toEqual({
      status: 'unavailable',
      reasonCode: 'IMAGE_PICKER_CANCELLED',
      message: 'Image selection was cancelled.',
    });
    expect(click).toHaveBeenCalledTimes(1);
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('returns exact selected image bytes without invoking microphone mechanics', async () => {
    const getUserMedia = vi.fn();
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    vi.spyOn(HTMLInputElement.prototype, 'click').mockImplementation(function pickerSelection(this: HTMLInputElement) {
      Object.defineProperty(this, 'files', {
        configurable: true,
        value: [{
          type: 'image/png',
          size: 3,
          name: 'picked.png',
          arrayBuffer: async () => Uint8Array.from([1, 2, 3]).buffer,
        }],
      });
      this.dispatchEvent(new Event('change'));
    });
    const port = createBrowserAppConversationHostPort();
    const result = await port.attachments.pickImage();
    expect(result).toMatchObject({
      status: 'selected',
      mimeType: 'image/png',
      displayName: 'picked.png',
    });
    expect(result.status === 'selected' ? Array.from(result.bytes) : []).toEqual([1, 2, 3]);
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('materializes and releases Blob preview URLs and audio playback URLs', async () => {
    const createObjectURL = vi.fn()
      .mockReturnValueOnce('blob:preview-url')
      .mockReturnValueOnce('blob:audio-url');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });
    const play = vi.fn(async () => {});
    const pause = vi.fn();
    class FakeAudio {
      src: string;
      onended: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(src: string) { this.src = src; }
      play = play;
      pause = pause;
    }
    vi.stubGlobal('Audio', FakeAudio);

    const port = createBrowserAppConversationHostPort();
    const preview = await port.preview.materialize({
      mimeType: 'image/png',
      bytes: Uint8Array.from([1, 2]),
    });
    expect(preview).toEqual({
      status: 'ready',
      previewHandle: 'browser-preview-1',
      mediaUrl: 'blob:preview-url',
    });
    if (preview.status === 'ready') {
      await port.preview.release({ previewHandle: preview.previewHandle });
    }
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:preview-url');

    await expect(port.playback.play({
      conversationAnchorId: 'anchor-1',
      messageId: 'message-1',
      mimeType: 'audio/ogg',
      bytes: Uint8Array.from([3, 4]),
    })).resolves.toEqual({ status: 'playing' });
    expect(play).toHaveBeenCalledTimes(1);
    await port.playback.stop();
    expect(pause).toHaveBeenCalledTimes(1);
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:audio-url');
  });

  it('starts MediaRecorder only on the record action and stops on the next action', async () => {
    const stopTrack = vi.fn();
    const stream = { getTracks: () => [{ stop: stopTrack }] } as unknown as MediaStream;
    const getUserMedia = vi.fn(async () => stream);
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });

    class FakeMediaRecorder {
      state: RecordingState = 'inactive';
      mimeType = 'audio/webm';
      ondataavailable: ((event: BlobEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      onstop: ((event: Event) => void) | null = null;
      constructor(readonly stream: MediaStream) {}
      start() { this.state = 'recording'; }
      stop() {
        this.state = 'inactive';
        this.ondataavailable?.({
          data: new Blob([Uint8Array.from([8, 9])], { type: 'audio/webm' }),
        } as BlobEvent);
        this.onstop?.(new Event('stop'));
      }
    }
    vi.stubGlobal('MediaRecorder', FakeMediaRecorder);

    const port = createBrowserAppConversationHostPort();
    expect(getUserMedia).not.toHaveBeenCalled();
    await expect(port.voiceInput.record()).resolves.toEqual({ status: 'recording' });
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    const recorded = await port.voiceInput.record();
    expect(recorded).toMatchObject({ status: 'recorded', mimeType: 'audio/webm' });
    expect(recorded.status === 'recorded' ? Array.from(recorded.bytes) : []).toEqual([8, 9]);
    expect(stopTrack).toHaveBeenCalledTimes(1);
  });

  it('returns typed unavailability for missing APIs and denied microphone permission', async () => {
    vi.stubGlobal('MediaRecorder', undefined);
    vi.stubGlobal('navigator', { mediaDevices: undefined });
    const missing = createBrowserAppConversationHostPort();
    await expect(missing.voiceInput.record()).resolves.toMatchObject({
      status: 'unavailable',
      reasonCode: 'MEDIA_RECORDER_UNAVAILABLE',
    });

    const denied = new Error('denied');
    denied.name = 'NotAllowedError';
    vi.stubGlobal('MediaRecorder', class {});
    vi.stubGlobal('navigator', {
      mediaDevices: { getUserMedia: vi.fn(async () => { throw denied; }) },
    });
    const permission = createBrowserAppConversationHostPort();
    await expect(permission.voiceInput.record()).resolves.toEqual({
      status: 'unavailable',
      reasonCode: 'MICROPHONE_PERMISSION_DENIED',
      message: 'Microphone permission was not granted.',
    });
  });
});
