import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, InlineAlert, NimiText, StatusBadge, Surface } from '@nimiplatform/kit/ui';
import {
  listLocalAppGrants,
  localAppGrantBridgeAvailable,
  revokeLocalAppGrant,
  type LocalAppGrantManagement as Grant,
} from './local-app-grant-bridge';

export function LocalAppGrantManagement() {
  const { t } = useTranslation();
  const [rows, setRows] = useState<Grant[]>([]);
  const [busySelector, setBusySelector] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!localAppGrantBridgeAvailable()) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      setRows(await listLocalAppGrants());
      setError('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const revoke = useCallback(async (selector: string) => {
    setBusySelector(selector);
    setError('');
    try {
      await revokeLocalAppGrant(selector);
      setRows((current) => current.filter((row) => row.selector !== selector));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusySelector('');
    }
  }, []);

  if (!localAppGrantBridgeAvailable()) return null;

  return (
    <section className="mt-8" data-testid="local-app-grant-management">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <NimiText role="section-title">{t('LocalAppGrants.management.title')}</NimiText>
          <NimiText role="helper" className="mt-1">{t('LocalAppGrants.management.description')}</NimiText>
        </div>
        <Button tone="secondary" size="sm" loading={loading} disabled={loading} onClick={() => { void refresh(); }}>
          {t('LocalAppGrants.action.refresh')}
        </Button>
      </div>
      {error ? <InlineAlert tone="danger" className="mt-3">{error}</InlineAlert> : null}
      {!loading && rows.length === 0 ? (
        <Surface tone="card" material="solid" padding="md" className="mt-3">
          <NimiText role="body">{t('LocalAppGrants.management.empty')}</NimiText>
        </Surface>
      ) : null}
      <div className="mt-3 grid gap-3">
        {rows.map((row) => (
          <Surface key={row.selector} tone="card" material="solid" padding="md" className="grid gap-3">
            <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="break-all font-mono text-xs leading-5 text-[var(--nimi-text-primary)]">{row.operationId}</p>
                <p className="mt-1 break-all font-mono text-xs leading-5 text-[var(--nimi-text-secondary)]">{row.resourceRef}</p>
              </div>
              <StatusBadge tone="success">{t('LocalAppGrants.state.granted')}</StatusBadge>
            </div>
            <div className="flex justify-end">
              <Button
                tone="danger"
                size="sm"
                loading={busySelector === row.selector}
                disabled={busySelector.length > 0}
                data-testid={`local-app-grant-revoke:${row.selector}`}
                onClick={() => { void revoke(row.selector); }}
              >
                {t('LocalAppGrants.action.revoke')}
              </Button>
            </div>
          </Surface>
        ))}
      </div>
    </section>
  );
}
