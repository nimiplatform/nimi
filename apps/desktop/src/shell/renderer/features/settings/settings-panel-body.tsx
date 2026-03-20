import { useEffect, useRef, useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { getShellFeatureFlags } from '@nimiplatform/shell-core/shell-mode';
import { ScrollShell } from '@renderer/components/scroll-shell.js';
import { APP_PAGE_TITLE_CLASS } from '@renderer/components/typography.js';
import { SidebarNav } from './settings-layout-components.js';
import { renderSettingsPage } from './settings-pages.js';
import {
  loadStoredSettingsSelected,
  persistStoredSettingsSelected,
} from './settings-storage.js';

export function SettingsPanelBody() {
  const MIN_SETTINGS_SIDEBAR_WIDTH = 220;
  const MAX_SETTINGS_SIDEBAR_WIDTH = 360;
  const { t } = useTranslation();
  const flags = getShellFeatureFlags();
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
    <div ref={containerRef} className="flex min-h-0 flex-1">
      <ScrollShell
        as="aside"
        className="relative flex shrink-0 flex-col bg-[#F8F9FB]"
        viewportClassName="bg-[#F8F9FB]"
        style={{ width: `${sidebarWidth}px` }}
      >
        <div className="flex h-14 shrink-0 items-center px-6">
          <h1 className={APP_PAGE_TITLE_CLASS}>{t('Navigation.settings')}</h1>
        </div>
        <SidebarNav selected={selectedId} onSelect={handleSelect} />
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label={t('Settings.resizeSidebarAriaLabel')}
          onMouseDown={startResize}
          className="absolute inset-y-0 right-0 z-10 w-2 translate-x-1/2 cursor-col-resize bg-transparent"
        />
      </ScrollShell>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-[#F8F9FB]">
        {renderSettingsPage(selectedId)}
      </div>
    </div>
  );
}
