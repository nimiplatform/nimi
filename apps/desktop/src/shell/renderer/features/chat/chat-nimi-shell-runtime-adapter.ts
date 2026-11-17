import type { NimiLocalAppClient, NimiLocalAppTextTurnInput } from '@nimiplatform/sdk/app';
import type { ChatAiThreadBundle } from '../../bridge/runtime-bridge/types';

export type DesktopNimiTextCapabilityResult = {
  readonly text: string;
  readonly traceId: string | null;
  readonly finishReason: 'stop' | 'length';
};

export type DesktopNimiTextCapabilityInput = {
  readonly client: Pick<NimiLocalAppClient, 'ai'>;
  readonly prompt: string;
  readonly history?: ChatAiThreadBundle['messages'];
  readonly signal?: AbortSignal;
};

const HISTORY_TURNS = 16;
const INPUT_BYTES = 512 * 1024;

// @nimi-authority: rule.nimi.desktop.shell-ui.chat-sides
export function buildDesktopNimiTextCapabilityRequest(
  input: Pick<DesktopNimiTextCapabilityInput, 'prompt' | 'history'>,
): NimiLocalAppTextTurnInput {
  const prompt = input.prompt.trim();
  if (!prompt) throw new Error('Nimi Chat text input is required.');
  const encoder = new TextEncoder();
  let bytes = encoder.encode(prompt).length;
  if (bytes > INPUT_BYTES) throw new Error('Nimi Chat input exceeds the text budget.');
  const history = input.history ?? [];
  const users = new Map(history.filter(item => item.role === 'user' && item.status === 'complete').map(item => [item.id, item]));
  const messages: NimiLocalAppTextTurnInput['messages'][number][] = [];
  for (let i = history.length - 1; i >= 0 && messages.length < HISTORY_TURNS * 2; i--) {
    const reply = history[i]!;
    if (reply.role !== 'assistant' || reply.status !== 'complete' || !reply.parentMessageId) continue;
    const user = users.get(reply.parentMessageId);
    if (!user || user.threadId !== reply.threadId || !user.contentText.trim() || !reply.contentText.trim()) continue;
    bytes += encoder.encode(user.contentText).length + encoder.encode(reply.contentText).length;
    if (bytes > INPUT_BYTES) break;
    users.delete(user.id);
    messages.push({ role: 'assistant', text: reply.contentText }, { role: 'user', text: user.contentText });
  }
  return { messages: [...messages.reverse(), { role: 'user', text: prompt }] };
}

export async function runDesktopNimiTextCapability(
  input: DesktopNimiTextCapabilityInput,
): Promise<DesktopNimiTextCapabilityResult> {
  input.signal?.throwIfAborted();
  const stream = await input.client.ai.text.streamTurn(buildDesktopNimiTextCapabilityRequest(input));
  const abort = () => { void stream.cancel().catch(() => undefined); };
  input.signal?.addEventListener('abort', abort, { once: true });
  let text = '';
  let result: DesktopNimiTextCapabilityResult | undefined;
  try {
    input.signal?.throwIfAborted();
    for await (const event of stream) {
      input.signal?.throwIfAborted();
      if (event.type === 'delta') text += event.text;
      if (event.type === 'failed') throw Object.assign(new Error(event.reasonCode), event);
      if (event.type === 'completed') {
        if ((event.finishReason !== 'stop' && event.finishReason !== 'length') || !text.trim()) {
          throw new Error(`Nimi Chat response ended with ${event.finishReason}.`);
        }
        result = { text, traceId: event.traceId || null, finishReason: event.finishReason };
        break;
      }
    }
  } catch (error) {
    // Returning the iterator closes the transport. A cleanup error after an
    // admitted terminal event cannot turn a completed generation into a resend.
    if (!result) throw error;
  } finally {
    input.signal?.removeEventListener('abort', abort);
    await stream.cancel().catch(() => undefined);
  }
  input.signal?.throwIfAborted();
  if (!result) throw new Error('Nimi Chat response ended without a confirmed result.');
  return result;
}
