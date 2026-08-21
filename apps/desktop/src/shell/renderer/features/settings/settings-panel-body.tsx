import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Button as KitButton,
  ScrollArea,
  SidebarAffordanceChevron,
  SidebarHeader,
  SidebarItem,
  SidebarResizeHandle,
  SidebarSection,
  SidebarShell,
  Surface,
} from '@nimiplatform/kit/ui';
import { getSettingsMenuSections } from './settings-assets.js';
import { renderSettingsPage } from './settings-pages.js';
import { useDesktopRendererCommands } from '../../renderer/binding-context.js';

const SETTINGS_SECTION_KEY_BY_LABEL: Record<string, string> = {
  Account: 'Settings.sectionAccount',
  'Privacy & Security': 'Settings.sectionPrivacySecurity',
  Preferences: 'Settings.sectionPreferences',
  Data: 'Settings.sectionData',
  'About & Legal': 'Settings.sectionAboutLegal',
};

const SETTINGS_ITEM_KEY_BY_ID: Record<string, string> = {
  profile: 'Settings.menuProfile',
  appearance: 'Settings.menuAppearance',
  privacy: 'Settings.menuPrivacy',
  security: 'Settings.menuSecurity',
  notifications: 'Settings.menuNotifications',
  developer: 'Settings.menuDeveloper',
  data: 'Settings.menuData',
  'about-legal': 'Settings.menuAboutLegal',
};

const MIN_SETTINGS_SIDEBAR_WIDTH = 200;
const MAX_SETTINGS_SIDEBAR_WIDTH = 320;
const SETTINGS_SIDEBAR_KEYBOARD_STEP = 8;
const COMPACT_SETTINGS_LAYOUT_MAX_WIDTH = 620;

export function SettingsPanelBody() {
  const { t } = useTranslation();
  const settings = useDesktopRendererCommands().settings;
  const menuSections = getSettingsMenuSections();
  const containerRef = useRef<HTMLDivElement>(null);
  const resizePointerIdRef = useRef<number | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(216);
  const [selectedId, setSelectedId] = useState(() => settings.loadSelected('profile'));
  const [isCompactLayout, setIsCompactLayout] = useState(false);
  const [compactView, setCompactView] = useState<'list' | 'detail'>('list');

  const handleSelect = (id: string) => {
    settings.persistSelected(id);
    setSelectedId(id);
    if (isCompactLayout) {
      setCompactView('detail');
    }
  };

  useEffect(() => settings.subscribeOpenSection((id) => {
    setSelectedId(id);
    setCompactView('detail');
  }), [settings]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver !== 'function') return undefined;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setIsCompactLayout(entry.contentRect.width < COMPACT_SETTINGS_LAYOUT_MAX_WIDTH);
      }
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const startResize = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    resizePointerIdRef.current = event.pointerId;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const continueResize = (event: PointerEvent<HTMLDivElement>) => {
    if (resizePointerIdRef.current !== event.pointerId || !containerRef.current) return;
    const rect = containerRef.current.getBoundingClientRect();
    setSidebarWidth(Math.min(
      MAX_SETTINGS_SIDEBAR_WIDTH,
      Math.max(MIN_SETTINGS_SIDEBAR_WIDTH, Math.round(event.clientX - rect.left)),
    ));
  };

  const stopResize = (event: PointerEvent<HTMLDivElement>) => {
    if (resizePointerIdRef.current !== event.pointerId) return;
    resizePointerIdRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  };

  const stepResize = (delta: number) => {
    setSidebarWidth((width) => Math.min(
      MAX_SETTINGS_SIDEBAR_WIDTH,
      Math.max(MIN_SETTINGS_SIDEBAR_WIDTH, width + delta),
    ));
  };

  const navigation = (
    <ScrollArea className="flex-1" contentClassName="space-y-4 px-3 pb-3 pt-1">
      {menuSections.map((section) => {
        const sectionKey = SETTINGS_SECTION_KEY_BY_LABEL[section.label];
        return (
          <SidebarSection
            key={section.label}
            label={sectionKey ? t(sectionKey) : section.label}
          >
            {section.items.map((item) => {
              const itemKey = SETTINGS_ITEM_KEY_BY_ID[item.id];
              const itemTitle = itemKey ? t(itemKey) : item.title;
              const active = selectedId === item.id;
              return (
                <SidebarItem
                  key={item.id}
                  kind="nav-row"
                  active={active}
                  data-testid={`settings-nav:${item.id}`}
                  onClick={() => handleSelect(item.id)}
                  icon={<span className={active ? 'text-[var(--nimi-action-primary-bg)]' : 'text-[var(--nimi-text-muted)]'}>{item.icon}</span>}
                  label={itemTitle}
                  trailing={active ? <SidebarAffordanceChevron /> : undefined}
                />
              );
            })}
          </SidebarSection>
        );
      })}
    </ScrollArea>
  );

  const pageTitle = (() => {
    const itemKey = SETTINGS_ITEM_KEY_BY_ID[selectedId];
    return itemKey ? t(itemKey) : selectedId;
  })();

  if (isCompactLayout) {
    return (
      <div ref={containerRef} className="flex min-h-0 flex-1 px-4 pb-4 pt-3" data-testid="panel:settings-body">
        <Surface
          tone="panel"
          material="solid"
          padding="none"
          className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border-[color:var(--nimi-border-subtle)] shadow-[0_10px_24px_rgba(15,23,42,0.05)]"
        >
          {compactView === 'list' ? (
            <div className="flex min-h-0 flex-1 flex-col" data-testid="panel:settings-compact-list">
              <SidebarHeader
                title={<h1 className="text-xl font-semibold leading-7 text-[color:var(--nimi-text-primary)]">{t('Navigation.settings')}</h1>}
                className="px-5"
              />
              {navigation}
            </div>
          ) : (
            <div className="flex min-h-0 flex-1 flex-col" data-testid="panel:settings-compact-detail">
              <div className="flex shrink-0 items-center gap-2 border-b border-[color:var(--nimi-border-subtle)] px-3 py-2">
                <KitButton
                  tone="ghost"
                  size="sm"
                  onClick={() => setCompactView('list')}
                  aria-label={t('Settings.back')}
                  data-testid="settings-compact-back"
                >
                  {t('Settings.back')}
                </KitButton>
                <span className="min-w-0 truncate text-[length:var(--nimi-type-body-size)] font-medium text-[var(--nimi-text-secondary)]">
                  {pageTitle}
                </span>
              </div>
              {renderSettingsPage(selectedId)}
            </div>
          )}
        </Surface>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex min-h-0 flex-1 gap-3 px-4 pb-4 pt-3" data-testid="panel:settings-body">
      <SidebarShell width={sidebarWidth} data-testid="panel:settings-sidebar">
        <SidebarHeader title={<h1 className="text-xl font-semibold leading-7 text-[color:var(--nimi-text-primary)]">{t('Navigation.settings')}</h1>} className="px-5" />
        {navigation}
        <SidebarResizeHandle
          ariaLabel={t('Settings.resizeSidebarAriaLabel')}
          aria-valuenow={sidebarWidth}
          aria-valuemin={MIN_SETTINGS_SIDEBAR_WIDTH}
          aria-valuemax={MAX_SETTINGS_SIDEBAR_WIDTH}
          onKeyDown={(event) => {
            if (event.key === 'ArrowLeft') {
              event.preventDefault();
              stepResize(-SETTINGS_SIDEBAR_KEYBOARD_STEP);
            } else if (event.key === 'ArrowRight') {
              event.preventDefault();
              stepResize(SETTINGS_SIDEBAR_KEYBOARD_STEP);
            }
          }}
          onPointerCancel={stopResize}
          onPointerDown={startResize}
          onPointerMove={continueResize}
          onPointerUp={stopResize}
        />
      </SidebarShell>

      <Surface
        tone="panel"
        material="solid"
        padding="none"
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border-[color:var(--nimi-border-subtle)] shadow-[0_10px_24px_rgba(15,23,42,0.05)]"
      >
        {renderSettingsPage(selectedId)}
      </Surface>
    </div>
  );
}
