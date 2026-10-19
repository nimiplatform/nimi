import { useMemo, useState } from 'react';
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTitle } from '@nimiplatform/kit/ui';
import { ChevronRight } from 'lucide-react';
import { useDayStore, useNimiDay } from '../app/context.js';
import { skillRunName, resolveSkills } from '../domain/skills.js';
import type { LocalDate, SkillRun } from '../domain/types.js';
import { describeUndone, formatInstant } from '../i18n/index.js';
import { RunStateChip, SkillIcon } from './common.js';
import { useUi } from './ui-context.js';

// Only the preview order changes. Execution, decisions and history stay with their existing owners.
function priority(run: SkillRun): number {
  if (run.state === 'waiting-start' || run.state === 'missed' || run.state === 'failed' || run.state === 'interrupted') return 0;
  if (run.state === 'running' || run.state === 'queued') return 1;
  return 2;
}

export function TodayCareRuns({ runs, today, title }: {
  readonly runs: readonly SkillRun[];
  readonly today: LocalDate;
  readonly title: string;
}) {
  const { copy, language } = useNimiDay();
  const snapshot = useDayStore();
  const ui = useUi();
  const [showAll, setShowAll] = useState(false);
  const skills = useMemo(() => resolveSkills(language, snapshot.state.skillOverrides, snapshot.state.customSkills), [language, snapshot.state.skillOverrides, snapshot.state.customSkills]);
  const ordered = useMemo(() => [...runs].sort((a, b) => priority(a) - priority(b)), [runs]);

  const rows = (entries: readonly SkillRun[]) => entries.map((run) => {
    const icon = skills.find((skill) => skill.id === run.skillId)?.icon ?? 'sparkles';
    const note = run.undone ? describeUndone(copy, run, snapshot.state.items)
      : run.toolCalls.some((call) => call.unsaved) ? (snapshot.saving === 'error' ? copy.run.unsavedNow : copy.run.unsavedThenSaved)
        : null;
    return (
      <button type="button" className="nd-today-run" key={run.id} data-testid="nd-today-run"
        onClick={() => { setShowAll(false); ui.openRun(run.id); }}
        aria-label={`${copy.run.detail} · ${skillRunName(run, language)} · ${copy.run.states[run.state]}`}>
        <span className="nd-skill-icon" data-icon={icon}><SkillIcon icon={icon} size={23} /></span>
        <span className="nd-today-run-body">
          <strong>{skillRunName(run, language)}</strong>
          <span className="nd-today-run-meta">
            <RunStateChip state={run.state} />
            <span>{copy.run.trigger[run.trigger]}</span>
            <time dateTime={run.scheduledFor ?? run.createdAt}>{formatInstant(copy, run.scheduledFor ?? run.createdAt, today)}</time>
          </span>
          {note ? <span className="nd-today-run-note">{note}</span> : null}
        </span>
        <ChevronRight size={16} aria-hidden="true" />
      </button>
    );
  });

  return (
    <>
      <div className="nd-today-run-list">{rows(ordered.slice(0, 3))}</div>
      {ordered.length > 3 ? (
        <button type="button" className="nd-link nd-link-icon nd-today-runs-all" onClick={() => setShowAll(true)}>
          {copy.today.seeAll} ({ordered.length}) <ChevronRight size={16} aria-hidden="true" />
        </button>
      ) : null}
      {showAll ? (
        <Dialog open onOpenChange={(open) => { if (!open) setShowAll(false); }}>
          <DialogContent onClose={() => setShowAll(false)} data-testid="nd-today-all-runs">
            <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
            <DialogBody><div className="nd-today-run-list">{rows(ordered)}</div></DialogBody>
          </DialogContent>
        </Dialog>
      ) : null}
    </>
  );
}
