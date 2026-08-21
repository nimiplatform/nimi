/**
 * `Support` secondary system surface host (`rule.nimi.desktop.product-surfaces.r022` / `rule.nimi.desktop.product-surfaces.r023`).
 *
 * `Support` is a standalone secondary surface, peer to `Settings`. It is
 * mounted from the `config/desktop-shell-ui-app-tabs.yaml` `support` entry (`nav_group: secondary`)
 * and is NOT one of the five ordinary primary navigation tabs.
 *
 * The host renders a fixed four-item sub-area sidebar (`rule.nimi.desktop.product-surfaces.r023`: repair /
 * diagnostics / logs / recovery) and dispatches the active sub-area.
 * Each sub-area owns its own typed-projection load and fail-closed state.
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
  SUPPORT_SECTION_IDS,
  SUPPORT_SECTION_LABEL_KEY,
  type SupportSectionId,
} from './support-sections.js';
import { loadStoredSupportSection, persistStoredSupportSection } from './support-storage.js';
import { SupportRepairSection } from './support-repair-section.js';
import { SupportDiagnosticsSection } from './support-diagnostics-section.js';
import { SupportLogsSection } from './support-logs-section.js';
import { SupportRecoverySection } from './support-recovery-section.js';

function renderSupportSection(
  section: SupportSectionId,
  navigate: (next: SupportSectionId) => void,
) {
  switch (section) {
    case 'repair':
      return <SupportRepairSection onNavigateToRecovery={() => navigate('recovery')} />;
    case 'diagnostics':
      return <SupportDiagnosticsSection />;
    case 'logs':
      return <SupportLogsSection />;
    case 'recovery':
      return <SupportRecoverySection onNavigateToRepair={() => navigate('repair')} />;
  }
}

export function SupportPanel() {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<SupportSectionId>(() => loadStoredSupportSection());

  const navigate = useCallback((next: SupportSectionId) => {
    persistStoredSupportSection(next);
    setSelected(next);
  }, []);

  return (
    <div
      data-testid="panel:support"
      className="flex min-h-0 flex-1 gap-3 px-4 pb-4 pt-3"
    >
      <SidebarShell width={216} data-testid="panel:support-sidebar">
        <SidebarHeader
          title={(
            <h1 className="text-xl font-semibold leading-7 text-[color:var(--nimi-text-primary)]">
              {t('Support.surfaceTitle')}
            </h1>
          )}
          className="px-5"
        />
        <ScrollArea className="flex-1" contentClassName="space-y-4 px-3 pb-3 pt-1">
          <SidebarSection label={t('Support.sidebarSectionLabel')}>
            {SUPPORT_SECTION_IDS.map((sectionId) => {
              const active = selected === sectionId;
              return (
                <SidebarItem
                  key={sectionId}
                  kind="nav-row"
                  active={active}
                  data-testid={`support-nav:${sectionId}`}
                  onClick={() => navigate(sectionId)}
                  label={t(SUPPORT_SECTION_LABEL_KEY[sectionId])}
                  trailing={active ? <SidebarAffordanceChevron /> : undefined}
                />
              );
            })}
          </SidebarSection>
        </ScrollArea>
      </SidebarShell>

      <Surface
        tone="panel"
        material="solid"
        padding="none"
        className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-xl border-[color:var(--nimi-border-subtle)] shadow-[0_10px_24px_rgba(15,23,42,0.05)]"
      >
        {renderSupportSection(selected, navigate)}
      </Surface>
    </div>
  );
}
