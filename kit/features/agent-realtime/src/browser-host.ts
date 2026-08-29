import type {
  NimiAgentRealtimeCaptureHandle,
  NimiAgentRealtimeHostMediaPort,
  NimiRealtimeAudioFormat,
} from './types.js';

type NimiBrowserAgentRealtimeHostEnvironment = {
  readonly mediaDevices: Pick<MediaDevices, 'getUserMedia'> | null;
  readonly createAudioContext: ((options?: AudioContextOptions) => AudioContext) | null;
  readonly createOpaqueId: () => string;
};

type PlaybackTrack = {
  nextStartTime: number;
  readonly sources: Set<AudioBufferSourceNode>;
};

const MAX_CAPTURE_FRAME_QUEUE = 4;

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-scaf-017
export function createBrowserAgentRealtimeHostMediaPort(): NimiAgentRealtimeHostMediaPort {
  return createBrowserAgentRealtimeHostMediaPortWithEnvironment(browserEnvironment());
}

/**
 * Environment injection is intentionally not exported. It keeps the public
 * Host factory singular while allowing the fixed browser mechanics to be
 * exercised by the module's contract tests.
 */
export function createBrowserAgentRealtimeHostMediaPortWithEnvironment(
  environment: NimiBrowserAgentRealtimeHostEnvironment,
): NimiAgentRealtimeHostMediaPort {
  let playbackContext: AudioContext | null = null;
  const playbackTracks = new Map<string, PlaybackTrack>();

  const port: NimiAgentRealtimeHostMediaPort = {
    microphone: Object.freeze({
      async beginCapture(input) {
        if (!environment.mediaDevices || !environment.createAudioContext) {
          return Object.freeze({ status: 'device-unavailable' as const });
        }
        let targetSamplesPerChannel: number;
        try {
          targetSamplesPerChannel = exactFrameSamples(input.format);
        } catch {
          return Object.freeze({ status: 'device-unavailable' as const });
        }
        let stream: MediaStream;
        try {
          stream = await environment.mediaDevices.getUserMedia({
            audio: {
              channelCount: { ideal: input.format.channelCount },
              sampleRate: { ideal: input.format.sampleRateHz },
            },
            video: false,
          });
        } catch (cause) {
          return Object.freeze({
            status: isPermissionDenial(cause)
              ? 'permission-denied' as const
              : 'device-unavailable' as const,
          });
        }

        const tracks = stream.getAudioTracks();
        if (tracks.length === 0) {
          stopMediaStream(stream);
          return Object.freeze({ status: 'device-unavailable' as const });
        }

        let context: AudioContext;
        try {
          context = environment.createAudioContext({
            sampleRate: input.format.sampleRateHz,
            latencyHint: 'interactive',
          });
        } catch {
          stopMediaStream(stream);
          return Object.freeze({ status: 'device-unavailable' as const });
        }

        const processorBufferSize = scriptProcessorBufferSize(targetSamplesPerChannel);
        let source: MediaStreamAudioSourceNode;
        let processor: ScriptProcessorNode;
        let mute: GainNode;
        try {
          source = context.createMediaStreamSource(stream);
          processor = context.createScriptProcessor(
            processorBufferSize,
            input.format.channelCount,
            input.format.channelCount,
          );
          mute = context.createGain();
        } catch {
          stopMediaStream(stream);
          if (context.state !== 'closed') await context.close();
          return Object.freeze({ status: 'device-unavailable' as const });
        }
        mute.gain.value = 0;
        source.connect(processor);
        processor.connect(mute);
        mute.connect(context.destination);

        const inputTrackId = `capture_${environment.createOpaqueId()}`;
        const utteranceId = `utterance_${environment.createOpaqueId()}`;
        let stopped = false;
        let frameSequence = 0n;
        let draining = false;
        let sampleQueue: number[] = [];
        const frameQueue: Uint8Array[] = [];

        const stop = async (): Promise<void> => {
          if (stopped) return;
          stopped = true;
          processor.onaudioprocess = null;
          for (const track of tracks) track.removeEventListener('ended', handleTrackEnded);
          source.disconnect();
          processor.disconnect();
          mute.disconnect();
          stopMediaStream(stream);
          if (context.state !== 'closed') await context.close();
          sampleQueue = [];
          frameQueue.length = 0;
        };

        const endCapture = async (
          reason: 'device-lost' | 'capture-overrun',
        ): Promise<void> => {
          if (stopped) return;
          await stop();
          await input.onCaptureEnded(reason);
        };

        const drainFrames = async (): Promise<void> => {
          if (draining || stopped) return;
          draining = true;
          try {
            while (!stopped && frameQueue.length > 0) {
              const frame = frameQueue.shift();
              if (!frame) continue;
              frameSequence += 1n;
              await input.onFrame({
                frameSequence: frameSequence.toString(),
                frame,
              });
            }
          } catch {
            await stop();
          } finally {
            draining = false;
          }
        };

        const enqueueFrame = (frame: Uint8Array): void => {
          if (stopped) return;
          if (frameQueue.length >= MAX_CAPTURE_FRAME_QUEUE) {
            void endCapture('capture-overrun');
            return;
          }
          frameQueue.push(frame);
          void drainFrames();
        };

        function handleTrackEnded(): void {
          void endCapture('device-lost');
        }

        for (const track of tracks) track.addEventListener('ended', handleTrackEnded, { once: true });
        processor.onaudioprocess = (event) => {
          if (stopped) return;
          appendInterleavedSamples(
            sampleQueue,
            event.inputBuffer,
            input.format.channelCount,
          );
          const samplesPerFrame = targetSamplesPerChannel * input.format.channelCount;
          while (sampleQueue.length >= samplesPerFrame) {
            const samples = sampleQueue.slice(0, samplesPerFrame);
            sampleQueue = sampleQueue.slice(samplesPerFrame);
            enqueueFrame(pcm16Bytes(samples));
          }
          if (sampleQueue.length > samplesPerFrame * 2) {
            void endCapture('capture-overrun');
          }
        };

        if (context.state === 'suspended') {
          try {
            await context.resume();
          } catch {
            await stop();
            return Object.freeze({ status: 'device-unavailable' as const });
          }
        }

        const capture: NimiAgentRealtimeCaptureHandle = Object.freeze({
          inputTrackId,
          utteranceId,
          stop,
        });
        return Object.freeze({ status: 'ready' as const, capture });
      },
    }),
    playback: Object.freeze({
      async writeAudioFrame(input) {
        const context = playbackContext
          ?? environment.createAudioContext?.({ latencyHint: 'interactive' })
          ?? null;
        if (!context) throw new Error('AudioContext is unavailable.');
        playbackContext = context;
        if (context.state === 'suspended') await context.resume();
        const buffer = audioBufferFromPcm(context, input.frame, input.format);
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(context.destination);
        const track = playbackTracks.get(input.outputTrackId) ?? {
          nextStartTime: context.currentTime,
          sources: new Set<AudioBufferSourceNode>(),
        };
        playbackTracks.set(input.outputTrackId, track);
        const startAt = Math.max(context.currentTime, track.nextStartTime);
        track.nextStartTime = startAt + buffer.duration;
        track.sources.add(source);
        source.onended = () => track.sources.delete(source);
        source.start(startAt);
      },
      async finishOutputTrack(input) {
        const track = playbackTracks.get(input.outputTrackId);
        if (!track) return;
        if (input.lifecycle !== 'completed') stopPlaybackTrack(track);
        playbackTracks.delete(input.outputTrackId);
      },
      async interruptOutputTrack(input) {
        const track = playbackTracks.get(input.outputTrackId);
        if (!track) return;
        stopPlaybackTrack(track);
        playbackTracks.delete(input.outputTrackId);
      },
      async close() {
        for (const track of playbackTracks.values()) stopPlaybackTrack(track);
        playbackTracks.clear();
        const context = playbackContext;
        playbackContext = null;
        if (context && context.state !== 'closed') await context.close();
      },
    }),
  };
  return Object.freeze(port);
}

function browserEnvironment(): NimiBrowserAgentRealtimeHostEnvironment {
  const browserGlobal = globalThis as typeof globalThis & {
    readonly AudioContext?: typeof AudioContext;
    readonly webkitAudioContext?: typeof AudioContext;
  };
  const Context = browserGlobal.AudioContext ?? browserGlobal.webkitAudioContext;
  return {
    mediaDevices: typeof navigator === 'undefined' ? null : navigator.mediaDevices ?? null,
    createAudioContext: Context ? (options) => new Context(options) : null,
    createOpaqueId: () => globalThis.crypto?.randomUUID?.()
      ?? `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`,
  };
}

function isPermissionDenial(cause: unknown): boolean {
  const name = cause && typeof cause === 'object'
    ? String((cause as { readonly name?: unknown }).name ?? '')
    : '';
  return name === 'NotAllowedError' || name === 'SecurityError';
}

function exactFrameSamples(format: NimiRealtimeAudioFormat): number {
  const samples = format.sampleRateHz * format.frameDurationMs / 1_000;
  const bytes = samples * format.channelCount * 2;
  if (!Number.isSafeInteger(samples) || samples <= 0
    || !Number.isSafeInteger(bytes) || bytes > format.maximumFrameBytes) {
    throw new Error('Negotiated audio format cannot produce bounded PCM frames.');
  }
  return samples;
}

function scriptProcessorBufferSize(targetSamples: number): number {
  let size = 256;
  while (size < targetSamples && size < 16_384) size *= 2;
  return size;
}

function appendInterleavedSamples(
  target: number[],
  buffer: AudioBuffer,
  channelCount: 1 | 2,
): void {
  const sourceChannels = Math.max(1, buffer.numberOfChannels);
  const channels = Array.from({ length: channelCount }, (_, index) => (
    buffer.getChannelData(Math.min(index, sourceChannels - 1))
  ));
  for (let sampleIndex = 0; sampleIndex < buffer.length; sampleIndex += 1) {
    for (const channel of channels) {
      const sample = Math.max(-1, Math.min(1, channel[sampleIndex] ?? 0));
      target.push(sample < 0 ? sample * 0x8000 : sample * 0x7fff);
    }
  }
}

function pcm16Bytes(samples: readonly number[]): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2);
  const view = new DataView(bytes.buffer);
  samples.forEach((sample, index) => view.setInt16(index * 2, Math.round(sample), true));
  return bytes;
}

function audioBufferFromPcm(
  context: AudioContext,
  frame: Uint8Array,
  format: NimiRealtimeAudioFormat,
): AudioBuffer {
  if (format.codec !== 'pcm-s16le'
    || frame.byteLength === 0
    || frame.byteLength % (format.channelCount * 2) !== 0
    || frame.byteLength > format.maximumFrameBytes) {
    throw new Error('Agent Realtime PCM frame is invalid.');
  }
  const sampleCount = frame.byteLength / (format.channelCount * 2);
  const buffer = context.createBuffer(
    format.channelCount,
    sampleCount,
    format.sampleRateHz,
  );
  const view = new DataView(frame.buffer, frame.byteOffset, frame.byteLength);
  for (let channelIndex = 0; channelIndex < format.channelCount; channelIndex += 1) {
    const output = buffer.getChannelData(channelIndex);
    for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex += 1) {
      const byteOffset = (sampleIndex * format.channelCount + channelIndex) * 2;
      output[sampleIndex] = view.getInt16(byteOffset, true) / 0x8000;
    }
  }
  return buffer;
}

function stopPlaybackTrack(track: PlaybackTrack): void {
  for (const source of track.sources) {
    try {
      source.stop();
    } catch {
      // A source that already ended has no remaining physical playback.
    }
    source.disconnect();
  }
  track.sources.clear();
}

function stopMediaStream(stream: MediaStream): void {
  for (const track of stream.getTracks()) track.stop();
}
