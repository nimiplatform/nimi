/**
 * Browser glue for the Simulator Shell: creates the session with real
 * browser ports, installs Shell-owned listener families, and renders one
 * React root. Imported dynamically by the effect-guard bootstrap only after
 * every guard is installed.
 *
 * Authority: P-SIM-001, P-SIM-017, P-SIM-018.
 */

import { Fragment, StrictMode, createElement as h, useMemo, useSyncExternalStore } from 'react';
import { createPortal, flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import {
  simulatorResolvedModuleCatalogs,
  simulatorResolvedModules,
  simulatorResolvedReadinessDeclarations,
  simulatorResolvedRegistryDigest,
  simulatorResolvedScenario,
} from '../registry.ts';
import type { SimulatorGuardHandle } from '../effects/guards.ts';
import { completeSimulatorBootstrapDisclosure } from '../bootstrap/disclosure.ts';
import { createSimulatorSession, type SimulatorSession } from './session.ts';
import { createGlobalListenerCoordinator, type SimulatorGlobalCoordinator } from './global-coordinator.ts';
import { installSimulatorIntegrityListener } from './integrity-listener.ts';
import { installSimulatorRouteHistoryListener } from './route-listener.ts';
import {
  createSimulatorBrowserSurfaceManager,
  type SimulatorBrowserSurfaceManager,
} from './browser-surface-host.tsx';
import {
  SimulatorShellContent,
  SimulatorStatusBar,
  type SimulatorShellViewProps,
} from './ui.tsx';
import { parseShellRoute } from './routes.ts';
import { SIMULATOR_PRODUCT_COMMANDS } from '../state-engine/product-state.ts';
import type { ProductEnginePorts } from './chrome/product-presentation.tsx';
import {
  createAssignedRootRegistry,
  createBrowserReadinessPort,
  createReactCommitTracker,
  isSimulationDisclosureVisible,
} from '../lifecycle/browser-readiness.ts';
import '../styles.css';
/* Field shell chrome (prototype2 Aurora port) — imported from JS because the
 * CSS profile protocol pins src/styles.css to the exact Kit import sequence.
 * Order matters: tokens override Kit material tokens, then the surfaces. */
import './styles/tokens.css';
import './styles/field.css';
import './styles/panes.css';
import './styles/spatial-tide.css';
import type { JsonValue } from '../state-engine/json-value.ts';
import type { SimulatorModuleCatalogDeclaration } from '../state-engine/types.ts';
import { simulatorError } from '../state-engine/errors.ts';
import {
  bindScenarioModuleData,
  compileScenarioReadiness,
  launchScenarioInstances,
  type SimulatorScenarioPredicateDefinition,
} from './scenario-runtime.ts';
import type { SimulatorReadinessExpectation } from '../lifecycle/readiness.ts';
import { simulatorReferenceInteractionCatalog } from '../interactions/reference-ecosystem.ts';

const RESOLVED_MODULE_CATALOGS: readonly Omit<SimulatorModuleCatalogDeclaration, 'moduleData'>[] =
  simulatorResolvedModuleCatalogs;

function privilegedFunction<T extends (...args: never[]) => unknown>(
  guard: SimulatorGuardHandle,
  targetPath: string,
): T {
  const value = guard.privileged[targetPath];
  if (typeof value !== 'function') throw new Error(`SIMULATOR_PRIVILEGED_PORT_MISSING:${targetPath}`);
  return value as T;
}

function optionalPrivilegedFunction<T extends (...args: never[]) => unknown>(
  guard: SimulatorGuardHandle,
  targetPath: string,
): T | null {
  const value = guard.privileged[targetPath];
  return typeof value === 'function' ? value as T : null;
}

function ShellRoot({
  session,
  disclosureRoot,
  coordinator,
  surfaces,
}: {
  session: SimulatorSession;
  disclosureRoot: HTMLElement;
  coordinator: SimulatorGlobalCoordinator;
  surfaces: SimulatorBrowserSurfaceManager;
}) {
  const version = useSyncExternalStore(
    (listener) => session.subscribe(listener),
    () => `${session.epoch}:${session.phase}:${session.engine.getCommitted().revision}:${session.replayDigest() ?? ''}:${session.instances().map((entry) => `${entry.instanceId}:${entry.status}:${entry.readiness}`).join(',')}:${session.diagnostics.list().length}:${session.route().kind}`,
  );
  void version;
  // Identity-stable chrome ports: the flow runner's timer effect keys off
  // these identities, so they must not change per session tick.
  const subscribeFamily = useMemo(
    () => (familyId: string, handler: (event: unknown) => void): (() => void) | null => {
      const subscribed = coordinator.subscribeFamily(familyId, handler);
      return subscribed.ok ? subscribed.value : null;
    },
    [coordinator],
  );
  const stageElement = useMemo(
    () => (instanceId: string): HTMLElement | null => surfaces.stageElement(instanceId),
    [surfaces],
  );
  const productPorts = useMemo<ProductEnginePorts>(() => ({
    productState: () => session.productState(),
    productFlow: (flowId) => session.productFlow(flowId),
    dispatchProductCommand: (type, payload) => session.dispatchProductCommand(
      type as (typeof SIMULATOR_PRODUCT_COMMANDS)[keyof typeof SIMULATOR_PRODUCT_COMMANDS],
      payload,
    ),
    emitInteraction: (input) => session.engine.acceptCommand('simulator.interaction.emit', {
      protocol: 'nimi.simulator.interaction/v1',
      interactionId: input.interactionId,
      source: { moduleId: input.sourceModuleId, instanceId: input.sourceInstanceId },
      targets: [...input.targets],
      type: input.type,
      payload: input.payload,
    }, { kind: 'instance', moduleId: input.sourceModuleId, instanceId: input.sourceInstanceId }),
  }), [session]);
  const props: SimulatorShellViewProps = {
    epoch: session.epoch,
    phase: session.phase,
    registryDigest: simulatorResolvedRegistryDigest,
    replayDigest: session.replayDigest(),
    stateRevision: session.engine.getCommitted().revision,
    moduleCount: simulatorResolvedModules.length,
    route: session.route(),
    instances: session.instances(),
    diagnostics: session.diagnostics.list(),
    modules: simulatorResolvedModules.map((row) => ({
      moduleId: row.metadata.moduleId,
      surfaces: row.metadata.surfaces.map((surface) => ({ id: surface.id, label: surface.label })),
    })),
    onNavigate: (route) => session.navigate(route),
    onOpen: (moduleId, surfaceId) => {
      void session.openInstance(moduleId, surfaceId, { activateBeforeMount: true });
    },
    onClose: (instanceId) => { void session.closeInstance(instanceId); },
    onActivate: (instanceId) => { void session.activateInstance(instanceId); },
    onDeactivate: (instanceId) => { void session.deactivateInstance(instanceId); },
    onReset: () => { void resetAndRelaunch(session); },
    subscribeFamily,
    stageElement,
    productPorts,
  };
  return h(Fragment, null,
    createPortal(h(SimulatorStatusBar, props), disclosureRoot),
    h(SimulatorShellContent, props),
  );
}

let resetInFlight: Promise<void> | null = null;

function resetAndRelaunch(session: SimulatorSession): Promise<void> {
  if (resetInFlight) return resetInFlight;
  resetInFlight = (async () => {
    const reset = await session.resetScenario();
    if (!reset.ok) throw new Error(reset.error.code);
    await launchScenarioInstances(session, simulatorResolvedScenario.launch);
  })().catch(() => {
    session.engine.terminateIntegrity(simulatorError('SIMULATOR_INTEGRITY_FAILURE'));
  }).finally(() => {
    resetInFlight = null;
  });
  return resetInFlight;
}

export async function mountSimulatorShell(guard: SimulatorGuardHandle): Promise<void> {
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
  const qualificationBegin = optionalPrivilegedFunction<(
    input: { readonly instanceId: string; readonly surfaceId: string },
  ) => Promise<unknown>>(guard, 'globalThis.__NIMI_SIMULATOR_QUALIFICATION_BEGIN_V1__');
  const qualificationEnd = optionalPrivilegedFunction<(
    input: {
      readonly observationToken: string;
      readonly firstFrame: number | null;
      readonly secondFrame: number | null;
    },
  ) => Promise<unknown>>(guard, 'globalThis.__NIMI_SIMULATOR_QUALIFICATION_END_V1__');
  const qualificationMark = optionalPrivilegedFunction<(
    input: {
      readonly observationToken: string;
      readonly ordinal: 'first' | 'second';
      readonly frame: number;
    },
  ) => Promise<unknown>>(guard, 'globalThis.__NIMI_SIMULATOR_QUALIFICATION_MARK_V1__');
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
    paintCompositeEvidence: qualificationBegin && qualificationMark && qualificationEnd
      ? {
          async begin(input) {
            const token = await qualificationBegin.call(globalThis, input);
            return typeof token === 'string' && token.length >= 1 && token.length <= 256 ? token : null;
          },
          async mark(input) {
            return await qualificationMark.call(globalThis, input) === true;
          },
          async end(input) {
            return await qualificationEnd.call(globalThis, input) === true;
          },
        }
      : null,
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
  const readiness = compileScenarioReadiness({
    expectations: simulatorResolvedScenario.readiness as unknown as Readonly<Record<string, SimulatorReadinessExpectation>>,
    predicates: simulatorResolvedScenario.predicates as unknown as Readonly<Record<string, SimulatorScenarioPredicateDefinition>>,
    activeOverlayLeaseCount: () => surfaces.activeOverlayLeaseCount,
  });
  const session = createSimulatorSession({
    scenario: simulatorResolvedScenario.scenario,
    interactions: simulatorReferenceInteractionCatalog,
    registryModules: simulatorResolvedModules,
    moduleCatalogs: bindScenarioModuleData(
      RESOLVED_MODULE_CATALOGS,
      simulatorResolvedScenario.moduleData as unknown as Readonly<Record<string, JsonValue>>,
    ),
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
    readinessExpectations: readiness.expectations,
    readinessProjectionPredicates: readiness.projectionPredicates,
    readinessBlockingPredicates: readiness.blockingPredicates,
    onRouteChange: (route) => {
      surfaces.setFullWindow(route.kind === 'instance' ? route.instanceId : null);
    },
    writeRoute: (path, replace) => {
      if (replace) window.history.replaceState(null, '', path);
      else window.history.pushState(null, '', path);
    },
    simulationDisclosureVisible: () => {
      const status = document.querySelector('[data-testid="simulator-status"]');
      return isSimulationDisclosureVisible(
        status instanceof HTMLElement ? status : null,
        (element) => window.getComputedStyle(element),
      );
    },
  });
  session.engine.setCapabilities(new Set(simulatorResolvedScenario.enabledCapabilities));
  sessionRef.current = session;
  installSimulatorIntegrityListener({
    guard,
    coordinator,
    terminate: () => session.engine.terminateIntegrity(simulatorError('SIMULATOR_INTEGRITY_FAILURE')),
  });

  const root = createRoot(rootElement);
  flushSync(() => {
    root.render(
      h(StrictMode, null,
        h(ShellRoot, { session, disclosureRoot, coordinator, surfaces }),
        surfaces.renderPortals(),
      ),
    );
  });
  completeSimulatorBootstrapDisclosure(document);
  try {
    await launchScenarioInstances(session, simulatorResolvedScenario.launch);
  } catch (error) {
    const cause = error instanceof Error ? error.message : String(error);
    throw new Error(`SIMULATOR_SCENARIO_LAUNCH_FAILED:${cause}`);
  }
  const applyBrowserRoute = (): void => {
    const route = parseShellRoute({
      pathname: window.location.pathname,
      search: window.location.search,
      hash: window.location.hash,
    });
    if (route) session.navigate(route, { history: false });
  };
  // Instance routes hide every non-target surface. Apply them only after the
  // canonical Scenario has reached its visible readiness checkpoints so a
  // fresh deep link cannot invalidate or falsely fail background readiness.
  installSimulatorRouteHistoryListener({ coordinator, onHistory: applyBrowserRoute });
  applyBrowserRoute();
}
