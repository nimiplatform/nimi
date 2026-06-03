
import { ReasonCode } from '../types/index.js';
import { createNimiError } from '../core/errors.js';
import {
  ChatContentPartType,
  FinishReason,
  ReasoningMode,
  ReasoningTraceMode,
  RoutePolicy,
  type ChatContentPart,
  type ChatMessage,
  type ReasoningConfig,
} from './generated/runtime/v1/ai';
import { asRecord, normalizeText, parseCount } from './runtime-value-utils.js';
import type {
  NimiFinishReason,
  NimiReasoningConfig,
  NimiRoutePolicy,
  NimiTokenUsage,
  NimiTraceInfo,
  TextMessage,
  TextMessageContentPart,
} from './types.js';

export function toRoutePolicy(value: NimiRoutePolicy | undefined): RoutePolicy {
  return value === 'cloud' ? RoutePolicy.CLOUD : RoutePolicy.LOCAL;
}

export function fromRoutePolicy(value: RoutePolicy): NimiRoutePolicy {
  return value === RoutePolicy.CLOUD ? 'cloud' : 'local';
}

export function fromRouteDecision(value: unknown): NimiRoutePolicy | undefined {
  const routeDecision = Number(value);
  if (routeDecision === RoutePolicy.CLOUD) {
    return 'cloud';
  }
  if (routeDecision === RoutePolicy.LOCAL) {
    return 'local';
  }
  return undefined;
}

export function toFinishReason(value: FinishReason): NimiFinishReason {
  switch (value) {
    case FinishReason.LENGTH:
      return 'length';
    case FinishReason.CONTENT_FILTER:
      return 'content-filter';
    case FinishReason.TOOL_CALL:
      return 'tool-calls';
    case FinishReason.ERROR:
      return 'error';
    case FinishReason.STOP:
    default:
      return 'stop';
  }
}

export function toUsage(value: unknown): NimiTokenUsage {
  const usage = asRecord(value);
  const inputTokens = parseCount(usage.inputTokens);
  const outputTokens = parseCount(usage.outputTokens);
  const totalTokens = typeof inputTokens === 'number' && typeof outputTokens === 'number'
    ? inputTokens + outputTokens
    : undefined;

  return {
    inputTokens,
    outputTokens,
    totalTokens,
  };
}

export function toTraceInfo(input: {
  traceId?: unknown;
  modelResolved?: unknown;
  routeDecision?: unknown;
}): NimiTraceInfo {
  const routeDecision = fromRouteDecision(input.routeDecision);
  return {
    traceId: normalizeText(input.traceId) || undefined,
    modelResolved: normalizeText(input.modelResolved) || undefined,
    ...(routeDecision ? { routeDecision } : {}),
  };
}

export function toReasoningConfig(value: NimiReasoningConfig | undefined): ReasoningConfig | undefined {
  if (!value) {
    return undefined;
  }

  let mode = ReasoningMode.UNSPECIFIED;
  if (value.mode === 'on') {
    mode = ReasoningMode.ON;
  } else if (value.mode === 'off') {
    mode = ReasoningMode.OFF;
  }

  let traceMode = ReasoningTraceMode.UNSPECIFIED;
  if (value.traceMode === 'separate') {
    traceMode = ReasoningTraceMode.SEPARATE;
  } else if (value.traceMode === 'hide') {
    traceMode = ReasoningTraceMode.HIDE;
  }

  const budgetTokens = Number(value.budgetTokens || 0);
  return {
    mode,
    traceMode,
    budgetTokens: Number.isFinite(budgetTokens) ? budgetTokens : 0,
  };
}

export function toRuntimeMessages(input: string | TextMessage[], system?: string): {
  systemPrompt: string;
  input: ChatMessage[];
} {
  if (typeof input === 'string') {
    const content = normalizeText(input);
    if (!content) {
      throw createNimiError({
        message: 'text input is required',
        reasonCode: ReasonCode.AI_INPUT_INVALID,
        actionHint: 'set_text_input',
        source: 'sdk',
      });
    }
    return {
      systemPrompt: normalizeText(system),
      input: [{ role: 'user', content, name: '', parts: [createTextChatContentPart(content)] }],
    };
  }

  const systemParts: string[] = [];
  const messages: ChatMessage[] = [];
  let hasNonSystemContent = false;

  if (Array.isArray(input)) {
    for (const message of input) {
      if (Array.isArray(message.content)) {
        // Multimodal content: build parts + dual-write text
        const protoParts = contentPartsToProto(message.content);
        const textContent = extractTextFromContentParts(message.content);

        if (message.role === 'system') {
          // System messages: extract text only, ignore media
          if (textContent) {
            systemParts.push(textContent);
          }
          continue;
        }

        if (protoParts.length === 0 && !textContent) {
          continue;
        }
        hasNonSystemContent = true;
        messages.push({
          role: message.role,
          content: textContent,
          name: normalizeText(message.name),
          parts: protoParts,
        });
        continue;
      }

      // String content: original path
      const content = normalizeText(message.content);
      if (!content) {
        continue;
      }
      if (message.role === 'system') {
        systemParts.push(content);
        continue;
      }
      hasNonSystemContent = true;
      messages.push({
        role: message.role,
        content,
        name: normalizeText(message.name),
        parts: [createTextChatContentPart(content)],
      });
    }
  }

  const explicitSystem = normalizeText(system);
  if (explicitSystem) {
    systemParts.push(explicitSystem);
  }

  if (messages.length === 0 || !hasNonSystemContent) {
    throw createNimiError({
      message: 'text input must include at least one non-system message with text or media content',
      reasonCode: ReasonCode.AI_INPUT_INVALID,
      actionHint: 'add_user_or_assistant_content_message',
      source: 'sdk',
    });
  }

  return {
    systemPrompt: systemParts.join('\n\n'),
    input: messages,
  };
}

function createUnsupportedTextChatPartError() {
  return createNimiError({
    message: 'text chat multimodal requires text, image_url, video_url, audio_url, or artifact_ref content parts',
    reasonCode: ReasonCode.AI_MEDIA_OPTION_UNSUPPORTED,
    actionHint: 'use_supported_text_chat_media_parts',
    source: 'sdk',
  });
}

function createTextChatContentPart(text: string): ChatContentPart {
  return {
    type: ChatContentPartType.TEXT,
    content: {
      oneofKind: 'text',
      text,
    },
  };
}

function createArtifactRefChatContentPart(part: Extract<TextMessageContentPart, { type: 'artifact_ref' }>): ChatContentPart {
  const artifactId = normalizeText(part.artifactId);
  const localArtifactId = normalizeText(part.localArtifactId);
  if (!artifactId && !localArtifactId) {
    throw createNimiError({
      message: 'artifact_ref requires artifactId or localArtifactId',
      reasonCode: ReasonCode.AI_INPUT_INVALID,
      actionHint: 'set_artifact_ref_id',
      source: 'sdk',
    });
  }
  return {
    type: ChatContentPartType.ARTIFACT_REF,
    content: {
      oneofKind: 'artifactRef',
      artifactRef: {
        artifactId: artifactId || '',
        localArtifactId: localArtifactId || '',
        mimeType: normalizeText(part.mimeType),
        displayName: normalizeText(part.displayName),
      },
    },
  };
}

function contentPartsToProto(
  parts: TextMessageContentPart[],
): ChatContentPart[] {
  const result: ChatContentPart[] = [];
  for (const part of parts) {
    switch (part.type) {
      case 'text': {
        const text = normalizeText(part.text);
        if (text) {
          result.push(createTextChatContentPart(text));
        }
        break;
      }
      case 'image_url': {
        const url = normalizeText(part.imageUrl);
        if (url) {
          result.push({
            type: ChatContentPartType.IMAGE_URL,
            content: {
              oneofKind: 'imageUrl',
              imageUrl: { url, detail: part.detail || 'auto' },
            },
          });
        }
        break;
      }
      case 'video_url': {
        const url = normalizeText(part.videoUrl);
        if (url) {
          result.push({
            type: ChatContentPartType.VIDEO_URL,
            content: {
              oneofKind: 'videoUrl',
              videoUrl: url,
            },
          });
        }
        break;
      }
      case 'audio_url': {
        const url = normalizeText(part.audioUrl);
        if (url) {
          result.push({
            type: ChatContentPartType.AUDIO_URL,
            content: {
              oneofKind: 'audioUrl',
              audioUrl: url,
            },
          });
        }
        break;
      }
      case 'artifact_ref': {
        result.push(createArtifactRefChatContentPart(part));
        break;
      }
      default:
        throw createUnsupportedTextChatPartError();
    }
  }
  return result;
}

function extractTextFromContentParts(parts: TextMessageContentPart[]): string {
  const texts: string[] = [];
  for (const part of parts) {
    if (part.type === 'text') {
      const text = normalizeText(part.text);
      if (text) {
        texts.push(text);
      }
    }
  }
  return texts.join('\n');
}
