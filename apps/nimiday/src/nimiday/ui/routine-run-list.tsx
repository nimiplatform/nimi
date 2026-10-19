import { skillRunName } from '../domain/skills.js';
import { MoreHorizontal } from 'lucide-react';
import { useDayStore, useEngine, useNimiDay } from '../app/context.js';
import { toLocalDate } from '../domain/time.js';
import type { SkillDefinition, SkillRun } from '../domain/types.js';
import { describeUndone, formatInstant } from '../i18n/index.js';
import { Hint, RunStateChip, SkillIcon } from './common.js';

/** A summary opens the existing detail view, where execution and undo controls live. */
export function RoutineRunList({ runs, skills, onOpen }: {
  readonly runs: readonly SkillRun[];
  readonly skills: readonly SkillDefinition[];
  readonly onOpen: (id: string) => void;
}) {
  const { copy, language } = useNimiDay();
  const { now } = useEngine();
  const snapshot = useDayStore();
  const today = toLocalDate(now);
  if (runs.length === 0) return <Hint>{copy.routines.runsEmpty}</Hint>;

  return (
    <div className="nd-run-summary-list">
      {runs.map((run, index) => {
        const skill = skills.find((entry) => entry.id === run.skillId);
        const changes = run.undone ? describeUndone(copy, run, snapshot.state.items)
          : run.toolCalls.some((call) => call.unsaved) ? (snapshot.saving === 'error' ? copy.run.unsavedNow : copy.run.unsavedThenSaved)
          : run.changes.length > 0 ? run.changes.map((change) => copy.run.change[change.kind](change.title)).join(' · ')
          : run.state === 'done' ? copy.run.noChanges : '';
        return (
          <button type="button" className="nd-run-summary" key={run.id} onClick={() => onOpen(run.id)}
            aria-label={`${copy.run.detail} · ${skillRunName(run, language)} · ${copy.run.states[run.state]} · ${formatInstant(copy, run.scheduledFor ?? run.createdAt, today)}`} data-testid="nd-run-summary">
            <span className="nd-run-summary__icon" data-icon={skill?.icon}><SkillIcon icon={skill?.icon ?? 'sparkles'} size={20} /></span>
            <strong>{skillRunName(run, language)}</strong>
            <RunStateChip state={run.state} />
            <time dateTime={run.scheduledFor ?? run.createdAt}>{formatInstant(copy, run.scheduledFor ?? run.createdAt, today)}</time>
            <span className="nd-run-summary__result">
              {index === 0 && run.replyText ? <span className="nd-run-summary__reply">{run.replyText.split(/\r?\n/u).find((line) => line.trim())}</span> : null}
              {changes ? <span className="nd-run-summary__changes">{changes}</span> : null}
            </span>
            <MoreHorizontal size={18} aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
