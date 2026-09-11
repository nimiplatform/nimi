import { AppsDistributionInfo } from './apps-distribution-info.js';
import { AppArtworkIcon } from './apps-card-visuals.js';
import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { asNimiError } from '@nimiplatform/sdk';
import type { NimiDesktopMachineProductRuntimeClient } from '@nimiplatform/sdk/runtime';
import { AppPackageJobKind, AppPackageSourceClass, ReasonCode, type AppPackageJob, type CommittedAppRelease, type LocalAppPackagePreview } from '@nimiplatform/sdk/runtime/wire-types';
import { openShellFileDialog } from '@nimiplatform/kit/shell/renderer/bridge';
import { Button, ConfirmDialog, InlineAlert } from '@nimiplatform/kit/ui';
import semver from 'semver';

type LocalIntent = { readonly preview: LocalAppPackagePreview; readonly installed: CommittedAppRelease | null };
type ImportPhase = 'idle' | 'choosing' | 'preparing' | 'confirming' | 'starting';

// @nimi-authority: rule.nimi.platform.app-ecosystem.p-napp-040e
export function useAppsLocalImport(getClient: () => NimiDesktopMachineProductRuntimeClient['apps'], onStarted: (job: AppPackageJob) => void) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<ImportPhase>('idle');
  const [intent, setIntent] = useState<LocalIntent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const intentRef = useRef<LocalIntent | null>(null);
  const operation = useRef<{ revision: number; abort: AbortController | null; busy: boolean }>({ revision: 0, abort: null, busy: false });
  const discard = useCallback(async (selected: LocalIntent) => {
    const result = await getClient().discardLocalAppPackage({ candidateSelector: selected.preview.candidateSelector });
    if (result.reasonCode !== ReasonCode.ACTION_EXECUTED) throw new Error(t('Apps.localImport.discardFailed'));
  }, [getClient, t]);
  const failure = useCallback((value: unknown): string => {
    const parsed = asNimiError(value);
    const known: Record<string, string> = {
      APP_PACKAGE_SELECTION_STALE: 'selectionExpired', APP_PACKAGE_ALREADY_INSTALLED: 'alreadyInstalled',
      APP_PACKAGE_HOST_RUNNING: 'stopRequired', APP_PACKAGE_JOB_ACTIVE: 'jobActive',
      APP_PACKAGE_INSTALL_UNAVAILABLE: 'unavailable', APP_PACKAGE_UPDATE_UNAVAILABLE: 'updateUnavailable',
      APP_PACKAGE_SELECTION_INVALID: 'invalidPackage',
      'electron-desktop-runtime-method-not-admitted': 'unavailable',
      'runtime-service-unavailable': 'unavailable',
    };
    const metadata = parsed.details?.reasonMetadata;
    const localReason = metadata && typeof metadata === 'object' && 'local_import_reason' in metadata ? String(metadata.local_import_reason) : '';
    const localKeys: Record<string, string> = { 'unsupported-target': 'unsupportedPlatform', 'local-file-unavailable': 'fileUnavailable', 'native-verification-failed': 'nativeInvalid' };
    const key = localKeys[localReason] ?? known[parsed.reasonCode];
    return key ? t(`Apps.localImport.${key}`) : (value instanceof Error ? value.message : t('Apps.localImport.failed'));
  }, [t]);
  const cancel = useCallback(() => {
    operation.current.revision += 1;
    operation.current.abort?.abort();
    operation.current.abort = null;
    operation.current.busy = false;
    const selected = intentRef.current;
    intentRef.current = null;
    setIntent(null);
    setPhase('idle');
    if (selected) void discard(selected).catch((cause: unknown) => setError(failure(cause)));
  }, [discard, failure]);
  useEffect(() => () => {
    operation.current.revision += 1;
    operation.current.abort?.abort();
    const selected = intentRef.current;
    intentRef.current = null;
    if (selected) void getClient().discardLocalAppPackage({ candidateSelector: selected.preview.candidateSelector }).catch(() => { /* Runtime expiry also releases uncommitted custody. */ });
  }, [getClient]);

  const choose = useCallback(async (installed: CommittedAppRelease | null = null) => {
    if (operation.current.busy || intentRef.current) return;
    operation.current.busy = true;
    const revision = ++operation.current.revision;
    const abort = new AbortController();
    operation.current.abort = abort;
    setError(null);
    setPhase('choosing');
    try {
      const selected = await openShellFileDialog({ kind: 'file', title: t('Apps.localImport.selectTitle'), filters: [{ name: 'Nimi App', extensions: ['nimiapp'] }], multiple: false });
      if (revision !== operation.current.revision) return;
      if (selected.canceled || selected.paths.length === 0) { setPhase('idle'); return; }
      if (selected.paths.length !== 1) throw new Error(t('Apps.localImport.selectOne'));
      setPhase('preparing');
      const result = await getClient().prepareLocalAppPackage({ sourcePath: selected.paths[0]! }, { signal: abort.signal, timeoutMs: 120_000 });
      if (result.reasonCode !== ReasonCode.ACTION_EXECUTED || !result.preview?.candidateSelector.length || !result.preview.appId || !semver.valid(result.preview.version)) {
        if (result.preview?.candidateSelector.length) await discard({ preview: result.preview, installed });
        throw new Error(t('Apps.localImport.invalidPreview'));
      }
      const next = { preview: result.preview, installed };
      if (revision !== operation.current.revision) { await discard(next); return; }
      if (installed && (installed.sourceClass !== AppPackageSourceClass.USER_IMPORTED || installed.appId !== next.preview.appId || !semver.gt(next.preview.version, installed.version))) {
        await discard(next);
        throw new Error(t(installed.appId === next.preview.appId ? 'Apps.localImport.newerVersionRequired' : 'Apps.localImport.wrongApp'));
      }
      intentRef.current = next;
      setIntent(next);
      setPhase('confirming');
    } catch (cause) {
      if (revision === operation.current.revision && !abort.signal.aborted) { setError(failure(cause)); setPhase('idle'); }
    } finally {
      if (revision === operation.current.revision) { operation.current.busy = false; operation.current.abort = null; }
    }
  }, [discard, failure, getClient, t]);

  const confirm = useCallback(async () => {
    const selected = intentRef.current;
    if (!selected || operation.current.busy) return;
    operation.current.busy = true;
    setPhase('starting');
    setError(null);
    try {
      const { preview, installed } = selected;
      const result = installed
        ? await getClient().startLocalAppPackageUpdate({ candidateSelector: preview.candidateSelector, launchSelector: installed.launchSelector, installedVersion: installed.version })
        : await getClient().startLocalAppPackageInstall({ candidateSelector: preview.candidateSelector });
      const job = result.job;
      if (result.reasonCode !== ReasonCode.ACTION_EXECUTED || !job?.jobId.length || job.appId !== preview.appId || job.sourceClass !== AppPackageSourceClass.USER_IMPORTED || job.targetVersion !== preview.version || job.kind !== (installed ? AppPackageJobKind.UPDATE : AppPackageJobKind.INSTALL)) throw new Error(t('Apps.localImport.invalidJob'));
      intentRef.current = null;
      setIntent(null);
      setPhase('idle');
      onStarted(job);
    } catch (cause) {
      setError(failure(cause));
      setPhase('confirming');
    } finally { operation.current.busy = false; }
  }, [failure, getClient, onStarted, t]);
  return { phase, intent, error, choose, cancel, confirm };
}

export function AppsLocalImportFeedback({ state }: { readonly state: ReturnType<typeof useAppsLocalImport> }): ReactElement {
  const { t } = useTranslation();
  const preview = state.intent?.preview;
  return <>
    {(state.phase === 'choosing' || state.phase === 'preparing') ? <InlineAlert tone="info" className="mx-4 mt-2" role="status">
      <span>{t(state.phase === 'choosing' ? 'Apps.localImport.choosing' : 'Apps.localImport.preparing')}</span>
      {state.phase === 'preparing' ? <Button tone="ghost" size="sm" onClick={state.cancel}>{t('Common.cancel')}</Button> : null}
    </InlineAlert> : null}
    {state.error && !preview ? <InlineAlert tone="danger" className="mx-4 mt-2" role="alert">{state.error}</InlineAlert> : null}
    <ConfirmDialog confirmTone="primary" open={preview !== undefined} title={t(state.intent?.installed ? 'Apps.localImport.updateTitle' : 'Apps.localImport.confirmTitle')}
      message={preview ? <div className="space-y-3">
        {state.error ? <InlineAlert tone="danger" role="alert">{state.error}</InlineAlert> : null}
        <div className="flex items-center gap-3"><AppArtworkIcon appId={preview.appId} displayName={preview.displayName} iconUrl={preview.info ? `data:image/png;base64,${preview.info.iconPngBase64}` : null} /><p className="font-semibold">{preview.displayName} · {preview.version}</p></div>
        <AppsDistributionInfo info={preview.info} />
        <p>{t('Apps.localImport.sourceDisclosure')}</p>
        {state.intent?.installed ? <p>{t('Apps.update.confirmMessage', { from: state.intent.installed.version, to: preview.version })}</p> : null}
        {preview.windowsCodeSigning === 'unsigned' ? <p>{t('Apps.localImport.nativeWindowsUnsigned')}</p> : null}
        {preview.os === 'macos' && preview.macosNotarization === 'absent' ? <p>{t(preview.observedSigningSubject ? 'Apps.localImport.nativeMacOSUnnotarized' : 'Apps.localImport.nativeMacOSUnsigned')}</p> : null}
        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
          <dt>{t('LocalDevelopment.field.app')}</dt><dd className="break-all">{preview.appId}</dd>
          <dt>{t('Apps.localImport.platform')}</dt><dd>{preview.os} · {preview.arch}</dd>
          <dt>{t('Apps.localImport.appAccess')}</dt><dd>{preview.appAccess.join(', ') || t('Apps.catalog.none')}</dd>
          {preview.observedSigningSubject ? <><dt>{t('Apps.catalog.nativePosture')}</dt><dd className="break-all">{preview.observedSigningSubject}</dd></> : null}
        </dl>
      </div> : ''}
      confirmLabel={t(state.intent?.installed ? 'Apps.action.update' : 'Apps.action.install')}
      cancelLabel={t('Common.cancel')} pending={state.phase === 'starting'} onConfirm={() => void state.confirm()} onClose={state.cancel} />
  </>;
}
