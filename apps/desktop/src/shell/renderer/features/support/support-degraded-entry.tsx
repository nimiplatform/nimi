import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, OverlayShell } from '@nimiplatform/kit/ui';
import { SupportTroubleshooting, type RecoveryEntryContext } from './support-troubleshooting.js';

// @nimi-authority: rule.nimi.desktop.product-surfaces.r029
// Mounted independently of ordinary Settings by the actual recovery gate.
export function SupportDegradedEntry({ recovery }: { recovery?: RecoveryEntryContext }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  return <>
    <Button tone="secondary" data-testid="support-degraded-entry-trigger" onClick={() => setOpen(true)}>{t('Settings.menuTroubleshooting')}</Button>
    <OverlayShell open={open} kind="dialog" size="M" onClose={() => setOpen(false)} title={t('Settings.menuTroubleshooting')}
      dataTestId="support-degraded-overlay" panelClassName="flex max-h-[88vh] flex-col overflow-hidden" contentClassName="flex min-h-0 flex-1 flex-col p-0"
      footer={<Button tone="ghost" data-testid="support-degraded-overlay-close" onClick={() => setOpen(false)}>{t('Common.close')}</Button>}>
      <SupportTroubleshooting recovery={recovery ? { ...recovery, onAction: recovery.onAction ? () => { setOpen(false); recovery.onAction!(); } : undefined } : { title: t('Support.homeNotReady') }} />
    </OverlayShell>
  </>;
}
