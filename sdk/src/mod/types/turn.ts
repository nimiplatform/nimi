import type { JsonObject } from '../../internal/utils.js';
import type {
  HookSourceType,
  TurnHookPoint,
} from './shared';

export type RuntimeHookTurnFacade = {
  registerTurnHookV2: (input: {
    modId: string;
    sourceType?: HookSourceType;
    point: TurnHookPoint;
    priority?: number;
    handler: (
      context: JsonObject,
    ) => Promise<JsonObject> | JsonObject;
  }) => Promise<void>;
  unregisterTurnHook: (input: {
    modId: string;
    point: TurnHookPoint;
  }) => number;
  invokeTurnHooks: (input: {
    point: TurnHookPoint;
    context: JsonObject;
    abortSignal?: AbortSignal;
  }) => Promise<{
    context: JsonObject;
    errors: Array<{ modId: string; point: TurnHookPoint; error: string }>;
    aborted: boolean;
  }>;
};

export type HookTurnClient = {
  register: (input: {
    point: TurnHookPoint;
    priority?: number;
    handler: (
      context: JsonObject,
    ) => Promise<JsonObject> | JsonObject;
  }) => Promise<void>;
  unregister: (input: {
    point: TurnHookPoint;
  }) => number;
  invoke: (input: {
    point: TurnHookPoint;
    context: JsonObject;
    abortSignal?: AbortSignal;
  }) => Promise<{
    context: JsonObject;
    errors: Array<{ modId: string; point: TurnHookPoint; error: string }>;
    aborted: boolean;
  }>;
};
