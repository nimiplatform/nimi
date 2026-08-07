/**
 * `Developer Tools` developer-group surface host (`D-DEV-001` / `D-DEV-003`).
 *
 * `Developer Tools` is a developer / internal surface, NOT an ordinary primary
 * navigation tab. It is registered as the `config/desktop-shell-ui-app-tabs.yaml` `developer-tools`
 * entry (`nav_group: developer`, `gated_by: enableDeveloperTools`) and is
 * mounted only when admitted Developer Mode is on — the renderer enforces that
 * gate before this panel is ever reached (`main-layout-view.tsx`).
 *
 * The host presents local-development registrations and activity
 * (`LocalDevelopmentRegistrations`) and routes technical diagnostics to the
 * Support surface instead of duplicating it. It hosts no ordinary-user
 * product functionality.
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
import { LocalDevelopmentRegistrations } from '../local-development/local-development-registrations.js';
import { useAppStore } from '../../app-shell/providers/app-store.js';

function DeveloperToolsDiagnosticsRoute({ onOpenSupport }: { onOpenSupport: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 px-6 py-6">
      <Surface tone="card" padding="none" className="max-w-xl p-5">
        <h2 className="text-[length:var(--nimi-type-section-title-size)] font-semibold text-[var(--nimi-text-primary)]">
          {t('DeveloperTools.diagnosticsLinkTitle')}
        </h2>
        <p className="mt-2 text-[length:var(--nimi-type-body-size)] text-[var(--nimi-text-secondary)]">
          {t('DeveloperTools.diagnosticsLinkBody')}
        </p>
        <button
          type="button"
          onClick={onOpenSupport}
          data-testid="developer-tools-open-support-diagnostics"
          className="mt-4 text-[length:var(--nimi-type-body-sm-size)] font-medium text-[var(--nimi-action-primary-bg)] hover:underline"
        >
          {t('DeveloperTools.diagnosticsLinkAction')}
        </button>
      </Surface>
    </div>
  );
}

function renderDeveloperToolsSection(section: DeveloperToolsSectionId, onOpenSupport: () => void) {
  switch (section) {
    case 'local-development':
      // D-DEV-003 local-development registration activity and management.
      return <LocalDevelopmentRegistrations />;
    case 'diagnostics':
      // D-DEV-003 technical diagnostics stay single-homed in Support; the
      // developer surface routes there instead of re-rendering a copy.
      return <DeveloperToolsDiagnosticsRoute onOpenSupport={onOpenSupport} />;
  }
}

export function DeveloperToolsPanel() {
  const { t } = useTranslation();
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  const [selected, setSelected] = useState<DeveloperToolsSectionId>(
    () => loadStoredDeveloperToolsSection(),
  );

  const navigate = useCallback((next: DeveloperToolsSectionId) => {
    persistStoredDeveloperToolsSection(next);
    setSelected(next);
  }, []);

  const openSupportDiagnostics = useCallback(() => {
    setActiveTab('support');
  }, [setActiveTab]);

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
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-2xl"
      >
        {renderDeveloperToolsSection(selected, openSupportDiagnostics)}
      </Surface>
    </div>
  );
}
