import { useState } from 'react';
import { Button, OverlayShell } from '@nimiplatform/kit/ui';
import { useTranslation } from 'react-i18next';
import type { ProductRetentionPreview, ProductRetentionResult } from '../../../shared/product-update.js';
import type { DesktopProductUpdatePort } from '../../renderer/product-update-port.js';

const bytes = (value: number) => `${(value / 1024 / 1024).toFixed(1)} MiB`;

// @nimi-authority: rule.nimi.platform.product-lifecycle.p-supd-013
export function ProductRetentionDialog({ port, disabled }: { port: DesktopProductUpdatePort; disabled: boolean }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<ProductRetentionPreview | null>(null);
  const [result, setResult] = useState<ProductRetentionResult | null>(null);
  const [error, setError] = useState('');
  const inspect = async () => {
    setOpen(true); setBusy(true); setError(''); setPreview(null); setResult(null);
    try { setPreview(await port.previewRetention()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  const selected = preview?.entries.filter(entry => entry.eligible) ?? [];
  const remove = async () => {
    if (busy || !selected.length) return;
    const versions = selected.map(entry => entry.version);
    setBusy(true); setError(''); setPreview(null);
    try { setResult(await port.cleanupRetention(versions)); }
    catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };
  return <>
    <Button disabled={disabled || busy} onClick={() => { void inspect(); }}>{t('ProductUpdate.retention.open')}</Button>
    <OverlayShell open={open} size="md" title={t('ProductUpdate.retention.title')}
      onClose={() => { if (!busy) setOpen(false); }}
      footer={<div className="flex justify-end gap-3">
        {!busy && !preview ? <Button onClick={() => { void inspect(); }}>{t('ProductUpdate.retention.refresh')}</Button> : null}
        {selected.length ? <Button disabled={busy} tone="danger" onClick={() => { void remove(); }}>{t('ProductUpdate.retention.confirm', { count: selected.length })}</Button> : null}
        <Button disabled={busy} onClick={() => setOpen(false)}>{t('ProductUpdate.dismiss')}</Button>
      </div>}>
      <div className="space-y-4 text-sm">
        <p>{t('ProductUpdate.retention.policy')}</p>
        {busy ? <p role="status">{t('ProductUpdate.retention.working')}</p> : null}
        {error ? <div role="alert"><p>{t('ProductUpdate.retention.failed')}</p><details><summary>{t('ProductUpdate.details')}</summary><code className="break-all">{error}</code></details></div> : null}
        {preview ? <>
          <p>{t(selected.length ? 'ProductUpdate.retention.summary' : 'ProductUpdate.retention.empty', {
            count: selected.length, size: bytes(selected.reduce((sum, entry) => sum + entry.logicalBytes, 0)),
          })}</p>
          <ul className="max-h-80 space-y-3 overflow-y-auto">
            {preview.entries.map(entry => <li key={entry.path} className="rounded-lg border border-[var(--nimi-border-default)] p-3">
              <p className="font-medium">{entry.version} · {entry.eligible ? bytes(entry.logicalBytes) : t('ProductUpdate.retention.kept')}</p>
              <p className="break-all text-xs text-[var(--nimi-text-muted)]">{entry.path}</p>
              {!entry.eligible ? <p>{t(`ProductUpdate.retention.reasons.${entry.reason}`, { defaultValue: t('ProductUpdate.retention.reasons.unknown') })}</p> : null}
              {entry.identitySha256 ? <details className="text-xs"><summary>{t('ProductUpdate.details')}</summary><code className="break-all">{entry.identitySha256}</code></details> : null}
            </li>)}
          </ul>
          {selected.length ? <p>{t('ProductUpdate.retention.confirmation')}</p> : null}
        </> : null}
        {result ? <ul className="space-y-2" role="status">{result.results.map(item => <li key={item.version}>
          <p>{item.version} · {t(item.removed ? 'ProductUpdate.retention.removed' : 'ProductUpdate.retention.retainedResult', { size: bytes(item.deletedBytes) })}</p>
          {item.reason ? <code className="break-all text-xs">{item.reason}</code> : null}
        </li>)}</ul> : null}
      </div>
    </OverlayShell>
  </>;
}
