import { useState, type ReactNode } from 'react';
import { Button, InlineAlert, nimiToast, TextareaField } from '@nimiplatform/kit/ui';
import { toLocalDate } from '../domain/time.js';
import { skillRunName, resolveSkills } from '../domain/skills.js';
import type { SkillRun } from '../domain/types.js';
import { keptChanges } from '../domain/undo.js';
import { methodOverflow } from '../domain/work.js';
import { describeUndone, formatInstant } from '../i18n/index.js';
import { useDayStore, useDesk, useEngine, useNimiDay } from '../app/context.js';
import { AgentAvatar } from './common.js';
import { useUi } from './ui-context.js';
import { needsAiSetup, openNimiAiCapabilities } from '../platform/ai-setup.js';

export function RunChanges({ run }: { readonly run: SkillRun }) {
  const { copy, store } = useNimiDay();
  const snapshot = useDayStore();
  const ui = useUi();
  if (run.changes.length === 0) return <p className="nd-faint" style={{ margin: '8px 0 0' }}>{copy.run.noChanges}</p>;
  const hadUnsaved = !run.undone && run.toolCalls.some((call) => call.unsaved);
  const kept = keptChanges(run, snapshot.state.items);
  return (
    <>
      <ul className="nd-changes-list">
        {run.changes.map((change, index) => (
          <li key={`${change.kind}-${index}`} data-undone={run.undone && !kept.has(index)}>
            {change.kind !== 'note-saved' && snapshot.state.items.some(item => item.id === change.itemId) ? (
              <button type="button" className="nd-link" onClick={() => ui.openItem(change.itemId)}>{copy.run.change[change.kind](change.title)}</button>
            ) : change.kind === 'note-saved' && snapshot.state.notes.some(note => note.id === change.noteId) ? (
              <button type="button" className="nd-link" onClick={() => ui.editNote({ noteId: change.noteId, circleId: snapshot.state.notes.find(note => note.id === change.noteId)!.circleId })}>{copy.run.change[change.kind](change.title)}</button>
            ) : copy.run.change[change.kind](change.title)}
            {kept.has(index) ? <span className="nd-faint"> · {copy.run.keptOnUndo}</span> : null}
          </li>
        ))}
      </ul>
      {hadUnsaved ? (
        <div className="nd-inline-actions nd-faint" style={{ marginTop: 6 }} data-testid="nd-run-unsaved">
          {/* Until a save succeeds again, the failed change is still only on screen. */}
          {snapshot.saving === 'error' ? (
            <>
              <span>{copy.run.unsavedNow}</span>
              <button type="button" className="nd-link" onClick={() => { void store.persist(); }}>{copy.common.retrySave}</button>
            </>
          ) : <span>{copy.run.unsavedThenSaved}</span>}
        </div>
      ) : null}
    </>
  );
}

/** Detail-dialog content for one run: progress while working, the reply once done. */
export function RunCard({ run, children }: { readonly run: SkillRun; readonly children?: ReactNode }) {
  const { engine, copy, actions, language } = useNimiDay();
  const { state } = useDayStore();
  const desk = useDesk();
  const { now, activeRunId, waitingForAgent } = useEngine();
  const ui = useUi();
  const [lesson, setLesson] = useState<string | null>(null);
  const today = toLocalDate(now);
  const agent = run.agentName ?? desk.agent?.displayName ?? copy.common.agentFallback;
  const avatarUrl = desk.agent && desk.agent.displayName === agent ? desk.agent.avatarUrl
    : state.profile.appointment && state.profile.appointment.displayName === agent ? state.profile.appointment.avatarUrl
      : null;
  const liveTools = desk.liveTools.filter((tool) => tool.turnId === run.turnId && tool.lifecycle === 'started');
  const setupRequired = run.state === 'failed' && needsAiSetup(run.error?.code);
  const requestLine = run.requestText.split('\n')[0] || '—';

  const start = async () => {
    // Scheduled runs start in place; a retry keeps the earlier record (and its undo) intact.
    const reuse = run.state === 'waiting-start' || run.state === 'missed';
    const result = reuse
      ? await engine.startSkill({ skillId: run.skillId, trigger: run.trigger === 'chat' ? 'user' : run.trigger, runId: run.id, rhythmId: run.rhythmId, focusCircleId: run.focusCircleId ?? null, focusItemId: run.focusItemId ?? null })
      : await engine.retry(run.id);
    if (!result.ok) nimiToast.show({ tone: 'warning', message: result.message, durationMs: 6000 });
    else ui.openRun(result.runId);
  };

  const undo = () => {
    const outcome = engine.undoRun(run.id);
    if (outcome) nimiToast.show({ tone: 'info', message: copy.run.undoResult(outcome.reverted, outcome.kept), durationMs: 5000 });
  };

  return (
    <div className="nd-run-result" data-testid="nd-run-card">
      {run.state === 'queued' || run.state === 'running' ? (
        <div className="nd-run-progress">
          <span className="nd-run-progress-avatar" data-active={run.state === 'running'}>
            <AgentAvatar name={agent} url={avatarUrl} size="md" />
          </span>
          <div className="nd-run-progress-copy">
            <strong>{run.state === 'running' ? copy.run.working(agent) : waitingForAgent ? copy.run.waitingAgent(agent) : copy.run.states.queued}</strong>
            <span className="nd-run-progress-status" role="status">
              {run.state === 'running'
                ? liveTools.length > 0
                  ? copy.assistant.liveTool(liveTools.map((tool) => copy.skills.toolNames[tool.name] ?? tool.name).join('、'))
                  : copy.run.runningHint
                : copy.run.queuedHint}
            </span>
            <span className="nd-run-quote">{requestLine}</span>
          </div>
          {run.state === 'running' && activeRunId === run.id ? (
            <Button tone="ghost" size="sm" onClick={() => { void engine.stopRun(); }}>{copy.run.stop}</Button>
          ) : null}
          {run.state === 'queued' ? <Button tone="ghost" size="sm" onClick={() => engine.cancelQueued(run.id)}>{copy.common.cancel}</Button> : null}
        </div>
      ) : null}

      {run.state === 'waiting-start' || run.state === 'missed' ? (
        <div className="nd-run-pending">
          <span className="nd-field-label">{copy.run.request}</span>
          <p className="nd-run-quote">{requestLine}</p>
          <div className="nd-inline-actions">
            {run.state === 'waiting-start' ? (
              <>
                <Button tone="primary" size="sm" onClick={() => { void start(); }}>{copy.run.start}</Button>
                <Button tone="ghost" size="sm" onClick={() => engine.dismissRun(run.id)}>{copy.run.dismiss}</Button>
              </>
            ) : (
              <>
                <span className="nd-faint">{run.error?.code === 'late' ? copy.run.missedLate : copy.run.missedReason}</span>
                <Button tone="secondary" size="sm" onClick={() => { void start(); }}>{copy.run.startNow}</Button>
                <Button tone="ghost" size="sm" onClick={() => engine.dismissRun(run.id)}>{copy.run.dismiss}</Button>
              </>
            )}
          </div>
        </div>
      ) : null}

      {run.state === 'failed' || run.state === 'interrupted' ? (
        <InlineAlert tone="warning" className="nd-run-alert">
          {run.state === 'interrupted'
            ? run.error?.code === 'outcome-unknown'
              ? copy.run.outcomeUnknown
              : run.error?.code === 'agent-changed'
                ? copy.run.agentChanged(run.agentName ?? agent, run.changes.length > 0)
                : (run.changes.length > 0 ? copy.run.interruptedReason : copy.run.interruptedClean)
            : setupRequired ? copy.assistant.needsAiSetup(agent) : copy.run.failedFriendly(agent)}
          {run.error ? <details className="nd-run-tech"><summary>{copy.assistant.technical}</summary>{run.error.code}{run.error.message && run.error.message !== run.error.code ? ` · ${run.error.message}` : ''}</details> : null}
        </InlineAlert>
      ) : null}

      {run.replyText ? (
        <div className="nd-run-reply-card">
          <div className="nd-run-reply-head">
            <AgentAvatar name={agent} url={avatarUrl} size="sm" />
            <strong>{agent}</strong>
            <time>{formatInstant(copy, run.finishedAt ?? run.createdAt, today)}</time>
          </div>
          <div className="nd-reply">{run.replyText}</div>
        </div>
      ) : null}

      {children}

      {run.state === 'done' || run.state === 'interrupted' || run.state === 'failed' ? (
        <>
          {run.changes.length > 0 ? (
            <section className="nd-run-changes">
              <h3 className="nd-field-label">{copy.run.changes}</h3>
              <RunChanges run={run} />
            </section>
          ) : null}
          <div className="nd-inline-actions nd-run-actions">
            {setupRequired ? <Button tone="secondary" size="sm" onClick={() => { void openNimiAiCapabilities().then(opened => { if (!opened) nimiToast.show({ tone: 'warning', message: copy.assistant.openAiSetupFailed }); }).catch(() => nimiToast.show({ tone: 'warning', message: copy.assistant.openAiSetupFailed })); }}>{copy.assistant.openAiSetup}</Button> : null}
            {run.changes.length > 0 && !run.undone ? <Button tone="ghost" size="sm" onClick={undo}>{copy.run.undoAll}</Button> : null}
            {run.undone ? <span className="nd-faint">{describeUndone(copy, run, state.items)}</span> : null}
            {run.state !== 'done' && run.trigger !== 'chat' ? <Button tone="secondary" size="sm" onClick={() => { void start(); }}>{copy.run.retry}</Button> : null}
            {lesson === null && run.trigger !== 'chat' ? <Button tone="ghost" size="sm" onClick={() => setLesson('')}>{copy.run.addLesson}</Button> : null}
          </div>
          {lesson !== null ? (
            <div className="nd-run-preference">
              <p className="nd-faint">{copy.run.lessonHint}</p>
              <TextareaField
                autoFocus
                rows={3}
                value={lesson}
                maxLength={300}
                placeholder={copy.run.lessonPlaceholder}
                aria-label={copy.run.addLesson}
                onChange={(event) => setLesson(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Escape') setLesson(null); }}
              />
              <div className="nd-inline-actions">
              <Button tone="primary" size="sm" disabled={!lesson.trim()} onClick={() => {
                // A lesson is only kept if the method can still be handed over whole with it.
                const skill = resolveSkills(language, state.skillOverrides, state.customSkills).find((entry) => entry.id === run.skillId);
                const withLesson = skill ? { instructions: skill.instructions, lessons: [...skill.lessons, { id: 'draft', text: lesson.trim(), addedAt: '' }] } : null;
                if (withLesson && methodOverflow(withLesson, language) > 0) {
                  nimiToast.show({ tone: 'warning', message: copy.run.lessonTooLong, durationMs: 8000 });
                  return;
                }
                actions.addLesson(run.skillId, lesson);
                setLesson(null);
                nimiToast.show({ tone: 'success', message: copy.run.lessonSaved(skillRunName(run, language)), durationMs: 4000 });
              }}>{copy.common.save}</Button>
              <Button tone="ghost" size="sm" onClick={() => setLesson(null)}>{copy.common.cancel}</Button>
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
