import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, ScrollArea, SidebarHeader, SidebarItem, SidebarResizeHandle, SidebarSearch, SidebarSection, SidebarShell, Surface } from '@nimiplatform/kit/ui';
import { getSettingsMenuSections } from './settings-assets.js';
import { renderSettingsPage } from './settings-pages.js';
import { SETTINGS_LABELS } from './settings-sections.js';
import { openHomeSettings, subscribeSettingsEntry } from './settings-entry.js';
import { useHomeDestination, useHomeNavigation } from '../../app-shell/providers/app-store.js';

const GROUP_KEYS: Record<string, string> = {
  Preferences: 'Settings.sectionPreferences', Account: 'Settings.sectionAccount',
  Device: 'Settings.sectionDevice', Support: 'Settings.sectionSupport',
};
const MIN_WIDTH = 200;
const MAX_WIDTH = 320;

// @nimi-authority: rule.nimi.desktop.shell-ui.settings-navigation
export function SettingsPanelBody() {
  const { t } = useTranslation();
  const navigation = useHomeNavigation();
  const selectedId = useHomeDestination().settingsSection ?? 'appearance';
  const container = useRef<HTMLDivElement>(null);
  const sidebar = useRef<HTMLDivElement>(null);
  const detail = useRef<HTMLDivElement>(null);
  const resizePointer = useRef<number | null>(null);
  const requestedFocus = useRef<'list' | 'detail' | null>('detail');
  const [width, setWidth] = useState(232);
  const [compact, setCompact] = useState(false);
  const [view, setView] = useState<'list' | 'detail'>('detail');
  const [query, setQuery] = useState('');
  const [entry, setEntry] = useState(0);
  const reveal = () => { setQuery(''); requestedFocus.current = 'detail'; setView('detail'); setEntry(value => value + 1); };
  useEffect(() => subscribeSettingsEntry(navigation, reveal), [navigation]);
  useEffect(() => { reveal(); }, [selectedId]);
  useEffect(() => {
    if (!container.current || typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(entries => {
      for (const event of entries) {
        const next = event.contentRect.width < 620;
        setCompact(previous => {
          if (next !== previous) requestedFocus.current = next && sidebar.current?.contains(document.activeElement) ? 'list' : 'detail';
          return next;
        });
      }
    });
    observer.observe(container.current);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const request = requestedFocus.current;
    if (!request) return;
    if (compact && view !== request) { setView(request); return; }
    const frame = requestAnimationFrame(() => {
      const target = request === 'list'
        ? sidebar.current?.querySelector<HTMLElement>(`[data-testid="settings-nav:${selectedId}"]`) ?? sidebar.current?.querySelector<HTMLElement>('input')
        : detail.current?.querySelector<HTMLElement>('h2, h1');
      if (target) { if (!target.matches('button, input, select, textarea')) target.tabIndex = -1; target.focus({ preventScroll: true }); }
      requestedFocus.current = null;
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedId, compact, view, entry]);

  const groups = getSettingsMenuSections().map(group => ({ ...group, items: group.items.filter(item => {
    const terms = `${t(SETTINGS_LABELS[item.id]!)} ${t(`Settings.searchTerms.${item.id}`)}`.toLocaleLowerCase();
    return !query.trim() || query.trim().toLocaleLowerCase().split(/\s+/).every(word => terms.includes(word));
  }) })).filter(group => group.items.length);
  const select = (id: string) => { void openHomeSettings(navigation, id); };
  const beginResize = (event: PointerEvent<HTMLDivElement>) => { event.preventDefault(); resizePointer.current = event.pointerId; event.currentTarget.setPointerCapture(event.pointerId); };
  const resize = (event: PointerEvent<HTMLDivElement>) => {
    if (resizePointer.current !== event.pointerId || !container.current) return;
    setWidth(Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(event.clientX - container.current.getBoundingClientRect().left))));
  };
  const endResize = (event: PointerEvent<HTMLDivElement>) => {
    if (resizePointer.current !== event.pointerId) return;
    resizePointer.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  return <div ref={container} className="flex min-h-0 min-w-0 flex-1 gap-3 px-4 pb-4 pt-3" data-testid="panel:settings-body">
    <div ref={sidebar} className={compact && view === 'detail' ? 'hidden' : 'contents'}><SidebarShell width={compact ? '100%' : width} className={`desktop-sidebar min-h-0 ${compact ? 'flex-1' : ''}`} data-testid="panel:settings-sidebar">
      <SidebarHeader className="desktop-sidebar__header" title={<h1 className="desktop-sidebar__title font-semibold">{t('Navigation.settings')}</h1>} />
      <div className="px-3 pb-3" data-testid="settings-search"><SidebarSearch value={query} onValueChange={setQuery}
        ariaLabel={t('Settings.search')} placeholder={t('Settings.search')} onClear={() => setQuery('')} clearLabel={t('Common.clear')} /></div>
      <ScrollArea className="min-h-0 flex-1" contentClassName="desktop-sidebar__body desktop-sidebar__groups">
        {groups.map(group => <SidebarSection key={group.label} label={t(GROUP_KEYS[group.label]!)}>
          {group.items.map(item => <SidebarItem key={item.id} kind="nav-row" active={selectedId === item.id} aria-current={selectedId === item.id ? 'page' : undefined}
            data-testid={`settings-nav:${item.id}`} title={t(SETTINGS_LABELS[item.id]!)} icon={item.icon} label={t(SETTINGS_LABELS[item.id]!)}
            description={query.trim() ? t(`Settings.searchSummary.${item.id}`) : undefined} onClick={() => select(item.id)} />)}
        </SidebarSection>)}
        {!groups.length ? <p role="status" className="px-2 text-sm text-[var(--nimi-text-secondary)]">{t('Settings.searchEmpty')}</p> : null}
      </ScrollArea>
      {!compact ? <SidebarResizeHandle ariaLabel={t('Settings.resizeSidebarAriaLabel')} aria-valuenow={width} aria-valuemin={MIN_WIDTH} aria-valuemax={MAX_WIDTH}
        onPointerDown={beginResize} onPointerMove={resize} onPointerUp={endResize} onPointerCancel={endResize}
        onKeyDown={event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); setWidth(value => Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, value + (event.key === 'ArrowRight' ? 8 : -8)))); } }} /> : null}
    </SidebarShell></div>
    <Surface tone="panel" material="solid" padding="none" className={`desktop-module-panel min-h-0 min-w-0 flex-1 flex-col overflow-hidden ${compact && view === 'list' ? 'hidden' : 'flex'}`}>
      {compact ? <div className="flex shrink-0 items-center gap-2 border-b border-[var(--nimi-border-subtle)] px-3 py-2">
        <Button tone="ghost" size="sm" data-testid="settings-compact-back" onClick={() => { requestedFocus.current = 'list'; setView('list'); }}>
          {t('Settings.back')}
        </Button><span className="truncate text-sm text-[var(--nimi-text-secondary)]">{t(SETTINGS_LABELS[selectedId]!)}</span>
      </div> : null}
      <div ref={detail} className="flex min-h-0 flex-1 flex-col" data-testid="settings-detail">{renderSettingsPage(selectedId)}</div>
    </Surface>
  </div>;
}
