import type { ProviderType } from '../types';

export type LlmAdapterErrorCode =
  | 'MODEL_NOT_FOUND'
  | 'PROVIDER_UNREACHABLE'
  | 'AUTH_FAILED'
  | 'RATE_LIMITED'
  | 'CONTEXT_OVERFLOW'
  | 'TIMEOUT'
  | 'UNKNOWN';

export type LlmAdapterError = {
  code: LlmAdapterErrorCode;
  message: string;
  provider?: ProviderType | string;
  model?: string;
  status?: number;
  retryAfterMs?: number;
  cause?: unknown;
};

export const OVERFLOW_PATTERNS: RegExp[] = [
  /prompt is too long/i,
  /input is too long for requested model/i,
  /exceeds the context window/i,
  /input token count.*exceeds the maximum/i,
  /maximum prompt length is \d+/i,
  /reduce the length of the messages/i,
  /maximum context length is \d+ tokens/i,
  /context[_ ]length[_ ]exceeded/i,
  /context.*(overflow|length|limit|exceed|too.?long)/i,
];

export const RATE_LIMIT_PATTERNS: RegExp[] = [/rate.?limit/i, /too many requests/i, /quota/i];
export const TIMEOUT_PATTERNS: RegExp[] = [/timeout/i, /ETIMEDOUT/i, /ECONNRESET/i, /ECONNREFUSED/i];
export const MODEL_NOT_FOUND_PATTERNS: RegExp[] = [/model.*(not.?found|does.?not.?exist|unknown)/i];
