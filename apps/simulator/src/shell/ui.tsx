/**
 * Simulator Shell view: one persistent simulated-status surface, Shell-owned
 * navigation, the instance window area, and the diagnostics region — composed
 * inside the prototype2 "Aurora field" chrome (Field sky, Cradle panes,
 * draggable surface windows, AppRail, Spine, Lens, Tide, Apps page, Field
 * menu, Sky panel, toast).
 *
 * Authority: P-SIM-001 (persistent, accessible simulation disclosure in
 * normal, loading, full-window, modal, instance-failure, and
 * session-failure states) and P-SIM-017.
 */

import { Fragment, useEffect, useMemo, useRef, type ReactElement, type MouseEvent as ReactMouseEvent } from 'react';
import type { SimulatorDiagnostic } from './diagnostics.ts';
import type { SimulatorShellRoute } from './routes.ts';
import type { SimulatorSessionInstanceView } from './session.ts';
import { UiProvider, useUi, PHASE_LABEL } from './chrome/ui-context.tsx';
import { ShellActionsProvider, type ShellActions } from './chrome/shell-actions.tsx';
import {
  ProductPresentationProvider,
  useProductPresentation,
  type ProductEnginePorts,
} from './chrome/product-presentation.tsx';
import { Field } from './chrome/field.tsx';
import { SpatialStage } from './chrome/spatial-stage.tsx';
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
  readonly onOpen: (moduleId: string, surfaceId: string) => void;
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

function Navigation(props: SimulatorShellViewProps): ReactElement {
  return (
    <nav className="simulator-nav" aria-label="Simulator">
      <a
        href="/"
        onClick={(event) => {
          event.preventDefault();
          props.onNavigate({ kind: 'home' });
        }}
        aria-current={props.route.kind === 'home' ? 'page' : undefined}
      >
        Home
      </a>
      <a
        href="/diagnostics"
        onClick={(event) => {
          event.preventDefault();
          props.onNavigate({ kind: 'diagnostics' });
        }}
        aria-current={props.route.kind === 'diagnostics' ? 'page' : undefined}
      >
        Diagnostics
      </a>
    </nav>
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
    </main>
  );
}

const BLOCK_MENU = '.pane-float, .simulator-surface, .spine, .app-rail, .apps-page, .apps-backdrop, .lens-backdrop, .toast-float, .field-menu, .sky-panel, .simulator-nav, .simulator-diagnostics, button, input';

/** Shell-global keyboard chrome (⌘K Lens, ` Tide, Escape ordering). Rides the
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
      const inEditable = Boolean(target?.matches('input, textarea, select, [contenteditable="true"]'));
      if ((e.metaKey || e.ctrlKey) && typeof e.key === 'string' && e.key.toLowerCase() === 'k') {
        e.preventDefault?.();
        state.ui.setLensOpen(!state.ui.lensOpen);
        return;
      }
      if (inDialog) return;
      if (e.key === '`' || e.key === '~') {
        if (inEditable) return;
        e.preventDefault?.();
        state.ui.toggleTide();
        return;
      }
      if (e.key === 'Escape') {
        if (state.ui.lensOpen) state.ui.setLensOpen(false);
        else if (state.ui.fieldMenu) state.ui.setFieldMenu(null);
        else if (state.ui.skyPanelOpen) state.ui.setSkyPanelOpen(false);
        else if (state.presentation.ledgerOpen) state.presentation.toggleLedger();
        else if (state.ui.tide) state.ui.toggleTide();
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
    ui.phase === 'auto' ? `自动（${PHASE_LABEL[ui.effectivePhase].slice(0, 1)}）` : PHASE_LABEL[ui.phase];

  if (props.route.kind === 'instance') {
    return (
      <div
        className="simulator-shell simulator-shell--full-window"
      >
        <FullWindowView {...props} />
        <WindowManager />
      </div>
    );
  }

  return (
    <div
      className="simulator-shell"
    >
      <Field phase={ui.effectivePhase}>
        {props.route.kind === 'home' ? (
          <SpatialStage active={ui.tide} onContextMenu={onContextMenu} onExit={ui.toggleTide}>
            <Cradle />
          </SpatialStage>
        ) : null}
        {props.route.kind === 'diagnostics' ? <DiagnosticsView {...props} /> : null}
        <WindowManager />
      </Field>
      {/*
        Interactive chrome lives OUTSIDE the Field: `.field` (position: fixed)
        forms its own stacking context below the `#simulator-surfaces` window
        layer (z 40), which would bury every overlapping chrome element under
        App windows. These elements are all individually fixed-positioned with
        z ≥ 60, so as root-level siblings they stack above surfaces and below
        the disclosure bar (z 2010099).
      */}
      <Navigation {...props} />
      <AppRail />
      <Spine />
      <Lens />
      <AppsPage />
      <SkyPanel />
      <ToastFloat />
      <AgentLayer />
      <ConsentOverlay />
      {ui.receiptGrantId ? (
        <GrantReceiptDialog grantId={ui.receiptGrantId} onClose={() => ui.setReceiptGrantId(null)} />
      ) : null}
      <LedgerDrawer />
      {ui.tide ? <div className="tide-caption">The Tide · 滚轮聚焦 · Esc 返回</div> : null}
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
          { id: 'tide', label: 'Tide 概览', hint: '`', run: ui.toggleTide },
          { id: 'phase', label: `切换相位（当前 ${phaseLabel}）`, hint: '◐', run: ui.cyclePhase },
          { id: 'sky', label: '光影与时间', hint: '☼', run: () => ui.setSkyPanelOpen(true) },
          { id: 'home', label: '回到基座', hint: 'cradle', run: () => props.onNavigate({ kind: 'home' }) },
        ]}
      />
    </div>
  );
}

export function SimulatorShellContent(props: SimulatorShellViewProps): ReactElement {
  const actions: ShellActions = useMemo(() => ({
    phase: props.phase,
    route: props.route,
    instances: props.instances,
    modules: props.modules,
    moduleCount: props.moduleCount,
    open: props.onOpen,
    close: props.onClose,
    activate: props.onActivate,
    deactivate: props.onDeactivate,
    navigate: props.onNavigate,
    reset: props.onReset,
  }), [props]);
  return (
    <UiProvider subscribeFamily={props.subscribeFamily} stageElement={props.stageElement}>
      <ShellActionsProvider value={actions}>
        <ProductPresentationProvider ports={props.productPorts}>
          <ShellChrome {...props} />
        </ProductPresentationProvider>
      </ShellActionsProvider>
    </UiProvider>
  );
}

/** Standalone/test composition. Production portals the status outside every inertable App/Shell root. */
export function SimulatorShellView(props: SimulatorShellViewProps): ReactElement {
  return (
    <Fragment>
      <SimulatorStatusBar {...props} />
      <SimulatorShellContent {...props} />
    </Fragment>
  );
}
