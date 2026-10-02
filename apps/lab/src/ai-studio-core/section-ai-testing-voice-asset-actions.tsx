import { useEffect, useState } from 'react';
import { Button, ConfirmDialog } from '@nimiplatform/kit/ui';
import { useAIStudioHost } from './host-context.js';

export function VoiceAssetActions({ voiceAssetId }: { readonly voiceAssetId: string }) {
  const { sdk, translate: t } = useAIStudioHost();
  const [status, setStatus] = useState('loading');
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let current = true;
    void sdk.listLocalAppVoiceAssets().then((assets) => {
      if (current) setStatus(assets.find((asset) => asset.voiceAssetId === voiceAssetId)?.status ?? 'unavailable');
    }, () => { if (current) setStatus('unavailable'); });
    return () => { current = false; };
  }, [sdk, voiceAssetId]);
  async function remove() {
    setBusy(true);
    setError('');
    try {
      await sdk.deleteLocalAppVoiceAsset(voiceAssetId);
      setStatus('deleted');
      setConfirm(false);
    } catch {
      setError(t('StudioShell.voiceDeleteFailed'));
    } finally {
      setBusy(false);
    }
  }
  return <div className="studio-result__rich">
    {status === 'deleted' ? <p role="status">{t('StudioShell.voiceDeleted')}</p> :
      <Button tone="danger" disabled={status !== 'active'} onClick={() => setConfirm(true)}>{t('StudioShell.voiceDelete')}</Button>}
    {status === 'unavailable' ? <p>{t('StudioShell.voiceUnavailable')}</p> : null}
    <ConfirmDialog open={confirm} title={t('StudioShell.voiceDeleteTitle')}
      message={<>{t('StudioShell.voiceDeleteDescription')}{error ? <p role="alert">{error}</p> : null}</>}
      confirmLabel={t('StudioShell.voiceDelete')} cancelLabel={t('StudioShell.voiceDeleteCancel')}
      loading={busy} onConfirm={() => { void remove(); }} onClose={() => setConfirm(false)} />
  </div>;
}
