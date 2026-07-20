/**
 * One session-wide overlay/global-effect coordinator. Kit owns the public
 * lease types; this module owns Simulator allocation, DOM policy, and State
 * Engine command projection.
 */

import type {
  NimiRendererHostResult,
  NimiRendererOverlayDismissReason,
  NimiRendererOverlayLease,
  NimiRendererOverlayLeaseState,
  NimiRendererOverlayNodeRegistration,
  NimiRendererOverlayOptions,
  NimiRendererOverlayPort,
} from '@nimiplatform/kit/shell/renderer/host';

import type { SimulatorStateEngine } from '../state-engine/engine.ts';
import type { SimulatorError, SimulatorResult } from '../state-engine/errors.ts';
import { simulatorError, simulatorFail, simulatorOk } from '../state-engine/errors.ts';
import type { JsonValue } from '../state-engine/json-value.ts';
import { SIMULATOR_OVERLAY_MAX_ACTIVE_LEASES } from '../state-engine/overlay-state.ts';
import type { SimulatorGlobalCoordinator } from './global-coordinator.ts';
import {
  captureRootScroll,
  eventTargetElement,
  firstFocusable,
  focusElement,
  isConnectedInside,
  lockRootScroll,
  restoreElementInert,
  restoreRootScroll,
  setElementInert,
  type ElementInertSnapshot,
  type RootScrollSnapshot,
} from './overlay-dom.ts';

export const SIMULATOR_OVERLAY_Z_INDEX_BASE = 2000000;
export const SIMULATOR_OVERLAY_Z_INDEX_MAX = 2009999;
export const SIMULATOR_SHELL_DIAGNOSTICS_Z_INDEX_BASE = 2010000;
export const SIMULATOR_OVERLAY_MAX_DISMISS_SUBSCRIPTIONS = 64;

type CoordinatorEffectOwner = 'kit-coordinator' | 'kit-primitive';
type CoordinatorEffectPhase = 'instance-lifecycle' | 'callback';

export interface SimulatorOverlayCoordinatorOptions {
  readonly engine: SimulatorStateEngine;
  readonly listeners: SimulatorGlobalCoordinator;
  readonly simulatorRoot: HTMLElement;
  readonly interactiveRoots: () => readonly HTMLElement[];
  readonly diagnosticsRoots: () => readonly HTMLElement[];
  readonly safeFocusTarget: () => HTMLElement;
  readonly effectScope: {
    run<T>(
      owner: CoordinatorEffectOwner,
      phase: CoordinatorEffectPhase,
      callback: () => T,
    ): T;
  };
  readonly onInstanceCallbackFailure: (instanceId: string, cause: string) => void;
}

export interface SimulatorOverlayInstanceInput {
  readonly moduleId: string;
  readonly instanceId: string;
  readonly rendererRoot: HTMLElement;
  readonly overlayRoot: HTMLElement;
}

export interface SimulatorOverlayInstanceHost {
  readonly port: NimiRendererOverlayPort;
  requestDismissAll(reason: 'dispose' | 'reset'): Promise<SimulatorResult<{ readonly requested: number }>>;
  acknowledgeInstanceUnmounted(reason: 'dispose' | 'reset'): Promise<SimulatorResult<{ readonly released: number }>>;
  readonly activeLeaseCount: number;
}

export interface SimulatorOverlayCoordinator {
  createInstanceHost(input: SimulatorOverlayInstanceInput): SimulatorResult<SimulatorOverlayInstanceHost>;
  activeLeaseCount(): number;
  listenerCount(): number;
  disposeAfterRootUnmounted(): SimulatorResult<{ readonly disposed: boolean }>;
}

interface InstanceEntry extends SimulatorOverlayInstanceInput {
  readonly creationSequence: number;
  readonly leases: Set<OverlayEntry>;
  disposed: boolean;
}

interface OverlayEntry {
  readonly overlayId: string;
  readonly allocationSequence: number;
  readonly instance: InstanceEntry;
  readonly options: NimiRendererOverlayOptions;
  state: NimiRendererOverlayLeaseState;
  nodes: NimiRendererOverlayNodeRegistration | null;
  listeners: { readonly sequence: number; readonly listener: (reason: NimiRendererOverlayDismissReason) => void }[];
  dismissSubscriptionSequence: number;
  contentZIndex: string | null;
  contentTabIndex: string | null;
}

const HOST_OK = <TValue>(value: TValue): NimiRendererHostResult<TValue> => ({ ok: true, value });
const HOST_FAIL = <TValue>(
  disposition: 'unsupported' | 'capability-denied' | 'resource-exhausted' | 'invalid-input'
    | 'host-unavailable' | 'effect-forbidden' | 'internal',
): NimiRendererHostResult<TValue> => ({ ok: false, error: { disposition } });

export function createSimulatorOverlayCoordinator(
  options: SimulatorOverlayCoordinatorOptions,
): SimulatorOverlayCoordinator {
  const instances = new Map<string, InstanceEntry>();
  const stack: OverlayEntry[] = [];
  const inertSnapshots: ElementInertSnapshot[] = [];
  let scrollSnapshot: RootScrollSnapshot | null = null;
  let disposed = false;

  const unsubscribeFamilies = options.effectScope.run('kit-coordinator', 'instance-lifecycle', () => {
    const subscriptions = [
      options.listeners.subscribeFamily('keyboard', dispatchKeyboard),
      options.listeners.subscribeFamily('pointer_dismissal', dispatchPointer),
      options.listeners.subscribeFamily('focus', dispatchFocus),
    ];
    if (subscriptions.some((result) => !result.ok)) {
      for (const result of subscriptions) if (result.ok) result.value();
      throw new Error('SIMULATOR_OVERLAY_LISTENER_FAMILY_MISSING');
    }
    return subscriptions.map((result) => result.ok ? result.value : () => undefined);
  });

  function activeEntries(): OverlayEntry[] {
    return stack.filter((entry) => entry.state !== 'released');
  }

  function topmostEligible(predicate: (entry: OverlayEntry) => boolean): OverlayEntry | null {
    return [...stack].reverse().find((entry) => entry.state === 'open' && predicate(entry)) ?? null;
  }

  function dispatchKeyboard(event: unknown): void {
    options.effectScope.run('kit-coordinator', 'callback', () => {
      const keyboard = event as Partial<KeyboardEvent>;
      if (keyboard.type !== 'keydown' || keyboard.key !== 'Escape' || keyboard.defaultPrevented) return;
      const entry = topmostEligible((candidate) => candidate.options.dismissOnEscape);
      if (!entry) return;
      keyboard.preventDefault?.();
      void requestDismiss(entry, 'escape');
    });
  }

  function dispatchPointer(event: unknown): void {
    options.effectScope.run('kit-coordinator', 'callback', () => {
      const target = eventTargetElement(event);
      if (!target) return;
      const entry = topmostEligible((candidate) => candidate.options.dismissOnOutsidePointer);
      if (!entry?.nodes) return;
      if (entry.nodes.content.contains(target) || entry.nodes.trigger?.contains(target)) return;
      void requestDismiss(entry, 'outside-pointer');
    });
  }

  function dispatchFocus(event: unknown): void {
    options.effectScope.run('kit-coordinator', 'callback', () => {
      const target = eventTargetElement(event);
      const entry = topmostModal();
      if (!target || !entry?.nodes || entry.nodes.content.contains(target)) return;
      focusInitial(entry);
    });
  }

  function topmostModal(): OverlayEntry | null {
    return [...stack].reverse().find((entry) => (
      entry.state !== 'released' && entry.options.modal && entry.nodes !== null
    )) ?? null;
  }

  function createInstanceHost(input: SimulatorOverlayInstanceInput): SimulatorResult<SimulatorOverlayInstanceHost> {
    if (disposed || instances.has(input.instanceId)) {
      return simulatorFail(simulatorError('SIMULATOR_INVALID_LIFECYCLE', { instanceId: input.instanceId }));
    }
    const committed = options.engine.getCommitted().instance(input.instanceId);
    const rootsCollide = [...instances.values()].some((entry) => (
      rootsOverlap(input.rendererRoot, entry.rendererRoot)
      || rootsOverlap(input.rendererRoot, entry.overlayRoot)
      || rootsOverlap(input.overlayRoot, entry.rendererRoot)
      || rootsOverlap(input.overlayRoot, entry.overlayRoot)
    ));
    if (!committed || committed.moduleId !== input.moduleId
      || input.rendererRoot === input.overlayRoot
      || rootsOverlap(input.rendererRoot, input.overlayRoot)
      || rootsCollide
      || !options.simulatorRoot.contains(input.rendererRoot)
      || !options.simulatorRoot.contains(input.overlayRoot)) {
      return simulatorFail(simulatorError('SIMULATOR_INVALID_LIFECYCLE', { instanceId: input.instanceId }));
    }
    const instance: InstanceEntry = {
      ...input,
      creationSequence: committed.creationSequence,
      leases: new Set(),
      disposed: false,
    };
    instances.set(input.instanceId, instance);

    const port: NimiRendererOverlayPort = Object.freeze({
      target: input.overlayRoot,
      acquire: (overlayOptions: NimiRendererOverlayOptions) => acquire(instance, overlayOptions),
    });
    const host: SimulatorOverlayInstanceHost = Object.freeze({
      port,
      requestDismissAll: (reason: 'dispose' | 'reset') => requestDismissAll(instance, reason),
      acknowledgeInstanceUnmounted: (reason: 'dispose' | 'reset') => acknowledgeInstanceUnmounted(instance, reason),
      get activeLeaseCount() {
        return [...instance.leases].filter((entry) => entry.state !== 'released').length;
      },
    });
    return simulatorOk(host);
  }

  async function acquire(
    instance: InstanceEntry,
    overlayOptions: NimiRendererOverlayOptions,
  ): Promise<NimiRendererHostResult<NimiRendererOverlayLease>> {
    if (disposed || instance.disposed || !rootsAvailable(instance)) return HOST_FAIL('host-unavailable');
    if (!validOverlayOptions(overlayOptions)) return HOST_FAIL('invalid-input');
    if (activeEntries().length >= SIMULATOR_OVERLAY_MAX_ACTIVE_LEASES) {
      return HOST_FAIL('resource-exhausted');
    }
    const stateOptions: JsonValue = {
      kind: overlayOptions.kind,
      modal: overlayOptions.modal,
      dismissOnEscape: overlayOptions.dismissOnEscape,
      dismissOnOutsidePointer: overlayOptions.dismissOnOutsidePointer,
      returnFocus: overlayOptions.returnFocus,
      initialFocusSemanticId: overlayOptions.initialFocusSemanticId,
      returnFocusSemanticId: overlayOptions.returnFocusSemanticId,
      scrollLock: overlayOptions.scrollLock,
      ariaLabel: overlayOptions.ariaLabel,
    };
    const result = await options.engine.acceptCommand('simulator.overlay.acquire', {
      ownerInstanceId: instance.instanceId,
      options: stateOptions,
    }, issuerFor(instance));
    if (!result.ok) return HOST_FAIL(mapError(result.error));
    const value = result.value as { readonly overlayId: string; readonly allocationSequence: number };
    const entry: OverlayEntry = {
      overlayId: value.overlayId,
      allocationSequence: value.allocationSequence,
      instance,
      options: Object.freeze({ ...overlayOptions }),
      state: 'open',
      nodes: null,
      listeners: [],
      dismissSubscriptionSequence: 0,
      contentZIndex: null,
      contentTabIndex: null,
    };
    stack.push(entry);
    instance.leases.add(entry);
    return HOST_OK(createPublicLease(entry));
  }

  function createPublicLease(entry: OverlayEntry): NimiRendererOverlayLease {
    return Object.freeze({
      state: () => entry.state,
      registerNodes: (nodes: NimiRendererOverlayNodeRegistration) => registerNodes(entry, nodes),
      subscribeDismiss: (listener: (reason: NimiRendererOverlayDismissReason) => void) => subscribeDismiss(entry, listener),
      requestDismiss: (_reason: 'app') => requestDismiss(entry, 'app'),
      acknowledgeContentUnmounted: () => acknowledgeContentUnmounted(entry),
    });
  }

  function registerNodes(
    entry: OverlayEntry,
    nodes: NimiRendererOverlayNodeRegistration,
  ): NimiRendererHostResult<{ readonly registered: boolean }> {
    return options.effectScope.run('kit-coordinator', 'callback', () => {
      if (entry.state !== 'open') return HOST_FAIL('host-unavailable');
      if (entry.nodes) {
        return sameNodes(entry.nodes, nodes)
          ? HOST_OK({ registered: false })
          : HOST_FAIL('invalid-input');
      }
      if (!validNodes(entry, nodes)
        || stack.some((candidate) => candidate !== entry && candidate.nodes?.content === nodes.content)) {
        return HOST_FAIL('invalid-input');
      }
      entry.nodes = nodes;
      entry.contentZIndex = nodes.content.style.zIndex || null;
      entry.contentTabIndex = nodes.content.getAttribute('tabindex');
      applyStackZIndices();
      applyGlobalProjection();
      if (entry.options.modal && topmostModal() === entry) focusInitial(entry);
      return HOST_OK({ registered: true });
    });
  }

  function subscribeDismiss(
    entry: OverlayEntry,
    listener: (reason: NimiRendererOverlayDismissReason) => void,
  ): NimiRendererHostResult<() => void> {
    if (entry.state !== 'open') return HOST_FAIL('host-unavailable');
    if (entry.dismissSubscriptionSequence >= SIMULATOR_OVERLAY_MAX_DISMISS_SUBSCRIPTIONS) {
      return HOST_FAIL('resource-exhausted');
    }
    entry.dismissSubscriptionSequence += 1;
    const subscription = { sequence: entry.dismissSubscriptionSequence, listener };
    entry.listeners.push(subscription);
    let subscribed = true;
    return HOST_OK(() => {
      if (!subscribed) return;
      subscribed = false;
      entry.listeners = entry.listeners.filter((candidate) => candidate !== subscription);
    });
  }

  async function requestDismiss(
    entry: OverlayEntry,
    reason: Exclude<NimiRendererOverlayDismissReason, 'reset'>,
  ): Promise<NimiRendererHostResult<{ readonly requested: boolean }>> {
    if (entry.state !== 'open') return HOST_OK({ requested: false });
    const result = await options.engine.acceptCommand('simulator.overlay.dismiss', {
      overlayId: entry.overlayId,
      reason,
    }, issuerFor(entry.instance));
    if (!result.ok) return HOST_FAIL(mapError(result.error));
    const changed = (result.value as { readonly changed: boolean }).changed;
    if (!changed) return HOST_OK({ requested: false });
    entry.state = 'dismiss-requested';
    emitDismiss(entry, reason);
    applyGlobalProjection();
    return HOST_OK({ requested: true });
  }

  function emitDismiss(entry: OverlayEntry, reason: NimiRendererOverlayDismissReason): void {
    for (const subscription of [...entry.listeners].sort((left, right) => left.sequence - right.sequence)) {
      try {
        const returned: object | void = options.effectScope.run(
          'kit-primitive',
          'callback',
          () => subscription.listener(reason) as unknown as object | void,
        );
        if (returned && typeof (returned as Promise<void>).then === 'function') {
          throw new Error('async overlay dismissal subscriber');
        }
      } catch {
        options.onInstanceCallbackFailure(entry.instance.instanceId, 'overlay-dismiss-listener-failure');
        return;
      }
    }
  }

  async function acknowledgeContentUnmounted(
    entry: OverlayEntry,
  ): Promise<NimiRendererHostResult<{ readonly released: boolean }>> {
    if (entry.state === 'released') return HOST_OK({ released: false });
    if (entry.state !== 'dismiss-requested') return HOST_OK({ released: false });
    if (entry.nodes?.content.isConnected) return HOST_OK({ released: false });
    const released = await releaseThroughEngine(entry);
    return released.ok ? HOST_OK({ released: released.value }) : HOST_FAIL('internal');
  }

  async function releaseThroughEngine(entry: OverlayEntry): Promise<SimulatorResult<boolean>> {
    const begin = await options.engine.acceptCommand('simulator.overlay.beginRelease', {
      overlayId: entry.overlayId,
    }, issuerFor(entry.instance));
    if (!begin.ok || !(begin.value as { readonly changed: boolean }).changed) {
      return failIntegrity(entry.instance.instanceId);
    }
    entry.state = 'releasing';
    releaseDomResources(entry);
    const released = await options.engine.acceptCommand('simulator.overlay.released', {
      overlayId: entry.overlayId,
    }, issuerFor(entry.instance));
    if (!released.ok || !(released.value as { readonly changed: boolean }).changed) {
      return failIntegrity(entry.instance.instanceId);
    }
    entry.state = 'released';
    entry.listeners = [];
    removeFromStack(entry);
    return simulatorOk(true);
  }

  async function requestDismissAll(
    instance: InstanceEntry,
    reason: 'dispose' | 'reset',
  ): Promise<SimulatorResult<{ readonly requested: number }>> {
    if (reason === 'reset' && options.engine.phase !== 'resetting') {
      return simulatorFail(simulatorError('SIMULATOR_INVALID_LIFECYCLE', { instanceId: instance.instanceId }));
    }
    let requested = 0;
    const entries = [...instance.leases].reverse();
    for (const entry of entries) {
      if (entry.state !== 'open') continue;
      if (reason === 'reset') {
        entry.state = 'dismiss-requested';
        emitDismiss(entry, 'reset');
        requested += 1;
        continue;
      }
      const result = await requestDismiss(entry, 'dispose');
      if (!result.ok) return simulatorFail(simulatorError('SIMULATOR_INTEGRITY_FAILURE', { instanceId: instance.instanceId }));
      if (result.value.requested) requested += 1;
    }
    applyGlobalProjection();
    return simulatorOk({ requested });
  }

  async function acknowledgeInstanceUnmounted(
    instance: InstanceEntry,
    reason: 'dispose' | 'reset',
  ): Promise<SimulatorResult<{ readonly released: number }>> {
    if (instance.disposed) return simulatorOk({ released: 0 });
    if (reason === 'reset' && options.engine.phase !== 'resetting') {
      return simulatorFail(simulatorError('SIMULATOR_INVALID_LIFECYCLE', { instanceId: instance.instanceId }));
    }
    for (const entry of instance.leases) {
      if (entry.nodes?.content.isConnected) return failIntegrity(instance.instanceId);
    }
    let releasedCount = 0;
    for (const entry of [...instance.leases].reverse()) {
      if (entry.state === 'released') continue;
      if (reason === 'reset') {
        entry.state = 'releasing';
        releaseDomResources(entry);
        entry.state = 'released';
        entry.listeners = [];
        removeFromStack(entry);
        releasedCount += 1;
        continue;
      }
      if (entry.state === 'open') {
        const dismissed = await requestDismiss(entry, 'dispose');
        if (!dismissed.ok) return failIntegrity(instance.instanceId);
      }
      const released = await releaseThroughEngine(entry);
      if (!released.ok) return released;
      releasedCount += 1;
    }
    instance.disposed = true;
    instances.delete(instance.instanceId);
    applyGlobalProjection();
    return simulatorOk({ released: releasedCount });
  }

  function releaseDomResources(entry: OverlayEntry): void {
    if (entry.nodes) {
      entry.nodes.content.style.zIndex = entry.contentZIndex ?? '';
      if (entry.contentTabIndex === null) entry.nodes.content.removeAttribute('tabindex');
      else entry.nodes.content.setAttribute('tabindex', entry.contentTabIndex);
    }
  }

  function removeFromStack(entry: OverlayEntry): void {
    const index = stack.indexOf(entry);
    if (index >= 0) stack.splice(index, 1);
    entry.instance.leases.delete(entry);
    applyStackZIndices();
    applyGlobalProjection();
    const nextModal = topmostModal();
    if (nextModal) focusInitial(nextModal);
    else returnFocus(entry);
  }

  function applyStackZIndices(): void {
    activeEntries().forEach((entry, index) => {
      if (entry.nodes) entry.nodes.content.style.zIndex = String(SIMULATOR_OVERLAY_Z_INDEX_BASE + index);
    });
  }

  function applyGlobalProjection(excluding: OverlayEntry | null = null): void {
    options.effectScope.run('kit-coordinator', 'callback', () => {
      while (inertSnapshots.length > 0) restoreElementInert(inertSnapshots.pop() as ElementInertSnapshot);
      const top = topmostModal();
      if (top && top !== excluding && top.nodes) {
        const activeRoots = [top.instance.overlayRoot];
        const diagnostics = options.diagnosticsRoots();
        const candidates = new Set<HTMLElement>([
          ...options.interactiveRoots(),
          ...[...instances.values()].flatMap((instance) => [instance.rendererRoot, instance.overlayRoot]),
          ...stack.filter((entry) => entry !== top && entry.nodes).map((entry) => entry.nodes?.content as HTMLElement),
        ]);
        for (const candidate of candidates) {
          if (!candidate.isConnected || !options.simulatorRoot.contains(candidate)) continue;
          if (activeRoots.includes(candidate)) continue;
          if (candidate.contains(top.nodes.content)) continue;
          if (diagnostics.some((root) => root === candidate || root.contains(candidate))) continue;
          inertSnapshots.push(setElementInert(candidate));
        }
      }
      const lockCount = activeEntries().filter((entry) => (
        entry.options.modal && entry.options.scrollLock === 'simulator-root'
      )).length;
      if (lockCount > 0 && scrollSnapshot === null) {
        scrollSnapshot = captureRootScroll(options.simulatorRoot);
        lockRootScroll(options.simulatorRoot);
      } else if (lockCount === 0 && scrollSnapshot !== null) {
        restoreRootScroll(options.simulatorRoot, scrollSnapshot);
        scrollSnapshot = null;
      }
    });
  }

  function focusInitial(entry: OverlayEntry): void {
    if (!entry.nodes) return;
    if (focusElement(entry.nodes.initialFocus)) return;
    if (focusElement(firstFocusable(entry.nodes.content))) return;
    if (!entry.nodes.content.hasAttribute('tabindex')) entry.nodes.content.setAttribute('tabindex', '-1');
    focusElement(entry.nodes.content);
  }

  function returnFocus(entry: OverlayEntry): void {
    if (!entry.options.returnFocus || !entry.nodes) return;
    const candidates = [
      entry.nodes.trigger,
      entry.nodes.returnFocus,
      entry.nodes.fallbackFocus,
      entry.instance.rendererRoot,
      options.safeFocusTarget(),
    ];
    for (const candidate of candidates) if (focusElement(candidate)) return;
  }

  function validNodes(entry: OverlayEntry, nodes: NimiRendererOverlayNodeRegistration): boolean {
    const roots = [entry.instance.rendererRoot, entry.instance.overlayRoot];
    return nodes.content.isConnected
      && entry.instance.overlayRoot.contains(nodes.content)
      && (nodes.trigger === null || isConnectedInside(nodes.trigger, roots))
      && (nodes.initialFocus === null || isConnectedInside(nodes.initialFocus, [nodes.content]))
      && (nodes.fallbackFocus === null || isConnectedInside(nodes.fallbackFocus, roots))
      && (nodes.returnFocus === null || isConnectedInside(nodes.returnFocus, roots));
  }

  function sameNodes(
    left: NimiRendererOverlayNodeRegistration,
    right: NimiRendererOverlayNodeRegistration,
  ): boolean {
    return left.trigger === right.trigger
      && left.content === right.content
      && left.initialFocus === right.initialFocus
      && left.fallbackFocus === right.fallbackFocus
      && left.returnFocus === right.returnFocus;
  }

  function rootsAvailable(instance: InstanceEntry): boolean {
    return instance.rendererRoot.isConnected
      && instance.overlayRoot.isConnected
      && options.simulatorRoot.contains(instance.rendererRoot)
      && options.simulatorRoot.contains(instance.overlayRoot);
  }

  function validOverlayOptions(value: NimiRendererOverlayOptions): boolean {
    const keys = Object.keys(value).sort();
    const expected = [
      'ariaLabel', 'dismissOnEscape', 'dismissOnOutsidePointer', 'initialFocusSemanticId',
      'kind', 'modal', 'returnFocus', 'returnFocusSemanticId', 'scrollLock',
    ];
    return keys.length === expected.length
      && keys.every((key, index) => key === expected[index])
      && ['dialog', 'popover', 'menu', 'tooltip'].includes(value.kind)
      && typeof value.modal === 'boolean'
      && typeof value.dismissOnEscape === 'boolean'
      && typeof value.dismissOnOutsidePointer === 'boolean'
      && typeof value.returnFocus === 'boolean'
      && (value.initialFocusSemanticId === null || validSemanticId(value.initialFocusSemanticId))
      && (value.returnFocusSemanticId === null || validSemanticId(value.returnFocusSemanticId))
      && (value.scrollLock === 'none' || value.scrollLock === 'simulator-root')
      && (!value.modal ? value.scrollLock === 'none' : true)
      && value.ariaLabel.trim().length > 0
      && value.ariaLabel.length <= 256;
  }

  function validSemanticId(value: string): boolean {
    return /^[A-Za-z][A-Za-z0-9_.:-]{0,127}$/u.test(value);
  }

  function issuerFor(instance: InstanceEntry) {
    return { kind: 'instance' as const, moduleId: instance.moduleId, instanceId: instance.instanceId };
  }

  function mapError(error: SimulatorError) {
    switch (error.code) {
      case 'SIMULATOR_UNSUPPORTED': return 'unsupported' as const;
      case 'SIMULATOR_CAPABILITY_DENIED': return 'capability-denied' as const;
      case 'SIMULATOR_RESOURCE_EXHAUSTED': return 'resource-exhausted' as const;
      case 'SIMULATOR_INVALID_PAYLOAD': return 'invalid-input' as const;
      case 'SIMULATOR_EFFECT_FORBIDDEN': return 'effect-forbidden' as const;
      case 'SIMULATOR_STALE_EPOCH':
      case 'SIMULATOR_INSTANCE_DISPOSED':
      case 'SIMULATOR_INSTANCE_FAILED':
      case 'SIMULATOR_MODULE_FAILED':
      case 'SIMULATOR_INVALID_LIFECYCLE':
        return 'host-unavailable' as const;
      case 'SIMULATOR_INTEGRITY_FAILURE':
      case 'SIMULATOR_INVALID_MANIFEST':
      case 'SIMULATOR_SOURCE_MISMATCH':
        return 'internal' as const;
    }
  }

  function failIntegrity(instanceId: string | null): SimulatorResult<never> {
    const error = simulatorError('SIMULATOR_INTEGRITY_FAILURE', { instanceId });
    options.engine.terminateIntegrity(error);
    return simulatorFail(error);
  }

  return {
    createInstanceHost,
    activeLeaseCount: () => activeEntries().length,
    listenerCount: () => unsubscribeFamilies.length,
    disposeAfterRootUnmounted() {
      if (disposed) return simulatorOk({ disposed: false });
      if (activeEntries().some((entry) => entry.nodes?.content.isConnected)) {
        return failIntegrity(activeEntries()[0]?.instance.instanceId ?? null);
      }
      for (const entry of [...activeEntries()].reverse()) {
        entry.state = 'released';
        releaseDomResources(entry);
        removeFromStack(entry);
      }
      while (inertSnapshots.length > 0) restoreElementInert(inertSnapshots.pop() as ElementInertSnapshot);
      if (scrollSnapshot) restoreRootScroll(options.simulatorRoot, scrollSnapshot);
      scrollSnapshot = null;
      for (const unsubscribe of unsubscribeFamilies) unsubscribe();
      instances.clear();
      disposed = true;
      return simulatorOk({ disposed: true });
    },
  };
}

function rootsOverlap(left: HTMLElement, right: HTMLElement): boolean {
  return left === right || left.contains(right) || right.contains(left);
}
