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
  readonly replayDigest: string | null;
  readonly stateRevision: number;
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
    h('section', { className: 'simulator-modules', 'aria-label': 'Selected modules' },
      props.modules.flatMap((module) => module.surfaces.map((surface) => h('button', {
        key: `${module.moduleId}/${surface.id}`,
        type: 'button',
        onClick: () => props.onOpen(module.moduleId, surface.id),
        'data-module-id': module.moduleId,
        'data-surface-id': surface.id,
      }, `Open ${surface.label}`))),
      h('button', {
        type: 'button',
        onClick: props.onReset,
        disabled: props.phase !== 'open',
        'data-simulator-action': 'reset',
      }, 'Reset scenario'),
    ),
    props.instances.length === 0
      ? h('p', { className: 'simulator-home__empty' }, 'No App instances are open.')
      : h('ul', { className: 'simulator-windows', 'aria-label': 'Open instances' },
          props.instances.map((instance) => h('li', {
            key: instance.instanceId,
            className: 'simulator-windows__item',
            'data-instance-status': instance.status,
            'data-readiness-status': instance.readiness,
            'data-instance-id': instance.instanceId,
            'data-module-id': instance.moduleId,
            'data-surface-id': instance.surfaceId,
          },
          h('span', null, `${instance.moduleId} — ${instance.status} — ${instance.readiness}`),
          instance.status === 'active'
            ? h('button', { type: 'button', onClick: () => props.onDeactivate(instance.instanceId) }, 'Deactivate')
            : instance.status === 'inactive'
              ? h('button', { type: 'button', onClick: () => props.onActivate(instance.instanceId) }, 'Activate')
              : null,
          instance.status === 'active' || instance.status === 'inactive'
            ? h('button', {
                type: 'button',
                onClick: () => props.onNavigate({
                  kind: 'instance',
                  instanceId: instance.instanceId,
                  appRoute: instance.route,
                }),
              }, 'Full window')
            : null,
          instance.status !== 'disposed'
            ? h('button', { type: 'button', onClick: () => props.onClose(instance.instanceId) }, 'Close')
            : null,
          ))),
  );
}

function FullWindowView(props: SimulatorShellViewProps): ReactElement {
  const fullWindowInstanceId = props.route.kind === 'instance' ? props.route.instanceId : null;
  const instance = fullWindowInstanceId
    ? props.instances.find((entry) => entry.instanceId === fullWindowInstanceId) ?? null
    : null;
  return h('main', {
    className: 'simulator-full-window',
    'data-full-window-instance': instance?.instanceId,
  },
    h('button', {
      type: 'button',
      onClick: () => props.onNavigate({ kind: 'home' }),
    }, 'Exit full window'),
    h('span', { role: 'status', 'aria-live': 'polite' },
      instance ? `${instance.moduleId} full window` : 'Requested instance is unavailable'),
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
  const usableActiveInstanceCount = props.instances.filter((instance) => (
    instance.status === 'active' && instance.readiness === 'usable'
  )).length;
  return h('div', {
    className: `simulator-shell${props.route.kind === 'instance' ? ' simulator-shell--full-window' : ''}`,
    'data-registry-digest': props.registryDigest,
    'data-replay-digest': props.replayDigest ?? undefined,
    'data-state-revision': props.stateRevision,
    'data-usable-active-instance-count': usableActiveInstanceCount,
  },
    props.route.kind === 'instance' ? null : h(Navigation, props),
    props.route.kind === 'diagnostics'
      ? h(DiagnosticsView, props)
      : props.route.kind === 'instance'
        ? h(FullWindowView, props)
        : h(HomeView, props),
  );
}

/** Standalone/test composition. Production portals the status outside every inertable App/Shell root. */
export function SimulatorShellView(props: SimulatorShellViewProps): ReactElement {
  return h(Fragment, null,
    h(SimulatorStatusBar, props),
    h(SimulatorShellContent, props),
  );
}
