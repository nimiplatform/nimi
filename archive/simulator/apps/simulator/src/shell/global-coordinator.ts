/**
 * Shell global-effect coordinator: exactly one physical listener per
 * admitted listener family and target, deterministic subscriber order, and
 * session-wide subscriber dispatch.
 *
 * Authority: P-SIM-017/018; tables/simulator-listener-families.yaml.
 * Apps and Kit instances never mutate these
 * globals independently; every lease releases exactly once.
 */

import {
  simulatorError,
  simulatorFail,
  simulatorOk,
  type SimulatorResult,
} from '../state-engine/errors.ts';

export interface SimulatorListenerFamily {
  readonly id: string;
  readonly eventTarget: 'document' | 'window';
  readonly eventTypes: readonly string[];
  readonly capture: boolean;
  readonly passive: boolean;
  readonly owner: 'simulator-bootstrap' | 'simulator-shell' | 'kit-coordinator';
}

export interface SimulatorListenerTarget {
  addEventListener(
    type: string,
    listener: (event: unknown) => void,
    options?: { capture?: boolean; passive?: boolean },
  ): void;
  removeEventListener(
    type: string,
    listener: (event: unknown) => void,
    options?: { capture?: boolean },
  ): void;
}

export interface SimulatorCoordinatorTargets {
  readonly window: SimulatorListenerTarget;
  readonly document: SimulatorListenerTarget;
}

export interface SimulatorListenerEffectScope {
  run<T>(
    owner: 'simulator-shell' | 'kit-coordinator',
    phase: 'instance-lifecycle',
    callback: () => T,
  ): T;
}

function physicalListenerOwner(
  familyOwner: SimulatorListenerFamily['owner'],
): 'simulator-shell' | 'kit-coordinator' {
  return familyOwner === 'kit-coordinator' ? 'kit-coordinator' : 'simulator-shell';
}

interface FamilyState {
  readonly family: SimulatorListenerFamily;
  readonly listeners: { type: string; handler: (event: unknown) => void }[];
  subscribers: { sequence: number; handler: (event: unknown) => void }[];
  installed: boolean;
}

export interface SimulatorGlobalCoordinator {
  /**
   * Subscribes to an admitted listener family. Exactly one physical listener
   * per family and target exists; the last unsubscribe removes it.
   */
  subscribeFamily(
    familyId: string,
    handler: (event: unknown) => void,
  ): SimulatorResult<() => void>;
  familyListenerCount(familyId: string): number;
  totalInstalledListeners(): number;
}

export function createGlobalListenerCoordinator(
  families: readonly SimulatorListenerFamily[],
  targets: SimulatorCoordinatorTargets,
  effectScope: SimulatorListenerEffectScope,
): SimulatorGlobalCoordinator {
  const byId = new Map<string, FamilyState>();
  let subscriptionSequence = 0;

  function install(state: FamilyState): void {
    const target = state.family.eventTarget === 'document' ? targets.document : targets.window;
    effectScope.run(physicalListenerOwner(state.family.owner), 'instance-lifecycle', () => {
      for (const eventType of state.family.eventTypes) {
        const handler = (event: unknown): void => {
          const ordered = state.subscribers
            .slice()
            .sort((left, right) => left.sequence - right.sequence);
          for (const subscriber of ordered) subscriber.handler(event);
        };
        target.addEventListener(eventType, handler, {
          capture: state.family.capture,
          passive: state.family.passive,
        });
        state.listeners.push({ type: eventType, handler });
      }
    });
    state.installed = true;
  }

  function uninstall(state: FamilyState): void {
    const target = state.family.eventTarget === 'document' ? targets.document : targets.window;
    effectScope.run(physicalListenerOwner(state.family.owner), 'instance-lifecycle', () => {
      for (const { type, handler } of state.listeners) {
        target.removeEventListener(type, handler, { capture: state.family.capture });
      }
    });
    state.listeners.length = 0;
    state.installed = false;
  }

  return {
    subscribeFamily(familyId, handler) {
      const family = families.find((entry) => entry.id === familyId);
      if (!family) {
        return simulatorFail(simulatorError('SIMULATOR_EFFECT_FORBIDDEN'));
      }
      let state = byId.get(familyId);
      if (!state) {
        state = { family, listeners: [], subscribers: [], installed: false };
        byId.set(familyId, state);
      }
      if (!state.installed) install(state);
      subscriptionSequence += 1;
      const subscriber = { sequence: subscriptionSequence, handler };
      state.subscribers.push(subscriber);
      return simulatorOk(() => {
        state.subscribers = state.subscribers.filter((entry) => entry !== subscriber);
        if (state.subscribers.length === 0) uninstall(state);
      });
    },
    familyListenerCount(familyId) {
      const state = byId.get(familyId);
      return state?.installed ? state.listeners.length : 0;
    },
    totalInstalledListeners() {
      let total = 0;
      for (const state of byId.values()) total += state.listeners.length;
      return total;
    },
  };
}
