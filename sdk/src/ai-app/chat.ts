import { getPlatformClient } from '../platform-client.js';
import type {
  Runtime,
  TextGenerateInput,
  TextGenerateOutput,
  TextMessage,
  TextStreamInput,
} from '../runtime/index.js';
import {
  streamAppAiTextResponse,
  type AppAiTextStreamDeltaPart,
  type AppAiTextStreamErrorPart,
  type AppAiTextStreamFinishPart,
  type AppAiTextStreamResponseHandlers,
  type AppAiTextStreamResponseResult,
  type AppAiTextStreamResponseSnapshot,
} from './text-stream-response.js';

export const DEFAULT_APP_AI_CHAT_METADATA = {
  callerKind: 'third-party-app',
  callerId: 'nimi-sdk.ai-app.chat',
  surfaceId: 'sdk.ai-app.chat',
} as const;

export type AppAiChatMetadataDefaults = Record<string, string>;
export type AppAiChatRequest = TextGenerateInput;
export type AppAiChatStreamRequest = TextStreamInput;
export type AppAiChatPrompt = string | TextMessage[];
export type AppAiChatDeltaPart = AppAiTextStreamDeltaPart;
export type AppAiChatFinishPart = AppAiTextStreamFinishPart;
export type AppAiChatErrorPart = AppAiTextStreamErrorPart;
export type AppAiChatStreamResult = AppAiTextStreamResponseResult;
export type AppAiChatStreamSnapshot = AppAiTextStreamResponseSnapshot;
export type AppAiChatStreamHandlers = AppAiTextStreamResponseHandlers;

export type AppAiChatRuntimeOptions = {
  metadataDefaults?: AppAiChatMetadataDefaults;
};

export async function submitAppAiChat(
  runtime: Runtime,
  request: AppAiChatRequest,
  options: AppAiChatRuntimeOptions = {},
): Promise<TextGenerateOutput> {
  return runtime.ai.text.generate(withDefaultAppAiChatMetadata(request, options.metadataDefaults));
}

export async function submitPlatformAppAiChat(
  request: AppAiChatRequest,
  options: AppAiChatRuntimeOptions = {},
): Promise<TextGenerateOutput> {
  return submitAppAiChat(getPlatformClient().runtime, request, options);
}

export async function streamAppAiChatResponse(
  runtime: Runtime,
  request: AppAiChatStreamRequest,
  handlers: AppAiChatStreamHandlers = {},
  options: AppAiChatRuntimeOptions = {},
): Promise<AppAiChatStreamResult> {
  return streamAppAiTextResponse(
    runtime,
    withDefaultAppAiChatMetadata(request, options.metadataDefaults),
    handlers,
  );
}

export async function streamPlatformAppAiChatResponse(
  request: AppAiChatStreamRequest,
  handlers: AppAiChatStreamHandlers = {},
  options: AppAiChatRuntimeOptions = {},
): Promise<AppAiChatStreamResult> {
  return streamAppAiChatResponse(getPlatformClient().runtime, request, handlers, options);
}

export function withDefaultAppAiChatMetadata<T extends AppAiChatRequest | AppAiChatStreamRequest>(
  request: T,
  metadataDefaults: AppAiChatMetadataDefaults = {},
): T {
  return {
    ...request,
    metadata: {
      ...DEFAULT_APP_AI_CHAT_METADATA,
      ...metadataDefaults,
      ...(request.metadata || {}),
    },
  };
}
