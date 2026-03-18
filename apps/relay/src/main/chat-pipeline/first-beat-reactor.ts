// Relay first-beat reactor — adapted from local-chat first-beat-reactor.ts
// Removed: window debug globals, emitLocalChatLog, mod SDK imports
// Adapted: console.info for debug logging in main process

import type {
  FirstBeatResult,
  LocalChatContextPacket,
  LocalChatTurnAiClient,
} from './types.js';
import type { TurnInvokeInput } from './request-builder.js';
import {
  DEFAULT_STREAM_END_MARKER,
  findTrailingEndMarkerFragmentLength,
  stripTrailingEndMarkerFragment,
} from './stream-end-marker.js';

export const FIRST_BEAT_END_MARKER = DEFAULT_STREAM_END_MARKER;
const FIRST_BEAT_MAX_TOKENS = 1024;
const FIRST_BEAT_REPAIR_MAX_TOKENS = 1024;
const FIRST_BEAT_FALLBACK_MAX_TOKENS = 1024;
const FIRST_BEAT_UNAVAILABLE_ERROR = 'RELAY_FIRST_BEAT_UNAVAILABLE';

type FirstBeatDebugContext = {
  flowId?: string;
  turnTxnId?: string;
  targetId?: string;
  sessionId?: string;
  entry?: 'send-flow' | 'proactive';
};

function emitFirstBeatDebugLog(input: {
  event: string;
  context?: FirstBeatDebugContext;
  details?: Record<string, unknown>;
}): void {
  try {
    const record = {
      ts: new Date().toISOString(),
      event: input.event,
      ...(input.context || {}),
      ...(input.details || {}),
    };
    console.info(`[relay:first-beat] ${input.event}`, record);
  } catch {
    // ignore logging failures
  }
}

function normalizeWhitespace(value: string): string {
  return String(value || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function normalizePreview(value: string): string {
  return normalizeWhitespace(value)
    .replace(/\n+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

function extractMarkedFirstBeat(value: string): string {
  const raw = String(value || '');
  const markerIndex = raw.indexOf(FIRST_BEAT_END_MARKER);
  if (markerIndex < 0) {
    return '';
  }
  const trailing = raw.slice(markerIndex + FIRST_BEAT_END_MARKER.length).trim();
  if (trailing) {
    return '';
  }
  return normalizePreview(raw.slice(0, markerIndex));
}

function longestTrailingMarkerPrefix(value: string): number {
  const size = findTrailingEndMarkerFragmentLength(value, FIRST_BEAT_END_MARKER);
  return size >= FIRST_BEAT_END_MARKER.length ? 0 : size;
}

function extractStablePreview(value: string): string {
  const marked = extractMarkedFirstBeat(value);
  if (marked) {
    return marked;
  }
  const prefixSize = longestTrailingMarkerPrefix(value);
  if (prefixSize <= 0) {
    return '';
  }
  return normalizePreview(String(value || '').slice(0, -prefixSize));
}

function extractUnmarkedCompleteFirstBeat(value: string): string {
  const normalized = normalizePreview(stripTrailingEndMarkerFragment(value, FIRST_BEAT_END_MARKER));
  if (!normalized) return '';
  if (/[，,、：:；;（(]$/u.test(normalized)) return '';
  if (/(?:\.\.\.|…)$/.test(normalized)) return '';
  return normalized;
}

function buildFirstBeatRepairPrompt(input: {
  prompt: string;
  contextPacket: LocalChatContextPacket;
  userText: string;
  partialText: string;
}): string {
  return [
    buildFirstBeatPrompt({
      prompt: input.prompt,
      contextPacket: input.contextPacket,
      userText: input.userText,
    }),
    '',
    'The first beat did not end properly.',
    `Previous output: ${input.partialText || '(empty)'}`,
    `Please re-output only one complete, natural sentence, and immediately append the end marker ${FIRST_BEAT_END_MARKER} after the sentence ends.`,
    `Do not output anything other than the first beat text and the end marker ${FIRST_BEAT_END_MARKER}.`,
  ].join('\n');
}

function buildFirstBeatFallbackPrompt(input: {
  prompt: string;
  contextPacket: LocalChatContextPacket;
  userText: string;
}): string {
  return [
    buildFirstBeatPrompt({
      prompt: input.prompt,
      contextPacket: input.contextPacket,
      userText: input.userText,
    }),
    '',
    'The previous first beat generation failed.',
    `Now please directly output one complete first sentence closely related to the user's current message, and immediately append the end marker ${FIRST_BEAT_END_MARKER} after it ends.`,
    `Do not output anything other than the first beat text and the end marker ${FIRST_BEAT_END_MARKER}.`,
  ].join('\n');
}

function buildFirstBeatPrompt(input: {
  prompt: string;
  contextPacket: LocalChatContextPacket;
  userText: string;
}): string {
  const restrainedLines = (() => {
    const hint = input.contextPacket.contentBoundaryHint;
    if (!hint) return [];
    if (hint.visualComfortLevel === 'text-only') {
      return [
        '- User selected text-only. Do not expand on appearance, body, clothing, or camera-style visual descriptions.',
        '- Do not output pornographic, nude, sexually suggestive, or explicit sexual content.',
      ];
    }
    if (hint.visualComfortLevel === 'restrained-visuals') {
      return [
        '- User selected restrained style. Do not output pornographic, nude, sexually suggestive, or explicit sexual content.',
      ];
    }
    return [];
  })();
  return [
    input.prompt,
    '',
    'You are now only responsible for generating the firstBeat.',
    'Rules:',
    '- Output only one complete, natural sentence that feels finished, and immediately append the end marker after it.',
    '- The goal is to first acknowledge the user — do not rush to say everything in one go.',
    '- If you do not yet have a complete deep analysis, make a conservative acknowledgment — do not jump to conclusions.',
    '- No paragraphs, no JSON, no bullet points, no explanations.',
    '- No system words, action tags, bracketed stage directions.',
    '- Do not always fall into fixed templates like "What happened / I\'m here / Tell me about it".',
    '- Even if the user explicitly asks for voice, finish the first sentence in text first.',
    '- Do not proactively advance the relationship, make promises, or promise to send images/videos immediately.',
    '- Do not cite memories you are unsure about; when uncertain, just naturally respond to the user\'s current message.',
    ...restrainedLines,
    `- The end marker is fixed as ${FIRST_BEAT_END_MARKER}, must be output verbatim at the end of the first sentence.`,
    `- Do not output anything other than the first beat text and the end marker ${FIRST_BEAT_END_MARKER}.`,
    `- Example: I'm still listening${FIRST_BEAT_END_MARKER}`,
    `Current turnMode=${input.contextPacket.turnMode || 'information'}`,
    `firstBeatStyle=${input.contextPacket.target.interactionProfile.expression.firstBeatStyle}`,
    `voiceConversationMode=${input.contextPacket.voiceConversationMode || 'off'}`,
    `userInput=${input.userText}`,
  ].join('\n');
}

export async function runFirstBeatReactor(input: {
  aiClient: LocalChatTurnAiClient;
  invokeInput: TurnInvokeInput;
  contextPacket: LocalChatContextPacket;
  userText: string;
  transientMessageId: string;
  abortSignal?: AbortSignal;
  onPreview?: (preview: string) => void;
  debugContext?: FirstBeatDebugContext;
}): Promise<FirstBeatResult> {
  const startedAt = performance.now();
  const prompt = buildFirstBeatPrompt({
    prompt: input.invokeInput.prompt,
    contextPacket: input.contextPacket,
    userText: input.userText,
  });
  let buffer = '';
  let preview = '';
  let traceId: string | null = null;
  let finishReason: string | null = null;
  let streamDeltaCount = 0;
  let streamFailed = false;

  emitFirstBeatDebugLog({
    event: 'start',
    context: input.debugContext,
    details: {
      transientMessageId: input.transientMessageId,
      userText: input.userText,
      promptChars: prompt.length,
      targetFirstBeatStyle: input.contextPacket.target.interactionProfile.expression.firstBeatStyle,
      turnMode: input.contextPacket.turnMode || null,
      voiceConversationMode: input.contextPacket.voiceConversationMode || null,
      temperature: 0.82,
      maxTokens: FIRST_BEAT_MAX_TOKENS,
      endMarker: FIRST_BEAT_END_MARKER,
      visualComfortLevel: input.contextPacket.contentBoundaryHint?.visualComfortLevel || null,
    },
  });

  try {
    for await (const event of input.aiClient.streamText({
      ...input.invokeInput,
      prompt,
      maxTokens: FIRST_BEAT_MAX_TOKENS,
      temperature: 0.82,
      abortSignal: input.abortSignal,
    })) {
      if (event.type === 'text_delta') {
        buffer += event.textDelta;
        streamDeltaCount += 1;
        const nextPreview = extractStablePreview(buffer);
        const sealedCandidate = extractMarkedFirstBeat(buffer);
        if (nextPreview && nextPreview !== preview) {
          preview = nextPreview;
          input.onPreview?.(nextPreview);
        }
        if (sealedCandidate) {
          emitFirstBeatDebugLog({
            event: 'stream-sealed',
            context: input.debugContext,
            details: {
              transientMessageId: input.transientMessageId,
              text: sealedCandidate,
              streamDeltaCount,
              traceId,
              latencyMs: Math.round(performance.now() - startedAt),
            },
          });
          return {
            text: sealedCandidate,
            transientMessageId: input.transientMessageId,
            traceId,
            latencyMs: Math.round(performance.now() - startedAt),
            streamDeltaCount,
            streamDurationMs: Math.round(performance.now() - startedAt),
          };
        }
        continue;
      }
      if (event.type === 'done') {
        traceId = String(event.traceId || '').trim() || null;
        finishReason = String(event.finishReason || '').trim() || null;
        emitFirstBeatDebugLog({
          event: 'stream-done',
          context: input.debugContext,
          details: {
            transientMessageId: input.transientMessageId,
            traceId,
            finishReason,
            streamDeltaCount,
            partialText: normalizePreview(buffer),
          },
        });
      }
    }
  } catch (error) {
    if (input.abortSignal?.aborted) {
      throw error;
    }
    streamFailed = true;
    emitFirstBeatDebugLog({
      event: 'stream-error',
      context: input.debugContext,
      details: {
        transientMessageId: input.transientMessageId,
        error: error instanceof Error ? error.message : String(error || ''),
        streamDeltaCount,
        partialText: normalizePreview(buffer),
      },
    });
  }

  const partialText = normalizePreview(buffer);
  const finalText = extractMarkedFirstBeat(buffer);

  if (!streamFailed && finishReason !== null && finalText) {
    emitFirstBeatDebugLog({
      event: 'return-stream-final',
      context: input.debugContext,
      details: {
        transientMessageId: input.transientMessageId,
        text: finalText,
        traceId,
        streamDeltaCount,
        latencyMs: Math.round(performance.now() - startedAt),
      },
    });
    return {
      text: finalText,
      transientMessageId: input.transientMessageId,
      traceId,
      latencyMs: Math.round(performance.now() - startedAt),
      streamDeltaCount,
      streamDurationMs: Math.round(performance.now() - startedAt),
    };
  }

  // ── Repair attempt ────────────────────────────────────────────────
  try {
    emitFirstBeatDebugLog({
      event: 'repair-start',
      context: input.debugContext,
      details: {
        transientMessageId: input.transientMessageId,
        partialText,
        partialChars: partialText.length,
      },
    });
    const repaired = await input.aiClient.generateText({
      ...input.invokeInput,
      prompt: buildFirstBeatRepairPrompt({
        prompt: input.invokeInput.prompt,
        contextPacket: input.contextPacket,
        userText: input.userText,
        partialText,
      }),
      maxTokens: FIRST_BEAT_REPAIR_MAX_TOKENS,
      temperature: 0.55,
    });
    const repairedText =
      extractMarkedFirstBeat(String(repaired.text || ''))
      || extractUnmarkedCompleteFirstBeat(String(repaired.text || ''));
    if (repairedText) {
      emitFirstBeatDebugLog({
        event: 'return-repair',
        context: input.debugContext,
        details: {
          transientMessageId: input.transientMessageId,
          text: repairedText,
          traceId: String(repaired.traceId || '').trim() || traceId,
          streamDeltaCount,
          latencyMs: Math.round(performance.now() - startedAt),
        },
      });
      return {
        text: repairedText,
        transientMessageId: input.transientMessageId,
        traceId: String(repaired.traceId || '').trim() || traceId,
        latencyMs: Math.round(performance.now() - startedAt),
        streamDeltaCount,
        streamDurationMs: Math.round(performance.now() - startedAt),
      };
    }
  } catch (error) {
    if (input.abortSignal?.aborted) {
      throw error;
    }
    emitFirstBeatDebugLog({
      event: 'repair-error',
      context: input.debugContext,
      details: {
        transientMessageId: input.transientMessageId,
        error: error instanceof Error ? error.message : String(error || ''),
      },
    });
  }

  // ── Fallback attempt ──────────────────────────────────────────────
  try {
    emitFirstBeatDebugLog({
      event: 'fallback-start',
      context: input.debugContext,
      details: { transientMessageId: input.transientMessageId },
    });
    const regenerated = await input.aiClient.generateText({
      ...input.invokeInput,
      prompt: buildFirstBeatFallbackPrompt({
        prompt: input.invokeInput.prompt,
        contextPacket: input.contextPacket,
        userText: input.userText,
      }),
      maxTokens: FIRST_BEAT_FALLBACK_MAX_TOKENS,
      temperature: 0.45,
    });
    const regeneratedText =
      extractMarkedFirstBeat(String(regenerated.text || ''))
      || extractUnmarkedCompleteFirstBeat(String(regenerated.text || ''));
    if (regeneratedText) {
      emitFirstBeatDebugLog({
        event: 'return-fallback',
        context: input.debugContext,
        details: {
          transientMessageId: input.transientMessageId,
          text: regeneratedText,
          traceId: String(regenerated.traceId || '').trim() || traceId,
          streamDeltaCount,
          latencyMs: Math.round(performance.now() - startedAt),
        },
      });
      return {
        text: regeneratedText,
        transientMessageId: input.transientMessageId,
        traceId: String(regenerated.traceId || '').trim() || traceId,
        latencyMs: Math.round(performance.now() - startedAt),
        streamDeltaCount,
        streamDurationMs: Math.round(performance.now() - startedAt),
      };
    }
  } catch (error) {
    if (input.abortSignal?.aborted) {
      throw error;
    }
    emitFirstBeatDebugLog({
      event: 'fallback-error',
      context: input.debugContext,
      details: {
        transientMessageId: input.transientMessageId,
        error: error instanceof Error ? error.message : String(error || ''),
      },
    });
  }

  emitFirstBeatDebugLog({
    event: 'unavailable',
    context: input.debugContext,
    details: {
      transientMessageId: input.transientMessageId,
      streamDeltaCount,
      traceId,
      finishReason,
      partialText,
    },
  });
  throw new Error(FIRST_BEAT_UNAVAILABLE_ERROR);
}
