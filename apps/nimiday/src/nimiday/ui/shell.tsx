import { CalendarHeart, HeartHandshake, ListChecks, MessageCircle, Repeat2, Settings, Sun, type LucideIcon } from 'lucide-react';
import { isOverdue } from '../domain/reminders.js';
import { useDayStore, useDesk, useEngine, useNimiDay } from '../app/context.js';
import type { NavTarget } from '../platform/engine.js';
import { AgentAvatar } from './common.js';
import { AssistantPage } from './assistant-page.js';
import { CarePage } from './care-page.js';
import { ItemsPage } from './items-page.js';
import { RoutinesPage } from './routines-page.js';
import { SettingsPage } from './settings-page.js';
import { TodayPage } from './today-page.js';

type View = NavTarget['view'];

const NAV: readonly { readonly view: View; readonly icon: LucideIcon }[] = [
  { view: 'today', icon: Sun },
  { view: 'care', icon: HeartHandshake },
  { view: 'items', icon: ListChecks },
  { view: 'routines', icon: Repeat2 },
  { view: 'assistant', icon: MessageCircle },
];

function Page() {
  const { nav } = useNimiDay();
  switch (nav.view) {
    case 'today':
      return <TodayPage />;
    case 'care':
      return <CarePage circleId={nav.circleId} />;
    case 'items':
      return <ItemsPage focusItemId={nav.itemId} />;
    case 'routines':
      return <RoutinesPage focusRunId={nav.runId} />;
    case 'assistant':
      return <AssistantPage />;
    case 'settings':
      return <SettingsPage />;
  }
}

export function Shell() {
  const { copy, nav, navigate, desk: deskApi, store } = useNimiDay();
  const snapshot = useDayStore();
  const desk = useDesk();
  const { now } = useEngine();
  const needsYou = snapshot.state.items.filter((item) => item.state === 'waiting' || (item.state === 'open' && isOverdue(item, now))).length;
  const agentName = desk.agent?.displayName ?? snapshot.state.profile.appointment?.displayName ?? null;
  const appointed = Boolean(snapshot.state.profile.appointment);
  const status = desk.phase !== 'ready'
    ? (desk.phase === 'loading' || desk.phase === 'opening'
      ? copy.agent.connecting
      : desk.phase === 'unavailable' && appointed
        ? copy.agent.unreachable
        : desk.awaitingConfirmation ? copy.agent.awaitingConfirm : copy.agent.none)
    : desk.connection === 'lost'
      ? copy.agent.connectionLost
      : desk.activeTurnId ? (deskApi.ownsTurn(desk.activeTurnId) ? copy.agent.replying : copy.agent.busyElsewhere) : copy.agent.idle;
  const tone = desk.phase === 'unavailable' && appointed
    ? 'lost'
    : desk.phase !== 'ready' ? 'off' : desk.connection === 'lost' ? 'lost' : desk.activeTurnId ? 'busy' : undefined;

  return (
    <div className="nd-shell" data-testid="nd-shell">
      <aside className="nd-sidebar" aria-label={copy.nav.label}>
        <div className="nd-brand">
          <span className="nd-brand-mark"><CalendarHeart size={16} aria-hidden="true" /></span>
          <span className="nd-brand-name">{copy.app.name}</span>
        </div>
        <button type="button" className="nd-agent-chip" onClick={() => navigate({ view: 'assistant' })} data-testid="nd-agent-chip">
          <AgentAvatar name={agentName ?? '?'} url={desk.agent?.avatarUrl ?? snapshot.state.profile.appointment?.avatarUrl ?? null} size="sm" />
          <span className="nd-agent-chip__text">
            <span className="nd-agent-chip__name">{agentName ?? copy.agent.appoint}</span>
            <span className="nd-agent-chip__status"><span className="nd-status-dot" data-tone={tone} aria-hidden="true" />{status}</span>
          </span>
        </button>
        <nav className="nd-nav">
          {NAV.map(({ view, icon: Icon }) => (
            <button
              key={view}
              type="button"
              className="nd-nav-item"
              aria-current={nav.view === view ? 'page' : undefined}
              aria-label={copy.nav[view]}
              title={copy.nav[view]}
              onClick={() => navigate({ view })}
              data-testid={`nd-nav-${view}`}
            >
              <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
              <span>{copy.nav[view]}</span>
              {view === 'today' && needsYou > 0 ? <span className="nd-nav-badge">{needsYou}</span> : null}
            </button>
          ))}
        </nav>
        <div className="nd-sidebar-foot">
          {snapshot.saving === 'error' ? (
            <span className="nd-save-state" data-tone="error" role="status" data-testid="nd-save-failed">
              {copy.common.saveFailed}
              <button type="button" className="nd-link" onClick={() => { void store.persist(); }}>{copy.common.retrySave}</button>
              {snapshot.saveError ? <details className="nd-faint"><summary>{copy.assistant.technical}</summary>{snapshot.saveError}</details> : null}
            </span>
          ) : snapshot.saving === 'saving' ? (
            <span className="nd-save-state" role="status">{copy.common.saving}</span>
          ) : null}
          <button
            type="button"
            className="nd-nav-item"
            aria-current={nav.view === 'settings' ? 'page' : undefined}
            aria-label={copy.nav.settings}
            title={copy.nav.settings}
            onClick={() => navigate({ view: 'settings' })}
            data-testid="nd-nav-settings"
          >
            <Settings size={18} strokeWidth={1.8} aria-hidden="true" />
            <span>{copy.nav.settings}</span>
          </button>
        </div>
      </aside>
      <main className="nd-main" data-view={nav.view}>
        <Page />
      </main>
    </div>
  );
}
