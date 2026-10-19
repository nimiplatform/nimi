import { useState } from 'react';
import { Button, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DialogTitle, TextField } from '@nimiplatform/kit/ui';
import { ArrowLeft, ChevronRight, Plus } from 'lucide-react';
import { useDayStore, useDesk, useNimiDay } from '../app/context.js';
import type { SkillDefinition } from '../domain/types.js';
import { Chip, SkillIcon } from './common.js';

// @nimi-authority: rule.nimi.nimiday.assistant.skill-library
export function SkillLibrary({ skills, initialSkillId, onClose, onUse, onEdit, onSchedule }: {
  readonly skills: readonly SkillDefinition[];
  readonly initialSkillId: string | null;
  readonly onClose: () => void;
  readonly onUse: (skill: SkillDefinition) => void;
  readonly onEdit: (skill: SkillDefinition | 'new') => void;
  readonly onSchedule: (skill: SkillDefinition) => void;
}) {
  const { copy, actions } = useNimiDay();
  const { state } = useDayStore();
  const desk = useDesk();
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState(initialSkillId);
  const selected = skills.find(skill => skill.id === selectedId);
  const needle = query.trim().toLocaleLowerCase();
  const matches = skills.filter(skill => `${skill.name} ${skill.purpose}`.toLocaleLowerCase().includes(needle));
  const canRun = desk.phase === 'ready' && desk.canUseWork;

  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent onClose={onClose} className="max-w-xl" data-testid="nd-skill-library">
      <DialogHeader><DialogTitle>{selected?.name ?? copy.skills.addSkill}</DialogTitle></DialogHeader>
      <DialogBody>
        {selected ? <div className="nd-library-detail">
          <Button tone="ghost" size="sm" leadingIcon={<ArrowLeft size={16} />} onClick={() => setSelectedId(null)}>{copy.skills.allSkills}</Button>
          <p>{selected.purpose}</p>
          <div className="nd-row-meta"><span>{copy.skills.materials}</span>{selected.materials.map(material => <Chip key={material}>{copy.skills.materialNames[material]}</Chip>)}</div>
          <p className="nd-faint">{copy.skills.libraryUseHint}</p>
          {!canRun ? <p className="nd-field-note" role="status">{desk.phase !== 'ready' ? copy.skills.needAgent : copy.skills.needWorkBody}</p> : null}
          {!selected.enabled ? <Chip>{copy.skills.disabled}</Chip> : null}
          <div className="nd-inline-actions">
            <Button tone="primary" disabled={!canRun || !selected.enabled} onClick={() => onUse(selected)}>{copy.skills.useOnce}</Button>
            <Button tone="secondary" disabled={state.favoriteSkillIds.includes(selected.id)} onClick={() => { actions.setSkillFavorite(selected.id, true); onClose(); }}>
              {state.favoriteSkillIds.includes(selected.id) ? copy.skills.inFavorites : copy.skills.addFavorite}
            </Button>
          </div>
          <div className="nd-inline-actions">
            <Button tone="ghost" size="sm" disabled={!selected.enabled} onClick={() => onSchedule(selected)}>{copy.skills.schedule}</Button>
            <Button tone="ghost" size="sm" onClick={() => onEdit(selected)}>{copy.skills.adjust}</Button>
          </div>
        </div> : <>
          <TextField autoFocus aria-label={copy.skills.search} placeholder={copy.skills.search} value={query} onChange={event => setQuery(event.target.value)} />
          <div className="nd-library-list">
            {matches.map(skill => <button type="button" className="nd-library-option" key={skill.id} onClick={() => setSelectedId(skill.id)}>
              <span className="nd-skill-icon" data-icon={skill.icon}><SkillIcon icon={skill.icon} size={22} /></span>
              <span className="nd-library-option__copy"><strong>{skill.name}</strong><span>{skill.purpose}</span></span>
              {state.favoriteSkillIds.includes(skill.id) ? <Chip>{copy.skills.favoriteBadge}</Chip> : !skill.enabled ? <Chip>{copy.skills.disabled}</Chip> : null}
              <ChevronRight size={16} aria-hidden="true" />
            </button>)}
            {matches.length === 0 ? <p className="nd-empty" role="status">{copy.skills.noMatches}</p> : null}
          </div>
        </>}
      </DialogBody>
      <DialogFooter>
        {!selected ? <Button tone="ghost" leadingIcon={<Plus size={16} />} onClick={() => onEdit('new')}>{copy.skills.createCustom}</Button> : null}
        <Button tone="secondary" className="ms-auto" onClick={onClose}>{copy.common.close}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
