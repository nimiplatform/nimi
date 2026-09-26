import { useState } from 'react';
import { Button, nimiToast, TextField } from '@nimiplatform/kit/ui';
import { toLocalDate } from '../domain/time.js';
import { resolveSkills } from '../domain/skills.js';
import type { SkillRun } from '../domain/types.js';
import { keptChanges } from '../domain/undo.js';
import { methodOverflow } from '../domain/work.js';
import { describeUndone, formatInstant } from '../i18n/index.js';
import { useDayStore, useDesk, useEngine, useNimiDay } from '../app/context.js';
import { RunStateChip } from './common.js';
import { useUi } from './ui-context.js';

export function RunChanges({ run }: { readonly run: SkillRun }) {
  const { copy, store } = useNimiDay();
  const snapshot = useDayStore();
  if (run.changes.length === 0) return <p className="nd-faint" style={{ margin: '8px 0 0' }}>{copy.run.noChanges}</p>;
  const hadUnsaved = !run.undone && run.toolCalls.some((call) => call.unsaved);
  const kept = keptChanges(run, snapshot.state.items);
  return (
    <>
      <ul className="nd-changes-list">
        {run.changes.map((change, index) => (
          <li key={`${change.kind}-${index}`} data-undone={run.undone && !kept.has(index)}>
            {copy.run.change[change.kind](change.title)}
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

export function RunCard({ run, compact = false }: { readonly run: SkillRun; readonly compact?: boolean }) {
  const { engine, copy, actions, language } = useNimiDay();
  const { state } = useDayStore();
  const desk = useDesk();
  const { now, activeRunId, waitingForAgent } = useEngine();
  const ui = useUi();
  const [lesson, setLesson] = useState<string | null>(null);
  const today = toLocalDate(now);
  const agent = run.agentName ?? desk.agent?.displayName ?? copy.common.agentFallback;
  const liveTools = desk.liveTools.filter((tool) => tool.turnId === run.turnId && tool.lifecycle === 'started');

  const start = async () => {
    // Scheduled runs start in place; a retry keeps the earlier record (and its undo) intact.
    const reuse = run.state === 'waiting-start' || run.state === 'missed';
    const result = reuse
      ? await engine.startSkill({ skillId: run.skillId, trigger: run.trigger === 'chat' ? 'user' : run.trigger, runId: run.id, rhythmId: run.rhythmId, focusCircleId: run.focusCircleId ?? null })
      : await engine.retry(run.id);
    if (!result.ok) nimiToast.show({ tone: 'warning', message: result.message, durationMs: 6000 });
  };

  const undo = () => {
    const outcome = engine.undoRun(run.id);
    if (outcome) nimiToast.show({ tone: 'info', message: copy.run.undoResult(outcome.reverted, outcome.kept), durationMs: 5000 });
  };

  return (
    <div className="nd-row" style={{ display: 'block' }} data-testid="nd-run-card">
      <div className="nd-split">
        <div className="nd-inline-actions">
          <strong style={{ fontSize: 14 }}>{run.skillName}</strong>
          <RunStateChip state={run.state} />
          <span className="nd-faint">{copy.run.trigger[run.trigger]} · {formatInstant(copy, run.scheduledFor ?? run.createdAt, today)}</span>
        </div>
        {!compact ? <button type="button" className="nd-link" onClick={() => ui.openRun(run.id)}>{copy.run.detail}</button> : null}
      </div>

      {run.state === 'waiting-start' ? (
        <div className="nd-inline-actions" style={{ marginTop: 8 }}>
          <Button tone="primary" size="sm" onClick={() => { void start(); }}>{copy.run.start}</Button>
          <Button tone="ghost" size="sm" onClick={() => engine.dismissRun(run.id)}>{copy.run.dismiss}</Button>
        </div>
      ) : null}

      {run.state === 'missed' ? (
        <div className="nd-inline-actions" style={{ marginTop: 8 }}>
          <span className="nd-faint">{run.error?.code === 'late' ? copy.run.missedLate : copy.run.missedReason}</span>
          <Button tone="secondary" size="sm" onClick={() => { void start(); }}>{copy.run.startNow}</Button>
          <Button tone="ghost" size="sm" onClick={() => engine.dismissRun(run.id)}>{copy.run.dismiss}</Button>
        </div>
      ) : null}

      {run.state === 'queued' || run.state === 'running' ? (
        <div className="nd-inline-actions" style={{ marginTop: 8 }}>
          <span className="nd-faint">
            {run.state === 'queued' && waitingForAgent ? copy.run.waitingAgent(agent) : null}
            {run.state === 'running' && liveTools.length > 0
              ? copy.assistant.liveTool(liveTools.map((tool) => copy.skills.toolNames[tool.name] ?? tool.name).join('、'))
              : run.state === 'running' ? copy.agent.replying : null}
          </span>
          {run.state === 'running' && activeRunId === run.id ? (
            <Button tone="ghost" size="sm" onClick={() => { void engine.stopRun(); }}>{copy.run.stop}</Button>
          ) : null}
          {run.state === 'queued' ? <Button tone="ghost" size="sm" onClick={() => engine.cancelQueued(run.id)}>{copy.common.cancel}</Button> : null}
        </div>
      ) : null}

      {run.replyText ? <div className="nd-reply" style={compact ? { maxHeight: 180, overflow: 'hidden' } : undefined}>{run.replyText}</div> : null}

      {run.state === 'done' || run.state === 'interrupted' || run.state === 'failed' ? (
        <>
          {run.state !== 'done' && run.error ? (
            <div className="nd-faint" style={{ margin: '8px 0 0' }}>
              {run.state === 'interrupted' && run.error.code === 'outcome-unknown'
                ? copy.run.outcomeUnknown
                : run.state === 'interrupted' && run.error.code === 'agent-changed'
                  ? copy.run.agentChanged(run.agentName ?? agent, run.changes.length > 0)
                : run.state === 'interrupted'
                  ? (run.changes.length > 0 ? copy.run.interruptedReason : copy.run.interruptedClean)
                  : copy.run.failedFriendly(agent)}
              <details><summary>{copy.assistant.technical}</summary>{run.error.code}{run.error.message && run.error.message !== run.error.code ? ` · ${run.error.message}` : ''}</details>
            </div>
          ) : null}
          {run.changes.length > 0 || run.state === 'done' ? <RunChanges run={run} /> : null}
          <div className="nd-inline-actions" style={{ marginTop: 8 }}>
            {run.changes.length > 0 && !run.undone ? <Button tone="ghost" size="sm" onClick={undo}>{copy.run.undoAll}</Button> : null}
            {run.undone ? <span className="nd-faint">{describeUndone(copy, run, state.items)}</span> : null}
            {run.state !== 'done' && run.trigger !== 'chat' ? <Button tone="secondary" size="sm" onClick={() => { void start(); }}>{copy.run.retry}</Button> : null}
            {!compact && lesson === null && run.trigger !== 'chat' ? <Button tone="ghost" size="sm" onClick={() => setLesson('')}>{copy.run.addLesson}</Button> : null}
          </div>
          {lesson !== null ? (
            <div className="nd-capture" style={{ marginTop: 8 }}>
              <TextField
                autoFocus
                value={lesson}
                maxLength={300}
                placeholder={copy.run.lessonPlaceholder}
                aria-label={copy.run.addLesson}
                onChange={(event) => setLesson(event.target.value)}
                onKeyDown={(event) => { if (event.key === 'Escape') setLesson(null); }}
                className="flex-1"
              />
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
                nimiToast.show({ tone: 'success', message: copy.run.lessonSaved(run.skillName), durationMs: 4000 });
              }}>{copy.common.save}</Button>
              <Button tone="ghost" size="sm" onClick={() => setLesson(null)}>{copy.common.cancel}</Button>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
