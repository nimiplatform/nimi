import {
  createStreamController,
  type StreamController,
} from '../../src/shell/renderer/features/turns/stream-controller.js';

export * from '../../src/shell/renderer/features/turns/stream-controller.js';

export function createTestStreamController(): StreamController {
  return createStreamController({
    now: Date.now,
    schedule(delayMs, listener) {
      const timer = setTimeout(() => listener({ ok: true }), delayMs);
      return () => clearTimeout(timer);
    },
    animationFrame(listener) {
      const timer = setTimeout(() => listener({ ok: true }), 16);
      return () => clearTimeout(timer);
    },
  });
}

const controller = createTestStreamController();

export const {
  cancelStream,
  clearAllStreams,
  clearStream,
  feedStreamEvent,
  getStreamState,
  rearmTotalTimeout,
  startKeepalive,
  startStream,
  subscribeStream,
} = controller;
