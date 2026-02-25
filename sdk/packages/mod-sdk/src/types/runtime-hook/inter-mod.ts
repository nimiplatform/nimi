import type { HookSourceType } from './shared';

export type RuntimeHookInterModFacade = {
  registerInterModHandlerV2: (input: {
    modId: string;
    sourceType?: HookSourceType;
    channel: string;
    handler: (
      payload: Record<string, unknown>,
      context?: Record<string, unknown>,
    ) => Promise<unknown> | unknown;
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
    payload: Record<string, unknown>;
    context?: Record<string, unknown>;
  }) => Promise<unknown>;
  broadcastInterMod: (input: {
    fromModId: string;
    sourceType?: HookSourceType;
    channel: string;
    payload: Record<string, unknown>;
    context?: Record<string, unknown>;
  }) => Promise<{
    responses: Array<{ modId: string; result: unknown }>;
    errors: Array<{ modId: string; error: string }>;
  }>;
  discoverInterModChannels: () => Array<{ channel: string; providers: string[] }>;
};

export type HookInterModClient = {
  registerHandler: (input: {
    channel: string;
    handler: (
      payload: Record<string, unknown>,
      context?: Record<string, unknown>,
    ) => Promise<unknown> | unknown;
  }) => Promise<void>;
  unregisterHandler: (input?: { channel?: string }) => number;
  request: (input: {
    toModId: string;
    channel: string;
    payload: Record<string, unknown>;
    context?: Record<string, unknown>;
  }) => Promise<unknown>;
  broadcast: (input: {
    channel: string;
    payload: Record<string, unknown>;
    context?: Record<string, unknown>;
  }) => Promise<{
    responses: Array<{ modId: string; result: unknown }>;
    errors: Array<{ modId: string; error: string }>;
  }>;
  discover: () => Array<{ channel: string; providers: string[] }>;
};
