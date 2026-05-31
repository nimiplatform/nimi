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

export type {
  RendererLogLevel,
  RendererLogMessage,
  RendererLogPayload,
} from '@nimiplatform/kit/telemetry';

export type RuntimeBridgeStructuredError = {
  code?: string;
  reasonCode?: string;
  actionHint?: string;
  traceId?: string;
  retryable?: boolean;
  message?: string;
  details?: JsonObject;
};
