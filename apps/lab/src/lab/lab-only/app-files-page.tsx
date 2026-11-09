import { useEffect, useRef, useState } from 'react';
import { Button, InlineAlert, TextField, NimiText, Surface } from '@nimiplatform/kit/ui';
import type { NimiLocalAppAssetRecord } from '@nimiplatform/sdk/app';
import { useTranslation } from '../../shell/i18n/index.js';
import { getLabLocalAppClient } from '../../shell/local-app-runtime-platform.js';
import { writeLabFile, verifyLabFile } from './app-files.js';

export function LabAppFilesPage() {
  const { t } = useTranslation();
  const [file, setFile] = useState<File | null>(null);
  const [path, setPath] = useState('');
  const [stage, setStage] = useState<'idle' | 'uploading' | 'checking' | 'passed' | 'failed'>('idle');
  const [count, setCount] = useState(0);
  const [asset, setAsset] = useState<NimiLocalAppAssetRecord | null>(null);
  const [error, setError] = useState('');
  const operation = useRef<AbortController | null>(null);
  useEffect(() => () => operation.current?.abort(), []);
  const busy = stage === 'uploading' || stage === 'checking';
  async function run(upload: boolean) {
    if (!file || operation.current) return;
    const controller = new AbortController(); operation.current = controller;
    const relativePath = upload ? `lab-transfer-tests/${crypto.randomUUID()}.bin` : path.trim();
    setPath(relativePath); setError(''); setAsset(null); setCount(0); setStage(upload ? 'uploading' : 'checking');
    let last = 0;
    const progress = (bytes: number) => { if (controller.signal.aborted) return; const now = performance.now(); if (bytes === file.size || now - last >= 100) { last = now; setCount(bytes); } };
    try {
      const assets = getLabLocalAppClient().storage.assets;
      if (upload) await writeLabFile(assets, file, relativePath, controller.signal, progress);
      controller.signal.throwIfAborted(); setStage('checking'); setCount(0);
      const verified = await verifyLabFile(assets, file, relativePath, controller.signal, progress);
      controller.signal.throwIfAborted(); setAsset(verified); setStage('passed');
    } catch (cause) {
      if (!controller.signal.aborted) {
        const reason = cause && typeof cause === 'object' && 'reasonCode' in cause ? String(cause.reasonCode) : '';
        const message = cause instanceof Error ? cause.message : String(cause);
        setError(reason && reason !== message ? `${reason} · ${message}` : message); setStage('failed');
      }
    } finally { if (operation.current === controller) operation.current = null; }
  }
  return <Surface padding="lg" className="mx-auto flex max-w-3xl flex-col gap-4">
    <h1>{t('CapabilityTests.appFiles.title')}</h1>
    <NimiText role="body">{t('CapabilityTests.appFiles.intro')}</NimiText>
    <label className="flex flex-col gap-2"><span>{t('CapabilityTests.appFiles.file')}</span><input type="file" aria-label={t('CapabilityTests.appFiles.file')} disabled={busy} onChange={event => { setFile(event.target.files?.[0] ?? null); setAsset(null); setError(''); setStage('idle'); }} /></label>
    <label className="flex flex-col gap-2"><span>{t('CapabilityTests.appFiles.path')}</span><TextField value={path} disabled={busy} onChange={event => setPath(event.target.value)} aria-label={t('CapabilityTests.appFiles.path')} /></label>
    <div className="flex flex-wrap gap-2"><Button disabled={!file || busy} loading={stage === 'uploading'} onClick={() => void run(true)}>{t('CapabilityTests.appFiles.upload')}</Button><Button tone="secondary" disabled={!file || !path.trim() || busy} loading={stage === 'checking'} onClick={() => void run(false)}>{t('CapabilityTests.appFiles.verify')}</Button></div>
    {busy && <p role="status">{t(`CapabilityTests.appFiles.${stage}`)} {count.toLocaleString()} / {file?.size.toLocaleString()} {t('CapabilityTests.appFiles.bytes')}</p>}
    {asset && <InlineAlert tone="success"><strong>{t('CapabilityTests.appFiles.passed')}</strong><p>{asset.sizeBytes.toLocaleString()} {t('CapabilityTests.appFiles.bytes')}</p><code className="break-all">{asset.sha256}</code></InlineAlert>}
    {error && <InlineAlert tone="warning"><p>{t('CapabilityTests.appFiles.failed')}</p><code className="break-all">{error}</code></InlineAlert>}
    <NimiText role="helper">{t('CapabilityTests.appFiles.footnote')}</NimiText>
  </Surface>;
}
