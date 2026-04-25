import type { AgentDataBundle } from '../driver/types.js';
import type { EmbodimentProjectionApi } from './embodiment-projection-api.js';

export type HandlerMeta = {
  description?: string;
  author?: string;
};

export type ActivityOrEventHandler = {
  meta?: HandlerMeta;
  dispose?(): void;
  execute(
    ctx: AgentDataBundle,
    projection: EmbodimentProjectionApi,
    options: { signal: AbortSignal },
  ): Promise<void>;
};

export type ContinuousHandler = {
  meta?: HandlerMeta;
  fps?: number;
  enabled?: boolean;
  dispose?(): void;
  update(ctx: AgentDataBundle, projection: EmbodimentProjectionApi): Promise<void> | void;
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
