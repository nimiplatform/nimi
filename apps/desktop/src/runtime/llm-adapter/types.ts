import { z } from 'zod';

export const modelCapabilitySchema = z.enum([
  'chat',
  'chat-vision',
  'embedding',
  'image',
  'tts',
  'stt',
  'code',
  'rerank',
]);
export type ModelCapability = z.infer<typeof modelCapabilitySchema>;

export const healthStatusSchema = z.enum(['healthy', 'unreachable', 'unsupported', 'unknown']);
export type ModelHealthStatus = z.infer<typeof healthStatusSchema>;

export type ChatMessage = {
  role: string;
  content: unknown;
  [key: string]: unknown;
};

export type NormalizedUsage = {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
  total: number;
};

export type LlmStreamEvent = {
  type: 'text_delta' | 'tool_use_delta' | 'metadata_delta' | 'done' | 'error';
  textDelta?: string;
  toolDelta?: unknown;
  latencyMs?: number;
  usage?: NormalizedUsage;
  raw?: unknown;
};
