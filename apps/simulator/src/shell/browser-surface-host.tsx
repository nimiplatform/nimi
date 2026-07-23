/**
 * Browser-owned surface composition for canonical App renderer instances.
 * Each instance receives collision-free renderer/overlay roots, one Kit host
 * binding, one portal in the Simulator's only React root, and one
 * overlay-coordinator lease boundary.
 *
 * Authority: P-SIM-006, P-SIM-013, P-SIM-014, P-SIM-017.
 */

import {
  Component,
  createElement as h,
  useSyncExternalStore,
  type ErrorInfo,
  type ReactNode,
} from 'react';
import { createPortal, flushSync } from 'react-dom';
import {
  NimiRendererHostProvider,
  createNimiRendererHostBinding,
  createNimiRendererThemeController,
  type NimiRendererHostBindingV1,
  type NimiRendererHostMethodMap,
  type NimiRendererHostResult,
} from '@nimiplatform/kit/shell/renderer/host';

import type { SimulatorGuardHandle } from '../effects/guards.ts';
import type { SimulatorAssignedRootRegistry, SimulatorReactCommitTracker } from '../lifecycle/browser-readiness.ts';
import type { SimulatorCanonicalInstance } from '../lifecycle/renderer-contract.ts';
import type { SimulatorPreparedSurfaceHost } from '../lifecycle/instance-host.ts';
import { assertJsonValue, type JsonValue } from '../state-engine/json-value.ts';
import type { SimulatorStateEngine } from '../state-engine/engine.ts';
import type { SimulatorGlobalCoordinator } from './global-coordinator.ts';
import { sha256HexOfText } from '../state-engine/sha256.ts';
import {
  createSimulatorOverlayCoordinator,
  type SimulatorOverlayCoordinator,
} from './overlay-coordinator.ts';

type KitMethod = keyof NimiRendererHostMethodMap & string;

export interface SimulatorBrowserSurfaceManagerOptions {
  readonly guard: SimulatorGuardHandle;
  readonly document: Document;
  readonly simulatorRoot: HTMLElement;
  readonly shellRoot: HTMLElement;
  readonly assignedRoots: SimulatorAssignedRootRegistry;
  readonly commits: SimulatorReactCommitTracker;
  readonly listeners: SimulatorGlobalCoordinator;
  readonly supportedKitCapabilities: ReadonlySet<string>;
  readonly invokeKitOperation: (input: {
    readonly moduleId: string;
    readonly instanceId: string;
    readonly method: string;
    readonly value: JsonValue;
  }) => Promise<NimiRendererHostResult<JsonValue>>;
  readonly reportReadyCandidate: (input: {
    readonly instanceId: string;
    readonly surfaceId: string;
    readonly contractId: string;
  }) => void;
}

export interface SimulatorBrowserSurfacePrepareInput {
  readonly engine: SimulatorStateEngine;
  readonly moduleId: string;
  readonly instanceId: string;
  readonly surfaceId: string;
  readonly readinessContractId: string;
  readonly kitCapabilities: readonly string[];
  readonly failInstance: (instanceId: string, cause: string) => void;
}

export interface SimulatorBrowserSurfaceManager {
  prepare(input: SimulatorBrowserSurfacePrepareInput): SimulatorPreparedSurfaceHost;
  setFullWindow(instanceId: string | null): void;
  renderPortals(): ReactNode;
  /** The imperative stage section for a live instance, or null when the
   * instance has no allocated surface. Shell chrome uses this to project
   * window geometry and to host the window-chrome portal. */
  stageElement(instanceId: string): HTMLElement | null;
  readonly liveSurfaceCount: number;
  readonly activeOverlayLeaseCount: number;
}

interface SurfaceRecord {
  readonly instanceId: string;
  readonly surfaceId: string;
  readonly stage: HTMLElement;
  readonly rendererRoot: HTMLElement;
  readonly overlayRoot: HTMLElement;
  readonly failInstance: (instanceId: string, cause: string) => void;
  readonly commitObserver: MutationObserver;
  binding: NimiRendererHostBindingV1<NimiRendererHostMethodMap> | null;
  canonical: SimulatorCanonicalInstance | null;
  mounted: boolean;
  unmounted: boolean;
}

interface BoundaryProps {
  readonly instanceId: string;
  readonly failInstance: (instanceId: string, cause: string) => void;
  readonly children: ReactNode;
}

class CanonicalSurfaceBoundary extends Component<BoundaryProps, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo): void {
    this.props.failInstance(this.props.instanceId, 'canonical-render-failure');
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

function CanonicalSurface(props: {
  readonly canonical: SimulatorCanonicalInstance;
  readonly surfaceId: string;
  readonly runRenderer: <T>(callback: () => T) => T;
}): ReactNode {
  const { canonical, surfaceId } = props;
  return props.runRenderer(() => canonical.surfaces[surfaceId].render() as ReactNode);
}

function validKitCapability(value: string): value is KitMethod {
  return /^nimi\.shell\.[A-Za-z0-9.-]{1,224}$/u.test(value);
}

function opaqueScopePrefix(input: SimulatorBrowserSurfacePrepareInput): string {
  const identity = `${input.engine.epoch}\u0000${input.moduleId}\u0000${input.instanceId}\u0000${input.surfaceId}`;
  return `nimi-scope-${sha256HexOfText(identity).slice(0, 32)}`;
}

export function createSimulatorBrowserSurfaceManager(
  options: SimulatorBrowserSurfaceManagerOptions,
): SimulatorBrowserSurfaceManager {
  const records = new Map<string, SurfaceRecord>();
  const portalListeners = new Set<() => void>();
  const theme = createNimiRendererThemeController({
    scheme: 'dark',
    accentPack: 'nimi-accent',
    density: 'regular',
  });
  let engine: SimulatorStateEngine | null = null;
  let overlays: SimulatorOverlayCoordinator | null = null;
  let portalVersion = 0;
  let fullWindowInstanceId: string | null = null;

  const surfaceContainer = options.document.createElement('div');
  surfaceContainer.id = 'simulator-surfaces';
  surfaceContainer.className = 'simulator-surfaces';
  options.simulatorRoot.append(surfaceContainer);

  function coordinator(nextEngine: SimulatorStateEngine): SimulatorOverlayCoordinator {
    if (engine && engine !== nextEngine) throw new Error('SIMULATOR_SURFACE_ENGINE_DRIFT');
    engine = nextEngine;
    if (!overlays) {
      overlays = createSimulatorOverlayCoordinator({
        engine: nextEngine,
        listeners: options.listeners,
        simulatorRoot: options.simulatorRoot,
        interactiveRoots: () => [options.shellRoot, surfaceContainer],
        diagnosticsRoots: () => [...options.shellRoot.querySelectorAll<HTMLElement>('.simulator-diagnostics')],
        safeFocusTarget: () => options.shellRoot,
        effectScope: {
          run: (owner, phase, callback) => options.guard.withScope({ owner, phase }, callback),
        },
        onInstanceCallbackFailure: (instanceId, cause) => {
          records.get(instanceId)?.failInstance(instanceId, cause);
        },
      });
    }
    return overlays;
  }

  function publishPortals(): void {
    portalVersion += 1;
    for (const listener of portalListeners) listener();
  }

  function SurfacePortals(): ReactNode {
    useSyncExternalStore(
      (listener) => {
        portalListeners.add(listener);
        return () => portalListeners.delete(listener);
      },
      () => portalVersion,
      () => portalVersion,
    );
    return [...records.values()]
      .filter((record) => record.mounted && !record.unmounted && record.canonical && record.binding)
      .map((record) => createPortal(
        h(CanonicalSurfaceBoundary, {
          instanceId: record.instanceId,
          failInstance: record.failInstance,
          children: h(NimiRendererHostProvider<NimiRendererHostMethodMap>, {
            binding: record.binding as NimiRendererHostBindingV1<NimiRendererHostMethodMap>,
            children: h(CanonicalSurface, {
              canonical: record.canonical as SimulatorCanonicalInstance,
              surfaceId: record.surfaceId,
              runRenderer: (callback) => options.guard.withScope({
                owner: 'canonical-renderer',
                phase: 'render',
              }, callback),
            }),
          }),
        }),
        record.rendererRoot,
        record.instanceId,
      ));
  }

  function allocateRoots(input: SimulatorBrowserSurfacePrepareInput): SurfaceRecord {
    if (records.has(input.instanceId)) throw new Error('SIMULATOR_SURFACE_DUPLICATE');
    if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(input.moduleId)) {
      throw new Error('SIMULATOR_MODULE_ROOT_CLASS_INVALID');
    }
    const moduleRootClass = `nimi-ui-module--${input.moduleId}`;
    const stage = options.document.createElement('section');
    stage.className = 'simulator-surface';
    stage.dataset.instanceId = input.instanceId;
    stage.dataset.moduleId = input.moduleId;
    stage.dataset.surfaceId = input.surfaceId;
    stage.hidden = fullWindowInstanceId !== null && fullWindowInstanceId !== input.instanceId;
    stage.dataset.fullWindow = fullWindowInstanceId === input.instanceId ? 'true' : 'false';
    const rendererRoot = options.document.createElement('div');
    rendererRoot.className = `simulator-surface__renderer ${moduleRootClass}`;
    const overlayRoot = options.document.createElement('div');
    overlayRoot.className = `simulator-surface__overlays ${moduleRootClass}`;
    // Shell-owned window chrome host: stays empty until the shell
    // WindowManager portals the header into it. It must precede the
    // renderer/overlay roots and carry no App content.
    const chromeRoot = options.document.createElement('div');
    chromeRoot.className = 'simulator-surface__chrome';
    stage.append(chromeRoot, rendererRoot, overlayRoot);
    surfaceContainer.append(stage);
    options.assignedRoots.assign(input.instanceId, input.surfaceId, {
      renderer: rendererRoot,
      overlay: overlayRoot,
    });
    const commitScope = { instanceId: input.instanceId, surfaceId: input.surfaceId };
    const commitObserver = options.guard.withScope(
      { owner: 'simulator-shell', phase: 'instance-lifecycle' },
      () => new MutationObserver(() => {
        options.guard.withScope(
          { owner: 'simulator-shell', phase: 'callback' },
          () => { options.commits.recordCommit(commitScope); },
        );
      }),
    );
    commitObserver.observe(rendererRoot, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });
    commitObserver.observe(overlayRoot, {
      attributes: true,
      characterData: true,
      childList: true,
      subtree: true,
    });
    const record: SurfaceRecord = {
      instanceId: input.instanceId,
      surfaceId: input.surfaceId,
      stage,
      rendererRoot,
      overlayRoot,
      failInstance: input.failInstance,
      commitObserver,
      binding: null,
      canonical: null,
      mounted: false,
      unmounted: false,
    };
    records.set(input.instanceId, record);
    return record;
  }

  const manager: SimulatorBrowserSurfaceManager = {
    prepare(input) {
      const unsupported = input.kitCapabilities.filter((capability) => (
        !validKitCapability(capability) || !options.supportedKitCapabilities.has(capability)
      ));
      if (unsupported.length > 0) {
        throw new Error(`SIMULATOR_KIT_CAPABILITY_UNAVAILABLE:${unsupported.join(',')}`);
      }
      const record = allocateRoots(input);
      const overlayResult = coordinator(input.engine).createInstanceHost({
        moduleId: input.moduleId,
        instanceId: input.instanceId,
        rendererRoot: record.rendererRoot,
        overlayRoot: record.overlayRoot,
      });
      if (!overlayResult.ok) {
        record.commitObserver.disconnect();
        options.commits.release({ instanceId: input.instanceId, surfaceId: input.surfaceId });
        records.delete(input.instanceId);
        options.assignedRoots.release(input.instanceId, input.surfaceId);
        record.stage.remove();
        throw new Error(overlayResult.error.code);
      }
      const overlayHost = overlayResult.value;
      const methods = input.kitCapabilities.filter(validKitCapability);
      const binding = createNimiRendererHostBinding<NimiRendererHostMethodMap>({
        opaqueScopePrefix: opaqueScopePrefix(input),
        declaredMethods: methods,
        capabilities: methods,
        localization: { locale: 'en-US', language: 'en', direction: 'ltr' },
        targets: { renderer: record.rendererRoot, overlay: record.overlayRoot },
        theme,
        operations: {
          invoke: (method, value) => options.invokeKitOperation({
            moduleId: input.moduleId,
            instanceId: input.instanceId,
            method,
            value: assertJsonValue(value, '$.kitOperation'),
          }),
        },
        overlays: overlayHost.port,
        surfaceLifecycle: {
          reportReadyCandidate: ({ contractId }) => options.reportReadyCandidate({
            instanceId: input.instanceId,
            surfaceId: input.surfaceId,
            contractId,
          }),
        },
      });
      record.binding = binding;

      const surfaceHost: SimulatorPreparedSurfaceHost = {
        kit: binding.facade,
        mount(canonical) {
          if (record.mounted || record.unmounted) throw new Error('SIMULATOR_SURFACE_MOUNT_INVALID');
          record.canonical = canonical;
          record.mounted = true;
          // Schedule the portal after the host commits prepare_success. A
          // synchronous render here would let the App's readiness candidate
          // precede the authoritative lifecycle transition.
          publishPortals();
        },
        async unmount() {
          if (record.unmounted) return;
          const reason = input.engine.phase === 'resetting' ? 'reset' : 'dispose';
          const dismissed = await overlayHost.requestDismissAll(reason);
          let failure = dismissed.ok ? null : new Error(dismissed.error.code);
          record.unmounted = true;
          record.commitObserver.disconnect();
          options.commits.release({ instanceId: input.instanceId, surfaceId: input.surfaceId });
          flushSync(publishPortals);
          record.canonical = null;
          const released = await overlayHost.acknowledgeInstanceUnmounted(reason);
          if (!released.ok && !failure) failure = new Error(released.error.code);
          try {
            options.assignedRoots.release(input.instanceId, input.surfaceId);
          } catch (error) {
            if (!failure) failure = error instanceof Error ? error : new Error(String(error));
          }
          records.delete(input.instanceId);
          record.stage.remove();
          record.binding = null;
          if (failure) throw failure;
        },
      };
      return Object.freeze(surfaceHost);
    },
    setFullWindow(instanceId) {
      fullWindowInstanceId = instanceId;
      surfaceContainer.dataset.fullWindow = instanceId ? 'true' : 'false';
      for (const record of records.values()) {
        record.stage.hidden = instanceId !== null && record.instanceId !== instanceId;
        record.stage.dataset.fullWindow = instanceId === record.instanceId ? 'true' : 'false';
      }
    },
    renderPortals() {
      return h(SurfacePortals);
    },
    stageElement(instanceId) {
      return records.get(instanceId)?.stage ?? null;
    },
    get liveSurfaceCount() {
      return records.size;
    },
    get activeOverlayLeaseCount() {
      return overlays?.activeLeaseCount() ?? 0;
    },
  };
  return Object.freeze(manager);
}
