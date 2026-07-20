/**
 * Simulator Shell view: one persistent simulated-status surface, Shell-owned
 * navigation, the instance window area, and the diagnostics region.
 *
 * Written with createElement (no JSX) so the exact production components
 * also run under Node's type-stripping test runner.
 *
 * Authority: P-SIM-001 (persistent, accessible simulation disclosure in
 * normal, loading, full-window, modal, instance-failure, and
 * session-failure states) and P-SIM-017.
 */

import { Fragment, createElement as h, type ReactElement } from 'react';
import type { SimulatorDiagnostic } from './diagnostics.ts';
import type { SimulatorShellRoute } from './routes.ts';
import type { SimulatorSessionInstanceView } from './session.ts';

export const SIMULATOR_STATUS_TEXT = 'Nimi Ecosystem Simulator — simulated data and effects';

export interface SimulatorShellViewProps {
  readonly epoch: number;
  readonly phase: 'open' | 'resetting' | 'terminal';
  readonly registryDigest: string;
  readonly moduleCount: number;
  readonly route: SimulatorShellRoute;
  readonly instances: readonly SimulatorSessionInstanceView[];
  readonly diagnostics: readonly SimulatorDiagnostic[];
  readonly onNavigate: (route: SimulatorShellRoute) => void;
}

export function SimulatorStatusBar(props: SimulatorShellViewProps): ReactElement {
  return h('header', {
    className: 'simulator-status',
    'data-testid': 'simulator-status',
    role: 'status',
    'aria-live': 'polite',
  },
    h('span', { className: 'simulator-status__text' }, SIMULATOR_STATUS_TEXT),
    h('output', { 'aria-label': 'Epoch', className: 'simulator-status__epoch' }, `epoch ${props.epoch}`),
    props.phase !== 'open'
      ? h('output', { 'aria-label': 'Session state', className: 'simulator-status__phase' }, props.phase)
      : null,
  );
}

function Navigation(props: SimulatorShellViewProps): ReactElement {
  return h('nav', { className: 'simulator-nav', 'aria-label': 'Simulator' },
    h('a', {
      href: '/',
      onClick: (event: { preventDefault(): void }) => {
        event.preventDefault();
        props.onNavigate({ kind: 'home' });
      },
      'aria-current': props.route.kind === 'home' ? 'page' : undefined,
    }, 'Home'),
    h('a', {
      href: '/diagnostics',
      onClick: (event: { preventDefault(): void }) => {
        event.preventDefault();
        props.onNavigate({ kind: 'diagnostics' });
      },
      'aria-current': props.route.kind === 'diagnostics' ? 'page' : undefined,
    }, 'Diagnostics'),
  );
}

function HomeView(props: SimulatorShellViewProps): ReactElement {
  return h('main', { className: 'simulator-home' },
    h('p', { className: 'simulator-home__summary' },
      `${props.moduleCount} selected module${props.moduleCount === 1 ? '' : 's'}`),
    props.instances.length === 0
      ? h('p', { className: 'simulator-home__empty' }, 'No App instances are open.')
      : h('ul', { className: 'simulator-windows', 'aria-label': 'Open instances' },
          props.instances.map((instance) => h('li', {
            key: instance.instanceId,
            className: 'simulator-windows__item',
            'data-instance-status': instance.status,
          }, `${instance.moduleId} — ${instance.status}`))),
  );
}

function DiagnosticsView(props: SimulatorShellViewProps): ReactElement {
  return h('main', { className: 'simulator-diagnostics' },
    h('h1', { className: 'simulator-diagnostics__title' }, 'Session diagnostics'),
    props.diagnostics.length === 0
      ? h('p', { className: 'simulator-diagnostics__empty' }, 'No diagnostics recorded.')
      : h('ul', { className: 'simulator-diagnostics__list' },
          props.diagnostics.map((diagnostic) => h('li', {
            key: diagnostic.diagnosticId,
            className: `simulator-diagnostics__item simulator-diagnostics__item--${diagnostic.scope}`,
          }, `${diagnostic.scope}: ${diagnostic.code}`))),
  );
}

export function SimulatorShellContent(props: SimulatorShellViewProps): ReactElement {
  return h('div', {
    className: 'simulator-shell',
    'data-registry-digest': props.registryDigest,
  },
    h(Navigation, props),
    props.route.kind === 'diagnostics' ? h(DiagnosticsView, props) : h(HomeView, props),
  );
}

/** Standalone/test composition. Production portals the status outside every inertable App/Shell root. */
export function SimulatorShellView(props: SimulatorShellViewProps): ReactElement {
  return h(Fragment, null,
    h(SimulatorStatusBar, props),
    h(SimulatorShellContent, props),
  );
}
