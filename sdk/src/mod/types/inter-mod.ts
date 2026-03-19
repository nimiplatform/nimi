import type { JsonObject, JsonValue } from '../../internal/utils.js';
import type { HookSourceType } from './shared';

export type RuntimeHookInterModFacade = {
  registerInterModHandlerV2: (input: {
    modId: string;
    sourceType?: HookSourceType;
    channel: string;
    handler: (
      payload: JsonObject,
      context?: JsonObject,
    ) => Promise<JsonValue> | JsonValue;
  }) => Promise<void>;
  unregisterInterModHandler: (input: {
    modId: string;
    channel?: string;
  }) => number;
  requestInterMod: (input: {
    fromModId: string;
    sourceType?: HookSourceType;
    toModId: string;
    channel: string;
    payload: JsonObject;
    context?: JsonObject;
  }) => Promise<JsonValue>;
  broadcastInterMod: (input: {
    fromModId: string;
    sourceType?: HookSourceType;
    channel: string;
    payload: JsonObject;
    context?: JsonObject;
  }) => Promise<{
    responses: Array<{ modId: string; result: JsonValue }>;
    errors: Array<{ modId: string; error: string }>;
  }>;
  discoverInterModChannels: () => Array<{ channel: string; providers: string[] }>;
};

export type HookInterModClient = {
  registerHandler: (input: {
    channel: string;
    handler: (
      payload: JsonObject,
      context?: JsonObject,
    ) => Promise<JsonValue> | JsonValue;
  }) => Promise<void>;
  unregisterHandler: (input?: { channel?: string }) => number;
  request: (input: {
    toModId: string;
    channel: string;
    payload: JsonObject;
    context?: JsonObject;
  }) => Promise<JsonValue>;
  broadcast: (input: {
    channel: string;
    payload: JsonObject;
    context?: JsonObject;
  }) => Promise<{
    responses: Array<{ modId: string; result: JsonValue }>;
    errors: Array<{ modId: string; error: string }>;
  }>;
  discover: () => Array<{ channel: string; providers: string[] }>;
};
