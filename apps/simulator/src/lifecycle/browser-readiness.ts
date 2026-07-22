/**
 * Concrete browser evidence for surface readiness. Assigned roots and React
 * commit tokens are Shell-owned; semantic checks never search the document.
 * Paint/Composite qualification is injected by the pinned-browser runner and
 * fails closed when that evidence source is absent.
 *
 * Authority: P-SIM-014; simulator-protocol.md §7.2.
 */

import type {
  SimulatorReadinessBrowserPort,
  SimulatorReadinessExpectation,
} from './readiness.ts';

export interface SimulatorAssignedSurfaceRoots {
  readonly renderer: HTMLElement;
  readonly overlay: HTMLElement;
}

export interface SimulatorAssignedRootRegistry {
  assign(instanceId: string, surfaceId: string, roots: SimulatorAssignedSurfaceRoots): void;
  release(instanceId: string, surfaceId: string): void;
  get(instanceId: string, surfaceId: string): SimulatorAssignedSurfaceRoots | null;
}

function rootKey(instanceId: string, surfaceId: string): string {
  return `${instanceId}\u0000${surfaceId}`;
}

export function createAssignedRootRegistry(): SimulatorAssignedRootRegistry {
  const roots = new Map<string, SimulatorAssignedSurfaceRoots>();
  const registry: SimulatorAssignedRootRegistry = {
    assign(instanceId, surfaceId, next) {
      const key = rootKey(instanceId, surfaceId);
      if (roots.has(key)) throw new Error('SIMULATOR_ASSIGNED_ROOT_DUPLICATE');
      if (next.renderer === next.overlay) throw new Error('SIMULATOR_ASSIGNED_ROOT_COLLISION');
      roots.set(key, Object.freeze(next));
    },
    release(instanceId, surfaceId) {
      roots.delete(rootKey(instanceId, surfaceId));
    },
    get(instanceId, surfaceId) {
      return roots.get(rootKey(instanceId, surfaceId)) ?? null;
    },
  };
  return Object.freeze(registry);
}

interface CommitWaiter {
  readonly floor: number;
  readonly resolve: (token: number) => void;
  readonly reject: (error: Error) => void;
  readonly signal: AbortSignal;
  readonly onAbort: () => void;
}

export interface SimulatorSurfaceCommitScope {
  readonly instanceId: string;
  readonly surfaceId: string;
}

interface SurfaceCommitState {
  token: number;
  readonly waiters: Set<CommitWaiter>;
}

export interface SimulatorReactCommitTracker {
  current(scope: SimulatorSurfaceCommitScope): number;
  recordCommit(scope: SimulatorSurfaceCommitScope): number;
  awaitAfter(input: SimulatorSurfaceCommitScope & { readonly floor: number; readonly signal: AbortSignal }): Promise<number>;
  release(scope: SimulatorSurfaceCommitScope): void;
}

export function createReactCommitTracker(): SimulatorReactCommitTracker {
  const surfaces = new Map<string, SurfaceCommitState>();

  function state(scope: SimulatorSurfaceCommitScope): SurfaceCommitState {
    const key = rootKey(scope.instanceId, scope.surfaceId);
    const existing = surfaces.get(key);
    if (existing) return existing;
    const created = { token: 0, waiters: new Set<CommitWaiter>() };
    surfaces.set(key, created);
    return created;
  }

  function remove(surface: SurfaceCommitState, waiter: CommitWaiter): void {
    surface.waiters.delete(waiter);
    waiter.signal.removeEventListener('abort', waiter.onAbort);
  }

  const tracker: SimulatorReactCommitTracker = {
    current: (scope) => surfaces.get(rootKey(scope.instanceId, scope.surfaceId))?.token ?? 0,
    recordCommit(scope) {
      const surface = state(scope);
      surface.token += 1;
      for (const waiter of [...surface.waiters]) {
        if (surface.token <= waiter.floor) continue;
        remove(surface, waiter);
        waiter.resolve(surface.token);
      }
      return surface.token;
    },
    awaitAfter(input) {
      const { floor, signal } = input;
      if (signal.aborted) return Promise.reject(new Error('SIMULATOR_READINESS_CANCELLED'));
      const surface = state(input);
      if (surface.token > floor) return Promise.resolve(surface.token);
      return new Promise<number>((resolve, reject) => {
        let waiter: CommitWaiter;
        const onAbort = (): void => {
          remove(surface, waiter);
          reject(new Error('SIMULATOR_READINESS_CANCELLED'));
        };
        waiter = { floor, resolve, reject, signal, onAbort };
        surface.waiters.add(waiter);
        signal.addEventListener('abort', onAbort, { once: true });
      });
    },
    release(scope) {
      const key = rootKey(scope.instanceId, scope.surfaceId);
      const surface = surfaces.get(key);
      if (!surface) return;
      surfaces.delete(key);
      for (const waiter of [...surface.waiters]) {
        remove(surface, waiter);
        waiter.reject(new Error('SIMULATOR_READINESS_CANCELLED'));
      }
    },
  };
  return Object.freeze(tracker);
}

function semanticElements(roots: SimulatorAssignedSurfaceRoots, semanticId: string): HTMLElement[] {
  const matches: HTMLElement[] = [];
  for (const root of [roots.renderer, roots.overlay]) {
    if (root.getAttribute('data-nimi-semantic-id') === semanticId) matches.push(root);
    for (const element of root.querySelectorAll<HTMLElement>('[data-nimi-semantic-id]')) {
      if (element.getAttribute('data-nimi-semantic-id') === semanticId) matches.push(element);
    }
  }
  return matches;
}

function idElement(roots: SimulatorAssignedSurfaceRoots, id: string): HTMLElement | null {
  const matches: HTMLElement[] = [];
  for (const root of [roots.renderer, roots.overlay]) {
    if (root.id === id) matches.push(root);
    for (const element of root.querySelectorAll<HTMLElement>('[id]')) {
      if (element.id === id) matches.push(element);
    }
  }
  return matches.length === 1 ? matches[0] : null;
}

function implicitRole(element: HTMLElement): string | null {
  const tag = element.tagName.toLowerCase();
  if (tag === 'button') return 'button';
  if (tag === 'a' && element.hasAttribute('href')) return 'link';
  if (tag === 'select') return element.hasAttribute('multiple') ? 'listbox' : 'combobox';
  if (tag === 'textarea') return 'textbox';
  if (tag !== 'input') return null;
  const type = (element.getAttribute('type') ?? 'text').toLowerCase();
  if (type === 'checkbox') return 'checkbox';
  if (type === 'radio') return 'radio';
  if (type === 'range') return 'slider';
  if (type === 'button' || type === 'submit' || type === 'reset') return 'button';
  return type === 'hidden' ? null : 'textbox';
}

function normalizedText(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function accessibleName(element: HTMLElement, roots: SimulatorAssignedSurfaceRoots): string {
  const direct = normalizedText(element.getAttribute('aria-label'));
  if (direct) return direct;
  const labelledBy = normalizedText(element.getAttribute('aria-labelledby'));
  if (labelledBy) {
    const resolved = labelledBy
      .split(' ')
      .map((id) => idElement(roots, id))
      .filter((candidate): candidate is HTMLElement => candidate !== null)
      .map((candidate) => normalizedText(candidate.textContent))
      .filter(Boolean)
      .join(' ');
    if (resolved) return resolved;
  }
  const labels = (element as HTMLElement & { readonly labels?: NodeListOf<HTMLLabelElement> | null }).labels;
  if (labels && labels.length > 0) {
    const label = [...labels].map((entry) => normalizedText(entry.textContent)).filter(Boolean).join(' ');
    if (label) return label;
  }
  const alternate = normalizedText(element.getAttribute('alt') ?? element.getAttribute('title'));
  if (alternate) return alternate;
  return normalizedText(element.textContent);
}

function visible(element: HTMLElement, computedStyle: (element: Element) => CSSStyleDeclaration): boolean {
  if (!element.isConnected || element.hidden || element.getAttribute('aria-hidden') === 'true') return false;
  if (element.closest('[hidden],[inert],[aria-hidden="true"]')) return false;
  const style = computedStyle(element);
  if (style.display === 'none' || style.visibility === 'hidden' || style.visibility === 'collapse') return false;
  return element.getClientRects().length > 0;
}

function actionable(element: HTMLElement): boolean {
  const disabled = Boolean((element as HTMLElement & { readonly disabled?: boolean }).disabled);
  if (disabled || element.getAttribute('aria-disabled') === 'true') return false;
  if (element.tabIndex >= 0) return true;
  const tag = element.tagName.toLowerCase();
  return tag === 'button' || tag === 'select' || tag === 'textarea'
    || (tag === 'a' && element.hasAttribute('href'))
    || (tag === 'input' && (element.getAttribute('type') ?? 'text').toLowerCase() !== 'hidden');
}

function markersMatch(
  roots: SimulatorAssignedSurfaceRoots,
  expectation: SimulatorReadinessExpectation,
  computedStyle: (element: Element) => CSSStyleDeclaration,
): boolean {
  if (!roots.renderer.isConnected || !roots.overlay.isConnected) return false;
  const rootMatches = semanticElements(roots, expectation.rootContentSemanticId);
  const controlMatches = semanticElements(roots, expectation.primaryControl.semanticId);
  if (rootMatches.length !== 1 || controlMatches.length !== 1) return false;
  const root = rootMatches[0];
  const control = controlMatches[0];
  const role = control.getAttribute('role') ?? implicitRole(control);
  return visible(root, computedStyle)
    && visible(control, computedStyle)
    && role === expectation.primaryControl.ariaRole
    && accessibleName(control, roots) === expectation.primaryControl.accessibleName
    && actionable(control);
}

export interface SimulatorBrowserReadinessOptions {
  readonly commits: SimulatorReactCommitTracker;
  readonly roots: SimulatorAssignedRootRegistry;
  readonly requestAnimationFrame: typeof requestAnimationFrame;
  readonly cancelAnimationFrame: typeof cancelAnimationFrame;
  readonly computedStyle: (element: Element) => CSSStyleDeclaration;
  readonly paintCompositeEvidence?: {
    readonly begin: (input: {
      readonly instanceId: string;
      readonly surfaceId: string;
    }) => Promise<string | null> | string | null;
    readonly mark: (input: {
      readonly observationToken: string;
      readonly ordinal: 'first' | 'second';
      readonly frame: number;
    }) => Promise<boolean> | boolean;
    readonly end: (input: {
      readonly observationToken: string;
      readonly firstFrame: number | null;
      readonly secondFrame: number | null;
    }) => Promise<boolean> | boolean;
  } | null;
}

export function createBrowserReadinessPort(options: SimulatorBrowserReadinessOptions): SimulatorReadinessBrowserPort {
  interface PaintWindow {
    readonly signal: AbortSignal;
    readonly renderer: HTMLElement;
    readonly priorFilter: string;
    readonly priorFilterPriority: string;
    readonly abort: () => void;
    probeApplied: boolean;
  }

  const windows = new Map<string, PaintWindow>();

  function releaseWindow(token: string): void {
    const active = windows.get(token);
    if (!active) return;
    if (active.probeApplied) {
      if (active.priorFilter) {
        active.renderer.style.setProperty('filter', active.priorFilter, active.priorFilterPriority);
      } else {
        active.renderer.style.removeProperty('filter');
      }
      active.probeApplied = false;
    }
    active.signal.removeEventListener('abort', active.abort);
    windows.delete(token);
  }

  const port: SimulatorReadinessBrowserPort = {
    currentCommitToken: (scope) => options.commits.current(scope),
    awaitCommit: (input) => options.commits.awaitAfter({
      instanceId: input.instanceId,
      surfaceId: input.surfaceId,
      floor: input.sinceToken,
      signal: input.signal,
    }),
    nextAnimationFrame(signal) {
      if (signal.aborted) return Promise.reject(new Error('SIMULATOR_READINESS_CANCELLED'));
      return new Promise<number>((resolve, reject) => {
        let handle = -1;
        const onAbort = (): void => {
          if (handle >= 0) options.cancelAnimationFrame(handle);
          reject(new Error('SIMULATOR_READINESS_CANCELLED'));
        };
        handle = options.requestAnimationFrame((timestamp) => {
          signal.removeEventListener('abort', onAbort);
          resolve(timestamp);
        });
        signal.addEventListener('abort', onAbort, { once: true });
      });
    },
    async beginPaintComposite(input) {
      if (!options.paintCompositeEvidence || input.signal.aborted) return null;
      const roots = options.roots.get(input.instanceId, input.surfaceId);
      if (!roots) return null;
      const token = await options.paintCompositeEvidence.begin({
        instanceId: input.instanceId,
        surfaceId: input.surfaceId,
      });
      if (!token || input.signal.aborted || windows.has(token)) {
        if (token) void options.paintCompositeEvidence.end({
          observationToken: token,
          firstFrame: null,
          secondFrame: null,
        });
        return null;
      }
      const abort = (): void => {
        releaseWindow(token);
        void options.paintCompositeEvidence?.end({
          observationToken: token,
          firstFrame: null,
          secondFrame: null,
        });
      };
      windows.set(token, {
        signal: input.signal,
        renderer: roots.renderer,
        priorFilter: roots.renderer.style.getPropertyValue('filter'),
        priorFilterPriority: roots.renderer.style.getPropertyPriority('filter'),
        abort,
        probeApplied: false,
      });
      input.signal.addEventListener('abort', abort, { once: true });
      return token;
    },
    async markPaintCompositeFrame(input) {
      if (!options.paintCompositeEvidence || input.signal.aborted || !windows.has(input.observationToken)) return false;
      if (input.ordinal === 'first') {
        const active = windows.get(input.observationToken);
        if (!active || active.probeApplied) return false;
        // The App commit may already have painted before the runner-owned first
        // marker crosses the CDP boundary. This one-frame filter makes the
        // assigned renderer itself require a real composite without overriding
        // an App-owned opacity-hidden state; releaseWindow restores exact styling.
        active.renderer.style.setProperty('filter', 'opacity(0.999999)', 'important');
        active.probeApplied = true;
      }
      return options.paintCompositeEvidence.mark({
        observationToken: input.observationToken,
        ordinal: input.ordinal,
        frame: input.frame,
      });
    },
    async observePaintComposite(input) {
      if (!options.paintCompositeEvidence || input.signal.aborted || !windows.has(input.observationToken)) return false;
      releaseWindow(input.observationToken);
      return options.paintCompositeEvidence.end({
        observationToken: input.observationToken,
        firstFrame: input.firstFrame,
        secondFrame: input.secondFrame,
      });
    },
    async checkSemanticMarkers(input) {
      if (input.signal.aborted) return { ok: false };
      const roots = options.roots.get(input.instanceId, input.surfaceId);
      return { ok: roots ? markersMatch(roots, input.expectation, options.computedStyle) : false };
    },
  };
  return Object.freeze(port);
}

export function isSimulationDisclosureVisible(
  element: HTMLElement | null,
  computedStyle: (element: Element) => CSSStyleDeclaration,
): boolean {
  return element !== null && visible(element, computedStyle);
}
