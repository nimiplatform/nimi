import { useEffect, useRef, useState } from 'react';
import type { NimiLocalAppAssetRecord } from '@nimiplatform/sdk/app';
import { Button, InlineAlert, Surface } from '@nimiplatform/kit/ui';
import { useLabRendererHost } from '../../renderer/context.js';
import { useTranslation } from '../../shell/i18n/index.js';
import { subscribeLabLocalAppSessionLoss } from '../../shell/auth/session-loss.js';
import { IntegrationAssetPreview } from './integration-asset-preview.js';

// @nimi-authority: rule.nimi.sdks.feature-clients.integrations
// This is the current App-owned file collection. A historical path is never
// used to enter this collection or to authorize preview, reveal or deletion.
export function IntegrationAssetsPanel({ busy, setAssetBusy }: { busy: boolean; setAssetBusy: (value: boolean) => void }) {
  const host = useLabRendererHost(); const { t } = useTranslation();
  const [assets, setAssets] = useState<readonly NimiLocalAppAssetRecord[]>([]);
  const [cursor, setCursor] = useState(''); const [selected, setSelected] = useState('');
  const [error, setError] = useState(''); const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false); const [acting, setActing] = useState(false);
  const live = useRef(false); const generation = useRef(0); const requests = useRef(0); const action = useRef(false);
  const currentHost = useRef(host); currentHost.current = host;
  const load = async (nextCursor = '') => {
    const scope = generation.current; const request = ++requests.current;
    const current = () => live.current && currentHost.current === host && generation.current === scope && requests.current === request;
    setLoading(true); setError('');
    try {
      const page = await host.sdk.localAppClient.storage.assets.list({ prefix: '', pageSize: 100, cursor: nextCursor });
      if (!current()) return;
      setAssets(previous => nextCursor ? [...new Map([...previous, ...page.assets].map(asset => [asset.relativePath, asset])).values()] : page.assets);
      setCursor(page.nextCursor); setLoaded(true);
    } catch { if (current()) setError(t('Integrations.filesLoadFailed')); }
    finally { if (current()) setLoading(false); }
  };
  useEffect(() => {
    live.current = true; generation.current++; setAssets([]); setCursor(''); setSelected(''); setError(''); setLoaded(false); setLoading(false);
    const unsubscribe = subscribeLabLocalAppSessionLoss(() => {
      if (currentHost.current !== host) return;
      generation.current++; requests.current++; action.current = false;
      setAssets([]); setCursor(''); setSelected(''); setLoaded(false); setLoading(false); setActing(false); setAssetBusy(false);
    });
    return () => { live.current = false; generation.current++; unsubscribe(); };
  }, [host, setAssetBusy]);
  const remove = async (relativePath: string) => {
    if (busy || action.current) return;
    const scope = generation.current; const current = () => live.current && currentHost.current === host && generation.current === scope;
    action.current = true; setActing(true); setAssetBusy(true); setError('');
    try {
      await host.sdk.localAppClient.storage.assets.remove(relativePath);
      if (!current()) return;
      setSelected(value => value === relativePath ? '' : value);
      await load();
    } catch { if (current()) setError(t('Integrations.fileRemoveFailed')); }
    finally { if (current()) { action.current = false; setActing(false); setAssetBusy(false); } }
  };
  return <Surface tone="panel" data-testid="integration-current-assets"><details onToggle={event => { if (event.currentTarget.open && !loaded && !loading) void load(); }}>
    <summary className="cursor-pointer font-semibold">{t('Integrations.currentFiles')}</summary>
    <p className="mt-3 text-sm">{t('Integrations.currentFilesHelp')}</p>
    {error ? <InlineAlert tone="warning">{error}</InlineAlert> : null}
    <Button className="mt-3" tone="secondary" disabled={busy || loading || acting} onClick={() => { setSelected(''); void load(); }}>{t('Integrations.refresh')}</Button>
    {loading ? <p className="mt-2 text-sm" role="status">{t('Common.loading')}</p> : null}
    {loaded && !assets.length ? <p className="mt-3 text-sm">{t('Integrations.noCurrentFiles')}</p> : null}
    {assets.map(asset => <div key={asset.relativePath} className="mt-3 border-t border-[var(--nimi-border-subtle)] pt-3 text-sm">
      <p className="break-all">{asset.relativePath}</p><p className="mt-1 text-xs">{asset.mediaType || 'application/octet-stream'} · {t('Integrations.assetSize', { size: asset.sizeBytes })}</p>
      <div className="mt-2 flex gap-2"><Button size="sm" tone="secondary" disabled={busy || acting} onClick={() => setSelected(asset.relativePath)}>{t('Integrations.viewCurrentFile')}</Button><Button size="sm" tone="danger" disabled={busy || acting} onClick={() => void remove(asset.relativePath)}>{t('Integrations.removeCurrentFile')}</Button></div>
      {selected === asset.relativePath ? <IntegrationAssetPreview relativePath={asset.relativePath} disabled={busy || acting} report={() => setError(t('Integrations.currentFileUnavailable'))} /> : null}
    </div>)}
    {cursor ? <Button className="mt-3" tone="secondary" disabled={busy || loading || acting} onClick={() => void load(cursor)}>{t('Integrations.moreAssets')}</Button> : null}
  </details></Surface>;
}
