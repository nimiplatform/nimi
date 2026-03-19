import type { JsonObject, JsonValue } from '../../internal/utils.js';
import type { HookSourceType } from './shared';

export type RuntimeHookEventFacade = {
  subscribeEvent: (input: {
    modId: string;
    sourceType?: HookSourceType;
    topic: string;
    handler: (payload: JsonObject) => Promise<JsonValue> | JsonValue;
    once?: boolean;
  }) => Promise<void>;
  unsubscribeEvent: (input: {
    modId: string;
    topic?: string;
  }) => number;
  publishEvent: (input: {
    modId: string;
    sourceType?: HookSourceType;
    topic: string;
    payload: JsonObject;
  }) => Promise<{ deliveredCount: number; failedCount: number; reasonCodes: string[] }>;
  listEventTopics: () => string[];
};

export type HookEventClient = {
  subscribe: (input: {
    topic: string;
    handler: (payload: JsonObject) => Promise<JsonValue> | JsonValue;
    once?: boolean;
  }) => Promise<void>;
  unsubscribe: (input?: { topic?: string }) => number;
  publish: (input: {
    topic: string;
    payload: JsonObject;
  }) => Promise<{ deliveredCount: number; failedCount: number; reasonCodes: string[] }>;
  listTopics: () => string[];
};
