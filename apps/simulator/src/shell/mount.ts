/**
 * Browser glue for the Simulator Shell: creates the session with real
 * browser ports, installs Shell-owned listener families, and renders one
 * React root. Imported dynamically by the effect-guard bootstrap only after
 * every guard is installed.
 *
 * Authority: P-SIM-001, P-SIM-017, P-SIM-018.
 */

import { Fragment, StrictMode, createElement as h, useLayoutEffect, useSyncExternalStore } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import {
  simulatorResolvedModuleCatalogs,
  simulatorResolvedModules,
  simulatorResolvedReadinessDeclarations,
  simulatorResolvedRegistryDigest,
} from '../registry.ts';
import type { SimulatorGuardHandle } from '../effects/guards.ts';
import { completeSimulatorBootstrapDisclosure } from '../bootstrap/disclosure.ts';
import { createSimulatorSession, type SimulatorSession } from './session.ts';
import { createGlobalListenerCoordinator } from './global-coordinator.ts';
import { installSimulatorIntegrityListener } from './integrity-listener.ts';
import { installSimulatorRouteHistoryListener } from './route-listener.ts';
import { createSimulatorBrowserSurfaceManager } from './browser-surface-host.tsx';
import {
  SimulatorShellContent,
  SimulatorStatusBar,
  type SimulatorShellViewProps,
} from './ui.ts';
import { parseShellRoute } from './routes.ts';
import {
  createAssignedRootRegistry,
  createBrowserReadinessPort,
  createReactCommitTracker,
  isSimulationDisclosureVisible,
} from '../lifecycle/browser-readiness.ts';
import '../styles.css';
import type { JsonValue } from '../state-engine/json-value.ts';
import type { SimulatorModuleCatalogDeclaration } from '../state-engine/types.ts';
import { simulatorError } from '../state-engine/errors.ts';

const EMPTY_SESSION_SEED = 'e5'.repeat(32);
const SCENARIO_MODULE_DATA: Readonly<Record<string, JsonValue>> = Object.freeze({});
const RESOLVED_MODULE_CATALOGS: readonly Omit<SimulatorModuleCatalogDeclaration, 'moduleData'>[] =
  simulatorResolvedModuleCatalogs;

function resolvedScenarioModuleCatalogs(): readonly SimulatorModuleCatalogDeclaration[] {
  const selected = new Set(RESOLVED_MODULE_CATALOGS.map((entry) => entry.moduleId));
  const configured = Object.keys(SCENARIO_MODULE_DATA);
  if (selected.size !== configured.length || configured.some((moduleId) => !selected.has(moduleId))) {
    throw new Error('SIMULATOR_SCENARIO_MODULE_DATA_MISMATCH');
  }
  return RESOLVED_MODULE_CATALOGS.map((catalog) => ({
    ...catalog,
    moduleData: SCENARIO_MODULE_DATA[catalog.moduleId],
  }));
}

function privilegedFunction<T extends (...args: never[]) => unknown>(
  guard: SimulatorGuardHandle,
  targetPath: string,
): T {
  const value = guard.privileged[targetPath];
  if (typeof value !== 'function') throw new Error(`SIMULATOR_PRIVILEGED_PORT_MISSING:${targetPath}`);
  return value as T;
}

function ShellRoot({
  session,
  disclosureRoot,
}: {
  session: SimulatorSession;
  disclosureRoot: HTMLElement;
}) {
  const version = useSyncExternalStore(
    (listener) => session.subscribe(listener),
    () => `${session.epoch}:${session.phase}:${session.instances().length}:${session.diagnostics.list().length}:${session.route().kind}`,
  );
  void version;
  const props: SimulatorShellViewProps = {
    epoch: session.epoch,
    phase: session.phase,
    registryDigest: simulatorResolvedRegistryDigest,
    moduleCount: simulatorResolvedModules.length,
    route: session.route(),
    instances: session.instances(),
    diagnostics: session.diagnostics.list(),
    onNavigate: (route) => session.navigate(route),
  };
  return h(Fragment, null,
    createPortal(h(SimulatorStatusBar, props), disclosureRoot),
    h(SimulatorShellContent, props),
  );
}

function CommitTrackedShellRoot({
  session,
  disclosureRoot,
  recordCommit,
}: {
  session: SimulatorSession;
  disclosureRoot: HTMLElement;
  recordCommit: () => void;
}) {
  useLayoutEffect(recordCommit);
  return h(ShellRoot, { session, disclosureRoot });
}

export function mountSimulatorShell(guard: SimulatorGuardHandle): void {
  const rootElement = document.getElementById('root');
  if (!rootElement) {
    throw new Error('Simulator root element is missing');
  }
  const disclosureRoot = document.getElementById('simulator-disclosure-root');
  if (!(disclosureRoot instanceof HTMLElement) || rootElement.contains(disclosureRoot)) {
    throw new Error('SIMULATOR_DISCLOSURE_ROOT_INVALID');
  }

  const privilegedSetTimeout = privilegedFunction<typeof setTimeout>(guard, 'globalThis.setTimeout');
  const privilegedRaf = privilegedFunction<typeof requestAnimationFrame>(guard, 'globalThis.requestAnimationFrame');
  const privilegedCancelRaf = privilegedFunction<typeof cancelAnimationFrame>(guard, 'globalThis.cancelAnimationFrame');
  const commits = createReactCommitTracker();
  const assignedRoots = createAssignedRootRegistry();
  rootElement.tabIndex = -1;
  const coordinator = createGlobalListenerCoordinator(
    guard.catalog.listenerFamilies.map((family) => ({
      id: family.id,
      eventTarget: family.eventTarget,
      eventTypes: family.eventTypes,
      capture: family.capture,
      passive: family.passive,
      owner: family.owner,
    })),
    { window, document },
    {
      run: (owner, phase, callback) => guard.withScope({ owner, phase }, callback),
    },
  );
  const readinessBrowser = createBrowserReadinessPort({
    commits,
    roots: assignedRoots,
    requestAnimationFrame: (callback) => privilegedRaf.call(globalThis, callback),
    cancelAnimationFrame: (handle) => privilegedCancelRaf.call(globalThis, handle),
    computedStyle: (element) => window.getComputedStyle(element),
    paintCompositeEvidence: null,
  });
  const sessionRef: { current: SimulatorSession | null } = { current: null };
  const surfaces = createSimulatorBrowserSurfaceManager({
    guard,
    document,
    simulatorRoot: document.body,
    shellRoot: rootElement,
    assignedRoots,
    commits,
    listeners: coordinator,
    supportedKitCapabilities: new Set(),
    invokeKitOperation: async () => ({
      ok: false,
      error: { disposition: 'unsupported' as const },
    }),
    reportReadyCandidate(input) {
      const readiness = sessionRef.current?.readinessFor(input.instanceId, input.surfaceId);
      if (!readiness?.ok) throw new Error('SIMULATOR_READINESS_BARRIER_MISSING');
      const signaled = readiness.value.signalCandidate({ contractId: input.contractId });
      if (!signaled.ok) throw new Error(signaled.error.code);
    },
  });
  const session = createSimulatorSession({
    scenario: {
      scenarioId: 'nimi-ecosystem-simulator',
      scenarioRevision: 'empty-selection',
      seed: EMPTY_SESSION_SEED,
      initialLogicalTime: 0,
      scenarioState: { disclosure: 'simulated' },
      ecosystemState: {},
      shellState: { readiness: {} },
    },
    registryModules: simulatorResolvedModules,
    moduleCatalogs: resolvedScenarioModuleCatalogs(),
    timers: {
      setTimeout: (handler, delayMs) => privilegedSetTimeout.call(globalThis, handler, delayMs),
      clearTimeout: (handle) => clearTimeout(handle as Parameters<typeof clearTimeout>[0]),
      now: () => performance.now(),
    },
    effectScope: {
      run: (owner, phase, callback) => guard.withScope({ owner, phase }, callback),
    },
    prepareSurface: (input) => surfaces.prepare(input),
    readinessBrowser,
    readinessDeclarations: simulatorResolvedReadinessDeclarations,
    readinessExpectations: {},
    readinessProjectionPredicates: {},
    readinessBlockingPredicates: {},
    commitToken: commits.current,
    simulationDisclosureVisible: () => {
      const status = document.querySelector('[data-testid="simulator-status"]');
      return isSimulationDisclosureVisible(
        status instanceof HTMLElement ? status : null,
        (element) => window.getComputedStyle(element),
      );
    },
  });
  sessionRef.current = session;
  installSimulatorIntegrityListener({
    guard,
    coordinator,
    terminate: () => session.engine.terminateIntegrity(simulatorError('SIMULATOR_INTEGRITY_FAILURE')),
  });

  const initial = parseShellRoute(window.location.pathname);
  if (initial) session.navigate(initial);
  installSimulatorRouteHistoryListener({
    coordinator,
    onHistory: () => {
      const route = parseShellRoute(window.location.pathname);
      if (route) session.navigate(route);
    },
  });

  const root = createRoot(rootElement);
  flushSync(() => {
    root.render(
      h(StrictMode, null,
        h(CommitTrackedShellRoot, {
          session,
          disclosureRoot,
          recordCommit: () => { commits.recordCommit(); },
        }),
        surfaces.renderPortals(),
      ),
    );
  });
  completeSimulatorBootstrapDisclosure(document);
}
