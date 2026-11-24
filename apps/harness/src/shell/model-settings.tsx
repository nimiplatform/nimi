import { useState } from 'react';
import { NimiAccountControl, useNimiAppSession } from '@nimiplatform/kit/auth/app';
import { Button } from '@nimiplatform/kit/ui';
import { AppModelConfigSurface } from '@nimiplatform/kit/features/model-config/ui';
import { openDesktopIntent } from '@nimiplatform/kit/shell/renderer/bridge';
import { ArrowLeft, ExternalLink, RefreshCw } from 'lucide-react';
import { useI18n } from '../i18n.js';
import { appId } from './auth/app-identity.js';

export function ModelSettings({ onBack }: { onBack?: () => void }) {
  const { t, locale } = useI18n();
  const { session, snapshot: access } = useNimiAppSession();
  const [error, setError] = useState('');
  const scope = access.runtime.status === 'connected' ? access.runtime.scope : undefined;

  async function openHome(section?: 'ai-models') {
    try {
      const result = await openDesktopIntent({ intent: { kind: 'open-apps', appId, ...(section ? { section } : {}) } });
      if (result.status !== 'accepted') throw new Error(result.reasonCode);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <section className="harness-settings">
      <header className="harness-settings__header">
        <div className="harness-settings__title">
          {onBack && (
            <Button size="sm" tone="ghost" leadingIcon={<ArrowLeft size={15} />} onClick={onBack}>
              {t('app.backToWorkspace')}
            </Button>
          )}
          <h1>{t('app.modelsAccess')}</h1>
        </div>
        <Button size="sm" tone="secondary" leadingIcon={<RefreshCw size={14} />} onClick={() => void session.recheck()}>
          {t('app.refreshAccess')}
        </Button>
      </header>

      <div className="harness-settings__body">
        <NimiAccountControl language={locale} />
        <div className="harness-access">
          <span className="harness-access__status" role="status">
            <span className={`harness-runtime-dot harness-runtime-dot--${access.runtime.status}`} />
            {access.runtime.status === 'connected' ? t('app.connectedToNimi') : t(`app.runtimeStatus.${access.runtime.status}` as const)}
          </span>
          <Button size="sm" tone="secondary" leadingIcon={<ExternalLink size={14} />} onClick={() => void openHome()}>
            {t('app.openHomeSettings')}
          </Button>
        </div>
        {error && <p className="harness-error" role="alert">{error}</p>}
        {scope && (
          <AppModelConfigSurface
            scope={scope}
            appId={appId}
            capabilityContracts={['text.generate', 'audio.transcribe']}
            language={locale}
            onOpenOwnerConfiguration={() => void openHome('ai-models')}
          />
        )}
      </div>
    </section>
  );
}
