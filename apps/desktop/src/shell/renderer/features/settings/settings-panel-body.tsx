import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollArea, SidebarAffordanceChevron, SidebarHeader, SidebarItem, SidebarResizeHandle, SidebarSection, SidebarShell } from '@nimiplatform/nimi-kit/ui';
import { getShellFeatureFlags } from '@nimiplatform/nimi-kit/core/shell-mode';
import { getSettingsMenuSections } from './settings-assets.js';
import { renderSettingsPage } from './settings-pages.js';
import {
  loadStoredSettingsSelected,
  persistStoredSettingsSelected,
} from './settings-storage.js';

const SETTINGS_SECTION_KEY_BY_LABEL: Record<string, string> = {
  Account: 'Settings.sectionAccount',
  'Privacy & Security': 'Settings.sectionPrivacySecurity',
  Preferences: 'Settings.sectionPreferences',
  Extensions: 'Settings.sectionExtensions',
  Advanced: 'Settings.sectionAdvanced',
};

const SETTINGS_ITEM_KEY_BY_ID: Record<string, string> = {
  profile: 'Settings.menuProfile',
  language: 'Settings.menuLanguage',
  privacy: 'Settings.menuPrivacy',
  security: 'Settings.menuSecurity',
  notifications: 'Settings.menuNotifications',
  extensions: 'Settings.menuModSettings',
  wallet: 'Settings.menuWallet',
};

export function SettingsPanelBody() {
  const MIN_SETTINGS_SIDEBAR_WIDTH = 220;
  const MAX_SETTINGS_SIDEBAR_WIDTH = 360;
  const { t } = useTranslation();
  const flags = getShellFeatureFlags();
  const menuSections = getSettingsMenuSections();
  const containerRef = useRef<HTMLDivElement>(null);
  const resizingRef = useRef(false);
  const [sidebarWidth, setSidebarWidth] = useState(240);
  const [selectedId, setSelectedId] = useState(() => {
    const stored = loadStoredSettingsSelected('profile');
    if (!flags.enableSettingsExtensions && stored === 'extensions') {
      persistStoredSettingsSelected('profile');
      return 'profile';
    }
    return stored;
  });

  const handleSelect = (id: string) => {
    persistStoredSettingsSelected(id);
    setSelectedId(id);
  };

  useEffect(() => {
    const onMouseMove = (event: globalThis.MouseEvent) => {
      if (!resizingRef.current || !containerRef.current) {
        return;
      }
      const rect = containerRef.current.getBoundingClientRect();
      const nextWidth = Math.min(
        MAX_SETTINGS_SIDEBAR_WIDTH,
        Math.max(MIN_SETTINGS_SIDEBAR_WIDTH, Math.round(event.clientX - rect.left)),
      );
      setSidebarWidth(nextWidth);
    };

    const onMouseUp = () => {
      resizingRef.current = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  const startResize = (event: MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    resizingRef.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  };

  return (
    <div ref={containerRef} className="flex min-h-0 flex-1" data-testid="panel:settings">
      <SidebarShell width={sidebarWidth} data-testid="panel:settings-sidebar">
        <SidebarHeader title={<h1 className={`nimi-type-page-title text-[color:var(--nimi-text-primary)]`}>{t('Navigation.settings')}</h1>} className="px-6" />
        <ScrollArea className="flex-1" contentClassName="space-y-5 px-3 pb-3 pt-2">
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

      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-[var(--nimi-surface-canvas)]">
        {renderSettingsPage(selectedId)}
      </div>
    </div>
  );
}
