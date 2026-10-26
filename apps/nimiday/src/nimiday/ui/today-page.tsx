import { useMemo, type ComponentProps } from 'react';
import { Button, InlineAlert, nimiToast } from '@nimiplatform/kit/ui';
import { ArrowUpRight, CalendarClock, CalendarDays, Sunrise } from 'lucide-react';
import { activeSkillRun, MORNING_CARE_SKILL, resolveSkills } from '../domain/skills.js';
import { buildToday } from '../domain/today.js';
import { formatDate, greeting } from '../i18n/index.js';
import { useDayStore, useDesk, useEngine, useNimiDay } from '../app/context.js';
import { AgentAvatar, Card, Hint, RunStateChip } from './common.js';
import { ItemRow } from './item-row.js';
import { QuickCapture } from './quick-capture.js';
import { TodayCareRuns } from './today-care-runs.js';
import { SourceAttention, SourceCompactEntry } from './source-attention.js';
import { useUi } from './ui-context.js';
import './today-page.css';

function TodaySection({ title, hint, action, children, className, testId }: ComponentProps<typeof Card>) {
  return (
    <section className={`nd-today-section ${className ?? ''}`} data-testid={testId}>
      <Card>
        <div className="nd-section-heading">
          <h2>{title}</h2>
          {action}
        </div>
        {hint ? <p className="nd-card-hint">{hint}</p> : null}
        {children}
      </Card>
    </section>
  );
}

export function TodayPage() {
  const { copy, language, engine, desk: deskApi, navigate } = useNimiDay();
  const { state } = useDayStore();
  const engineState = useEngine();
  const desk = useDesk();
  const ui = useUi();
  const now = engineState.now;
  const model = useMemo(() => buildToday(state, now), [state, now]);
  const agentName = desk.agent?.displayName ?? state.profile.appointment?.displayName ?? null;
  const morningSkill = useMemo(() => resolveSkills(language, state.skillOverrides, state.customSkills)
    .find((skill) => skill.id === MORNING_CARE_SKILL)!, [language, state.skillOverrides, state.customSkills]);
  const morningRun = activeSkillRun(state.runs, MORNING_CARE_SKILL);

  const runMorning = async () => {
    if (morningRun) {
      ui.openRun(morningRun.id);
      return;
    }
    const result = await engine.startSkill({ skillId: MORNING_CARE_SKILL, trigger: 'user' });
    if (!result.ok) nimiToast.show({ tone: 'warning', message: result.message, durationMs: 6000 });
    else ui.openRun(result.runId);
  };

  return (
    <div className="nd-page nd-today-page" data-testid="nd-today">
      <div className="nd-today-columns">
        <div className="nd-stack nd-today-primary">
          <Card testId="nd-capture-card" className="nd-today-welcome">
            <div className="nd-today-welcome-heading">
              <div>
                <p className="nd-today-date">{copy.today.title} · {formatDate(copy, model.date, model.date)}</p>
                <h1 className="nd-page-title">{greeting(copy, now)}</h1>
                <p className="nd-hero-sub">{copy.today.welcome}</p>
              </div>
              {agentName ? <button type="button" className="nd-today-companion" onClick={() => navigate({ view: 'assistant' })}>
                <AgentAvatar name={agentName} url={desk.agent?.avatarUrl ?? state.profile.appointment?.avatarUrl ?? null} size="sm" />
                <span>{desk.phase === 'ready' ? copy.agent.onDuty(agentName) : agentName}</span>
                <ArrowUpRight size={14} aria-hidden="true" />
              </button> : null}
            </div>
            <QuickCapture />
          </Card>

          {/* A question the user has to answer holds up whatever comes after it. */}
          {model.waiting.length > 0 ? (
            <TodaySection title={copy.today.waiting} testId="nd-today-waiting">
              <div className="nd-list">
                {model.waiting.map((item) => <ItemRow key={item.id} item={item} />)}
              </div>
            </TodaySection>
          ) : null}
          {model.attention.length > 0 ? (
            <TodaySection title={copy.today.now}>
              <div className="nd-list">
                {model.attention.map((item) => <ItemRow key={item.id} item={item} showSnooze showDay={item.date !== model.date} />)}
              </div>
            </TodaySection>
          ) : null}

          {model.missed.length > 0 ? (
            <TodaySection title={copy.today.missed}>
              <div className="nd-list">
                {model.missed.map((item) => <ItemRow key={item.id} item={item} showSnooze showDay />)}
              </div>
            </TodaySection>
          ) : null}

          <SourceCompactEntry />
          <div className="nd-today-details">
            <TodaySection title={copy.today.schedule} className="nd-today-schedule" action={<Button tone="ghost" size="sm" className="nd-section-action" onClick={() => ui.newItem({ date: model.date })}>{copy.today.addSchedule}</Button>}>
              {model.timeline.length === 0 ? <div className="nd-today-empty"><span className="nd-today-empty-icon"><CalendarDays size={28} strokeWidth={1.5} aria-hidden="true" /></span><Hint>{copy.today.scheduleEmpty}</Hint><Button tone="secondary" size="sm" onClick={() => ui.newItem({ date: model.date })}>{copy.today.planSomething}</Button></div> : (
                <div className="nd-list">
                  {model.timeline.map((entry) => (entry.kind === 'item' ? (
                    <ItemRow key={entry.key} item={entry.item} date={entry.date} time={entry.time} done={entry.done} projected={entry.projected} />
                  ) : (
                    <div key={entry.key} className="nd-row">
                      <CalendarClock size={18} strokeWidth={1.8} aria-hidden="true" style={{ flex: 'none', marginTop: 1, color: 'var(--nimi-text-muted)' }} />
                      <div className="nd-row-time">{entry.time}</div>
                      <div className="nd-row-body">
                        <span className="nd-row-title">{copy.today.rhythmAt(entry.rhythm.name)}</span>
                        <div className="nd-row-meta">
                          {entry.run ? <RunStateChip state={entry.run.state} /> : null}
                        </div>
                      </div>
                      {entry.run && (entry.run.state === 'waiting-start' || entry.run.state === 'missed' || entry.run.state === 'done') ? (
                        <Button size="sm" tone="ghost" onClick={() => ui.openRun(entry.run!.id)}>{copy.common.open}</Button>
                      ) : null}
                    </div>
                  )))}
                </div>
              )}
            </TodaySection>

            <TodaySection title={agentName ? copy.today.care(agentName) : copy.agent.none} testId="nd-agent-care">
              {desk.phase === 'no-agents' || (!state.profile.appointment && desk.phase !== 'ready') ? (
                <>
                  <p className="nd-muted" style={{ margin: '0 0 12px', fontSize: 13 }}>{copy.agent.noneBody}</p>
                  <Button tone="primary" size="sm" onClick={ui.appointAgent}>{copy.agent.appoint}</Button>
                </>
              ) : desk.phase === 'choose' && desk.awaitingConfirmation ? (
                <>
                  <p className="nd-muted" style={{ margin: '0 0 12px', fontSize: 13 }}>{copy.agent.confirmBody}</p>
                  <Button tone="primary" size="sm" onClick={ui.appointAgent}>{copy.agent.confirmTitle(desk.awaitingConfirmation.displayName)}</Button>
                </>
              ) : (
                <>
                  {desk.phase === 'unavailable' ? (
                    <div style={{ marginBottom: 12 }}>
                      <InlineAlert tone="warning" action={<Button size="sm" tone="secondary" onClick={() => { void deskApi.start(state.profile.appointment); }}>{copy.common.retry}</Button>}>
                        {desk.unreachable ? copy.agent.unreachableBody(desk.unreachable.displayName) : copy.agent.unavailable}
                      </InlineAlert>
                    </div>
                  ) : null}
                  {model.runs.length === 0 ? <Hint>{agentName ? copy.today.careEmpty(agentName) : copy.common.loading}</Hint> : (
                    <TodayCareRuns runs={model.runs} today={model.date} title={agentName ? copy.today.care(agentName) : copy.agent.none} />
                  )}
                  <div className="nd-inline-actions nd-today-care-actions">
                    <Button
                      tone="secondary"
                      size="sm"
                      leadingIcon={<Sunrise size={14} aria-hidden="true" />}
                      disabled={!morningRun && (desk.phase !== 'ready' || !desk.canUseWork)}
                      onClick={() => { void runMorning(); }}
                    >
                      {morningRun ? copy.today.viewCareRun(morningSkill.name) : morningSkill.name}
                    </Button>
                    <button type="button" className="nd-link" onClick={() => navigate({ view: 'assistant' })}>{copy.nav.assistant}</button>
                  </div>
                  {desk.phase === 'ready' && !desk.canUseWork ? <p className="nd-faint" style={{ margin: '10px 0 0' }}>{copy.skills.needWork}</p> : null}
                </>
              )}
            </TodaySection>
          </div>
        </div>

        <aside className="nd-stack nd-today-rail" aria-label={copy.today.fromApps}>
          <SourceAttention />
        </aside>
      </div>
    </div>
  );
}
