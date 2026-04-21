import type { AgentDataBundle } from '../driver/types.js';
import type { Live2DPluginApi } from '../live2d/plugin-api.js';

export type HandlerMeta = {
  description?: string;
  author?: string;
};

export type ActivityOrEventHandler = {
  meta?: HandlerMeta;
  execute(
    ctx: AgentDataBundle,
    live2d: Live2DPluginApi,
    options: { signal: AbortSignal },
  ): Promise<void>;
};

export type ContinuousHandler = {
  meta?: HandlerMeta;
  fps?: number;
  enabled?: boolean;
  update(ctx: AgentDataBundle, live2d: Live2DPluginApi): void;
};

export type RegisteredActivityHandler = {
  kind: 'activity';
  activityId: string;
  handler: ActivityOrEventHandler;
  sourcePath: string;
};

export type RegisteredEventHandler = {
  kind: 'event';
  eventName: string;
  handler: ActivityOrEventHandler;
  sourcePath: string;
};

export type RegisteredContinuousHandler = {
  kind: 'continuous';
  id: string;
  fps: number;
  handler: ContinuousHandler;
  sourcePath: string;
};

export type RegisteredHandler =
  | RegisteredActivityHandler
  | RegisteredEventHandler
  | RegisteredContinuousHandler;
