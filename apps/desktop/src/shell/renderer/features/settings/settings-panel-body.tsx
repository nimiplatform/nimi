import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { getShellFeatureFlags } from '@nimiplatform/shell-core/shell-mode';
import { SidebarNav } from './settings-layout-components';
import { renderSettingsPage } from './settings-pages';
import {
  loadStoredSettingsSelected,
  persistStoredSettingsSelected,
} from './settings-storage';

export function SettingsPanelBody() {
  const { t } = useTranslation();
  const flags = getShellFeatureFlags();
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

  return (
    <div className="flex min-h-0 flex-1">
      <aside className="flex w-60 shrink-0 flex-col overflow-y-auto border-r border-gray-200 bg-white">
        <div className="flex h-14 shrink-0 items-center px-6">
          <h1 className="text-lg font-semibold text-gray-900">{t('Navigation.settings')}</h1>
        </div>
        <SidebarNav selected={selectedId} onSelect={handleSelect} />
      </aside>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {renderSettingsPage(selectedId)}
      </div>
    </div>
  );
}
