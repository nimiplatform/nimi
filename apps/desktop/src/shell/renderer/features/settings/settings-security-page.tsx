import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { NimiText } from '@nimiplatform/kit/ui';
import { useDesktopRendererBindings } from '../../renderer/binding-context.js';
import { InlineFeedback } from '../../ui/feedback/inline-feedback';
import { Button, Card, PageShell, Section, StatusBadge } from './settings-layout-components.js';
import { MonitorIcon, ShieldIcon } from './settings-assets.js';

// @nimi-authority: rule.nimi.desktop.shell-runtime.r023
export function SecurityPage() {
  const { t } = useTranslation();
  const bindings = useDesktopRendererBindings();
  const [opening, setOpening] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openAccountManagement = async () => {
    if (opening) return;
    setOpening(true);
    setError(null);
    try {
      await bindings.app.commands.openAccountManagement();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason || t('SecuritySettings.accountManagementUnavailable')));
    } finally {
      setOpening(false);
    }
  };

  return (
    <PageShell title={t('SecuritySettings.pageTitle')} description={t('SecuritySettings.pageDescription')}>
      <Section title={t('SecuritySettings.accountSecurityTitle')}>
        <Card>
          <div className="flex items-center justify-between gap-6">
            <div className="flex items-center gap-4">
              <ShieldIcon className="h-5 w-5 text-[var(--nimi-text-muted)]" />
              <div>
                <NimiText role="label">{t('SecuritySettings.manageAccount')}</NimiText>
                <NimiText role="caption">{t('SecuritySettings.manageAccountDescription')}</NimiText>
              </div>
            </div>
            <Button variant="secondary" disabled={opening} onClick={() => void openAccountManagement()}>
              {opening ? t('SecuritySettings.openingAccount') : t('SecuritySettings.manageAccount')}
            </Button>
          </div>
          {error ? (
            <InlineFeedback
              feedback={{ kind: 'error', message: error }}
              onDismiss={() => setError(null)}
              className="mt-4"
            />
          ) : null}
        </Card>
      </Section>
      <Section title={t('SecuritySettings.activeSessionsTitle')} description={t('SecuritySettings.activeSessionsDescription')}>
        <Card>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <MonitorIcon className="h-5 w-5 text-[var(--nimi-text-muted)]" />
              <div className="flex flex-col">
                <NimiText role="label">{t('SecuritySettings.thisDevice')}</NimiText>
                <NimiText role="caption">{t('SecuritySettings.runtimeSession')}</NimiText>
              </div>
            </div>
            <StatusBadge status="success" text={t('SecuritySettings.currentSession')} />
          </div>
        </Card>
      </Section>
    </PageShell>
  );
}
