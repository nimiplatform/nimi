/**
 * `Developer Tools` developer-group surface host (`D-DEV-001` / `D-DEV-003`).
 *
 * `Developer Tools` is a developer / internal surface, NOT an ordinary primary
 * navigation tab. It is registered as the `app-tabs.yaml` `developer-tools`
 * entry (`nav_group: developer`, `gated_by: enableDeveloperTools`) and is
 * mounted only when admitted Developer Mode is on — the renderer enforces that
 * gate before this panel is ever reached (`main-layout-view.tsx`).
 *
 * The host renders a fixed three-item sub-area sidebar (`D-DEV-003`: mod
 * sources, standalone Tester reference, developer diagnostics) and dispatches
 * the active sub-area. It hosts no ordinary-user product functionality.
 */

import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ScrollArea,
  SidebarAffordanceChevron,
  SidebarHeader,
  SidebarItem,
  SidebarSection,
  SidebarShell,
  Surface,
} from '@nimiplatform/kit/ui';
import {
  DEVELOPER_TOOLS_SECTION_IDS,
  DEVELOPER_TOOLS_SECTION_LABEL_KEY,
  type DeveloperToolsSectionId,
} from './developer-tools-sections.js';
import {
  loadStoredDeveloperToolsSection,
  persistStoredDeveloperToolsSection,
} from './developer-tools-storage.js';
import { DeveloperModSourcesSection } from './developer-mod-sources-section.js';
import { DeveloperTesterSection } from './developer-tester-section.js';
import { SupportDiagnosticsSection } from '@renderer/features/support/support-diagnostics-section.js';

function renderDeveloperToolsSection(section: DeveloperToolsSectionId) {
  switch (section) {
    case 'mod-sources':
      return <DeveloperModSourcesSection />;
    case 'tester':
      return <DeveloperTesterSection />;
    case 'diagnostics':
      // D-DEV-003 technical diagnostics — reuses the typed diagnostics
      // projection surface rather than recreating a parallel diagnostics view.
      return <SupportDiagnosticsSection />;
  }
}

export function DeveloperToolsPanel() {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<DeveloperToolsSectionId>(
    () => loadStoredDeveloperToolsSection(),
  );

  const navigate = useCallback((next: DeveloperToolsSectionId) => {
    persistStoredDeveloperToolsSection(next);
    setSelected(next);
  }, []);

  return (
    <div
      data-testid="panel:developer-tools"
      className="flex min-h-0 flex-1 gap-4 px-5 pb-5 pt-4"
    >
      <SidebarShell width={240} data-testid="panel:developer-tools-sidebar">
        <SidebarHeader
          title={(
            <h1 className="nimi-type-page-title text-[color:var(--nimi-text-primary)]">
              {t('DeveloperTools.surfaceTitle')}
            </h1>
          )}
          className="px-6"
        />
        <ScrollArea className="flex-1" contentClassName="space-y-5 px-3 pb-3 pt-2">
          <SidebarSection label={t('DeveloperTools.sidebarSectionLabel')}>
            {DEVELOPER_TOOLS_SECTION_IDS.map((sectionId) => {
              const active = selected === sectionId;
              return (
                <SidebarItem
                  key={sectionId}
                  kind="nav-row"
                  active={active}
                  data-testid={`developer-tools-nav:${sectionId}`}
                  onClick={() => navigate(sectionId)}
                  label={t(DEVELOPER_TOOLS_SECTION_LABEL_KEY[sectionId])}
                  trailing={active ? <SidebarAffordanceChevron /> : undefined}
                />
              );
            })}
          </SidebarSection>
        </ScrollArea>
      </SidebarShell>

      <Surface
        tone="panel"
        material="glass-regular"
        padding="none"
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-3xl"
      >
        {renderDeveloperToolsSection(selected)}
      </Surface>
    </div>
  );
}
