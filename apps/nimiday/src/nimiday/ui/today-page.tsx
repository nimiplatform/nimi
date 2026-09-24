import { useMemo } from 'react';
import { Button, InlineAlert, nimiToast } from '@nimiplatform/kit/ui';
import { CalendarClock, Sunrise } from 'lucide-react';
import { MORNING_CARE_SKILL } from '../domain/skills.js';
import { buildToday } from '../domain/today.js';
import { formatDate, greeting } from '../i18n/index.js';
import { useDayStore, useDesk, useEngine, useNimiDay } from '../app/context.js';
import { Card, Chip, Hint, RunStateChip } from './common.js';
import { ItemRow } from './item-row.js';
import { QuickCapture } from './quick-capture.js';
import { RunCard } from './run-card.js';
import { SourceCoverageNote, SourceRow } from './source-row.js';
import { useUi } from './ui-context.js';

export function TodayPage() {
  const { copy, engine, desk: deskApi, navigate } = useNimiDay();
  const { state } = useDayStore();
  const engineState = useEngine();
  const desk = useDesk();
  const ui = useUi();
  const now = engineState.now;
  const model = useMemo(() => buildToday(state, engineState.changes, now), [state, engineState.changes, now]);
  const agentName = desk.agent?.displayName ?? state.profile.appointment?.displayName ?? null;

  const runMorning = async () => {
    const result = await engine.startSkill({ skillId: MORNING_CARE_SKILL, trigger: 'user' });
    if (!result.ok) nimiToast.show({ tone: 'warning', message: result.message, durationMs: 6000 });
  };

  return (
    <div className="nd-page" data-testid="nd-today">
      <div className="nd-hero">
        <div>
          <h1 className="nd-hero-date">{formatDate(copy, model.date, model.date)}</h1>
          <p className="nd-hero-sub">
            {greeting(copy, now)}
            {agentName && desk.phase === 'ready' ? ` · ${copy.agent.onDuty(agentName)}` : ''}
            {' · '}
            {copy.today.counts(model.counts.today, model.counts.week)}
          </p>
        </div>
      </div>

      <Card testId="nd-capture-card">
        <QuickCapture />
      </Card>

      <div className="nd-columns" style={{ marginTop: 18 }}>
        <div className="nd-stack">
          {/* A question the user has to answer holds up whatever comes after it. */}
          {model.waiting.length > 0 ? (
            <Card title={copy.today.waiting} testId="nd-today-waiting">
              <div className="nd-list">
                {model.waiting.map((item) => <ItemRow key={item.id} item={item} />)}
              </div>
            </Card>
          ) : null}
          {model.attention.length > 0 ? (
            <Card title={copy.today.now}>
              <div className="nd-list">
                {model.attention.map((item) => <ItemRow key={item.id} item={item} showSnooze showDay={item.date !== model.date} />)}
              </div>
            </Card>
          ) : null}

          {model.missed.length > 0 ? (
            <Card title={copy.today.missed} hint={copy.today.missedHint}>
              <div className="nd-list">
                {model.missed.map((item) => <ItemRow key={item.id} item={item} showSnooze showDay />)}
              </div>
            </Card>
          ) : null}

          <Card title={copy.today.schedule} action={<Button tone="ghost" size="sm" onClick={() => ui.newItem({ date: model.date })}>{copy.common.add}</Button>}>
            {model.timeline.length === 0 ? <Hint>{copy.today.scheduleEmpty}</Hint> : (
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
          </Card>

        </div>

        <div className="nd-stack">
          {/* Things to act on in other apps come before what has already been looked after. */}
          {engineState.activityStatus === 'ready' && model.remindersTotal > 0 ? (
            <Card
              title={copy.today.reminders}
              hint={copy.today.remindersHint}
              action={model.remindersTotal > model.reminders.length ? <button type="button" className="nd-link" onClick={() => navigate({ view: 'care' })}>{copy.today.seeAll}</button> : undefined}
              testId="nd-source-reminders"
            >
              <div className="nd-list">
                {model.reminders.map((change) => <SourceRow key={change.id} change={change} />)}
              </div>
              <SourceCoverageNote />
            </Card>
          ) : null}
          <Card title={agentName ? copy.today.care(agentName) : copy.agent.none} testId="nd-agent-care">
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
                  <div className="nd-list">
                    {model.runs.slice(0, 2).map((run) => <RunCard key={run.id} run={run} compact />)}
                  </div>
                )}
                <div className="nd-inline-actions" style={{ marginTop: 12 }}>
                  <Button
                    tone="secondary"
                    size="sm"
                    leadingIcon={<Sunrise size={14} aria-hidden="true" />}
                    disabled={desk.phase !== 'ready' || !desk.canUseWork}
                    onClick={() => { void runMorning(); }}
                  >
                    {copy.today.runMorning(agentName ?? copy.common.agentFallback)}
                  </Button>
                  <button type="button" className="nd-link" onClick={() => navigate({ view: 'assistant' })}>{copy.nav.assistant}</button>
                </div>
                {desk.phase === 'ready' && !desk.canUseWork ? <p className="nd-faint" style={{ margin: '10px 0 0' }}>{copy.skills.needWork}</p> : null}
              </>
            )}
          </Card>


          <Card
            title={copy.today.changes}
            action={model.changesTotal > model.changes.length ? <button type="button" className="nd-link" onClick={() => navigate({ view: 'care' })}>{copy.today.seeAll}</button> : undefined}
            testId="nd-changes"
          >
            {engineState.activityStatus === 'no-access' ? (
              <>
                <p className="nd-muted" style={{ margin: 0, fontSize: 13 }}>{copy.today.sourcesNoAccess}</p>
                <p className="nd-faint" style={{ margin: '6px 0 0' }}>{copy.today.sourcesNoAccessBody}</p>
              </>
            ) : engineState.activityStatus === 'unavailable' ? (
              <Hint>{copy.today.sourcesUnavailable}</Hint>
            ) : model.changes.length === 0 ? <Hint>{copy.today.changesEmpty}</Hint> : (
              <div className="nd-list">
                {model.changes.map((change) => <SourceRow key={change.id} change={change} />)}
              </div>
            )}
            {model.remindersTotal === 0 ? <SourceCoverageNote /> : null}
          </Card>

          {model.counts.overdue > 0 && model.attention.length === 0 ? (
            <Chip tone="danger">{copy.today.overdue} · {model.counts.overdue}</Chip>
          ) : null}
        </div>
      </div>
    </div>
  );
}
