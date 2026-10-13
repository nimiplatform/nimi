import { vi } from 'vitest';
import { createBrowserAgentRealtimeHostMediaPortWithEnvironment } from '../src/browser-host';

export const PLAYBACK_FORMAT = {
  codec: 'pcm-s16le' as const, sampleRateHz: 16_000, channelCount: 1 as const,
  frameDurationMs: 20, maximumFrameBytes: 640,
};

export function playbackFixture() {
  const sources: Array<{
    onended: (() => void) | null;
    stop: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    start: ReturnType<typeof vi.fn>;
  }> = [];
  const context = {
    currentTime: 0, state: 'running', destination: {},
    resume: vi.fn(async () => { context.state = 'running'; }),
    createBuffer: (_channels: number, size: number, rate: number) => ({
      duration: size / rate, getChannelData: () => new Float32Array(size),
    }),
    createBufferSource: () => {
      const source = { onended: null, connect: vi.fn(), stop: vi.fn(), disconnect: vi.fn(), start: vi.fn() };
      sources.push(source);
      return source;
    },
    close: vi.fn(async () => { context.state = 'closed'; }),
  };
  const host = createBrowserAgentRealtimeHostMediaPortWithEnvironment({
    mediaDevices: null, createAudioContext: () => context as unknown as AudioContext, createOpaqueId: () => 'fixture',
  });
  const write = (outputTrackId = 'track') => host.playback.writeAudioFrame({
    outputTrackId, frameSequence: String(sources.length + 1), frame: new Uint8Array(640), format: PLAYBACK_FORMAT,
  });
  return { host, sources, context, write };
}
