import { OpenAICompatibleGatewayError } from './errors.mjs';
import {
  OPENAI_PREFIX,
  audioMimeType,
  chatUsage,
  embeddingUsage,
  isRecord,
  normalizeFinishReason,
  normalizeText,
  responseUsage,
  unixSeconds,
  unsupportedFeature,
} from './gateway-utils.mjs';

export function chatCompletionResponse(runtimeResult, normalized) {
  const message = isRecord(runtimeResult?.message)
    ? runtimeResult.message
    : { role: 'assistant', content: normalizeText(runtimeResult?.text) };
  return {
    id: normalizeText(runtimeResult?.id) || `chatcmpl-${normalized.requestId}`,
    object: 'chat.completion',
    created: unixSeconds(runtimeResult),
    model: normalized.model.id,
    choices: [
      {
        index: 0,
        message: omitResponseUndefined({
          role: normalizeText(message.role) || 'assistant',
          content: message.content ?? '',
          refusal: message.refusal ?? null,
          tool_calls: Array.isArray(message.tool_calls) ? message.tool_calls : undefined,
        }),
        finish_reason: normalizeFinishReason(runtimeResult?.finishReason ?? runtimeResult?.finish_reason),
        logprobs: runtimeResult?.logprobs ?? null,
      },
    ],
    usage: chatUsage(runtimeResult?.usage),
  };
}

export function chatCompletionStreamResponse(config, normalized) {
  if (typeof config.runtime.streamChatCompletion !== 'function') {
    throw unsupportedFeature('chat.completions.stream', 'Runtime chat streaming is not wired for this gateway.');
  }
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const event of config.runtime.streamChatCompletion(normalized.runtimeRequest)) {
          const chunk = chatStreamChunk(event, normalized);
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`));
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
  return new Response(stream, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
    },
  });
}

export function responseApiResponse(runtimeResult, normalized) {
  const outputText = normalizeText(runtimeResult?.outputText ?? runtimeResult?.text);
  return {
    id: normalizeText(runtimeResult?.id) || `resp-${normalized.requestId}`,
    object: 'response',
    created_at: unixSeconds(runtimeResult),
    status: normalizeText(runtimeResult?.status) || 'completed',
    model: normalized.model.id,
    output: Array.isArray(runtimeResult?.output)
      ? runtimeResult.output
      : [
        {
          id: `msg-${normalized.requestId}`,
          type: 'message',
          status: 'completed',
          role: 'assistant',
          content: [{ type: 'output_text', text: outputText, annotations: [] }],
        },
      ],
    usage: responseUsage(runtimeResult?.usage),
  };
}

export function embeddingResponse(runtimeResult, normalized) {
  const embeddings = Array.isArray(runtimeResult?.embeddings) ? runtimeResult.embeddings : [];
  if (embeddings.length === 0) {
    throw new OpenAICompatibleGatewayError(
      'NIMI_GATEWAY_RUNTIME_RESPONSE_INVALID',
      'Runtime embedding returned no vectors.',
      502,
    );
  }
  return {
    object: 'list',
    model: normalized.model.id,
    data: embeddings.map((embedding, index) => ({
      object: 'embedding',
      embedding,
      index,
    })),
    usage: embeddingUsage(runtimeResult?.usage),
  };
}

export async function imageGenerationResponse(runtimeResult, responseFormat, config, artifactOrigin) {
  if (!isRecord(runtimeResult) || !Array.isArray(runtimeResult.artifacts)) {
    throw new OpenAICompatibleGatewayError(
      'NIMI_GATEWAY_RUNTIME_RESPONSE_INVALID',
      'Runtime image generation job returned no artifact list.',
      502,
    );
  }
  const created = typeof runtimeResult.createdUnixSeconds === 'number'
    ? runtimeResult.createdUnixSeconds
    : Math.floor(Date.now() / 1000);
  return {
    created,
    data: await Promise.all(
      runtimeResult.artifacts.map((artifact, index) => imageArtifactToOpenAIData(
        artifact,
        responseFormat,
        index,
        config,
        artifactOrigin,
      )),
    ),
  };
}

export async function resolveAudioBytes(runtimeResult, config) {
  if (isRecord(runtimeResult)) {
    if (runtimeResult.bytes instanceof Uint8Array && runtimeResult.bytes.length > 0) {
      return {
        bytes: runtimeResult.bytes,
        mimeType: normalizeText(runtimeResult.mimeType || runtimeResult.mime_type) || audioMimeType(runtimeResult.responseFormat),
      };
    }
    if (Array.isArray(runtimeResult.artifacts) && runtimeResult.artifacts.length > 0) {
      const artifact = runtimeResult.artifacts.find((item) => normalizeText(item?.mimeType || item?.mime_type).startsWith('audio/'))
        || runtimeResult.artifacts[0];
      const resolved = await resolveArtifactBytes(artifact, config, 0);
      return {
        bytes: resolved.bytes,
        mimeType: normalizeText(resolved.mimeType) || 'application/octet-stream',
      };
    }
  }
  throw new OpenAICompatibleGatewayError(
    'NIMI_GATEWAY_RUNTIME_RESPONSE_INVALID',
    'Runtime speech synthesis returned no readable audio bytes.',
    502,
  );
}

function chatStreamChunk(event, normalized) {
  if (isRecord(event) && Array.isArray(event.choices)) {
    return { ...event, model: normalized.model.id };
  }
  const delta = isRecord(event?.delta) ? event.delta : {};
  return {
    id: normalizeText(event?.id) || `chatcmpl-${normalized.requestId}`,
    object: 'chat.completion.chunk',
    created: unixSeconds(event),
    model: normalized.model.id,
    choices: [
      {
        index: 0,
        delta,
        finish_reason: event?.finishReason ?? event?.finish_reason ?? null,
      },
    ],
  };
}

async function imageArtifactToOpenAIData(artifact, responseFormat, index, config, artifactOrigin) {
  if (!isRecord(artifact)) {
    throw new OpenAICompatibleGatewayError(
      'NIMI_GATEWAY_RUNTIME_RESPONSE_INVALID',
      `Runtime image artifact at index ${index} must be an object.`,
      502,
    );
  }
  if (responseFormat === 'url') {
    const resolved = await resolveArtifactBytes(artifact, config, index);
    const artifactId = config.artifactIdGenerator();
    config.artifacts.set(artifactId, {
      bytes: resolved.bytes,
      mimeType: resolved.mimeType,
      expiresAtMs: config.nowMs() + config.artifactTtlMs,
    });
    return {
      url: new URL(`${OPENAI_PREFIX}/artifacts/${encodeURIComponent(artifactId)}`, artifactOrigin)
        .toString(),
    };
  }
  const { bytes } = await resolveArtifactBytes(artifact, config, index);
  return { b64_json: Buffer.from(bytes).toString('base64') };
}

async function resolveArtifactBytes(artifact, config, index) {
  const bytes = artifact.bytes;
  if (!(bytes instanceof Uint8Array) || bytes.length === 0) {
    const artifactId = normalizeText(artifact.artifactId || artifact.artifact_id || artifact.id);
    if (artifactId && typeof config.runtime.readArtifactBytes === 'function') {
      const resolved = await config.runtime.readArtifactBytes({ artifactId });
      if (isRecord(resolved) && resolved.bytes instanceof Uint8Array && resolved.bytes.length > 0) {
        return {
          bytes: resolved.bytes,
          mimeType: normalizeText(resolved.mimeType || resolved.mime_type || artifact.mimeType || artifact.mime_type)
            || 'application/octet-stream',
        };
      }
    }
    throw new OpenAICompatibleGatewayError(
      'NIMI_GATEWAY_IMAGE_BYTES_UNAVAILABLE',
      `Runtime image artifact at index ${index} did not include readable bytes.`,
      502,
    );
  }
  return {
    bytes,
    mimeType: normalizeText(artifact.mimeType || artifact.mime_type) || 'application/octet-stream',
  };
}

function omitResponseUndefined(value) {
  const out = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (nestedValue !== undefined) {
      out[key] = nestedValue;
    }
  }
  return out;
}
