export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = unknown;
export type JsonObject = Record<string, unknown>;
export type JsonArray = JsonValue[];

export type RendererLogLevel = 'debug' | 'info' | 'warn' | 'error';
export type RendererLogMessage = `action:${string}` | `phase:${string}`;

export type RendererLogPayload = {
  level: RendererLogLevel;
  area: string;
  message: RendererLogMessage;
  traceId?: string;
  flowId?: string;
  source?: string;
  costMs?: number;
  details?: JsonObject;
};

export function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
