import type { JsonObject, JsonValue } from '../../internal/utils.js';
import type { HookSourceType } from './shared';

export type RuntimeHookDataFacade = {
  queryData: (input: {
    modId: string;
    sourceType?: HookSourceType;
    capability: string;
    query: JsonObject;
  }) => Promise<JsonValue>;
  registerDataProvider: (input: {
    modId: string;
    sourceType?: HookSourceType;
    capability: string;
    handler: (query: JsonObject) => Promise<JsonValue> | JsonValue;
  }) => Promise<void>;
  unregisterDataProvider: (input: {
    modId: string;
    capability: string;
  }) => boolean;
  listDataCapabilities: () => string[];
};

export type HookDataClient = {
  query: (input: {
    capability: string;
    query: JsonObject;
  }) => Promise<JsonValue>;
  register: (input: {
    capability: string;
    handler: (query: JsonObject) => Promise<JsonValue> | JsonValue;
  }) => Promise<void>;
  unregister: (input: {
    capability: string;
  }) => boolean;
  listCapabilities: () => string[];
};
