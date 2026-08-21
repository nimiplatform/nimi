/**
 * Degraded-state Support entry (`rule.nimi.desktop.product-surfaces.r029`).
 *
 * `rule.nimi.desktop.product-surfaces.r029` requires the `Support` surface — at least the `repair` and
 * `recovery` sub-areas — to stay reachable when the ordinary shell cannot be
 * entered (fail-closed product state) or when Settings preference state is
 * itself corrupt. The ordinary `SupportPanel` only mounts inside the
 * `ready_for_use` shell, so this component is the degraded-state recovery
 * entry: a self-contained overlay, restricted to the degraded-reachable
 * sub-areas, that the first-run / repair gate can open without depending on
 * ordinary shell readiness.
 */

import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { OverlayShell } from '@nimiplatform/kit/ui';
import {
  SUPPORT_DEGRADED_REACHABLE_SECTIONS,
  SUPPORT_SECTION_LABEL_KEY,
  type SupportSectionId,
} from './support-sections.js';
import { SupportRepairSection } from './support-repair-section.js';
import { SupportRecoverySection } from './support-recovery-section.js';

function renderDegradedSection(
  section: 'repair' | 'recovery',
  navigate: (next: SupportSectionId) => void,
) {
  if (section === 'repair') {
    return <SupportRepairSection onNavigateToRecovery={() => navigate('recovery')} />;
  }
  return <SupportRecoverySection onNavigateToRepair={() => navigate('repair')} />;
}

/**
 * The trigger button + overlay shown in a degraded gate. Renders nothing
 * intrusive when closed — just a button. When opened it presents the
 * degraded-reachable Support sub-areas in a modal dialog whose chrome
 * (ESC, focus trap, aria) comes from the kit `OverlayShell`.
 */
export function SupportDegradedEntry() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [section, setSection] = useState<SupportSectionId>('repair');

  const navigate = useCallback((next: SupportSectionId) => {
    setSection(next);
  }, []);

  const sidebar = (
    <div className="flex flex-col gap-1">
      {SUPPORT_DEGRADED_REACHABLE_SECTIONS.map((sectionId) => {
        const active = section === sectionId;
        return (
          <button
            key={sectionId}
            type="button"
            data-testid={`support-degraded-nav:${sectionId}`}
            onClick={() => navigate(sectionId)}
            className={
              active
                ? 'rounded-lg bg-[var(--nimi-action-primary-bg)] px-3 py-1.5 text-left text-xs font-medium text-[var(--nimi-action-primary-text)]'
                : 'rounded-lg px-3 py-1.5 text-left text-xs font-medium text-[var(--nimi-text-secondary)] hover:text-[var(--nimi-text-primary)]'
            }
          >
            {t(SUPPORT_SECTION_LABEL_KEY[sectionId])}
          </button>
        );
      })}
    </div>
  );

  return (
    <>
      <button
        type="button"
        data-testid="support-degraded-entry-trigger"
        onClick={() => setOpen(true)}
        className="inline-flex items-center rounded-lg border border-[var(--nimi-border-subtle)] bg-[var(--nimi-surface-card)] px-3 py-2 text-xs font-medium text-[var(--nimi-text-primary)] transition hover:bg-[var(--nimi-surface-active)]"
      >
        {t('Support.degradedEntryButton')}
      </button>

      <OverlayShell
        open={open}
        kind="dialog"
        size="M"
        onClose={() => setOpen(false)}
        title={t('Support.surfaceTitle')}
        sidebar={sidebar}
        dataTestId="support-degraded-overlay"
        panelClassName="flex max-h-[88vh] flex-col overflow-hidden"
        contentClassName="flex min-h-0 flex-1 flex-col overflow-hidden px-0 py-0"
        footer={(
          <div className="flex justify-end">
            <button
              type="button"
              data-testid="support-degraded-overlay-close"
              onClick={() => setOpen(false)}
              className="rounded-lg px-2 py-1 text-xs text-[var(--nimi-text-secondary)] hover:text-[var(--nimi-text-primary)]"
            >
              {t('Support.degradedEntryClose')}
            </button>
          </div>
        )}
      >
        {renderDegradedSection(section === 'repair' ? 'repair' : 'recovery', navigate)}
      </OverlayShell>
    </>
  );
}
