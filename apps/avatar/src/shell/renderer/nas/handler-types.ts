import type { AgentDataBundle } from '../driver/types.js';
import type { BackendProjection, Live2DBackendExtension } from '../carrier/backend-branch.js';

export type HandlerMeta = {
  description?: string;
  author?: string;
};

/** Retired creator capability sentinel. Handler source that declares
 *  `live2d-extension` is rejected during sandbox/registry loading; creator
 *  code must use the authority-owned projection cue surface instead. */
export type NasHandlerCapability = 'live2d-extension';

/** Internal backend channel used by the sandbox projection translator.
 *  This object is not exposed to creator-authored handler source. */
export type NasHandlerExtension = {
  live2d?: Live2DBackendExtension;
};

export type ActivityOrEventHandler = {
  meta?: HandlerMeta;
  /** Retired capability declaration list. Any creator-authored requires value
   *  is rejected fail-closed by the registry. */
  requires?: readonly NasHandlerCapability[];
  dispose?(): void;
  execute(
    ctx: AgentDataBundle,
    projection: BackendProjection,
    options: {
      signal: AbortSignal;
      /** Internal backend extension surface for sandbox translation only.
       *  Creator code receives the cue projection API, not this object. */
      extension?: NasHandlerExtension;
    },
  ): Promise<void>;
};

export type ContinuousHandler = {
  meta?: HandlerMeta;
  fps?: number;
  enabled?: boolean;
  requires?: readonly NasHandlerCapability[];
  dispose?(): void;
  update(
    ctx: AgentDataBundle,
    projection: BackendProjection,
    options?: { extension?: NasHandlerExtension },
  ): Promise<void> | void;
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
