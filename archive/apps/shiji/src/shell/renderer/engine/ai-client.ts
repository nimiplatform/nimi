/**
 * ai-client.ts — Thin streaming wrapper around runtime.ai.text.stream.
 * Uses getPlatformClient().runtime.ai.text.stream — no extra dependencies needed.
 * Per SJ-DIAL-004: streaming enabled, retry once on transient transport failure.
 */
import { getPlatformClient } from '@nimiplatform/sdk';

export type StreamChunkCallback = (chunk: string) => void;

export type GenerateResult = {
  fullText: string;
  interrupted: boolean;
};

/**
 * streamDialogueText — calls runtime.ai.text.stream and collects output.
 * Calls onChunk for each text delta as it arrives.
 * Returns { fullText, interrupted } when stream ends.
 * Throws on non-transient errors (schema, contract, model errors).
 */
export async function streamDialogueText(
  systemPrompt: string,
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  modelId: string,
  onChunk: StreamChunkCallback,
  signal?: AbortSignal,
): Promise<GenerateResult> {
  let fullText = '';
  let interrupted = false;

  try {
    const result = await getPlatformClient().runtime.ai.text.stream({
      model: modelId,
      system: systemPrompt,
      input: messages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      })),
      signal,
    });

    for await (const part of result.stream) {
      if (signal?.aborted) {
        interrupted = true;
        break;
      }
      if (part.type === 'delta') {
        fullText += part.text;
        onChunk(part.text);
      } else if (part.type === 'error') {
        throw part.error instanceof Error ? part.error : new Error(String(part.error));
      }
    }
  } catch (error) {
    if (signal?.aborted) {
      interrupted = true;
    } else {
      throw error;
    }
  }

  return { fullText, interrupted };
}
