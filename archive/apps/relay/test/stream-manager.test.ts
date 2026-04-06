// Unit tests for stream-manager.ts
// Tests the generic stream protocol (RL-IPC-003) in isolation

import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

// Since stream-manager.ts uses Electron's WebContents, we test the logic patterns directly
// by reimplementing the core algorithm without Electron imports

interface MockWebContents {
  destroyed: boolean;
  sent: Array<{ channel: string; data: unknown }>;
  send(channel: string, data: unknown): void;
  isDestroyed(): boolean;
}

function createMockWebContents(): MockWebContents {
  const wc: MockWebContents = {
    destroyed: false,
    sent: [],
    send(channel: string, data: unknown) {
      wc.sent.push({ channel, data });
    },
    isDestroyed() {
      return wc.destroyed;
    },
  };
  return wc;
}

// Core stream consumption logic extracted from stream-manager.ts
async function consumeStream(
  streamId: string,
  asyncIterable: AsyncIterable<unknown>,
  webContents: MockWebContents,
  signal: AbortSignal,
): Promise<void> {
  try {
    for await (const chunk of asyncIterable) {
      if (signal.aborted) break;
      if (webContents.isDestroyed()) break;
      webContents.send('relay:stream:chunk', { streamId, data: chunk });
    }
    if (!signal.aborted && !webContents.isDestroyed()) {
      webContents.send('relay:stream:end', { streamId });
    }
  } catch (error: unknown) {
    if (!signal.aborted && !webContents.isDestroyed()) {
      const message = error instanceof Error ? error.message : String(error);
      webContents.send('relay:stream:error', { streamId, error: { message } });
    }
  }
}

describe('Stream Manager — Core Logic', () => {
  let wc: MockWebContents;

  beforeEach(() => {
    wc = createMockWebContents();
  });

  it('forwards all chunks and sends end event', async () => {
    const chunks = ['hello', 'world', 'done'];
    async function* gen() {
      for (const c of chunks) yield c;
    }

    const ac = new AbortController();
    await consumeStream('s1', gen(), wc, ac.signal);

    // Should have 3 chunk events + 1 end event
    assert.equal(wc.sent.length, 4);
    assert.equal(wc.sent[0].channel, 'relay:stream:chunk');
    assert.deepEqual(wc.sent[0].data, { streamId: 's1', data: 'hello' });
    assert.equal(wc.sent[3].channel, 'relay:stream:end');
    assert.deepEqual(wc.sent[3].data, { streamId: 's1' });
  });

  it('stops forwarding when aborted', async () => {
    const ac = new AbortController();
    let yieldCount = 0;

    async function* gen() {
      for (let i = 0; i < 100; i++) {
        yieldCount++;
        yield `chunk-${i}`;
        if (i === 2) ac.abort();
      }
    }

    await consumeStream('s2', gen(), wc, ac.signal);

    // Should not have sent all 100 chunks
    const chunkEvents = wc.sent.filter((s) => s.channel === 'relay:stream:chunk');
    assert.ok(chunkEvents.length <= 4, `should stop early, got ${chunkEvents.length} chunks`);
    // Should NOT send end event when aborted
    const endEvents = wc.sent.filter((s) => s.channel === 'relay:stream:end');
    assert.equal(endEvents.length, 0, 'should not send end when aborted');
  });

  it('stops forwarding when webContents is destroyed', async () => {
    async function* gen() {
      yield 'chunk-0';
      wc.destroyed = true;
      yield 'chunk-1';
      yield 'chunk-2';
    }

    const ac = new AbortController();
    await consumeStream('s3', gen(), wc, ac.signal);

    // Only chunk-0 should have been sent
    const chunkEvents = wc.sent.filter((s) => s.channel === 'relay:stream:chunk');
    assert.equal(chunkEvents.length, 1, 'should stop when webContents destroyed');
  });

  it('sends error event on stream failure', async () => {
    async function* gen() {
      yield 'chunk-0';
      throw new Error('stream broke');
    }

    const ac = new AbortController();
    await consumeStream('s4', gen(), wc, ac.signal);

    const errorEvents = wc.sent.filter((s) => s.channel === 'relay:stream:error');
    assert.equal(errorEvents.length, 1, 'should send error event');
    const errorData = errorEvents[0].data as { streamId: string; error: { message: string } };
    assert.equal(errorData.streamId, 's4');
    assert.equal(errorData.error.message, 'stream broke');
  });

  it('does not send error when aborted during error', async () => {
    const ac = new AbortController();

    async function* gen() {
      yield 'chunk-0';
      ac.abort();
      throw new Error('stream broke after abort');
    }

    await consumeStream('s5', gen(), wc, ac.signal);

    const errorEvents = wc.sent.filter((s) => s.channel === 'relay:stream:error');
    assert.equal(errorEvents.length, 0, 'should not send error when aborted');
  });
});
