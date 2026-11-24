import { useState } from 'react';
import { NimiAccountControl, useNimiAppSession } from '@nimiplatform/kit/auth/app';
import { Button } from '@nimiplatform/kit/ui';
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
          <div className="harness-access">
            <span className="harness-access__status">
              {locale === 'zh'
                ? '本工作台通过 Runtime 伙伴（Brain-Body 共生）路由模型与记忆；如需调整默认云端或本地对话模型，请前往 Nimi Home 模型设置。'
                : 'This workspace routes models and memory through your Nimi Partner (Brain-Body symbiosis). Configure default local or cloud models in Nimi Home.'}
            </span>
            <Button size="sm" tone="primary" leadingIcon={<ExternalLink size={14} />} onClick={() => void openHome('ai-models')}>
              {locale === 'zh' ? '在 Nimi Home 中配置模型' : 'Configure models in Nimi Home'}
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}
