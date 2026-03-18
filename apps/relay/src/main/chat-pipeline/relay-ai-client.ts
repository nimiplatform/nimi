// RelayAiClient — wraps Runtime SDK to implement LocalChatTurnAiClient for the chat pipeline.
// No mod SDK imports. Calls runtime.ai.text.generate/stream and runtime.media.* directly.

import type { Runtime } from '@nimiplatform/sdk/runtime';
import { parseJsonObject } from './json-repair.js';
import { resolveModelAndRoute } from '../input-transform.js';
import type {
  ChatRouteSnapshot,
  LocalChatGenerateImageInput,
  LocalChatGenerateImageResult,
  LocalChatGenerateObjectInput,
  LocalChatGenerateObjectResult,
  LocalChatGenerateTextInput,
  LocalChatGenerateTextResult,
  LocalChatGenerateVideoInput,
  LocalChatGenerateVideoResult,
  LocalChatStreamTextDelta,
  LocalChatTurnAiClient,
} from './types.js';

const DEFAULT_SUBJECT_USER_ID = 'local-user';

function normalize(value: string | undefined | null): string {
  return String(value || '').trim();
}

export function createRelayAiClient(runtime: Runtime): LocalChatTurnAiClient {
  return {
    // ── generateText ──────────────────────────────────────────────────
    async generateText(
      input: LocalChatGenerateTextInput,
    ): Promise<LocalChatGenerateTextResult> {
      const target = resolveModelAndRoute(undefined, input.model);
      const response = await runtime.ai.text.generate({
        model: target.model,
        input: input.prompt,
        maxTokens: input.maxTokens,
        temperature: input.temperature,
        subjectUserId: normalize(input.subjectUserId) || DEFAULT_SUBJECT_USER_ID,
        route: target.route,
      });
      const traceId = normalize(response.trace?.traceId);
      return {
        text: String(response.text || ''),
        traceId,
        finishReason: response.finishReason,
      };
    },

    // ── generateObject ────────────────────────────────────────────────
    async generateObject<T = unknown>(
      input: LocalChatGenerateObjectInput,
    ): Promise<LocalChatGenerateObjectResult<T>> {
      const target = resolveModelAndRoute(undefined, input.model);
      const response = await runtime.ai.text.generate({
        model: target.model,
        input: input.prompt,
        maxTokens: input.maxTokens,
        temperature: input.temperature,
        subjectUserId: normalize(input.subjectUserId) || DEFAULT_SUBJECT_USER_ID,
        route: target.route,
      });
      const text = String(response.text || '');
      const traceId = normalize(response.trace?.traceId);
      const object = parseJsonObject(text) as T;
      return { object, text, traceId };
    },

    // ── streamText ────────────────────────────────────────────────────
    async *streamText(
      input: LocalChatGenerateTextInput,
    ): AsyncIterable<LocalChatStreamTextDelta> {
      const target = resolveModelAndRoute(undefined, input.model);
      const response = await runtime.ai.text.stream({
        model: target.model,
        input: input.prompt,
        maxTokens: input.maxTokens,
        temperature: input.temperature,
        subjectUserId: normalize(input.subjectUserId) || DEFAULT_SUBJECT_USER_ID,
        route: target.route,
      });
      for await (const event of response.stream) {
        if (event.type === 'delta') {
          const textDelta = String(event.text || '');
          if (textDelta) {
            yield { type: 'text_delta', textDelta };
          }
          continue;
        }
        if (event.type === 'finish') {
          yield {
            type: 'done',
            traceId: normalize(event.trace?.traceId) || '',
            finishReason: event.finishReason || 'stop',
          };
          continue;
        }
        if (event.type === 'error') {
          throw event.error;
        }
      }
    },

    // ── generateImage ─────────────────────────────────────────────────
    async generateImage(
      input: LocalChatGenerateImageInput,
    ): Promise<LocalChatGenerateImageResult> {
      const model = normalize(input.model) || 'local/default';
      const response = await runtime.media.image.generate({
        model,
        prompt: input.prompt,
        negativePrompt: input.negativePrompt,
        size: input.size,
        aspectRatio: input.aspectRatio,
        quality: input.quality,
        style: input.style,
        n: input.n,
        subjectUserId: DEFAULT_SUBJECT_USER_ID,
      });
      const traceId = normalize(response.trace?.traceId);
      const artifacts = (response.artifacts || []).map((artifact) => ({
        uri: normalize(artifact.uri) || undefined,
        base64:
          artifact.bytes instanceof Uint8Array && artifact.bytes.length > 0
            ? Buffer.from(artifact.bytes).toString('base64')
            : undefined,
        mimeType: normalize(artifact.mimeType) || undefined,
      }));
      return { artifacts, traceId };
    },

    // ── generateVideo ─────────────────────────────────────────────────
    async generateVideo(
      input: LocalChatGenerateVideoInput,
    ): Promise<LocalChatGenerateVideoResult> {
      const model = normalize(input.model) || 'local/default';
      const content: Array<
        | { type: 'text'; role?: 'prompt'; text: string }
        | {
            type: 'image_url';
            role: 'first_frame' | 'last_frame' | 'reference_image';
            imageUrl: string;
          }
      > = [{ type: 'text', role: 'prompt', text: input.prompt }];

      const mode =
        (input.mode as 't2v' | 'i2v-first-frame' | 'i2v-first-last' | 'i2v-reference') ||
        't2v';

      const response = await runtime.media.video.generate({
        model,
        mode,
        prompt: input.prompt,
        content,
        options: {
          durationSec: input.durationSeconds,
          ratio: input.aspectRatio,
        },
        subjectUserId: DEFAULT_SUBJECT_USER_ID,
      });
      const traceId = normalize(response.trace?.traceId);
      const artifacts = (response.artifacts || []).map((artifact) => ({
        uri: normalize(artifact.uri) || undefined,
        base64:
          artifact.bytes instanceof Uint8Array && artifact.bytes.length > 0
            ? Buffer.from(artifact.bytes).toString('base64')
            : undefined,
        mimeType: normalize(artifact.mimeType) || undefined,
      }));
      return { artifacts, traceId };
    },

    // ── resolveRoute ──────────────────────────────────────────────────
    async resolveRoute(
      _input: { routeBinding?: unknown },
    ): Promise<ChatRouteSnapshot | null> {
      // The relay uses input-transform.ts route resolution (model prefix based).
      // Default to local route since relay primarily uses local runtime.
      return { source: 'local', model: 'local/default' };
    },
  };
}
