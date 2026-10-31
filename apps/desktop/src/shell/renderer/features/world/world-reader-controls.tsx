import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronRight, Type, X } from 'lucide-react';
import { Button, IconButton, NimiText, NumberStepper, Popover, PopoverContent, PopoverTrigger, SegmentedControl } from '@nimiplatform/kit/ui';

export type ReaderOutlineItem = { id: string; label: string; depth: number };
type OutlineBranch = ReaderOutlineItem & { children: OutlineBranch[] };

export function readerOutlineTree(items: ReaderOutlineItem[]): OutlineBranch[] {
  const roots: OutlineBranch[] = [];
  const ancestors: OutlineBranch[] = [];
  for (const item of items) {
    const branch: OutlineBranch = { ...item, children: [] };
    while (ancestors.length && ancestors.at(-1)!.depth >= item.depth) ancestors.pop();
    (ancestors.at(-1)?.children ?? roots).push(branch);
    ancestors.push(branch);
  }
  return roots;
}

// @nimi-authority: rule.nimi.desktop.shell-ui.r013
export function ReaderContents({ items, activeId, expanded, onExpand, onSelect }: {
  items: ReaderOutlineItem[];
  activeId: string;
  expanded: Record<string, boolean>;
  onExpand: (id: string, open: boolean) => void;
  onSelect: (id: string) => void;
}) {
  const { t } = useTranslation();
  const prefix = useId();
  const containsActive = (branch: OutlineBranch): boolean => branch.id === activeId || branch.children.some(containsActive);
  const render = (branches: OutlineBranch[], nested = false) => <ul className={nested ? 'world-reader-outline-children' : 'world-reader-outline'}>
    {branches.map((branch) => {
      const active = branch.id === activeId;
      const open = expanded[branch.id] ?? containsActive(branch);
      const childrenId = `${prefix}-${branch.id}`;
      return <li key={branch.id}>
        <div className="world-reader-outline-row" data-active={active || undefined} data-parent={branch.children.length > 0 || undefined}>
          <button type="button" onClick={() => onSelect(branch.id)} aria-current={active ? 'location' : undefined}
            className="world-reader-outline-link">{branch.label}</button>
          {branch.children.length ? <IconButton tone="ghost" size="sm" icon={open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
            aria-label={t(open ? 'WorldDetail.reader.collapseChapter' : 'WorldDetail.reader.expandChapter', { name: branch.label })}
            aria-expanded={open} aria-controls={childrenId} onClick={() => onExpand(branch.id, !open)} /> : null}
        </div>
        {branch.children.length ? <div id={childrenId} hidden={!open}>{render(branch.children, true)}</div> : null}
      </li>;
    })}
  </ul>;
  return <nav aria-label={t('WorldDetail.discovery.contents')}>{render(readerOutlineTree(items))}</nav>;
}

export type ReaderPreferences = { fontSize: number; lineHeight: number; width: 'standard' | 'wide' };
export const DEFAULT_READER_PREFERENCES: ReaderPreferences = { fontSize: 20, lineHeight: 1.85, width: 'standard' };

export function ReaderSettings({ value, onChange }: { value: ReaderPreferences; onChange: (value: ReaderPreferences) => void }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <Button tone="ghost" size="sm" leadingIcon={<Type size={18} />} data-testid="world-reader-settings">{t('WorldDetail.reader.settings')}</Button>
    </PopoverTrigger>
    <PopoverContent align="end" sideOffset={12} className="w-[320px] max-w-[calc(100vw-32px)]">
      <div className="mb-5 flex items-center justify-between gap-3">
        <NimiText as="h2" role="section-title">{t('WorldDetail.reader.settings')}</NimiText>
        <IconButton tone="ghost" size="sm" icon={<X size={16} />} aria-label={t('WorldDetail.reader.closeSettings')} onClick={() => setOpen(false)} />
      </div>
      <div className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <NimiText role="label">{t('WorldDetail.reader.fontSize')}</NimiText>
          <NumberStepper value={value.fontSize} min={16} max={24} step={1} ariaLabel={t('WorldDetail.reader.fontSize')}
            decreaseLabel={t('WorldDetail.reader.decreaseFont')} increaseLabel={t('WorldDetail.reader.increaseFont')}
            onValueChange={(fontSize) => onChange({ ...value, fontSize })} />
        </div>
        <div className="flex items-center justify-between gap-4">
          <NimiText role="label">{t('WorldDetail.reader.lineHeight')}</NimiText>
          <SegmentedControl size="sm" ariaLabel={t('WorldDetail.reader.lineHeight')} value={String(value.lineHeight)}
            items={[
              { value: '1.6', label: t('WorldDetail.reader.compact') },
              { value: '1.85', label: t('WorldDetail.reader.standard') },
              { value: '2.1', label: t('WorldDetail.reader.relaxed') },
            ]} onValueChange={(lineHeight) => onChange({ ...value, lineHeight: Number(lineHeight) })} />
        </div>
        <div className="flex items-center justify-between gap-4">
          <NimiText role="label">{t('WorldDetail.reader.width')}</NimiText>
          <SegmentedControl size="sm" ariaLabel={t('WorldDetail.reader.width')} value={value.width}
            items={[{ value: 'standard', label: t('WorldDetail.reader.standardWidth') }, { value: 'wide', label: t('WorldDetail.reader.wide') }]}
            onValueChange={(width) => onChange({ ...value, width: width as ReaderPreferences['width'] })} />
        </div>
      </div>
      <div className="mt-5 flex justify-end border-t border-[var(--nimi-border-subtle)] pt-3">
        <Button tone="ghost" size="sm" onClick={() => onChange(DEFAULT_READER_PREFERENCES)}>{t('WorldDetail.reader.reset')}</Button>
      </div>
    </PopoverContent>
  </Popover>;
}
