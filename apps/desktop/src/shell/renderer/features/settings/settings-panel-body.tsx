import { useEffect, useRef, useState, type MouseEvent } from 'react';
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
import {
  addSettingsOpenSectionListener,
  loadStoredSettingsSelected,
  persistStoredSettingsSelected,
} from './settings-storage.js';

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
  const menuSections = getSettingsMenuSections();
  const containerRef = useRef<HTMLDivElement>(null);
  const resizingRef = useRef(false);
  const [sidebarWidth, setSidebarWidth] = useState(216);
  const [selectedId, setSelectedId] = useState(() => loadStoredSettingsSelected('profile'));

  const handleSelect = (id: string) => {
    persistStoredSettingsSelected(id);
    setSelectedId(id);
  };

  const dragCleanupRef = useRef<(() => void) | null>(null);

  // Unmount safety: if the component tears down mid-drag, remove stale listeners.
  useEffect(() => {
    return () => {
      dragCleanupRef.current?.();
    };
  }, []);

  useEffect(() => addSettingsOpenSectionListener((id) => {
    setSelectedId(id);
  }), []);

  const startResize = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    resizingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const cleanup = () => {
      resizingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      dragCleanupRef.current = null;
    };

    const onMouseMove = (moveEvent: globalThis.MouseEvent) => {
      if (!resizingRef.current || !containerRef.current) {
        return;
      }
      const rect = containerRef.current.getBoundingClientRect();
      const nextWidth = Math.min(
        MAX_SETTINGS_SIDEBAR_WIDTH,
        Math.max(MIN_SETTINGS_SIDEBAR_WIDTH, Math.round(moveEvent.clientX - rect.left)),
      );
      setSidebarWidth(nextWidth);
    };

    const onMouseUp = () => {
      cleanup();
    };

    dragCleanupRef.current = cleanup;
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
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
          onMouseDown={startResize}
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
