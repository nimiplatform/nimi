import { useCallback, useEffect, useState } from 'react';
import { Button } from '@nimiplatform/kit/ui';
import { openDesktopIntent } from '@nimiplatform/kit/shell/renderer/bridge';
import { ExternalLink, Plug, RefreshCw } from 'lucide-react';
import { useI18n } from '../i18n.js';
import { errorText, type GrantedIntegration } from './harness-types.js';

export function IntegrationsPanel() {
  const { t } = useI18n();
  const [items, setItems] = useState<GrantedIntegration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const list = await window.nimiHarness.listIntegrations();
      setItems(list);
    } catch (cause) {
      setError(errorText(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function openInHome() {
    try {
      const result = await openDesktopIntent({ intent: { kind: 'open-integrations' } });
      if (result.status !== 'accepted') throw new Error(result.reasonCode);
    } catch (cause) {
      setError(errorText(cause));
    }
  }

  return (
    <div className="harness-inspector-section">
      <div className="harness-inspector-toolbar">
        <div>
          <h3 className="harness-inspector-heading">{t('integrations.title')}</h3>
          <p className="harness-muted harness-muted--sm">{t('integrations.subtitle')}</p>
        </div>
        <Button size="sm" tone="ghost" leadingIcon={<RefreshCw size={13} className={loading ? 'harness-spin' : ''} />} onClick={() => void load()} aria-label={t('inspector.refresh')} />
      </div>

      <Button size="sm" tone="secondary" fullWidth leadingIcon={<ExternalLink size={14} />} onClick={() => void openInHome()}>
        {t('integrations.manageInHome')}
      </Button>

      {error && <p className="harness-error" role="alert">{error}</p>}

      {!loading && items.length === 0 && !error && (
        <div className="harness-empty-card">
          <Plug size={20} aria-hidden="true" />
          <strong>{t('integrations.empty')}</strong>
          <p className="harness-muted harness-muted--sm">{t('integrations.emptyHint')}</p>
        </div>
      )}

      <div className="harness-integration-list">
        {items.map(target => (
          <section key={target.targetRef} className="harness-integration-card">
            <header className="harness-integration-card__header">
              <strong>{target.displayName}</strong>
              <span className={`harness-pill harness-pill--${target.available ? 'success' : 'neutral'}`}>
                {target.available ? t('integrations.online') : t('integrations.offline')}
              </span>
            </header>
            <ul className="harness-integration-ops">
              {target.operations.map(op => (
                <li key={op.name} className="harness-integration-op">
                  <div className="harness-integration-op__row">
                    <span className={`harness-pill harness-pill--${op.effect === 'write' ? 'warning' : 'info'}`}>
                      {op.effect === 'write' ? t('decision.writeBadge') : t('decision.readBadge')}
                    </span>
                    <code>{op.displayName || op.name}</code>
                  </div>
                  {op.description && <p className="harness-muted harness-muted--xs">{op.description}</p>}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
