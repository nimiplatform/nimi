import { createEventBus, type EventBus } from '../infra/event-bus.js';

export type MotionPriority = 'low' | 'normal' | 'high';

export type PlayMotionOptions = {
  priority?: MotionPriority;
  loop?: boolean;
  fadeIn?: number;
  fadeOut?: number;
};

export type ModelBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type Live2DCommandEvent =
  | { kind: 'motion'; group: string; options: PlayMotionOptions }
  | { kind: 'motion-stop' }
  | { kind: 'parameter'; id: string; value: number; weight: number }
  | { kind: 'parameter-add'; id: string; delta: number }
  | { kind: 'expression'; id: string }
  | { kind: 'expression-clear' }
  | { kind: 'pose'; group: string; loop: boolean }
  | { kind: 'pose-clear' };

export type Live2DCommandBus = EventBus<{ command: Live2DCommandEvent }>;

export interface Live2DPluginApi {
  playMotion(group: string, opts?: PlayMotionOptions): Promise<void>;
  stopMotion(): void;
  setParameter(id: string, value: number, weight?: number): void;
  getParameter(id: string): number;
  addParameter(id: string, delta: number): void;
  setExpression(id: string): Promise<void>;
  clearExpression(): void;
  setPose(group: string, loop?: boolean): void;
  clearPose(): void;
  wait(ms: number): Promise<void>;
  getModelBounds(): ModelBounds;
}

export type PluginApiContext = {
  bounds: () => ModelBounds;
  parameterState: Map<string, number>;
  commandBus: Live2DCommandBus;
};

export function createLive2DPluginApi(context: PluginApiContext): Live2DPluginApi {
  return {
    async playMotion(group, opts = {}) {
      context.commandBus.emit('command', { kind: 'motion', group, options: opts });
    },
    stopMotion() {
      context.commandBus.emit('command', { kind: 'motion-stop' });
    },
    setParameter(id, value, weight = 1) {
      context.parameterState.set(id, value);
      context.commandBus.emit('command', { kind: 'parameter', id, value, weight });
    },
    getParameter(id) {
      return context.parameterState.get(id) ?? 0;
    },
    addParameter(id, delta) {
      const next = (context.parameterState.get(id) ?? 0) + delta;
      context.parameterState.set(id, next);
      context.commandBus.emit('command', { kind: 'parameter-add', id, delta });
    },
    async setExpression(id) {
      context.commandBus.emit('command', { kind: 'expression', id });
    },
    clearExpression() {
      context.commandBus.emit('command', { kind: 'expression-clear' });
    },
    setPose(group, loop = false) {
      context.commandBus.emit('command', { kind: 'pose', group, loop });
    },
    clearPose() {
      context.commandBus.emit('command', { kind: 'pose-clear' });
    },
    async wait(ms) {
      await new Promise<void>((resolve) => globalThis.setTimeout(resolve, ms));
    },
    getModelBounds() {
      return context.bounds();
    },
  };
}

export function createCommandBus(): Live2DCommandBus {
  return createEventBus<{ command: Live2DCommandEvent }>();
}
