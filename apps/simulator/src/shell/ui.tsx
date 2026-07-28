/**
 * Simulator Shell view: one persistent simulated-status surface plus the
 * instance window area and diagnostics region, composed inside the Aurora
 * field chrome.
 *
 * Authority: .nimi/spec/platform/simulator.authority.yaml.
 */

import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type ReactElement,
  type MouseEvent as ReactMouseEvent,
} from 'react';
import type { SimulatorDiagnostic } from './diagnostics.ts';
import type { SimulatorShellRoute } from './routes.ts';
import type { SimulatorSessionInstanceView } from './session.ts';
import { UiProvider, useUi, SCENE_PHASE_LABEL } from './chrome/ui-context.tsx';
import { ShellActionsProvider, type ShellActions } from './chrome/shell-actions.tsx';
import {
  ProductPresentationProvider,
  useProductPresentation,
  type ProductEnginePorts,
} from './chrome/product-presentation.tsx';
import { Field } from './chrome/field.tsx';
import { Cradle } from './chrome/cradle.tsx';
import { WindowManager } from './chrome/window-manager.tsx';
import { AppRail } from './chrome/app-rail.tsx';
import { Spine } from './chrome/spine.tsx';
import { Lens } from './chrome/lens.tsx';
import { AppsPage } from './chrome/apps-page.tsx';
import { FieldMenu } from './chrome/field-menu.tsx';
import { SkyPanel } from './chrome/sky-panel.tsx';
import { ToastFloat } from './chrome/toast-float.tsx';
import { ConsentOverlay } from './chrome/consent-overlay.tsx';
import { GrantDock } from './chrome/grant-dock.tsx';
import { GrantReceiptDialog } from './chrome/grant-receipt.tsx';
import { LedgerDrawer } from './chrome/ledger-drawer.tsx';
import { AgentLayer } from './chrome/agent-layer.tsx';

export const SIMULATOR_STATUS_TEXT = 'Nimi Ecosystem Simulator — simulated data and effects';

export interface SimulatorShellViewProps {
  readonly epoch: number;
  readonly phase: 'open' | 'resetting' | 'terminal';
  readonly moduleCount: number;
  readonly route: SimulatorShellRoute;
  readonly instances: readonly SimulatorSessionInstanceView[];
  readonly diagnostics: readonly SimulatorDiagnostic[];
  readonly modules: readonly {
    readonly moduleId: string;
    readonly surfaces: readonly { readonly id: string; readonly label: string }[];
  }[];
  readonly onNavigate: (route: SimulatorShellRoute) => void;
  readonly onOpen: (moduleId: string, surfaceId: string) => Promise<string | null>;
  readonly onClose: (instanceId: string) => void;
  readonly onActivate: (instanceId: string) => void;
  readonly onDeactivate: (instanceId: string) => void;
  readonly onReset: () => void;
  /** Chrome host ports (production wires the global-listener coordinator and
   * the browser surface manager; tests leave both absent). */
  readonly subscribeFamily?: (familyId: string, handler: (event: unknown) => void) => (() => void) | null;
  readonly stageElement?: (instanceId: string) => HTMLElement | null;
  /** Engine ports for the product presentation layer (session-wired in
   * production; absent in standalone/SSR composition). */
  readonly productPorts?: ProductEnginePorts;
}

export function SimulatorStatusBar(props: SimulatorShellViewProps): ReactElement {
  return (
    <header
      className="simulator-status"
      data-testid="simulator-status"
      role="status"
      aria-live="polite"
    >
      <span className="simulator-status__text">{SIMULATOR_STATUS_TEXT}</span>
      <output aria-label="Epoch" className="simulator-status__epoch">{`epoch ${props.epoch}`}</output>
      {props.phase !== 'open' ? (
        <output aria-label="Session state" className="simulator-status__phase">{props.phase}</output>
      ) : null}
    </header>
  );
}

function FullWindowView(props: SimulatorShellViewProps): ReactElement {
  const fullWindowInstanceId = props.route.kind === 'instance' ? props.route.instanceId : null;
  const instance = fullWindowInstanceId
    ? props.instances.find((entry) => entry.instanceId === fullWindowInstanceId) ?? null
    : null;
  return (
    <main
      className="simulator-full-window"
      data-full-window-instance={instance?.instanceId}
    >
      <button
        type="button"
        onClick={() => props.onNavigate({ kind: 'home' })}
      >
        Exit full window
      </button>
      <span role="status" aria-live="polite">
        {instance ? `${instance.moduleId} full window` : 'Requested instance is unavailable'}
      </span>
    </main>
  );
}

function DiagnosticsView(props: SimulatorShellViewProps): ReactElement {
  return (
    <main className="simulator-diagnostics">
      <h1 className="simulator-diagnostics__title">Session diagnostics</h1>
      <section className="simulator-diagnostics__section" aria-labelledby="simulator-instance-diagnostics-title">
        <h2 id="simulator-instance-diagnostics-title" className="simulator-diagnostics__section-title">
          App instances
        </h2>
        {props.instances.length === 0 ? (
          <p className="simulator-diagnostics__empty">No App instances are open.</p>
        ) : (
          <ul className="simulator-windows" aria-label="Open instances">
            {props.instances.map((instance) => (
              <li
                key={instance.instanceId}
                className="simulator-windows__item"
                data-instance-status={instance.status}
                data-readiness-status={instance.readiness}
                data-instance-id={instance.instanceId}
                data-module-id={instance.moduleId}
                data-surface-id={instance.surfaceId}
              >
                <span>{`${instance.moduleId} — ${instance.status} — ${instance.readiness}`}</span>
                {instance.status === 'active' ? (
                  <button type="button" onClick={() => props.onDeactivate(instance.instanceId)}>Deactivate</button>
                ) : instance.status === 'inactive' ? (
                  <button type="button" onClick={() => props.onActivate(instance.instanceId)}>Activate</button>
                ) : null}
                {instance.status === 'active' || instance.status === 'inactive' ? (
                  <button
                    type="button"
                    onClick={() => props.onNavigate({
                      kind: 'instance',
                      instanceId: instance.instanceId,
                      appRoute: instance.route,
                    })}
                  >
                    Full window
                  </button>
                ) : null}
                {instance.status !== 'disposed' ? (
                  <button type="button" onClick={() => props.onClose(instance.instanceId)}>Close</button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="simulator-diagnostics__section" aria-labelledby="simulator-session-diagnostics-title">
        <h2 id="simulator-session-diagnostics-title" className="simulator-diagnostics__section-title">
          Events
        </h2>
        {props.diagnostics.length === 0 ? (
          <p className="simulator-diagnostics__empty">No diagnostics recorded.</p>
        ) : (
          <ul className="simulator-diagnostics__list">
            {props.diagnostics.map((diagnostic) => (
              <li
                key={diagnostic.diagnosticId}
                className={`simulator-diagnostics__item simulator-diagnostics__item--${diagnostic.scope}`}
              >
                {`${diagnostic.scope}: ${diagnostic.code}`}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

const BLOCK_MENU = '.pane-float, .simulator-surface, .spine, .app-rail, .apps-page, .apps-backdrop, .lens-backdrop, .toast-float, .field-menu, .sky-panel, .simulator-diagnostics, button, input';

/** Shell-global keyboard chrome (⌘K Lens and Escape ordering). Rides the
 * admitted `keyboard` listener family through the global coordinator. */
function useChromeKeyboard(): void {
  const ui = useUi();
  const presentation = useProductPresentation();
  const latest = useRef({ ui, presentation });
  latest.current = { ui, presentation };
  useEffect(() => {
    const unsubscribe = ui.subscribeFamily('keyboard', (event) => {
      const e = event as Partial<KeyboardEvent>;
      if (e.type !== 'keydown') return;
      const state = latest.current;
      const target = e.target instanceof HTMLElement ? e.target : null;
      const inDialog = Boolean(target?.closest('[role="dialog"]'));
      if ((e.metaKey || e.ctrlKey) && typeof e.key === 'string' && e.key.toLowerCase() === 'k') {
        e.preventDefault?.();
        state.ui.setLensOpen(!state.ui.lensOpen);
        return;
      }
      if (inDialog) return;
      if (e.key === 'Escape') {
        if (state.ui.lensOpen) state.ui.setLensOpen(false);
        else if (state.ui.fieldMenu) state.ui.setFieldMenu(null);
        else if (state.ui.skyPanelOpen) state.ui.setSkyPanelOpen(false);
        else if (state.presentation.ledgerOpen) state.presentation.toggleLedger();
      }
    });
    return () => unsubscribe?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ui.subscribeFamily]);
}

function ShellChrome(props: SimulatorShellViewProps): ReactElement {
  const ui = useUi();
  useChromeKeyboard();
  const liveInstances = props.instances.filter((instance) => instance.status !== 'disposed');

  const onContextMenu = (e: ReactMouseEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest(BLOCK_MENU)) return;
    e.preventDefault();
    ui.setFieldMenu({ x: e.clientX, y: e.clientY });
  };

  const phaseLabel =
    ui.phase === 'auto'
      ? `演进（${SCENE_PHASE_LABEL[ui.effectivePhase].slice(0, 2)}）`
      : SCENE_PHASE_LABEL[ui.phase];

  if (props.route.kind === 'instance') {
    return (
      <>
        <WindowManager />
        <div
          className="simulator-shell simulator-shell--full-window"
        >
          <FullWindowView {...props} />
        </div>
      </>
    );
  }

  return (
    <>
      <WindowManager />
      <div
        className="simulator-shell"
      >
        <Field phase={ui.effectivePhase}>
          {props.route.kind === 'home' ? (
            <div className="stage" onContextMenu={onContextMenu}>
              <Cradle />
            </div>
          ) : null}
          {props.route.kind === 'diagnostics' ? <DiagnosticsView {...props} /> : null}
        </Field>
        {/*
          Interactive chrome lives OUTSIDE the Field: `.field` (position: fixed)
          covers the base App layer during Scenario readiness. App surfaces rise
          above it only after an explicit window interaction, while the home
          depth workspace participates in the same last-interaction stacking
          order.
          These elements are all individually fixed-positioned with z ≥ 60, so
          as root-level siblings they stack above surfaces.
        */}
        <AppRail />
        <Spine />
        <Lens />
        <AppsPage />
        <SkyPanel />
        <ToastFloat />
        <AgentLayer />
        <GrantDock />
        <ConsentOverlay />
        {ui.receiptGrantId ? (
          <GrantReceiptDialog grantId={ui.receiptGrantId} onClose={() => ui.setReceiptGrantId(null)} />
        ) : null}
        <LedgerDrawer />
        <FieldMenu
          items={[
          {
            id: 'tidy',
            label: '整理场 · tidy panes',
            hint: 'tidy',
            run: () => {
              ui.tidyPanes();
              ui.tidyWindows(liveInstances.map((entry) => ({
                instanceId: entry.instanceId,
                moduleId: entry.moduleId,
              })));
            },
          },
          { id: 'lens', label: '打开 Lens', hint: '⌘K', run: () => ui.setLensOpen(true) },
          {
            id: 'phase',
            label: `切换月昼相位（当前 ${phaseLabel}）`,
            hint: '◐',
            run: ui.cycleScenePhase,
          },
          { id: 'sky', label: '光影与时间', hint: '☼', run: () => ui.setSkyPanelOpen(true) },
          { id: 'home', label: '回到基座', hint: 'cradle', run: () => props.onNavigate({ kind: 'home' }) },
          {
            id: 'reset',
            label: '重置场景',
            hint: 'reset',
            simulatorAction: 'reset',
            run: props.onReset,
          },
          ]}
        />
      </div>
    </>
  );
}

function SimulatorShellProviders(props: SimulatorShellViewProps): ReactElement {
  const ui = useUi();
  const open = useCallback((moduleId: string, surfaceId: string) => {
    void props.onOpen(moduleId, surfaceId).then((instanceId) => {
      if (instanceId) ui.presentWindow(instanceId, moduleId);
    });
  }, [props.onOpen, ui]);
  const actions: ShellActions = useMemo(() => ({
    epoch: props.epoch,
    phase: props.phase,
    route: props.route,
    instances: props.instances,
    modules: props.modules,
    moduleCount: props.moduleCount,
    open,
    close: props.onClose,
    activate: props.onActivate,
    deactivate: props.onDeactivate,
    navigate: props.onNavigate,
    reset: props.onReset,
  }), [open, props]);
  return (
    <ShellActionsProvider value={actions}>
      <ProductPresentationProvider ports={props.productPorts}>
        <ShellChrome {...props} />
      </ProductPresentationProvider>
    </ShellActionsProvider>
  );
}

export function SimulatorShellContent(props: SimulatorShellViewProps): ReactElement {
  return (
    <UiProvider subscribeFamily={props.subscribeFamily} stageElement={props.stageElement}>
      <SimulatorShellProviders {...props} />
    </UiProvider>
  );
}

/** Standalone/test composition. */
export function SimulatorShellView(props: SimulatorShellViewProps): ReactElement {
  return (
    <Fragment>
      <SimulatorStatusBar {...props} />
      <SimulatorShellContent {...props} />
    </Fragment>
  );
}
