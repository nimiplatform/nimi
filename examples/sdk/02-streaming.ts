/**
 * Stream one text turn and stop it on request.
 *
 * Deltas are partial text. Only a `completed` event makes the answer final; a
 * `failed` event keeps its typed reason instead of becoming a generic error.
 */

import type { NimiLocalAppClient } from '@nimiplatform/sdk';
import { createNimiError, isNimiError } from '@nimiplatform/sdk/types';

export async function streamAnswer(
  client: NimiLocalAppClient,
  question: string,
  onText: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  signal?.throwIfAborted();
  const stream = await client.ai.text.streamTurn({
    messages: [{ role: 'user', text: question }],
  });
  let cancellation: Promise<void> | undefined;
  const cancel = () => cancellation ??= stream.cancel();
  const stop = () => {
    // Event listeners cannot await. The finally block observes this rejection.
    void cancel().catch(() => {});
  };
  signal?.addEventListener('abort', stop, { once: true });
  let text = '';
  let failed = false;
  let primaryFailure: unknown;
  try {
    // Abort may have happened while the Host was establishing the stream.
    signal?.throwIfAborted();
    for await (const event of stream) {
      // A buffered terminal/delta cannot turn a stopped request into success.
      signal?.throwIfAborted();
      if (event.type === 'delta') {
        text += event.text;
        onText(event.text);
      } else if (event.type === 'failed') {
        throw createNimiError({
          message: `Text turn failed: ${event.reasonCode}`,
          code: event.reasonCode,
          reasonCode: event.reasonCode,
          actionHint: event.actionHint,
          traceId: event.traceId,
          source: 'runtime',
          interruption: event.interruption,
          retryable: event.interruption?.resubmitDisposition === 'caller-may-resubmit',
        });
      } else if (event.type === 'completed') {
        return text;
      }
    }
    signal?.throwIfAborted();
    throw new Error('Text turn ended without a completed event.');
  } catch (error) {
    failed = true;
    primaryFailure = error;
    throw error;
  } finally {
    signal?.removeEventListener('abort', stop);
    try { await cancel(); }
    catch (cleanupError) {
      if (!failed) throw cleanupError;
      if (primaryFailure === cleanupError) throw primaryFailure;
      if (primaryFailure instanceof AggregateError && primaryFailure.errors.includes(cleanupError)) throw primaryFailure;
      // Keep typed recovery information and both errors; cleanup cannot replace it.
      const combined = new AggregateError(
        [primaryFailure, cleanupError],
        primaryFailure instanceof Error ? primaryFailure.message : 'Text stream failed and cleanup also failed.',
        { cause: primaryFailure },
      );
      if (isNimiError(primaryFailure)) Object.assign(combined, {
        code: primaryFailure.code, reasonCode: primaryFailure.reasonCode,
        actionHint: primaryFailure.actionHint, traceId: primaryFailure.traceId,
        retryable: primaryFailure.retryable, source: primaryFailure.source,
        details: primaryFailure.details, interruption: primaryFailure.interruption,
      });
      throw combined;
    }
  }
}
