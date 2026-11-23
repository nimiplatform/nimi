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

export type ReaderTheme = 'paper' | 'sepia' | 'clean';
export type ReaderLayout = 'magazine' | 'novel';
export type ReaderWidth = 'narrow' | 'standard' | 'wide';
export type ReaderPreferences = {
  theme: ReaderTheme;
  layout: ReaderLayout;
  fontSize: number;
  lineHeight: number;
  width: ReaderWidth;
};

export const READER_FONT_SIZE_MIN = 15;
export const READER_FONT_SIZE_MAX = 24;
export const READER_LINE_HEIGHTS = [1.65, 1.9, 2.15] as const;

export const DEFAULT_READER_PREFERENCES: ReaderPreferences = {
  theme: 'clean',
  layout: 'magazine',
  fontSize: 18,
  lineHeight: 1.9,
  width: 'standard',
};

const READER_PREFERENCES_STORAGE_KEY = 'nimi.desktop.world-reader.preferences.v1';
const VALID_THEMES = new Set<ReaderTheme>(['paper', 'sepia', 'clean']);
const VALID_LAYOUTS = new Set<ReaderLayout>(['magazine', 'novel']);
const VALID_WIDTHS = new Set<ReaderWidth>(['narrow', 'standard', 'wide']);
const VALID_LINE_HEIGHTS = new Set<number>(READER_LINE_HEIGHTS);

export function normalizeReaderPreferences(raw: unknown): ReaderPreferences {
  if (!raw || typeof raw !== 'object') return DEFAULT_READER_PREFERENCES;
  const record = raw as Record<string, unknown>;
  const theme = typeof record.theme === 'string' && VALID_THEMES.has(record.theme as ReaderTheme)
    ? record.theme as ReaderTheme
    : DEFAULT_READER_PREFERENCES.theme;
  const layout = typeof record.layout === 'string' && VALID_LAYOUTS.has(record.layout as ReaderLayout)
    ? record.layout as ReaderLayout
    : DEFAULT_READER_PREFERENCES.layout;
  const fontSize = typeof record.fontSize === 'number' && Number.isInteger(record.fontSize)
    && record.fontSize >= READER_FONT_SIZE_MIN && record.fontSize <= READER_FONT_SIZE_MAX
    ? record.fontSize
    : DEFAULT_READER_PREFERENCES.fontSize;
  const lineHeight = typeof record.lineHeight === 'number' && VALID_LINE_HEIGHTS.has(record.lineHeight)
    ? record.lineHeight
    : DEFAULT_READER_PREFERENCES.lineHeight;
  const width = typeof record.width === 'string' && VALID_WIDTHS.has(record.width as ReaderWidth)
    ? record.width as ReaderWidth
    : DEFAULT_READER_PREFERENCES.width;
  return { theme, layout, fontSize, lineHeight, width };
}

export function loadReaderPreferences(): ReaderPreferences {
  if (typeof window === 'undefined') return DEFAULT_READER_PREFERENCES;
  try {
    const stored = window.localStorage.getItem(READER_PREFERENCES_STORAGE_KEY);
    if (!stored) return DEFAULT_READER_PREFERENCES;
    return normalizeReaderPreferences(JSON.parse(stored));
  } catch {
    return DEFAULT_READER_PREFERENCES;
  }
}

export function saveReaderPreferences(preferences: ReaderPreferences): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(READER_PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
  } catch {
    // Ignore restricted storage environments; in-memory session preferences still apply.
  }
}

export function ReaderSettings({ value, onChange }: {
  value: ReaderPreferences;
  onChange: (next: ReaderPreferences | ((previous: ReaderPreferences) => ReaderPreferences)) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild>
      <Button tone="ghost" size="sm" leadingIcon={<Type size={16} />} data-testid="world-reader-settings">{t('WorldDetail.reader.settings')}</Button>
    </PopoverTrigger>
    <PopoverContent align="end" sideOffset={10} className="w-[348px] max-w-[calc(100vw-32px)]">
      <div className="mb-4 flex items-center justify-between gap-3">
        <NimiText as="h2" role="section-title">{t('WorldDetail.reader.settings')}</NimiText>
        <IconButton tone="ghost" size="sm" icon={<X size={16} />} aria-label={t('WorldDetail.reader.closeSettings')} onClick={() => setOpen(false)} />
      </div>
      <div className="space-y-3.5">
        <div className="flex items-center justify-between gap-4">
          <NimiText role="label">{t('WorldDetail.reader.theme')}</NimiText>
          <SegmentedControl size="sm" ariaLabel={t('WorldDetail.reader.theme')} value={value.theme}
            items={[
              { value: 'clean', label: t('WorldDetail.reader.themeClean'), icon: <span aria-hidden="true" className="world-reader-swatch world-reader-swatch--clean" /> },
              { value: 'paper', label: t('WorldDetail.reader.themePaper'), icon: <span aria-hidden="true" className="world-reader-swatch world-reader-swatch--paper" /> },
              { value: 'sepia', label: t('WorldDetail.reader.themeSepia'), icon: <span aria-hidden="true" className="world-reader-swatch world-reader-swatch--sepia" /> },
            ]}
            onValueChange={(theme) => onChange((previous) => ({ ...previous, theme: theme as ReaderTheme }))} />
        </div>
        <div className="flex items-center justify-between gap-4">
          <NimiText role="label">{t('WorldDetail.reader.layout')}</NimiText>
          <SegmentedControl size="sm" ariaLabel={t('WorldDetail.reader.layout')} value={value.layout}
            items={[
              { value: 'magazine', label: t('WorldDetail.reader.layoutMagazine') },
              { value: 'novel', label: t('WorldDetail.reader.layoutNovel') },
            ]}
            onValueChange={(layout) => onChange((previous) => ({ ...previous, layout: layout as ReaderLayout }))} />
        </div>
        <div className="flex items-center justify-between gap-4">
          <NimiText role="label">{t('WorldDetail.reader.fontSize')}</NimiText>
          <NumberStepper value={value.fontSize} min={READER_FONT_SIZE_MIN} max={READER_FONT_SIZE_MAX} step={1} ariaLabel={t('WorldDetail.reader.fontSize')}
            decreaseLabel={t('WorldDetail.reader.decreaseFont')} increaseLabel={t('WorldDetail.reader.increaseFont')}
            onValueChange={(fontSize) => onChange((previous) => ({ ...previous, fontSize }))} />
        </div>
        <div className="flex items-center justify-between gap-4">
          <NimiText role="label">{t('WorldDetail.reader.lineHeight')}</NimiText>
          <SegmentedControl size="sm" ariaLabel={t('WorldDetail.reader.lineHeight')} value={String(value.lineHeight)}
            items={[
              { value: '1.65', label: t('WorldDetail.reader.compact') },
              { value: '1.9', label: t('WorldDetail.reader.standard') },
              { value: '2.15', label: t('WorldDetail.reader.relaxed') },
            ]} onValueChange={(lineHeight) => onChange((previous) => ({ ...previous, lineHeight: Number(lineHeight) }))} />
        </div>
        <div className="flex items-center justify-between gap-4">
          <NimiText role="label">{t('WorldDetail.reader.width')}</NimiText>
          <SegmentedControl size="sm" ariaLabel={t('WorldDetail.reader.width')} value={value.width}
            items={[
              { value: 'narrow', label: t('WorldDetail.reader.narrowWidth') },
              { value: 'standard', label: t('WorldDetail.reader.standardWidth') },
              { value: 'wide', label: t('WorldDetail.reader.wide') },
            ]}
            onValueChange={(width) => onChange((previous) => ({ ...previous, width: width as ReaderWidth }))} />
        </div>
      </div>
      <div className="mt-4 flex justify-end border-t border-[var(--nimi-border-subtle)] pt-3">
        <Button tone="ghost" size="sm" onClick={() => onChange(DEFAULT_READER_PREFERENCES)}>{t('WorldDetail.reader.reset')}</Button>
      </div>
    </PopoverContent>
  </Popover>;
}
