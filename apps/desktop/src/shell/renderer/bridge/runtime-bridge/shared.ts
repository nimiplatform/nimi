import type { RuntimeLogMessage } from '@runtime/telemetry/logger';
import type { JsonObject } from '@nimiplatform/kit/shell/renderer/bridge';
export type {
  JsonPrimitive,
  JsonValue,
  JsonObject,
} from '@nimiplatform/kit/shell/renderer/bridge';
export {
  assertRecord,
  isJsonObject,
  parseOptionalJsonObject,
  parseOptionalNumber,
  parseOptionalString,
  parseRequiredString,
} from '@nimiplatform/kit/shell/renderer/bridge';

export type JsonArray = unknown[];

export type RendererLogLevel = 'debug' | 'info' | 'warn' | 'error';
export type RendererLogMessage = RuntimeLogMessage;

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

export type RuntimeBridgeStructuredError = {
  code?: string;
  reasonCode?: string;
  actionHint?: string;
  traceId?: string;
  retryable?: boolean;
  message?: string;
  details?: JsonObject;
};
