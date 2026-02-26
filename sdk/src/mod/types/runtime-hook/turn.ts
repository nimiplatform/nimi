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
      context: Record<string, unknown>,
    ) => Promise<Record<string, unknown>> | Record<string, unknown>;
  }) => Promise<void>;
  unregisterTurnHook: (input: {
    modId: string;
    point: TurnHookPoint;
  }) => number;
  invokeTurnHooks: (input: {
    point: TurnHookPoint;
    context: Record<string, unknown>;
    abortSignal?: AbortSignal;
  }) => Promise<{
    context: Record<string, unknown>;
    errors: Array<{ modId: string; point: TurnHookPoint; error: string }>;
    aborted: boolean;
  }>;
};

export type HookTurnClient = {
  register: (input: {
    point: TurnHookPoint;
    priority?: number;
    handler: (
      context: Record<string, unknown>,
    ) => Promise<Record<string, unknown>> | Record<string, unknown>;
  }) => Promise<void>;
  unregister: (input: {
    point: TurnHookPoint;
  }) => number;
  invoke: (input: {
    point: TurnHookPoint;
    context: Record<string, unknown>;
    abortSignal?: AbortSignal;
  }) => Promise<{
    context: Record<string, unknown>;
    errors: Array<{ modId: string; point: TurnHookPoint; error: string }>;
    aborted: boolean;
  }>;
};
