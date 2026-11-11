import { useEffect, useRef, useState } from 'react';
import { Button, FieldShell, InlineAlert, Surface, TextField } from '@nimiplatform/kit/ui';
import { Copy, FileUp } from 'lucide-react';
import type { NimiLocalAppAssetRecord } from '@nimiplatform/sdk/app';
import { useLabRendererHost } from '../../renderer/context.js';
import { useTranslation } from '../../shell/i18n/index.js';
import { LAB_FILE_MISMATCH, verifyLabFile, writeLabFile } from './app-files.js';

type FileCheck =
  | { readonly stage: 'uploading' | 'checking'; readonly bytes: number }
  | { readonly stage: 'passed'; readonly asset: NimiLocalAppAssetRecord }
  | { readonly stage: 'failed'; readonly messageKey: 'uploadUnconfirmed' | 'mismatch' | 'readFailed'; readonly detail: string };

export function LabAppFilesPage() {
  const { t, i18n } = useTranslation();
  const host = useLabRendererHost();
  const [file, setFile] = useState<File | null>(null);
  const [path, setPath] = useState('');
  const [check, setCheck] = useState<FileCheck | null>(null);
  const [confirmedUploadPath, setConfirmedUploadPath] = useState('');
  const [copyStatus, setCopyStatus] = useState('');
  const operation = useRef<AbortController | null>(null);
  const pathField = useRef<HTMLInputElement>(null);
  useEffect(() => () => operation.current?.abort(), []);

  const running = check?.stage === 'uploading' || check?.stage === 'checking' ? check : null;
  const key = (name: string) => `CapabilityTests.appFiles.${name}`;
  const formatBytes = (bytes: number) => bytes.toLocaleString(i18n.language);

  async function run(action: 'upload' | 'verify') {
    const upload = action === 'upload';
    if (!file || operation.current || (!upload && !path.trim())) return;
    const controller = new AbortController();
    operation.current = controller;
    const relativePath = upload ? `lab-transfer-tests/${crypto.randomUUID()}.bin` : path.trim();
    let stage: 'uploading' | 'checking' = upload ? 'uploading' : 'checking';
    let lastUpdate = 0;
    setPath(relativePath);
    setCopyStatus('');
    if (upload) setConfirmedUploadPath('');
    setCheck({ stage, bytes: 0 });

    const progress = (bytes: number) => {
      if (controller.signal.aborted) return;
      const now = performance.now();
      if (bytes !== file.size && now - lastUpdate < 100) return;
      lastUpdate = now;
      setCheck({ stage, bytes });
    };

    try {
      const assets = host.sdk.localAppClient.storage.assets;
      if (upload) {
        await writeLabFile(assets, file, relativePath, controller.signal, progress);
        controller.signal.throwIfAborted();
        setConfirmedUploadPath(relativePath);
      }
      stage = 'checking';
      lastUpdate = 0;
      setCheck({ stage, bytes: 0 });
      const asset = await verifyLabFile(assets, file, relativePath, controller.signal, progress);
      controller.signal.throwIfAborted();
      setCheck({ stage: 'passed', asset });
    } catch (cause) {
      if (controller.signal.aborted) return;
      const reason = cause && typeof cause === 'object' && 'reasonCode' in cause ? String(cause.reasonCode) : '';
      const message = cause instanceof Error ? cause.message : String(cause);
      const messageKey = stage === 'uploading' ? 'uploadUnconfirmed' : message === LAB_FILE_MISMATCH ? 'mismatch' : 'readFailed';
      setCheck({ stage: 'failed', messageKey, detail: reason && reason !== message ? `${reason} · ${message}` : message });
    } finally {
      if (operation.current === controller) operation.current = null;
    }
  }

  async function copyPath() {
    const value = path.trim();
    if (!value) return;
    try {
      const result = await host.app.commands.copyText(value);
      if (!result.ok || !result.value.copied) throw new Error('copy-failed');
      if (pathField.current?.value.trim() === value) setCopyStatus(t('Common.copied'));
    } catch {
      if (pathField.current?.value.trim() === value) setCopyStatus(t('Common.copyFailed'));
    }
  }

  return (
    <div className="lab-workspace-route">
      <div className="mx-auto grid max-w-3xl gap-4">
        <header className="lab-workspace-heading">
          <span className="lab-workspace-heading__icon" aria-hidden="true"><FileUp size={22} /></span>
          <div><h1>{t(key('title'))}</h1><p>{t(key('intro'))}</p></div>
        </header>
        <Surface tone="panel" className="grid gap-4">
          <FieldShell label={t(key('file'))}>
            <input
              className="block max-w-full text-sm file:mr-3 file:rounded-lg file:border file:border-[var(--nimi-border-subtle)] file:bg-[var(--nimi-surface-card)] file:px-3 file:py-2 file:text-[var(--nimi-text-primary)]"
              type="file"
              aria-label={t(key('file'))}
              disabled={running !== null}
              onChange={event => { setFile(event.currentTarget.files?.[0] ?? null); setCheck(null); }}
            />
          </FieldShell>
          <div className="grid gap-2">
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-0 flex-1 basis-52">
                <FieldShell label={t(key('path'))}>
                  <TextField
                    ref={pathField}
                    value={path}
                    readOnly={running !== null}
                    aria-label={t(key('path'))}
                    aria-describedby="lab-app-files-path-help"
                    onChange={event => { setPath(event.currentTarget.value); setCheck(null); setCopyStatus(''); }}
                  />
                </FieldShell>
              </div>
              <Button type="button" tone="secondary" disabled={!path.trim()} leadingIcon={<Copy size={14} aria-hidden="true" />} onClick={() => void copyPath()}>
                {t(key('copyPath'))}
              </Button>
            </div>
            <p id="lab-app-files-path-help" className="m-0 text-xs text-[var(--nimi-text-secondary)]">{t(key('pathHelp'))}</p>
            <p className={copyStatus ? 'm-0 text-xs text-[var(--nimi-text-secondary)]' : 'sr-only'} role="status">{copyStatus}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" disabled={!file || running !== null} onClick={() => void run('upload')}>{t(key('upload'))}</Button>
            <Button type="button" tone="secondary" disabled={!file || !path.trim() || running !== null} onClick={() => void run('verify')}>{t(key('verify'))}</Button>
          </div>
          {running && file ? (
            <div className="grid gap-1">
              <strong className="text-sm" role="status">{t(key(running.stage))}</strong>
              <span className="text-sm text-[var(--nimi-text-secondary)]">{formatBytes(running.bytes)} / {formatBytes(file.size)} {t(key('bytes'))}</span>
            </div>
          ) : null}
          {check?.stage === 'passed' ? (
            <InlineAlert tone="success">
              <strong>{t(key('passed'))}</strong>
              <p className="break-all">{check.asset.relativePath} · {formatBytes(check.asset.sizeBytes)} {t(key('bytes'))}</p>
              <code className="break-all">{check.asset.sha256}</code>
            </InlineAlert>
          ) : null}
          {check?.stage === 'failed' ? (
            <InlineAlert tone="warning">
              {confirmedUploadPath === path.trim() ? <p>{t(key('uploadConfirmed'))}</p> : null}
              <strong>{t(key(check.messageKey))}</strong>
              <details className="mt-2 text-xs">
                <summary className="cursor-pointer">{t(key('technicalDetails'))}</summary>
                <code className="break-all">{check.detail}</code>
              </details>
            </InlineAlert>
          ) : null}
        </Surface>
        <p className="m-0 text-sm text-[var(--nimi-text-secondary)]">{t(key('role' in host.sdk.localAppClient ? 'footnoteWeb' : 'footnote'))}</p>
      </div>
    </div>
  );
}
