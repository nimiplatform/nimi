/**
 * Stream one text turn and stop it on request.
 *
 * Deltas are partial text. Only a `completed` event makes the answer final; a
 * `failed` event keeps its typed reason instead of becoming a generic error.
 */

import type { NimiLocalAppClient } from '@nimiplatform/sdk';

export async function streamAnswer(
  client: NimiLocalAppClient,
  question: string,
  onText: (text: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  const stream = await client.ai.text.streamTurn({
    messages: [{ role: 'user', text: question }],
  });
  const stop = () => {
    void stream.cancel();
  };
  signal?.addEventListener('abort', stop, { once: true });
  let text = '';
  try {
    for await (const event of stream) {
      if (event.type === 'delta') {
        text += event.text;
        onText(event.text);
      } else if (event.type === 'failed') {
        throw Object.assign(new Error(`Text turn failed: ${event.reasonCode}`), {
          reasonCode: event.reasonCode,
          actionHint: event.actionHint,
        });
      } else if (event.type === 'completed') {
        return text;
      }
    }
    throw new Error('Text turn ended without a completed event.');
  } finally {
    signal?.removeEventListener('abort', stop);
    await stream.cancel();
  }
}
