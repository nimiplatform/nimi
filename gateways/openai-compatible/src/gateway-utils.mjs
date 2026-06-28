import { OpenAICompatibleGatewayError } from './errors.mjs';

export const OPENAI_PREFIX = '/v1';

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

export function callRequiredRuntimeMethod(runtime, method, feature, request) {
  if (typeof runtime[method] !== 'function') {
    throw unsupportedFeature(feature, `Runtime method ${method} is not wired for this gateway.`);
  }
  return runtime[method](request);
}

export function unsupportedFeature(feature, detail) {
  return new OpenAICompatibleGatewayError(
    'NIMI_GATEWAY_UNSUPPORTED_FEATURE',
    detail ? `${feature}: ${detail}` : `${feature} is not supported by this gateway.`,
  );
}

export function modelNotFound(modelId) {
  return new OpenAICompatibleGatewayError(
    'NIMI_GATEWAY_MODEL_NOT_FOUND',
    `OpenAI-compatible model alias is not configured: ${modelId || '<empty>'}`,
    404,
  );
}

export function requireBodyText(value, label) {
  const text = normalizeText(value);
  if (!text) {
    throw new OpenAICompatibleGatewayError(
      'NIMI_GATEWAY_REQUEST_INVALID',
      `${label} is required.`,
    );
  }
  return text;
}

export function optionalNumber(value, label) {
  if (value === undefined || value === null || value === '') return undefined;
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new OpenAICompatibleGatewayError(
      'NIMI_GATEWAY_REQUEST_INVALID',
      `${label} must be a finite number.`,
    );
  }
  return number;
}

export function optionalBoolean(value, label) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'boolean') {
    throw new OpenAICompatibleGatewayError(
      'NIMI_GATEWAY_REQUEST_INVALID',
      `${label} must be a boolean.`,
    );
  }
  return value;
}

export function optionalRecord(value, label) {
  if (value === undefined || value === null) return undefined;
  if (!isRecord(value)) {
    throw new OpenAICompatibleGatewayError(
      'NIMI_GATEWAY_REQUEST_INVALID',
      `${label} must be an object.`,
    );
  }
  return value;
}

export function optionalRecordArray(value, label) {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    throw new OpenAICompatibleGatewayError(
      'NIMI_GATEWAY_REQUEST_INVALID',
      `${label} must be an array.`,
    );
  }
  for (const [index, item] of value.entries()) {
    if (!isRecord(item)) {
      throw new OpenAICompatibleGatewayError(
        'NIMI_GATEWAY_REQUEST_INVALID',
        `${label}[${index}] must be an object.`,
      );
    }
  }
  return value;
}

export function optionalStringArray(value, label) {
  if (value === undefined || value === null) return undefined;
  if (!Array.isArray(value)) {
    throw new OpenAICompatibleGatewayError(
      'NIMI_GATEWAY_REQUEST_INVALID',
      `${label} must be an array.`,
    );
  }
  return value.map((item, index) => {
    const text = normalizeText(item);
    if (!text) {
      throw new OpenAICompatibleGatewayError(
        'NIMI_GATEWAY_REQUEST_INVALID',
        `${label}[${index}] must be a non-empty string.`,
      );
    }
    return text;
  });
}

export function normalizeEmbeddingInput(value) {
  if (typeof value === 'string') {
    const text = value.trim();
    if (!text) {
      throw new OpenAICompatibleGatewayError(
        'NIMI_GATEWAY_REQUEST_INVALID',
        'embeddings.input must not be empty.',
      );
    }
    return [text];
  }
  if (Array.isArray(value)) {
    const items = value.map((item) => normalizeText(item)).filter(Boolean);
    if (items.length === 0) {
      throw new OpenAICompatibleGatewayError(
        'NIMI_GATEWAY_REQUEST_INVALID',
        'embeddings.input must include at least one non-empty string.',
      );
    }
    return items;
  }
  throw new OpenAICompatibleGatewayError(
    'NIMI_GATEWAY_REQUEST_INVALID',
    'embeddings.input must be a string or string array.',
  );
}

export function unixSeconds(value) {
  return typeof value?.createdUnixSeconds === 'number'
    ? value.createdUnixSeconds
    : Math.floor(Date.now() / 1000);
}

export function normalizeFinishReason(value) {
  const text = normalizeText(value);
  if (!text) return 'stop';
  if (text === 'tool-calls') return 'tool_calls';
  return text;
}

export function chatUsage(value) {
  if (!isRecord(value)) return undefined;
  return {
    prompt_tokens: Number(value.promptTokens ?? value.prompt_tokens ?? 0),
    completion_tokens: Number(value.completionTokens ?? value.completion_tokens ?? 0),
    total_tokens: Number(value.totalTokens ?? value.total_tokens ?? 0),
  };
}

export function responseUsage(value) {
  if (!isRecord(value)) return undefined;
  return {
    input_tokens: Number(value.inputTokens ?? value.input_tokens ?? value.promptTokens ?? 0),
    output_tokens: Number(value.outputTokens ?? value.output_tokens ?? value.completionTokens ?? 0),
    total_tokens: Number(value.totalTokens ?? value.total_tokens ?? 0),
  };
}

export function embeddingUsage(value) {
  if (!isRecord(value)) return undefined;
  return {
    prompt_tokens: Number(value.promptTokens ?? value.prompt_tokens ?? 0),
    total_tokens: Number(value.totalTokens ?? value.total_tokens ?? value.promptTokens ?? 0),
  };
}

export function audioMimeType(format) {
  const text = normalizeText(format);
  if (text === 'wav') return 'audio/wav';
  if (text === 'opus') return 'audio/opus';
  if (text === 'aac') return 'audio/aac';
  if (text === 'flac') return 'audio/flac';
  if (text === 'pcm') return 'audio/pcm';
  return 'audio/mpeg';
}

export function assertLoopbackRemoteAddress(context) {
  const remoteAddress = normalizeText(context.remoteAddress);
  if (!isLoopbackRemoteAddress(remoteAddress)) {
    throw new OpenAICompatibleGatewayError(
      'NIMI_GATEWAY_LOOPBACK_REQUIRED',
      'OpenAI-compatible gateway v1 requires verified loopback client evidence.',
      403,
    );
  }
}

export function assertAuthorized(request, config) {
  const header = request.headers.get('authorization') || '';
  const match = /^Bearer\s+(.+)$/iu.exec(header.trim());
  const token = match ? match[1].trim() : '';
  if (!token || !config.apiKeys.has(token)) {
    throw new OpenAICompatibleGatewayError(
      'NIMI_GATEWAY_AUTH_REQUIRED',
      'OpenAI-compatible gateway requires a valid local API key.',
      401,
    );
  }
}

export function resolveGatewayArtifactOrigin(config, requestUrl, context) {
  if (config.publicBaseUrl) {
    return config.publicBaseUrl;
  }
  const contextOrigin = normalizeOptionalText(context.gatewayOrigin || context.publicBaseUrl);
  if (contextOrigin) {
    return normalizePublicBaseUrl(contextOrigin);
  }
  return normalizePublicBaseUrl(originFromUrl(requestUrl));
}

export function normalizePublicBaseUrl(value) {
  const text = normalizeOptionalText(value);
  if (!text) return undefined;
  let url;
  try {
    url = new URL(text);
  } catch {
    throw invalidPublicBaseUrl();
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw invalidPublicBaseUrl();
  }
  if (!isLoopbackOriginHostname(url.hostname)) {
    throw invalidPublicBaseUrl();
  }
  return url.origin;
}

export function assertMethod(request, expected) {
  if (request.method.toUpperCase() !== expected) {
    throw new OpenAICompatibleGatewayError(
      'NIMI_GATEWAY_METHOD_NOT_ALLOWED',
      `Expected ${expected} for this OpenAI-compatible gateway route.`,
      405,
    );
  }
}

export async function readJsonBody(request) {
  const contentType = request.headers.get('content-type') || '';
  if (contentType && !contentType.toLowerCase().includes('application/json')) {
    throw new OpenAICompatibleGatewayError(
      'NIMI_GATEWAY_CONTENT_TYPE_INVALID',
      'OpenAI-compatible gateway requests must use application/json.',
    );
  }
  try {
    return await request.json();
  } catch {
    throw new OpenAICompatibleGatewayError(
      'NIMI_GATEWAY_JSON_INVALID',
      'OpenAI-compatible gateway request body must be valid JSON.',
    );
  }
}

export function normalizeOpenAIPath(pathname) {
  if (pathname === '/healthz') return pathname;
  if (pathname === OPENAI_PREFIX) return '/';
  if (pathname.startsWith(`${OPENAI_PREFIX}/`)) {
    return pathname.slice(OPENAI_PREFIX.length);
  }
  return pathname;
}

export function validateAllowedKeys(value, keys, path) {
  for (const key of Object.keys(value)) {
    if (!keys.has(key)) {
      throw new OpenAICompatibleGatewayError(
        'NIMI_GATEWAY_UNSUPPORTED_FEATURE',
        `${path}.${key} is not supported by this gateway.`,
      );
    }
  }
}

export function normalizeResponseFormat(value) {
  const text = normalizeText(value);
  if (!text) return 'url';
  if (text === 'url' || text === 'b64_json') return text;
  throw new OpenAICompatibleGatewayError(
    'NIMI_GATEWAY_UNSUPPORTED_FEATURE',
    `images.generations.response_format ${text} is not supported by this gateway.`,
  );
}

export function normalizeOptionalImageSize(value) {
  const text = normalizeOptionalText(value);
  if (!text) return undefined;
  if (!/^[1-9]\d{1,4}x[1-9]\d{1,4}$/u.test(text)) {
    throw new OpenAICompatibleGatewayError(
      'NIMI_GATEWAY_REQUEST_INVALID',
      'images.generations.size must use WIDTHxHEIGHT format.',
    );
  }
  return text;
}

export function normalizePositiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) {
    throw new OpenAICompatibleGatewayError(
      'NIMI_GATEWAY_REQUEST_INVALID',
      `${label} must be a positive integer.`,
    );
  }
  return number;
}

export function normalizeOptionalPositiveInteger(value, label) {
  if (value === undefined || value === null || value === '') return undefined;
  return normalizePositiveInteger(value, label);
}

export function normalizeOptionalText(value) {
  const text = normalizeText(value);
  return text || undefined;
}

export function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : '';
}

export function normalizeCapabilityList(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => normalizeText(item).toLowerCase()).filter(Boolean))];
}

export function omitUndefined(value) {
  const out = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    if (nestedValue !== undefined) {
      out[key] = nestedValue;
    }
  }
  return out;
}

export function jsonResponse(status, body) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

export function errorResponse(error) {
  if (error instanceof OpenAICompatibleGatewayError) {
    return jsonResponse(error.status, {
      error: {
        message: error.message,
        type: error.type,
        code: error.code,
      },
    });
  }
  return jsonResponse(500, {
    error: {
      message: 'OpenAI-compatible gateway request failed.',
      type: 'server_error',
      code: 'NIMI_GATEWAY_INTERNAL_ERROR',
    },
  });
}

export function isRecord(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isLoopbackRemoteAddress(remoteAddress) {
  return remoteAddress === '127.0.0.1'
    || remoteAddress === '::1'
    || remoteAddress === '::ffff:127.0.0.1';
}

function originFromUrl(value) {
  try {
    return new URL(value).origin;
  } catch {
    throw invalidPublicBaseUrl();
  }
}

function invalidPublicBaseUrl() {
  return new OpenAICompatibleGatewayError(
    'NIMI_GATEWAY_PUBLIC_BASE_URL_INVALID',
    'OpenAI-compatible gateway v1 artifact URLs require a numeric loopback origin.',
  );
}

function isLoopbackOriginHostname(value) {
  const hostname = normalizeText(value).replace(/^\[|\]$/gu, '');
  return hostname === '127.0.0.1' || hostname === '::1';
}
