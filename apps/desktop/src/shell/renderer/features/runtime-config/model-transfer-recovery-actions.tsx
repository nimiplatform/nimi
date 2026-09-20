import { Button, InlineAlert } from '@nimiplatform/kit/ui';
import type { NimiRuntimeLocalTransferProgressEvent } from '@nimiplatform/sdk/runtime';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAppStore } from '../../app-shell/providers/app-store.js';
import { desktopBridge } from '../../bridge.js';
import { useDesktopRendererCommands } from '../../renderer/binding-context.js';
import { useGlobalDownloads } from './global-downloads-context.js';
import { useRuntimeConfigLocalEnvironmentClient } from './runtime-config-local-environment-sdk-service.js';
import { basenameFromRuntimePath } from './runtime-config-model-center-utils.js';

type RecoveryTransfer = Pick<NimiRuntimeLocalTransferProgressEvent, 'availableActions' | 'relatedInstallSessionId'>;
type RecoveryAction = 'check_sync' | 'view_related_transfer' | 'import_file' | 'import_directory';

// Shared by the global utility and the Model Library; only Runtime-advertised
// actions are offered. The view keeps command failure observable in place.
export function TransferRecoveryControls(props: {
  readonly event: RecoveryTransfer;
  readonly disabled?: boolean;
  readonly onAction: (action: RecoveryAction) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const running = useRef(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const run = async (action: RecoveryAction) => {
    if (running.current || props.disabled) return;
    running.current = true;
    setBusy(true); setError(''); setNotice('');
    try {
      await props.onAction(action);
      if (action === 'check_sync') setNotice(t('runtimeConfig.downloads.checkSyncStarted'));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    } finally { running.current = false; setBusy(false); }
  };
  const actions = props.event.availableActions;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {actions.includes('check_sync') ? <Button data-transfer-recovery="check_sync" size="sm" tone="secondary" disabled={busy || props.disabled}
        onClick={() => { void run('check_sync'); }}>{t('runtimeConfig.localModelCenter.checkSync')}</Button> : null}
      {actions.includes('view_related_transfer') && props.event.relatedInstallSessionId ? <Button data-transfer-recovery="view_related_transfer" size="sm" tone="secondary" disabled={busy || props.disabled}
        onClick={() => { void run('view_related_transfer'); }}>{t('runtimeConfig.downloads.viewRelatedTransfer')}</Button> : null}
      {actions.includes('reimport') ? <>
        <Button data-transfer-recovery="import_file" size="sm" tone="secondary" disabled={busy || props.disabled} onClick={() => { void run('import_file'); }}>
          {t('runtimeConfig.localModelCenter.importModelFile')}
        </Button>
        <Button data-transfer-recovery="import_directory" size="sm" tone="secondary" disabled={busy || props.disabled} onClick={() => { void run('import_directory'); }}>
          {t('runtimeConfig.localModelCenter.importModelDirectory')}
        </Button>
      </> : null}
      {error ? <InlineAlert tone="danger">{error}</InlineAlert> : null}
      {notice ? <p role="status" className="text-xs text-[var(--nimi-text-secondary)]">{notice}</p> : null}
    </div>
  );
}

export function ModelTransferRecoveryActions(props: { readonly event: RecoveryTransfer; readonly disabled?: boolean }) {
  const { t } = useTranslation();
  const commands = useDesktopRendererCommands();
  const local = useRuntimeConfigLocalEnvironmentClient();
  const downloads = useGlobalDownloads();
  const setActiveTab = useAppStore((state) => state.setActiveTab);
  return <TransferRecoveryControls {...props} onAction={async (action) => {
    if (action === 'view_related_transfer') {
      if (!downloads || !props.event.relatedInstallSessionId) throw Error(t('runtimeConfig.downloads.relatedTransferUnavailable'));
      downloads.selectTransfer(props.event.relatedInstallSessionId);
      setActiveTab('downloads');
      return;
    }
    if (action === 'check_sync') {
      const result = await desktopBridge.startProductControlCheckSync();
      if (result.error || !result.run || !['running', 'completed'].includes(result.run.state)) {
        throw Error(result.error || t('DataManagement.checkSyncFailed'));
      }
    } else {
      const sourcePath = action === 'import_file' ? await commands.pickLocalRuntimeAssetFile() : await commands.pickLocalRuntimeAssetDirectory();
      if (!sourcePath) return;
      await local.importModelAsset({ sourcePath, displayName: basenameFromRuntimePath(sourcePath) || undefined }, { caller: 'core' });
    }
    await downloads?.refresh();
  }} />;
}
