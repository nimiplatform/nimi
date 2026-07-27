/**
 * Surface readiness barrier: one typed App candidate through State Engine
 * quiescence, React commit, two browser animation frames, and exact semantic
 * markers on the assigned visible roots.
 *
 * Authority: P-SIM-014;
 * tables/simulator-state-engine-policy.yaml `readiness`.
 * A skeleton, loading fallback, off-root marker, hidden simulation
 * disclosure, or pending lifecycle/reset can never become ready.
 */

import {
  simulatorError,
  simulatorFail,
  simulatorOk,
  type SimulatorResult,
} from '../state-engine/errors.ts';
import type { JsonValue } from '../state-engine/json-value.ts';
import type { SimulatorStateEngine } from '../state-engine/engine.ts';

export type SimulatorReadinessState =
  | 'idle'
  | 'signaled'
  | 'waiting-quiescence'
  | 'waiting-commit'
  | 'waiting-render'
  | 'usable'
  | 'cancelled'
  | 'failed';

export type SimulatorReadinessTerminalReason =
  | 'qualified'
  | 'dispose'
  | 'reset'
  | 'stale-epoch'
  | 'state-change'
  | 'instance-failure'
  | 'module-failure'
  | 'session-failure'
  | 'semantic-mismatch'
  | 'render-barrier-failed';

export interface SimulatorReadinessTerminal {
  readonly state: 'usable' | 'cancelled' | 'failed';
  readonly reason: SimulatorReadinessTerminalReason;
  readonly markedAtLogicalTime: number | null;
}

export interface SimulatorReadinessDeclaration {
  readonly contractId: string;
  readonly surfaceId: string;
  readonly rootContentSemanticId: string;
  readonly primaryControl: {
    readonly semanticId: string;
    readonly ariaRole: string;
    readonly accessibleName: string;
  };
}

export interface SimulatorReadinessExpectation {
  readonly contractId: string;
  readonly rootContentSemanticId: string;
  readonly primaryControl: {
    readonly semanticId: string;
    readonly ariaRole: string;
    readonly accessibleName: string;
  };
  readonly projectionPredicateId: string;
  readonly blockingStatePredicateId: string;
}

/**
 * Browser observation port. The browser shell wires real React commit
 * tracking, rAF, and assigned-root semantic checks; tests wire deterministic
 * fixtures.
 */
export interface SimulatorReadinessBrowserPort {
  /** Returns the current React commit token for one assigned App surface. */
  currentCommitToken(input: { readonly instanceId: string; readonly surfaceId: string }): number;
  /** Resolves with the first commit token after the scoped candidate floor. */
  awaitCommit(input: {
    readonly instanceId: string;
    readonly surfaceId: string;
    readonly sinceToken: number;
    readonly signal: AbortSignal;
  }): Promise<number>;
  /** One animation frame; resolves with the frame's sequence number. */
  nextAnimationFrame(signal: AbortSignal): Promise<number>;
  /**
   * Semantic marker check scoped to the assigned renderer/overlay roots:
   * exact root-content semantic ID, primary-control semantic ID/ARIA
   * role/accessible name, visibility, and enabled/focusable state.
   */
  checkSemanticMarkers(input: {
    readonly instanceId: string;
    readonly surfaceId: string;
    readonly expectation: SimulatorReadinessExpectation;
    readonly signal: AbortSignal;
  }): Promise<{ readonly ok: boolean }>;
}

export interface SimulatorReadinessBarrierOptions {
  readonly engine: SimulatorStateEngine;
  readonly instanceId: string;
  readonly surfaceId: string;
  readonly epoch: number;
  readonly declaration: SimulatorReadinessDeclaration;
  readonly expectation: SimulatorReadinessExpectation;
  readonly browser: SimulatorReadinessBrowserPort;
  /** Scenario predicate over the committed projection. */
  readonly projectionPredicate: (projection: JsonValue) => boolean;
  /** True while a blocking coordinator lease exists. */
  readonly blockingPredicate: () => boolean;
  readonly projection: () => JsonValue;
  readonly simulationDisclosureVisible: () => boolean;
  readonly onStateChange?: (state: SimulatorReadinessState) => void;
}

export interface SimulatorReadinessBarrier {
  readonly readinessId: string | null;
  readonly state: SimulatorReadinessState;
  signalCandidate(input: { readonly contractId: string }): SimulatorResult<{ readonly signaled: boolean }>;
  cancel(reason: SimulatorReadinessTerminalReason): void;
  /** Invalidates immediately but defers observable completion to reset ordering. */
  beginResetCancellation(): { readonly settle: () => void } | null;
  readonly completion: Promise<SimulatorReadinessTerminal>;
}

const CANCELLED = Symbol('simulator-readiness-cancelled');
const OBSERVATION_FAILED = Symbol('simulator-readiness-observation-failed');

interface ReadinessPublication {
  readonly terminalState: 'usable' | 'failed';
  readonly reason: SimulatorReadinessTerminalReason;
  readonly markedAtLogicalTime: number | null;
  readonly expectedRevision: number;
  observed: boolean;
}

export function createReadinessBarrier(options: SimulatorReadinessBarrierOptions): SimulatorReadinessBarrier {
  const { engine } = options;
  let state: SimulatorReadinessState = 'idle';
  let readinessId: string | null = null;
  let candidateCommitFloor: number | null = null;
  let reservation: {
    settle(outcome: JsonValue): SimulatorResult<{ readonly accepted: boolean }>;
    cancel(reason: 'caller' | 'dispose' | 'reset'): SimulatorResult<{ readonly cancelled: boolean }>;
  } | null = null;
  let publication: ReadinessPublication | null = null;
  let unsubscribeState: (() => void) | null = null;
  const cancelListeners = new Set<() => void>();
  const readinessAbort = new AbortController();
  let resolveCompletion: (terminal: SimulatorReadinessTerminal) => void = () => undefined;
  let completionSettled = false;
  const completion = new Promise<SimulatorReadinessTerminal>((resolve) => {
    resolveCompletion = resolve;
  });

  function stopStateWatch(): void {
    unsubscribeState?.();
    unsubscribeState = null;
  }

  function stopObservations(): void {
    stopStateWatch();
    readinessAbort.abort();
    for (const listener of cancelListeners) listener();
    cancelListeners.clear();
  }

  function settleCompletion(terminalState: 'usable' | 'cancelled' | 'failed', reason: SimulatorReadinessTerminalReason, markedAtLogicalTime: number | null): void {
    if (completionSettled) return;
    completionSettled = true;
    stopObservations();
    resolveCompletion(Object.freeze({ state: terminalState, reason, markedAtLogicalTime }));
  }

  function isCurrentReadyInstance(): boolean {
    if (engine.epoch !== options.epoch) return false;
    const instance = engine.getCommitted().instance(options.instanceId);
    return Boolean(
      instance
      && instance.surfaceId === options.surfaceId
      && (instance.status === 'inactive' || instance.status === 'active'),
    );
  }

  function publicationMatches(candidate: ReadinessPublication): boolean {
    const shell = engine.getCommitted().partitions.shell as Record<string, JsonValue>;
    const readiness = shell.readiness as Record<string, JsonValue> | undefined;
    const entry = readiness?.[readinessId as string] as Record<string, JsonValue> | undefined;
    return Boolean(
      entry
      && entry.surfaceId === options.surfaceId
      && entry.instanceId === options.instanceId
      && entry.state === candidate.terminalState
      && entry.reason === candidate.reason
      && entry.markedAtLogicalTime === candidate.markedAtLogicalTime,
    );
  }

  function failPublicationIntegrity(): void {
    publication = null;
    reservation = null;
    engine.terminateIntegrity(simulatorError('SIMULATOR_INTEGRITY_FAILURE', {
      instanceId: options.instanceId,
    }));
    if (!completionSettled) {
      state = 'cancelled';
      options.onStateChange?.(state);
      settleCompletion('cancelled', 'session-failure', null);
    }
  }

  function settlePublishedTerminal(result: SimulatorResult<JsonValue>): void {
    const candidate = publication;
    if (!candidate || completionSettled) return;
    if (!result.ok || !candidate.observed || !publicationMatches(candidate)) {
      failPublicationIntegrity();
      return;
    }
    publication = null;
    reservation = null;
    state = candidate.terminalState;
    options.onStateChange?.(state);
    settleCompletion(candidate.terminalState, candidate.reason, candidate.markedAtLogicalTime);
  }

  function publishTerminal(terminalState: 'usable' | 'failed', reason: SimulatorReadinessTerminalReason): void {
    const markedAtLogicalTime = terminalState === 'usable' ? engine.getCommitted().logicalTime : null;
    const activeReservation = reservation;
    if (!activeReservation) {
      failPublicationIntegrity();
      return;
    }
    publication = {
      terminalState,
      reason,
      markedAtLogicalTime,
      expectedRevision: engine.getCommitted().revision + 1,
      observed: false,
    };
    const settled = activeReservation.settle({
      readinessId,
      surfaceId: options.surfaceId,
      instanceId: options.instanceId,
      state: terminalState,
      reason,
      markedAtLogicalTime,
    });
    if (!settled.ok || !settled.value.accepted) failPublicationIntegrity();
  }

  function cancelWith(reason: SimulatorReadinessTerminalReason): void {
    if (state === 'usable' || state === 'cancelled' || state === 'failed') return;
    if (publication?.observed) return;
    state = 'cancelled';
    options.onStateChange?.(state);
    publication = null;
    const activeReservation = reservation;
    reservation = null;
    activeReservation?.cancel(reason === 'reset' ? 'reset' : 'dispose');
    settleCompletion('cancelled', reason, null);
  }

  function beginResetCancellation(): { readonly settle: () => void } | null {
    if (state === 'usable' || state === 'cancelled' || state === 'failed') return null;
    if (publication?.observed) return null;
    state = 'cancelled';
    options.onStateChange?.(state);
    publication = null;
    const activeReservation = reservation;
    reservation = null;
    activeReservation?.cancel('reset');
    stopObservations();
    let settled = false;
    return Object.freeze({
      settle() {
        if (settled) return;
        settled = true;
        settleCompletion('cancelled', 'reset', null);
      },
    });
  }

  /** Race one asynchronous browser observation against cancellation. */
  function raceCancel<T>(step: Promise<T>): Promise<T | typeof CANCELLED | typeof OBSERVATION_FAILED> {
    return new Promise((resolve) => {
      const listener = (): void => resolve(CANCELLED);
      cancelListeners.add(listener);
      void step.then(
        (value) => {
          cancelListeners.delete(listener);
          resolve(value);
        },
        () => {
          cancelListeners.delete(listener);
          resolve(OBSERVATION_FAILED);
        },
      );
    });
  }

  async function drive(): Promise<void> {
    // 1. State Engine quiescence (an open external reservation never blocks).
    state = 'waiting-quiescence';
    options.onStateChange?.(state);
    if (!engine.isQuiescent()) {
      const reached = await raceCancel(new Promise<boolean>((resolve) => {
        unsubscribeState = engine.subscribeState(() => {
          if (engine.isQuiescent()) {
            stopStateWatch();
            resolve(true);
          }
        });
        if (engine.isQuiescent()) {
          stopStateWatch();
          resolve(true);
        }
      }));
      if (reached === CANCELLED || reached !== true) return;
    }
    if (state !== 'waiting-quiescence') return;

    // From quiescence, any new State Engine commit invalidates the barrier.
    unsubscribeState = engine.subscribeState((revision) => {
      if (state !== 'usable' && state !== 'cancelled' && state !== 'failed') {
        const candidate = publication;
        if (
          candidate
          && revision === candidate.expectedRevision
          && publicationMatches(candidate)
        ) {
          candidate.observed = true;
          stopStateWatch();
          return;
        }
        cancelWith('state-change');
      }
    });

    // 2. Current epoch/instance, then the React commit at or after the signal.
    if (!isCurrentReadyInstance()) {
      cancelWith(engine.epoch === options.epoch ? 'state-change' : 'stale-epoch');
      return;
    }
    state = 'waiting-commit';
    options.onStateChange?.(state);
    const commitFloor = candidateCommitFloor;
    if (commitFloor === null) {
      failPublicationIntegrity();
      return;
    }
    const commit = await raceCancel(options.browser.awaitCommit({
      instanceId: options.instanceId,
      surfaceId: options.surfaceId,
      sinceToken: commitFloor,
      signal: readinessAbort.signal,
    }));
    if (commit === CANCELLED || state !== 'waiting-commit') return;
    if (commit === OBSERVATION_FAILED || commit <= commitFloor) {
      publishTerminal('failed', 'render-barrier-failed');
      return;
    }

    // 3. Give the committed DOM two successive browser rendering opportunities.
    state = 'waiting-render';
    options.onStateChange?.(state);
    const firstFrame = await raceCancel(options.browser.nextAnimationFrame(readinessAbort.signal));
    if (firstFrame === CANCELLED || state !== 'waiting-render') return;
    if (firstFrame === OBSERVATION_FAILED) {
      publishTerminal('failed', 'render-barrier-failed');
      return;
    }
    const secondFrame = await raceCancel(options.browser.nextAnimationFrame(readinessAbort.signal));
    if (secondFrame === CANCELLED || state !== 'waiting-render') return;
    if (secondFrame === OBSERVATION_FAILED || secondFrame <= firstFrame) {
      publishTerminal('failed', 'render-barrier-failed');
      return;
    }

    // 4. Check exact product semantics on the assigned roots.
    if (!options.projectionPredicate(options.projection()) || options.blockingPredicate() || !options.simulationDisclosureVisible()) {
      publishTerminal('failed', 'semantic-mismatch');
      return;
    }
    const markers = await raceCancel(options.browser.checkSemanticMarkers({
      instanceId: options.instanceId,
      surfaceId: options.surfaceId,
      expectation: options.expectation,
      signal: readinessAbort.signal,
    }));
    if (markers === CANCELLED || state !== 'waiting-render') return;
    if (markers === OBSERVATION_FAILED || !markers.ok) {
      publishTerminal('failed', 'semantic-mismatch');
      return;
    }

    publishTerminal('usable', 'qualified');
  }

  const barrier: SimulatorReadinessBarrier = {
    get readinessId() {
      return readinessId;
    },
    get state() {
      return state;
    },
    signalCandidate(input: { readonly contractId: string }): SimulatorResult<{ readonly signaled: boolean }> {
      if (state !== 'idle') {
        return simulatorFail(simulatorError('SIMULATOR_INVALID_LIFECYCLE', { instanceId: options.instanceId }));
      }
      if (input.contractId !== options.declaration.contractId) {
        return simulatorFail(simulatorError('SIMULATOR_INVALID_PAYLOAD', { instanceId: options.instanceId }));
      }
      if (options.declaration.surfaceId !== options.surfaceId) {
        return simulatorFail(simulatorError('SIMULATOR_INVALID_PAYLOAD', { instanceId: options.instanceId }));
      }
      if (engine.epoch !== options.epoch) {
        return simulatorFail(simulatorError('SIMULATOR_STALE_EPOCH', { instanceId: options.instanceId }));
      }
      if (!isCurrentReadyInstance()) {
        return simulatorFail(simulatorError('SIMULATOR_INVALID_LIFECYCLE', { instanceId: options.instanceId }));
      }
      // Declaration and scenario expectation must match exactly.
      if (
        options.expectation.contractId !== options.declaration.contractId
        || options.expectation.rootContentSemanticId !== options.declaration.rootContentSemanticId
        || options.expectation.primaryControl.semanticId !== options.declaration.primaryControl.semanticId
        || options.expectation.primaryControl.ariaRole !== options.declaration.primaryControl.ariaRole
        || options.expectation.primaryControl.accessibleName !== options.declaration.primaryControl.accessibleName
      ) {
        return simulatorFail(simulatorError('SIMULATOR_INVALID_PAYLOAD', { instanceId: options.instanceId }));
      }
      const allocation = engine.allocateReadinessId();
      if (!allocation.ok) return simulatorFail(allocation.error);
      readinessId = allocation.value.readinessId;
      const reserved = engine.reserveAsync({
        issuer: { kind: 'shell', moduleId: null, instanceId: null },
        causationId: null,
        commandType: 'simulator.readiness.settle',
        outcomeSchemaId: 'simulator-readiness-terminal',
        onCommandSettlement: settlePublishedTerminal,
      });
      if (!reserved.ok) return simulatorFail(reserved.error);
      reservation = reserved.value;
      candidateCommitFloor = options.browser.currentCommitToken({
        instanceId: options.instanceId,
        surfaceId: options.surfaceId,
      });
      state = 'signaled';
      options.onStateChange?.(state);
      void drive();
      return simulatorOk({ signaled: true });
    },
    cancel: cancelWith,
    beginResetCancellation,
    completion,
  };
  return Object.freeze(barrier);
}
