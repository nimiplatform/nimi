import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { useTranslation } from 'react-i18next';
import {
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
  Advanced: 'Settings.sectionAdvanced',
  'About & Legal': 'Settings.sectionAboutLegal',
};

const SETTINGS_ITEM_KEY_BY_ID: Record<string, string> = {
  profile: 'Settings.menuProfile',
  language: 'Settings.menuLanguage',
  appearance: 'Settings.menuAppearance',
  privacy: 'Settings.menuPrivacy',
  security: 'Settings.menuSecurity',
  notifications: 'Settings.menuNotifications',
  downloads: 'Settings.menuDownloads',
  performance: 'Settings.menuPerformance',
  data: 'Settings.menuData',
  'about-legal': 'Settings.menuAboutLegal',
};

export function SettingsPanelBody() {
  const MIN_SETTINGS_SIDEBAR_WIDTH = 200;
  const MAX_SETTINGS_SIDEBAR_WIDTH = 320;
  const { t } = useTranslation();
  const settings = useDesktopRendererCommands().settings;
  const menuSections = getSettingsMenuSections();
  const containerRef = useRef<HTMLDivElement>(null);
  const resizePointerIdRef = useRef<number | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState(216);
  const [selectedId, setSelectedId] = useState(() => settings.loadSelected('profile'));

  const handleSelect = (id: string) => {
    settings.persistSelected(id);
    setSelectedId(id);
  };

  useEffect(() => settings.subscribeOpenSection((id) => {
    setSelectedId(id);
  }), [settings]);

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

  return (
    <div ref={containerRef} className="flex min-h-0 flex-1 gap-3 px-4 pb-4 pt-3" data-testid="panel:settings-body">
      <SidebarShell width={sidebarWidth} data-testid="panel:settings-sidebar">
        <SidebarHeader title={<h1 className="text-xl font-semibold leading-7 text-[color:var(--nimi-text-primary)]">{t('Navigation.settings')}</h1>} className="px-5" />
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
                      icon={<span className={active ? 'text-mint-600' : 'text-gray-400'}>{item.icon}</span>}
                      label={itemTitle}
                      trailing={active ? <SidebarAffordanceChevron /> : undefined}
                    />
                  );
                })}
              </SidebarSection>
            );
          })}
        </ScrollArea>
        <SidebarResizeHandle
          ariaLabel={t('Settings.resizeSidebarAriaLabel')}
          onPointerCancel={stopResize}
          onPointerDown={startResize}
          onPointerMove={continueResize}
          onPointerUp={stopResize}
        />
      </SidebarShell>

      <Surface
        tone="panel"
        material="glass-regular"
        padding="none"
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border-white/60 shadow-[0_10px_24px_rgba(15,23,42,0.05)]"
      >
        {renderSettingsPage(selectedId)}
      </Surface>
    </div>
  );
}
