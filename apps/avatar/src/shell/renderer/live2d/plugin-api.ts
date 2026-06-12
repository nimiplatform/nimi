import { createEventBus, type EventBus } from '../infra/event-bus.js';
import type { PlayMotionOptions } from '@nimiplatform/kit/features/avatar/headless';

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

export function createCommandBus(): Live2DCommandBus {
  return createEventBus<{ command: Live2DCommandEvent }>();
}
