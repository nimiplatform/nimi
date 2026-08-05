import { OpenAICompatibleGatewayError } from './errors.mjs';
import {
  AUDIO_SYNTHESIZE_CAPABILITY,
  IMAGE_GENERATE_CAPABILITY,
  TEXT_EMBED_CAPABILITY,
  TEXT_GENERATE_CAPABILITY,
  TEXT_STREAM_CAPABILITY,
  listSupportedImageGenerationModels,
  listSupportedOpenAIModels,
} from './model-inventory.mjs';
import {
  isRecord,
  modelNotFound,
  normalizeEmbeddingInput,
  normalizeOptionalImageSize,
  normalizeOptionalPositiveInteger,
  normalizeOptionalText,
  normalizePositiveInteger,
  normalizeResponseFormat,
  normalizeText,
  omitUndefined,
  optionalBoolean,
  optionalNumber,
  optionalRecord,
  optionalRecordArray,
  optionalStringArray,
  requireBodyText,
  unsupportedFeature,
  validateAllowedKeys,
} from './gateway-utils.mjs';

const SUPPORTED_IMAGE_GENERATION_KEYS = new Set([
  'model',
  'prompt',
  'n',
  'size',
  'response_format',
  'quality',
  'style',
  'user',
  'output_format',
  'output_compression',
  'background',
  'moderation',
  'partial_images',
  'stream',
]);

const SUPPORTED_CHAT_COMPLETION_KEYS = new Set([
  'model',
  'messages',
  'stream',
  'temperature',
  'top_p',
  'max_tokens',
  'max_completion_tokens',
  'presence_penalty',
  'frequency_penalty',
  'stop',
  'seed',
  'user',
  'metadata',
  'tools',
  'tool_choice',
  'response_format',
  'n',
  'logprobs',
  'top_logprobs',
  'stream_options',
  'parallel_tool_calls',
  'service_tier',
  'store',
  'reasoning_effort',
  'modalities',
  'audio',
  'prediction',
  'web_search_options',
]);

const SUPPORTED_RESPONSE_KEYS = new Set([
  'model',
  'input',
  'instructions',
  'stream',
  'tools',
  'tool_choice',
  'max_output_tokens',
  'temperature',
  'top_p',
  'user',
  'metadata',
  'store',
  'previous_response_id',
  'truncation',
  'include',
  'parallel_tool_calls',
  'reasoning',
  'text',
  'service_tier',
  'background',
]);

const SUPPORTED_EMBEDDING_KEYS = new Set([
  'model',
  'input',
  'encoding_format',
  'dimensions',
  'user',
]);

const SUPPORTED_SPEECH_KEYS = new Set([
  'model',
  'input',
  'voice',
  'response_format',
  'speed',
  'instructions',
  'stream_format',
]);

export async function normalizeImageGenerationRequest(body, config) {
  if (!isRecord(body)) {
    throw new OpenAICompatibleGatewayError(
      'NIMI_GATEWAY_REQUEST_INVALID',
      'images.generations request body must be a JSON object.',
    );
  }
  validateAllowedKeys(body, SUPPORTED_IMAGE_GENERATION_KEYS, 'images.generations');
  const modelId = normalizeText(body.model);
  const model = await resolveImageGenerationModel(config, modelId);
  if (!model) {
    throw new OpenAICompatibleGatewayError(
      'NIMI_GATEWAY_MODEL_NOT_FOUND',
      `OpenAI-compatible model alias is not configured: ${modelId || '<empty>'}`,
      404,
    );
  }
  const prompt = normalizeText(body.prompt);
  if (!prompt) {
    throw new OpenAICompatibleGatewayError(
      'NIMI_GATEWAY_PROMPT_REQUIRED',
      'images.generations prompt is required.',
    );
  }
  const count = normalizePositiveInteger(body.n ?? 1, 'images.generations.n');
  if (count !== 1) {
    throw new OpenAICompatibleGatewayError(
      'NIMI_GATEWAY_UNSUPPORTED_FEATURE',
      'images.generations.n greater than 1 is not supported by this gateway.',
    );
  }
  const responseFormat = normalizeResponseFormat(body.response_format);
  const stream = optionalBoolean(body.stream, 'images.generations.stream');
  if (stream === true) {
    throw unsupportedFeature('images.generations.stream', 'Runtime image generation streaming is not wired for this gateway.');
  }
  const scenario = {
    kind: 'image',
    prompt,
    count,
    size: normalizeOptionalImageSize(body.size),
    quality: normalizeOptionalText(body.quality),
    style: normalizeOptionalText(body.style),
    user: normalizeOptionalText(body.user),
    outputFormat: normalizeOptionalText(body.output_format),
    outputCompression: normalizeOptionalPositiveInteger(body.output_compression, 'images.generations.output_compression'),
    background: normalizeOptionalText(body.background),
    moderation: normalizeOptionalText(body.moderation),
    partialImages: normalizeOptionalPositiveInteger(body.partial_images, 'images.generations.partial_images'),
    responseFormat,
  };
  return {
    model,
    responseFormat,
    scenario: omitUndefined(scenario),
  };
}

export async function normalizeChatCompletionRequest(body, config) {
  if (!isRecord(body)) {
    throw new OpenAICompatibleGatewayError(
      'NIMI_GATEWAY_REQUEST_INVALID',
      'chat.completions request body must be a JSON object.',
    );
  }
  validateAllowedKeys(body, SUPPORTED_CHAT_COMPLETION_KEYS, 'chat.completions');
  const stream = optionalBoolean(body.stream, 'chat.completions.stream') === true;
  if (body.n !== undefined && normalizePositiveInteger(body.n, 'chat.completions.n') !== 1) {
    throw unsupportedFeature('chat.completions.n', 'only n=1 is supported by this gateway.');
  }
  if (body.logprobs !== undefined || body.top_logprobs !== undefined) {
    throw unsupportedFeature('chat.completions.logprobs', 'logprobs are not wired for this gateway.');
  }
  if (body.stream_options !== undefined) {
    throw unsupportedFeature('chat.completions.stream_options', 'stream options are not wired for this gateway.');
  }
  if (body.parallel_tool_calls !== undefined) {
    throw unsupportedFeature('chat.completions.parallel_tool_calls', 'parallel tool call semantics are not wired for this gateway.');
  }
  for (const unsupported of ['modalities', 'audio', 'prediction', 'web_search_options']) {
    if (body[unsupported] !== undefined) {
      throw unsupportedFeature(`chat.completions.${unsupported}`);
    }
  }
  const modelId = requireBodyText(body.model, 'chat.completions.model');
  const model = await resolveOpenAIModel(config, modelId, stream ? TEXT_STREAM_CAPABILITY : TEXT_GENERATE_CAPABILITY);
  if (!model) {
    throw modelNotFound(modelId);
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    throw new OpenAICompatibleGatewayError(
      'NIMI_GATEWAY_REQUEST_INVALID',
      'chat.completions.messages must be a non-empty array.',
    );
  }
  const requestId = config.idGenerator();
  const runtimeRequest = {
    appId: config.appId,
    subjectUserId: config.subjectUserId,
    requestId,
    idempotencyKey: `openai-compatible:${requestId}`,
    messages: body.messages,
    parameters: omitUndefined({
      temperature: optionalNumber(body.temperature, 'chat.completions.temperature'),
      topP: optionalNumber(body.top_p, 'chat.completions.top_p'),
      maxTokens: optionalNumber(body.max_completion_tokens ?? body.max_tokens, 'chat.completions.max_tokens'),
      presencePenalty: optionalNumber(body.presence_penalty, 'chat.completions.presence_penalty'),
      frequencyPenalty: optionalNumber(body.frequency_penalty, 'chat.completions.frequency_penalty'),
      stop: body.stop,
      seed: body.seed,
      user: normalizeOptionalText(body.user),
      metadata: optionalRecord(body.metadata, 'chat.completions.metadata'),
      serviceTier: normalizeOptionalText(body.service_tier),
      store: optionalBoolean(body.store, 'chat.completions.store'),
      reasoningEffort: normalizeOptionalText(body.reasoning_effort),
    }),
    tools: optionalRecordArray(body.tools, 'chat.completions.tools'),
    toolChoice: body.tool_choice,
    responseFormat: body.response_format,
    stream,
    labels: {
      gateway: 'openai-compatible',
      openaiEndpoint: 'chat.completions',
    },
  };
  return { model, requestId, stream, runtimeRequest };
}

export async function normalizeResponseRequest(body, config) {
  if (!isRecord(body)) {
    throw new OpenAICompatibleGatewayError(
      'NIMI_GATEWAY_REQUEST_INVALID',
      'responses request body must be a JSON object.',
    );
  }
  validateAllowedKeys(body, SUPPORTED_RESPONSE_KEYS, 'responses');
  const modelId = requireBodyText(body.model, 'responses.model');
  const model = await resolveOpenAIModel(config, modelId, TEXT_GENERATE_CAPABILITY);
  if (!model) {
    throw modelNotFound(modelId);
  }
  if (body.input === undefined || body.input === null || body.input === '') {
    throw new OpenAICompatibleGatewayError(
      'NIMI_GATEWAY_REQUEST_INVALID',
      'responses.input is required.',
    );
  }
  const requestId = config.idGenerator();
  return {
    model,
    requestId,
    stream: optionalBoolean(body.stream, 'responses.stream') === true,
    runtimeRequest: {
      appId: config.appId,
      subjectUserId: config.subjectUserId,
      requestId,
      idempotencyKey: `openai-compatible:${requestId}`,
      input: body.input,
      instructions: normalizeOptionalText(body.instructions),
      tools: optionalRecordArray(body.tools, 'responses.tools'),
      toolChoice: body.tool_choice,
      parameters: omitUndefined({
        maxOutputTokens: optionalNumber(body.max_output_tokens, 'responses.max_output_tokens'),
        temperature: optionalNumber(body.temperature, 'responses.temperature'),
        topP: optionalNumber(body.top_p, 'responses.top_p'),
        user: normalizeOptionalText(body.user),
        metadata: optionalRecord(body.metadata, 'responses.metadata'),
        previousResponseId: normalizeOptionalText(body.previous_response_id),
        truncation: normalizeOptionalText(body.truncation),
        include: optionalStringArray(body.include, 'responses.include'),
        parallelToolCalls: optionalBoolean(body.parallel_tool_calls, 'responses.parallel_tool_calls'),
        reasoning: optionalRecord(body.reasoning, 'responses.reasoning'),
        text: optionalRecord(body.text, 'responses.text'),
        serviceTier: normalizeOptionalText(body.service_tier),
        background: optionalBoolean(body.background, 'responses.background'),
        store: optionalBoolean(body.store, 'responses.store'),
      }),
      labels: {
        gateway: 'openai-compatible',
        openaiEndpoint: 'responses',
      },
    },
  };
}

export async function normalizeEmbeddingRequest(body, config) {
  if (!isRecord(body)) {
    throw new OpenAICompatibleGatewayError(
      'NIMI_GATEWAY_REQUEST_INVALID',
      'embeddings request body must be a JSON object.',
    );
  }
  validateAllowedKeys(body, SUPPORTED_EMBEDDING_KEYS, 'embeddings');
  const modelId = requireBodyText(body.model, 'embeddings.model');
  const model = await resolveOpenAIModel(config, modelId, TEXT_EMBED_CAPABILITY);
  if (!model) {
    throw modelNotFound(modelId);
  }
  const input = normalizeEmbeddingInput(body.input);
  const encodingFormat = normalizeOptionalText(body.encoding_format) || 'float';
  if (encodingFormat !== 'float') {
    throw unsupportedFeature('embeddings.encoding_format', 'only float embeddings are supported by this gateway.');
  }
  const requestId = config.idGenerator();
  return {
    model,
    requestId,
    runtimeRequest: {
      appId: config.appId,
      subjectUserId: config.subjectUserId,
      requestId,
      idempotencyKey: `openai-compatible:${requestId}`,
      input,
      encodingFormat,
      dimensions: normalizeOptionalPositiveInteger(body.dimensions, 'embeddings.dimensions'),
      user: normalizeOptionalText(body.user),
      labels: {
        gateway: 'openai-compatible',
        openaiEndpoint: 'embeddings',
      },
    },
  };
}

export async function normalizeSpeechRequest(body, config) {
  if (!isRecord(body)) {
    throw new OpenAICompatibleGatewayError(
      'NIMI_GATEWAY_REQUEST_INVALID',
      'audio.speech request body must be a JSON object.',
    );
  }
  validateAllowedKeys(body, SUPPORTED_SPEECH_KEYS, 'audio.speech');
  const modelId = requireBodyText(body.model, 'audio.speech.model');
  const model = await resolveOpenAIModel(config, modelId, AUDIO_SYNTHESIZE_CAPABILITY);
  if (!model) {
    throw modelNotFound(modelId);
  }
  const input = requireBodyText(body.input, 'audio.speech.input');
  const streamFormat = normalizeOptionalText(body.stream_format) || 'audio';
  if (streamFormat !== 'audio') {
    throw unsupportedFeature('audio.speech.stream_format', 'only stream_format=audio is supported by this gateway.');
  }
  const requestId = config.idGenerator();
  return {
    model,
    requestId,
    runtimeRequest: {
      appId: config.appId,
      subjectUserId: config.subjectUserId,
      requestId,
      idempotencyKey: `openai-compatible:${requestId}`,
      input,
      voice: requireBodyText(body.voice, 'audio.speech.voice'),
      responseFormat: normalizeOptionalText(body.response_format) || 'mp3',
      speed: optionalNumber(body.speed, 'audio.speech.speed'),
      instructions: normalizeOptionalText(body.instructions),
      streamFormat,
      labels: {
        gateway: 'openai-compatible',
        openaiEndpoint: 'audio.speech',
      },
    },
  };
}

async function resolveImageGenerationModel(config, modelId) {
  const models = await listSupportedImageGenerationModels(config);
  return models.find((model) => model.id === modelId);
}

async function resolveOpenAIModel(config, modelId, capability) {
  const models = await listSupportedOpenAIModels(config);
  return models.find((model) => model.id === modelId && model.capabilities.includes(capability));
}
