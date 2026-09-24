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
import { Plus } from 'lucide-react';
import { nextRhythmOccurrence } from '../domain/rhythms.js';
import { CUSTOM_SKILL_MATERIALS, CUSTOM_SKILL_TOOLS, defaultSkillText, isSkillAdjusted, resolveSkills, skillNeedsFocus } from '../domain/skills.js';
import { methodOverflow } from '../domain/work.js';
import { toLocalDate } from '../domain/time.js';
import type { MaterialKind, Rhythm, RhythmDays, SkillDefinition } from '../domain/types.js';
import { describeSchedule, formatInstant } from '../i18n/index.js';
import { useDayStore, useDesk, useEngine, useNimiDay } from '../app/context.js';
import { Card, Chip, Hint, MenuButton, PageHead, SkillIcon } from './common.js';
import { RunCard } from './run-card.js';
import { useUi } from './ui-context.js';

export function RoutinesPage({ focusRunId }: { readonly focusRunId?: string }) {
  const { copy, language, actions, engine } = useNimiDay();
  const { state } = useDayStore();
  const { now } = useEngine();
  const desk = useDesk();
  const ui = useUi();
  const [editingRhythm, setEditingRhythm] = useState<Rhythm | 'new' | null>(null);
  const [editingSkill, setEditingSkill] = useState<SkillDefinition | 'new' | null>(null);
  const skills = useMemo(() => resolveSkills(language, state.skillOverrides, state.customSkills), [language, state.skillOverrides, state.customSkills]);
  const runs = state.runs.filter((run) => run.state !== 'dismissed').slice().sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)).slice(0, 20);
  const today = toLocalDate(now);
  const canRun = desk.phase === 'ready' && desk.canUseWork;

  useEffect(() => {
    if (focusRunId) ui.openRun(focusRunId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRunId]);

  const use = async (skill: SkillDefinition, focusCircleId: string | null = null) => {
    const result = await engine.startSkill({ skillId: skill.id, trigger: 'user', focusCircleId });
    if (!result.ok) nimiToast.show({ tone: 'warning', message: result.message, durationMs: 6000 });
    else nimiToast.show({ tone: 'success', message: copy.skills.started(desk.agent?.displayName ?? copy.common.agentFallback, skill.name), durationMs: 4000 });
  };

  return (
    <div className="nd-page" data-testid="nd-routines">
      <PageHead title={copy.routines.title} sub={copy.routines.subtitle} />

      <Card
        title={copy.routines.rhythms}
        hint={copy.routines.whenClosed}
        action={<Button tone="ghost" size="sm" leadingIcon={<Plus size={14} aria-hidden="true" />} onClick={() => setEditingRhythm('new')}>{copy.routines.newRhythm}</Button>}
      >
        {state.rhythms.length === 0 ? <Hint>{copy.routines.runsEmpty}</Hint> : (
          <div className="nd-list">
            {state.rhythms.map((rhythm) => {
              const next = rhythm.enabled ? nextRhythmOccurrence(rhythm.schedule, now) : null;
              const skill = skills.find((candidate) => candidate.id === rhythm.skillId);
              return (
                <div key={rhythm.id} className="nd-rhythm-row" data-testid="nd-rhythm-row">
                  <div>
                    <div className="nd-inline-actions">
                      {skill ? <SkillIcon icon={skill.icon} size={16} /> : null}
                      <strong style={{ fontSize: 14 }}>{rhythm.name}</strong>
                      <span className="nd-faint">{describeSchedule(copy, rhythm.schedule)}</span>
                    </div>
                    <div className="nd-row-meta">
                      <Chip>{rhythm.start === 'auto' ? copy.routines.startAuto : copy.routines.startAsk}</Chip>
                      {!rhythm.enabled ? <Chip>{copy.routines.disabled}</Chip> : null}
                      {next ? <span>{copy.routines.next(formatInstant(copy, next.toISOString(), today))}</span> : null}
                      {skill ? <span>{skill.name}</span> : null}
                    </div>
                  </div>
                  <div className="nd-inline-actions">
                    <Button tone="ghost" size="sm" onClick={() => setEditingRhythm(rhythm)}>{copy.common.edit}</Button>
                    <Toggle checked={rhythm.enabled} ariaLabel={rhythm.name} onValueChange={(value) => actions.setRhythmEnabled(rhythm.id, value)} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      <div className="nd-split" style={{ margin: '24px 0 12px' }}>
        <h2 className="nd-card-title">{copy.routines.skills}</h2>
        <Button tone="ghost" size="sm" leadingIcon={<Plus size={14} aria-hidden="true" />} onClick={() => setEditingSkill('new')}>{copy.skills.newSkill}</Button>
      </div>
      {!canRun ? (
        <p className="nd-faint" style={{ margin: '-4px 0 12px' }}>
          {desk.phase !== 'ready' ? copy.skills.needAgent : copy.skills.needWorkBody}
        </p>
      ) : null}
      <div className="nd-skill-grid">
        {skills.map((skill) => (
          <Card key={skill.id} className="nd-skill-card" testId="nd-skill-card">
            <div className="nd-skill-head">
              <span className="nd-circle-icon"><SkillIcon icon={skill.icon} /></span>
              <strong style={{ fontSize: 15 }}>{skill.name}</strong>
              {skill.builtIn && isSkillAdjusted(skill.id, state.skillOverrides) ? <Chip tone="accent">{copy.skills.adjusted}</Chip> : null}
              {!skill.enabled ? <Chip>{copy.skills.disabled}</Chip> : null}
            </div>
            <p>{skill.purpose}</p>
            <div className="nd-row-meta">
              <span>{copy.skills.tools}</span>
              {skill.tools.slice(0, 5).map((tool) => <Chip key={tool}>{copy.skills.toolNames[tool] ?? tool}</Chip>)}
            </div>
            <div className="nd-skill-foot">
              {skillNeedsFocus(skill) && canRun && skill.enabled ? (
                <MenuButton
                  label={copy.skills.useFor}
                  trigger={<Button tone="primary" size="sm">{copy.skills.use}</Button>}
                  items={[
                    { id: 'everyone', label: copy.skills.useForEveryone, onSelect: () => { void use(skill); } },
                    ...state.circles
                      .filter((circle) => circle.status !== 'ended')
                      .map((circle) => ({ id: circle.id, label: circle.name, onSelect: () => { void use(skill, circle.id); } })),
                  ]}
                />
              ) : (
                <Button tone="primary" size="sm" disabled={!canRun || !skill.enabled} onClick={() => { void use(skill); }}>{copy.skills.use}</Button>
              )}
              <Button tone="ghost" size="sm" onClick={() => setEditingSkill(skill)}>{copy.skills.adjust}</Button>
            </div>
          </Card>
        ))}
      </div>

      <Card title={copy.routines.runs} className="" testId="nd-runs">
        {runs.length === 0 ? <Hint>{copy.routines.runsEmpty}</Hint> : (
          <div className="nd-list">
            {runs.map((run) => <RunCard key={run.id} run={run} />)}
          </div>
        )}
      </Card>

      {editingRhythm ? (
        <RhythmEditor rhythm={editingRhythm === 'new' ? null : editingRhythm} skills={skills} onClose={() => setEditingRhythm(null)} />
      ) : null}
      {editingSkill ? (
        <SkillEditor skill={editingSkill === 'new' ? null : editingSkill} onClose={() => setEditingSkill(null)} />
      ) : null}
    </div>
  );
}

function RhythmEditor({ rhythm, skills, onClose }: { readonly rhythm: Rhythm | null; readonly skills: readonly SkillDefinition[]; readonly onClose: () => void }) {
  const { copy, actions } = useNimiDay();
  const [name, setName] = useState(rhythm?.name ?? '');
  const [skillId, setSkillId] = useState(rhythm?.skillId ?? skills[0]?.id ?? '');
  const [days, setDays] = useState<RhythmDays>(rhythm?.schedule.days ?? 'daily');
  const [weekdays, setWeekdays] = useState<number[]>([...(rhythm?.schedule.weekdays ?? [])]);
  const [time, setTime] = useState(rhythm?.schedule.time ?? '08:00');
  const [notify, setNotify] = useState(rhythm?.notify ?? true);
  const [start, setStart] = useState<'ask' | 'auto'>(rhythm?.start ?? 'ask');
  const desk = useDesk();
  const skill = skills.find((candidate) => candidate.id === skillId);

  const save = () => {
    const schedule = { days, weekdays: days === 'custom' ? (weekdays.length ? weekdays : [1]) : [], time };
    if (rhythm) actions.editRhythm(rhythm.id, { name: name || skill?.name, schedule, notify, start });
    else {
      const created = actions.addRhythm({ skillId, name: name || skill?.name || skillId, schedule });
      if (start !== 'ask' || !notify) actions.editRhythm(created.id, { start, notify });
    }
    onClose();
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent onClose={onClose}>
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
              <SegmentedControl ariaLabel={copy.routines.rhythmDays} size="sm" value={days} onValueChange={(value) => setDays(value as RhythmDays)}
                items={(['daily', 'weekdays', 'weekends', 'custom'] as const).map((value) => ({ value, label: copy.routines.daysOptions[value] }))} />
              {days === 'custom' ? (
                <div className="nd-weekday-picker">
                  {[1, 2, 3, 4, 5, 6, 0].map((weekday) => (
                    <button key={weekday} type="button" className="nd-weekday" aria-pressed={weekdays.includes(weekday)}
                      onClick={() => setWeekdays(weekdays.includes(weekday) ? weekdays.filter((value) => value !== weekday) : [...weekdays, weekday])}>
                      {copy.time.weekdays[weekday]}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
            <label className="nd-field">
              <span className="nd-field-label">{copy.routines.rhythmTime}</span>
              <input className="nd-native-input" type="time" value={time} onChange={(event) => setTime(event.target.value)} />
            </label>
            <div className="nd-field">
              <SegmentedControl
                ariaLabel={copy.routines.startAsk}
                size="sm"
                value={start}
                onValueChange={(value) => setStart(value as 'ask' | 'auto')}
                items={[
                  { value: 'ask', label: copy.routines.startAsk },
                  { value: 'auto', label: copy.routines.startAuto, disabled: !desk.canUseWork },
                ]}
              />
              <span className="nd-faint">{desk.canUseWork ? copy.routines.startAutoHint : copy.routines.startAutoUnavailable}</span>
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
              <Button tone="primary" size="sm" disabled={!skillId} onClick={save}>{copy.common.save}</Button>
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
      <DialogContent onClose={onClose}>
        <DialogHeader><DialogTitle>{skill ? `${copy.skills.adjust} · ${skill.name}` : copy.skills.newSkill}</DialogTitle></DialogHeader>
        <DialogBody>
          <div className="nd-form nd-dialog-scroll">
            {!builtIn ? (
              <>
                <label className="nd-field">
                  <span className="nd-field-label">{copy.skills.name}</span>
                  <TextField value={name} maxLength={40} onChange={(event) => setName(event.target.value)} />
                </label>
                <label className="nd-field">
                  <span className="nd-field-label">{copy.skills.purpose}</span>
                  <TextField value={purpose} maxLength={200} onChange={(event) => setPurpose(event.target.value)} />
                </label>
              </>
            ) : <p className="nd-muted" style={{ margin: 0, fontSize: 13 }}>{skill?.purpose}</p>}
            <label className="nd-field">
              <span className="nd-field-label">{copy.skills.request}</span>
              <TextField value={request} maxLength={300} onChange={(event) => setRequest(event.target.value)} />
            </label>
            <label className="nd-field">
              <span className="nd-field-label">{copy.skills.method}</span>
              <TextareaField value={instructions} rows={9} maxLength={4000} onChange={(event) => setInstructions(event.target.value)} />
              {overflow > 0 ? <span className="nd-field-error" role="alert" data-testid="nd-method-too-long">{copy.skills.methodTooLong(overflow)}</span> : null}
            </label>
            {!builtIn ? (
              <>
                <div className="nd-field">
                  <span className="nd-field-label">{copy.skills.tools}</span>
                  <div className="nd-kind-picker">
                    {CUSTOM_SKILL_TOOLS.map((tool) => (
                      <Checkbox key={tool} label={copy.skills.toolNames[tool] ?? tool} checked={tools.includes(tool)} onChange={() => setTools(toggle(tools, tool))} />
                    ))}
                  </div>
                </div>
                <div className="nd-field">
                  <span className="nd-field-label">{copy.skills.materials}</span>
                  <div className="nd-kind-picker">
                    {CUSTOM_SKILL_MATERIALS.map((material) => (
                      <Checkbox key={material} label={copy.skills.materialNames[material] ?? material} checked={materials.includes(material)} onChange={() => setMaterials(toggle(materials, material))} />
                    ))}
                  </div>
                </div>
              </>
            ) : (
              <div className="nd-row-meta">
                <span>{copy.skills.materials}</span>
                {skill?.materials.map((material) => <Chip key={material}>{copy.skills.materialNames[material] ?? material}</Chip>)}
              </div>
            )}
            {skill ? (
              <div className="nd-field">
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
