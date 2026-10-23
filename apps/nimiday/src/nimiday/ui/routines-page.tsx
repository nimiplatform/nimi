import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  nimiToast,
  SegmentedControl,
  SelectField,
  TextareaField,
  TextField,
  Toggle,
} from '@nimiplatform/kit/ui';
import { ArrowRight, ChevronDown, ChevronRight, Info, Plus } from 'lucide-react';
import { nextRhythmOccurrence } from '../domain/rhythms.js';
import { activeSkillRun, CUSTOM_SKILL_MATERIALS, CUSTOM_SKILL_TOOLS, defaultSkillText, isSkillAdjusted, preparationAppointments, resolveSkills, skillNeedsFocus, VISIT_PREP_SKILL } from '../domain/skills.js';
import { methodOverflow } from '../domain/work.js';
import { toLocalDate } from '../domain/time.js';
import type { MaterialKind, Rhythm, RhythmDays, SkillDefinition } from '../domain/types.js';
import { describeScheduleDays, formatInstant, formatWhen } from '../i18n/index.js';
import { useDayStore, useDesk, useEngine, useNimiDay } from '../app/context.js';
import { Chip, Hint, MenuButton, PageHead, SkillIcon } from './common.js';
import { RoutineRunList } from './routine-run-list.js';
import { SkillLibrary } from './skill-library.js';
import { TimeField, timeFieldLabels } from './time-field.js';
import { useUi } from './ui-context.js';

// @nimi-authority: rule.nimi.nimiday.assistant.skill-library
export function RoutinesPage({ focusRunId }: { readonly focusRunId?: string }) {
  const { copy, language, actions, engine } = useNimiDay();
  const { state } = useDayStore();
  const { now } = useEngine();
  const desk = useDesk();
  const ui = useUi();
  const [editingRhythm, setEditingRhythm] = useState<Rhythm | 'new' | null>(null);
  const [editingSkill, setEditingSkill] = useState<SkillDefinition | 'new' | null>(null);
  const [showAllRuns, setShowAllRuns] = useState(false);
  const [librarySelection, setLibrarySelection] = useState<string | null | undefined>(undefined);
  const [focusSkill, setFocusSkill] = useState<SkillDefinition | null>(null);
  const [newRhythmSkillId, setNewRhythmSkillId] = useState<string | undefined>();
  const [preparingSkill, setPreparingSkill] = useState<SkillDefinition | null>(null);
  const [selectedAppointment, setSelectedAppointment] = useState('');
  const skills = useMemo(() => resolveSkills(language, state.skillOverrides, state.customSkills), [language, state.skillOverrides, state.customSkills]);
  const runs = state.runs.filter((run) => run.state !== 'dismissed').slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const favorites = state.favoriteSkillIds.flatMap(id => skills.find(skill => skill.id === id) ?? []);
  const today = toLocalDate(now);
  const canRun = desk.phase === 'ready' && desk.canUseWork;
  const appointments = preparationAppointments(state);
  const currentRuns = runs.filter(run => run.trigger !== 'chat');
  const recentRuns = [...currentRuns.filter(run => run.state === 'queued' || run.state === 'running'),
    ...currentRuns.filter(run => run.state !== 'queued' && run.state !== 'running')].slice(0, 4);

  useEffect(() => {
    if (focusRunId) ui.openRun(focusRunId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRunId]);

  const use = async (skill: SkillDefinition, focusCircleId: string | null | undefined = undefined, focusItemId: string | null = null) => {
    if (skillNeedsFocus(skill) && focusCircleId === undefined) {
      setFocusSkill(skill);
      return;
    }
    if (skill.id === VISIT_PREP_SKILL && !focusItemId) {
      setSelectedAppointment('');
      setPreparingSkill(skill);
      return;
    }
    const result = await engine.startSkill({ skillId: skill.id, trigger: 'user', focusCircleId: focusCircleId ?? null, focusItemId });
    if (!result.ok) nimiToast.show({ tone: 'warning', message: result.message, durationMs: 6000 });
    else {
      setPreparingSkill(null);
      setFocusSkill(null);
      ui.openRun(result.runId);
    }
  };

  return (
    <div className="nd-page nd-routines-page" data-testid="nd-routines">
      <PageHead title={copy.routines.title} />

      <section className="nd-routines-section" aria-labelledby="nd-rhythms-heading">
        <div className="nd-section-heading">
          <h2 id="nd-rhythms-heading">{copy.routines.rhythms}</h2>
          <Button tone="ghost" size="sm" className="nd-section-action" leadingIcon={<Plus size={18} aria-hidden="true" />} onClick={() => { setNewRhythmSkillId(undefined); setEditingRhythm('new'); }}>{copy.routines.newRhythm}</Button>
        </div>
        {state.rhythms.length === 0 ? <Hint>{copy.routines.rhythmsEmpty}</Hint> : (
          <div className="nd-rhythm-grid">
            {state.rhythms.map((rhythm) => {
              const next = rhythm.enabled ? nextRhythmOccurrence(rhythm.schedule, now) : null;
              const skill = skills.find((candidate) => candidate.id === rhythm.skillId);
              return (
                <article key={rhythm.id} className="nd-rhythm-tile" data-testid="nd-rhythm-row" data-enabled={rhythm.enabled}>
                  <span className="nd-skill-icon" data-icon={skill?.icon}><SkillIcon icon={skill?.icon ?? 'sparkles'} size={26} /></span>
                  <button type="button" className="nd-rhythm-edit" onClick={() => setEditingRhythm(rhythm)} aria-label={`${copy.routines.editRhythm} · ${rhythm.name}`} title={copy.routines.editRhythm}>
                    <strong>{rhythm.name}</strong>
                    <time className="nd-rhythm-time">{rhythm.schedule.time}</time>
                    <span className="nd-rhythm-days">{describeScheduleDays(copy, rhythm.schedule)}</span>
                    <span className="nd-rhythm-mode">{rhythm.start === 'auto' ? copy.routines.startAuto : copy.routines.startAsk}</span>
                    {next ? <span className="nd-rhythm-next">{copy.routines.next(formatInstant(copy, next.toISOString(), today))}</span> : null}
                  </button>
                  <div className="nd-rhythm-toggle">
                    <Toggle checked={rhythm.enabled} ariaLabel={rhythm.name} onValueChange={(value) => actions.setRhythmEnabled(rhythm.id, value)} />
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="nd-routines-section" aria-labelledby="nd-skills-heading">
        <div className="nd-section-heading">
          <h2 id="nd-skills-heading">{copy.routines.skills}</h2>
          <Button tone="ghost" size="sm" className="nd-section-action" leadingIcon={<Plus size={18} aria-hidden="true" />} onClick={() => setLibrarySelection(null)}>{copy.skills.addSkill}</Button>
        </div>
        {!canRun ? <p className="nd-section-hint" role="status">{desk.phase !== 'ready' ? copy.skills.needAgent : copy.skills.needWorkBody}</p> : null}
        {favorites.length === 0 ? <div className="nd-skills-welcome" data-testid="nd-skills-welcome">
          <h3>{currentRuns.length === 0 ? copy.skills.firstUse : copy.skills.favoritesEmpty}</h3>
          <p>{copy.skills.favoritesEmptyHint}</p>
          {currentRuns.length === 0 ? <div className="nd-inline-actions">
            {['morning-care', 'shopping-list', VISIT_PREP_SKILL].map(id => <Button key={id} tone="secondary" size="sm" onClick={() => setLibrarySelection(id)}>{copy.skills.actions[id]}</Button>)}
          </div> : null}
          <Button tone="ghost" size="sm" trailingIcon={<ArrowRight size={16} />} onClick={() => setLibrarySelection(null)}>{copy.skills.browseLibrary}</Button>
        </div> : <div className="nd-favorite-skills" data-testid="nd-favorite-skills">
          {favorites.map(skill => {
            const latest = currentRuns.find(run => run.skillId === skill.id);
            const pending = !skillNeedsFocus(skill) && skill.id !== VISIT_PREP_SKILL ? activeSkillRun(runs, skill.id) : null;
            return <article key={skill.id} className="nd-favorite-skill" data-testid="nd-favorite-skill">
              <span className="nd-skill-icon" data-icon={skill.icon}><SkillIcon icon={skill.icon} size={22} /></span>
              <div className="nd-favorite-skill__copy">
                <div className="nd-inline-actions"><h3>{skill.name}</h3>
                  {skill.builtIn && isSkillAdjusted(skill.id, state.skillOverrides) ? <Chip tone="accent">{copy.skills.adjusted}</Chip> : null}
                  {!skill.enabled ? <Chip>{copy.skills.disabled}</Chip> : null}
                </div>
                {latest ? <button type="button" className="nd-link nd-skill-latest" onClick={() => ui.openRun(latest.id)}>
                  {formatInstant(copy, latest.createdAt, today)} · {copy.run.states[latest.state]} · {latest.state === 'queued' || latest.state === 'running' ? copy.skills.viewProgress : copy.skills.viewResult}
                </button> : null}
              </div>
              <Button tone="ghost" size="sm" className="nd-skill-use" disabled={!pending && (!canRun || !skill.enabled)}
                trailingIcon={skillNeedsFocus(skill) ? <ChevronDown size={16} /> : <ArrowRight size={16} />}
                onClick={() => { if (pending) ui.openRun(pending.id); else void use(skill); }}>
                {pending ? copy.skills.viewProgress : skillNeedsFocus(skill) ? copy.skills.chooseFocus : copy.skills.actions[skill.id] ?? copy.skills.use}
              </Button>
              <MenuButton label={copy.skills.manage(skill.name)} items={[
                { id: 'edit', label: copy.skills.adjust, onSelect: () => setEditingSkill(skill) },
                { id: 'schedule', label: copy.skills.schedule, disabled: !skill.enabled, onSelect: () => { setNewRhythmSkillId(skill.id); setEditingRhythm('new'); } },
                { id: 'remove', label: copy.skills.removeFavorite, onSelect: () => actions.setSkillFavorite(skill.id, false) },
              ]} />
            </article>;
          })}
        </div>}
      </section>

      <section className="nd-routines-section" aria-labelledby="nd-recent-tasks-heading" data-testid="nd-runs">
        <div className="nd-section-heading">
          <h2 id="nd-recent-tasks-heading">{copy.routines.recentTasks}</h2>
          <Button tone="ghost" size="sm" trailingIcon={<ChevronRight size={16} />} onClick={() => setShowAllRuns(true)}>{copy.routines.allRuns}</Button>
        </div>
        <div className="nd-run-list-surface"><RoutineRunList runs={recentRuns} skills={skills} onOpen={ui.openRun} /></div>
      </section>

      {librarySelection !== undefined ? <SkillLibrary skills={skills} initialSkillId={librarySelection} onClose={() => setLibrarySelection(undefined)}
        onUse={skill => { setLibrarySelection(undefined); void use(skill); }}
        onEdit={skill => { setLibrarySelection(undefined); setEditingSkill(skill); }}
        onSchedule={skill => { setLibrarySelection(undefined); setNewRhythmSkillId(skill.id); setEditingRhythm('new'); }}
      /> : null}

      {focusSkill ? <Dialog open onOpenChange={open => { if (!open) setFocusSkill(null); }}>
        <DialogContent onClose={() => setFocusSkill(null)} data-testid="nd-skill-focus">
          <DialogHeader><DialogTitle>{copy.skills.useFor}</DialogTitle></DialogHeader>
          <DialogBody><div className="nd-focus-options">
            <Button tone="secondary" disabled={!canRun || !focusSkill.enabled} onClick={() => { void use(focusSkill, null); }}>{copy.skills.useForEveryone}</Button>
            {state.circles.filter(circle => circle.status !== 'ended').map(circle => <Button key={circle.id} tone="secondary" disabled={!canRun || !focusSkill.enabled} onClick={() => { void use(focusSkill, circle.id); }}>{circle.name}</Button>)}
          </div></DialogBody>
          <DialogFooter><Button tone="secondary" onClick={() => setFocusSkill(null)}>{copy.common.cancel}</Button></DialogFooter>
        </DialogContent>
      </Dialog> : null}

      {preparingSkill ? (
        <Dialog open onOpenChange={(open) => { if (!open) setPreparingSkill(null); }}>
          <DialogContent onClose={() => setPreparingSkill(null)} data-testid="nd-choose-appointment">
            <DialogHeader><DialogTitle>{copy.skills.chooseAppointment}</DialogTitle></DialogHeader>
            <DialogBody>
              <p className="nd-muted">{appointments.length ? copy.skills.appointmentHint : copy.skills.noAppointments}</p>
              <div className="nd-appointment-options" role="radiogroup" aria-label={copy.skills.chooseAppointment}>
                {appointments.map(item => <label key={item.id} className="nd-appointment-option" data-selected={selectedAppointment === item.id}>
                  <input type="radio" name="preparation-appointment" checked={selectedAppointment === item.id} onChange={() => setSelectedAppointment(item.id)} />
                  <span><strong>{item.title}</strong><span className="nd-faint">{formatWhen(copy, item, today)}{item.place ? ` · ${item.place}` : ''}</span></span>
                </label>)}
              </div>
            </DialogBody>
            <DialogFooter>
              <Button tone="ghost" onClick={() => { setPreparingSkill(null); ui.newItem({ kind: 'appointment' }); }}>{copy.skills.addAppointment}</Button>
              <Button tone="primary" disabled={!canRun || !appointments.some(item => item.id === selectedAppointment)} onClick={() => { void use(preparingSkill, null, selectedAppointment); }}>{copy.skills.prepareAppointment}</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      ) : null}

      {showAllRuns ? (
        <Dialog open onOpenChange={(open) => { if (!open) setShowAllRuns(false); }}>
          <DialogContent onClose={() => setShowAllRuns(false)} data-testid="nd-all-runs">
            <DialogHeader><DialogTitle>{copy.routines.allRuns}</DialogTitle></DialogHeader>
            <DialogBody>
              <RoutineRunList runs={runs} skills={skills} onOpen={(id) => { setShowAllRuns(false); ui.openRun(id); }} />
            </DialogBody>
          </DialogContent>
        </Dialog>
      ) : null}

      {editingRhythm ? (
        <RhythmEditor initialSkillId={newRhythmSkillId} rhythm={editingRhythm === 'new' ? null : editingRhythm} skills={skills} onClose={() => setEditingRhythm(null)} />
      ) : null}
      {editingSkill ? (
        <SkillEditor skill={editingSkill === 'new' ? null : editingSkill} onClose={() => setEditingSkill(null)} />
      ) : null}
    </div>
  );
}

function RhythmEditor({ rhythm, skills, initialSkillId, onClose }: { readonly initialSkillId?: string; readonly rhythm: Rhythm | null; readonly skills: readonly SkillDefinition[]; readonly onClose: () => void }) {
  const { copy, actions } = useNimiDay();
  const [name, setName] = useState(rhythm?.name ?? '');
  const [skillId, setSkillId] = useState(rhythm?.skillId ?? initialSkillId ?? skills[0]?.id ?? '');
  const [days, setDays] = useState<RhythmDays>(rhythm?.schedule.days ?? 'daily');
  const [weekdays, setWeekdays] = useState<number[]>([...(rhythm?.schedule.weekdays ?? [])]);
  const [time, setTime] = useState(rhythm?.schedule.time ?? '08:00');
  const [notify, setNotify] = useState(rhythm?.notify ?? true);
  const [start, setStart] = useState<'ask' | 'auto'>(rhythm?.start ?? 'ask');
  const desk = useDesk();
  const skill = skills.find((candidate) => candidate.id === skillId);
  const needsWeekday = days === 'custom' && weekdays.length === 0;

  const save = () => {
    if (!skillId || needsWeekday) return;
    const schedule = { days, weekdays: days === 'custom' ? weekdays : [], time };
    if (rhythm) actions.editRhythm(rhythm.id, { name: name || skill?.name, schedule, notify, start });
    else {
      const created = actions.addRhythm({ skillId, name: name || skill?.name || skillId, schedule });
      if (start !== 'ask' || !notify) actions.editRhythm(created.id, { start, notify });
    }
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent onClose={onClose} className="max-w-lg" data-testid="nd-rhythm-editor">
        <DialogHeader><DialogTitle>{rhythm ? copy.routines.editRhythm : copy.routines.newRhythm}</DialogTitle></DialogHeader>
        <DialogBody>
          <div className="nd-form nd-dialog-scroll">
            <label className="nd-field">
              <span className="nd-field-label">{copy.routines.rhythmSkill}</span>
              <SelectField contentLayer="dialog" aria-label={copy.routines.rhythmSkill} value={skillId} onValueChange={setSkillId} options={skills.map((entry) => ({ value: entry.id, label: entry.name }))} disabled={Boolean(rhythm)} />
            </label>
            <label className="nd-field">
              <span className="nd-field-label">{copy.routines.rhythmName}</span>
              <TextField value={name} placeholder={skill?.name} maxLength={60} onChange={(event) => setName(event.target.value)} />
            </label>
            <div className="nd-field">
              <span className="nd-field-label">{copy.routines.rhythmDays}</span>
              <SegmentedControl className="nd-segmented-fill" ariaLabel={copy.routines.rhythmDays} size="sm" value={days} onValueChange={(value) => setDays(value as RhythmDays)}
                items={(['daily', 'weekdays', 'weekends', 'custom'] as const).map((value) => ({ value, label: copy.routines.daysOptions[value] }))} />
              {days === 'custom' ? (
                <><div className="nd-weekday-picker" role="group" aria-label={copy.routines.rhythmDays} aria-describedby={needsWeekday ? 'nd-rhythm-weekday-hint' : undefined}>
                  {[1, 2, 3, 4, 5, 6, 0].map((weekday) => (
                    <button key={weekday} type="button" className="nd-weekday" aria-pressed={weekdays.includes(weekday)}
                      onClick={() => setWeekdays(weekdays.includes(weekday) ? weekdays.filter((value) => value !== weekday) : [...weekdays, weekday])}>
                      {copy.time.weekdays[weekday]}
                    </button>
                  ))}
                </div>{needsWeekday ? <p id="nd-rhythm-weekday-hint" role="status" className="nd-field-error">{copy.routines.chooseWeekday}</p> : null}</>
              ) : null}
            </div>
            <label className="nd-field">
              <span className="nd-field-label">{copy.routines.rhythmTime}</span>
              <TimeField contentLayer="dialog" value={time} onValueChange={setTime} labels={timeFieldLabels(copy, copy.routines.rhythmTime)} />
            </label>
            <div className="nd-field">
              <span className="nd-field-label">{copy.routines.startMode}</span>
              <SegmentedControl
                className="nd-segmented-fill"
                ariaLabel={copy.routines.startMode}
                size="sm"
                value={start}
                onValueChange={(value) => setStart(value as 'ask' | 'auto')}
                items={[
                  { value: 'ask', label: copy.routines.startAsk },
                  { value: 'auto', label: copy.routines.startAuto, disabled: !desk.canUseWork },
                ]}
              />
              <p className="nd-field-note">
                <Info size={14} aria-hidden="true" />
                <span>{desk.canUseWork ? copy.routines.startAutoHint : copy.routines.startAutoUnavailable}</span>
              </p>
            </div>
            <div className="nd-setting">
              <span className="nd-setting-title">{copy.routines.notify}</span>
              <Toggle checked={notify} onValueChange={setNotify} ariaLabel={copy.routines.notify} />
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <div className="nd-split" style={{ width: '100%' }}>
            {rhythm ? <Button tone="ghost" size="sm" onClick={() => { actions.deleteRhythm(rhythm.id); onClose(); }}>{copy.routines.deleteRhythm}</Button> : <span />}
            <div className="nd-inline-actions">
              <Button tone="secondary" size="sm" onClick={onClose}>{copy.common.cancel}</Button>
              <Button tone="primary" size="sm" disabled={!skillId || needsWeekday} onClick={save}>{copy.common.save}</Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SkillEditor({ skill, onClose }: { readonly skill: SkillDefinition | null; readonly onClose: () => void }) {
  const { copy, actions, language } = useNimiDay();
  const { state } = useDayStore();
  const liveLessons = skill
    ? resolveSkills(language, state.skillOverrides, state.customSkills).find((candidate) => candidate.id === skill.id)?.lessons ?? []
    : [];
  const builtIn = skill?.builtIn ?? false;
  const [name, setName] = useState(skill?.name ?? '');
  const [purpose, setPurpose] = useState(skill?.purpose ?? '');
  const [request, setRequest] = useState(skill?.request ?? '');
  const [instructions, setInstructions] = useState(skill?.instructions ?? '');
  const [tools, setTools] = useState<string[]>([...(skill?.tools ?? ['day_list_items', 'day_create_item', 'day_ask_user'])]);
  const [materials, setMaterials] = useState<MaterialKind[]>([...(skill?.materials ?? ['today', 'week'])]);
  const [enabled, setEnabled] = useState(skill?.enabled ?? true);
  // The same budget the skill is started with: a method that is saved is handed over whole.
  const overflow = methodOverflow({ instructions, lessons: liveLessons }, language);

  const save = () => {
    if (builtIn && skill) {
      const defaults = defaultSkillText(skill.id, language);
      actions.adjustSkill(skill.id, {
        ...(defaults && instructions !== defaults.instructions ? { instructions } : {}),
        ...(defaults && request !== defaults.request ? { request } : {}),
        enabled,
      });
    } else {
      actions.saveCustomSkill({
        ...(skill ? { id: skill.id } : {}),
        icon: skill?.icon ?? 'sparkles',
        name: name.trim() || copy.skills.newSkill,
        purpose: purpose.trim(),
        request: request.trim() || name.trim(),
        instructions: instructions.trim(),
        tools,
        materials,
        enabled,
      });
    }
    onClose();
  };

  const toggle = <T extends string>(list: T[], value: T): T[] => (list.includes(value) ? list.filter((entry) => entry !== value) : [...list, value]);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent onClose={onClose} className="max-w-xl" data-testid="nd-skill-editor">
        <DialogHeader><DialogTitle>{skill ? `${copy.skills.adjust} · ${skill.name}` : copy.skills.newSkill}</DialogTitle></DialogHeader>
        <DialogBody>
          <div className="nd-form nd-dialog-scroll">
            {!builtIn ? (
              <>
                <label className="nd-field">
                  <span className="nd-field-label">{copy.skills.name}</span>
                  <TextField value={name} maxLength={40} placeholder={copy.skills.namePlaceholder} onChange={(event) => setName(event.target.value)} />
                </label>
                <label className="nd-field">
                  <span className="nd-field-label">{copy.skills.purpose}</span>
                  <TextField value={purpose} maxLength={200} placeholder={copy.skills.purposePlaceholder} onChange={(event) => setPurpose(event.target.value)} />
                </label>
              </>
            ) : <p className="nd-field-note">{skill?.purpose}</p>}
            <label className="nd-field">
              <span className="nd-field-label">{copy.skills.request}</span>
              <TextField value={request} maxLength={300} placeholder={copy.skills.requestPlaceholder} onChange={(event) => setRequest(event.target.value)} />
            </label>
            <label className="nd-field">
              <span className="nd-field-label">{copy.skills.method}</span>
              <TextareaField value={instructions} rows={7} maxLength={4000} placeholder={copy.skills.methodPlaceholder} onChange={(event) => setInstructions(event.target.value)} />
              {overflow > 0 ? <span className="nd-field-error" role="alert" data-testid="nd-method-too-long">{copy.skills.methodTooLong(overflow)}</span> : null}
            </label>
            {!builtIn ? (
              <>
                <div className="nd-field nd-form-section">
                  <span className="nd-field-label">{copy.skills.tools}</span>
                  <div className="nd-check-grid">
                    {CUSTOM_SKILL_TOOLS.map((tool) => (
                      <Checkbox key={tool} label={copy.skills.toolNames[tool] ?? tool} checked={tools.includes(tool)} onChange={() => setTools(toggle(tools, tool))} />
                    ))}
                  </div>
                </div>
                <div className="nd-field nd-form-section">
                  <span className="nd-field-label">{copy.skills.materials}</span>
                  <div className="nd-check-grid">
                    {CUSTOM_SKILL_MATERIALS.map((material) => (
                      <Checkbox key={material} label={copy.skills.materialNames[material] ?? material} checked={materials.includes(material)} onChange={() => setMaterials(toggle(materials, material))} />
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <>
                <div className="nd-row-meta">
                  <span>{copy.skills.materials}</span>
                  {skill?.materials.map((material) => <Chip key={material}>{copy.skills.materialNames[material] ?? material}</Chip>)}
                </div>
                <div className="nd-row-meta">
                  <span>{copy.skills.tools}</span>
                  {skill?.tools.map((tool) => <Chip key={tool}>{copy.skills.toolNames[tool] ?? tool}</Chip>)}
                </div>
              </>
            )}
            {skill ? (
              <div className="nd-field nd-form-section">
                <span className="nd-field-label">{copy.skills.lessons}</span>
                <span className="nd-faint">{copy.skills.lessonsHint}</span>
                {liveLessons.length === 0 ? <span className="nd-faint">{copy.skills.lessonsEmpty}</span> : (
                  <ul className="nd-changes-list">
                    {liveLessons.map((entry) => (
                      <li key={entry.id} className="nd-split">
                        <span>{entry.text}</span>
                        <button type="button" className="nd-link" onClick={() => actions.removeLesson(skill.id, entry.id)}>{copy.common.delete}</button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ) : null}
            <div className="nd-setting">
              <span className="nd-setting-title">{copy.skills.enabledLabel}</span>
              <Toggle checked={enabled} onValueChange={setEnabled} ariaLabel={copy.skills.enabledLabel} />
            </div>
          </div>
        </DialogBody>
        <DialogFooter>
          <div className="nd-split" style={{ width: '100%' }}>
            {builtIn && skill ? (
              <Button tone="ghost" size="sm" onClick={() => { actions.resetSkill(skill.id); onClose(); }}>{copy.skills.reset}</Button>
            ) : skill ? (
              <Button tone="ghost" size="sm" onClick={() => { actions.deleteCustomSkill(skill.id); onClose(); }}>{copy.skills.deleteSkill}</Button>
            ) : <span />}
            <div className="nd-inline-actions">
              <Button tone="secondary" size="sm" onClick={onClose}>{copy.common.cancel}</Button>
              <Button tone="primary" size="sm" disabled={(!builtIn && !name.trim()) || overflow > 0} onClick={save}>{copy.common.save}</Button>
            </div>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
