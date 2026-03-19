// RL-IPC-003 — Generic Stream IPC Protocol
// Shared by AI text streaming and video job subscription

import type { WebContents } from 'electron';
import { normalizeError } from './error-utils.js';
import type { RelayEventMap } from '../shared/ipc-contract.js';

interface ActiveStream {
  type: string;
  abortController: AbortController;
}

const streams = new Map<string, ActiveStream>();
let streamCounter = 0;

function generateStreamId(): string {
  return `stream_${++streamCounter}_${Date.now()}`;
}

/**
 * Open a stream and begin forwarding chunks to the renderer.
 *
 * Phase 1: Returns { streamId } to the renderer.
 * Phase 2: Iterates the async iterable, sending chunks via webContents.send.
 * Phase 3: Renderer can cancel via cancelStream(streamId).
 */
export async function openStream(
  streamType: string,
  asyncIterable: AsyncIterable<unknown>,
  webContents: WebContents,
): Promise<{ streamId: string }> {
  const streamId = generateStreamId();
  const abortController = new AbortController();

  streams.set(streamId, { type: streamType, abortController });

  // Start consuming the stream in the background
  consumeStream(streamId, asyncIterable, webContents, abortController.signal);

  return { streamId };
}

async function consumeStream(
  streamId: string,
  asyncIterable: AsyncIterable<unknown>,
  webContents: WebContents,
  signal: AbortSignal,
): Promise<void> {
  try {
    for await (const chunk of asyncIterable) {
      if (signal.aborted) {
        break;
      }
      if (webContents.isDestroyed()) {
        break;
      }
      // relay:stream:chunk — { streamId, data }
      const payload: RelayEventMap['relay:stream:chunk'] = { streamId, data: chunk as RelayEventMap['relay:stream:chunk']['data'] };
      webContents.send('relay:stream:chunk', payload);
    }

    if (!signal.aborted && !webContents.isDestroyed()) {
      // relay:stream:end — { streamId }
      const payload: RelayEventMap['relay:stream:end'] = { streamId };
      webContents.send('relay:stream:end', payload);
    }
  } catch (error: unknown) {
    if (!signal.aborted && !webContents.isDestroyed()) {
      const errorPayload = normalizeError(error);
      // relay:stream:error — { streamId, error }
      const payload: RelayEventMap['relay:stream:error'] = { streamId, error: errorPayload };
      webContents.send('relay:stream:error', payload);
    }
  } finally {
    streams.delete(streamId);
  }
}

/**
 * Cancel an active stream. Aborts the underlying async iterator.
 */
export function cancelStream(streamId: string): boolean {
  const stream = streams.get(streamId);
  if (!stream) {
    return false;
  }
  stream.abortController.abort();
  streams.delete(streamId);
  return true;
}
