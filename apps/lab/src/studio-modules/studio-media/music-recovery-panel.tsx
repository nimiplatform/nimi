import { useEffect, useRef, useState } from 'react';
import { Button } from '@nimiplatform/kit/ui';
import { useAIStudioHost } from '../../ai-studio-core/host-context.js';
import { ArtifactMediaResult } from '../../ai-studio-core/section-ai-testing-output.js';
import { MusicGenerationNotice } from '../../ai-studio-core/section-ai-testing-music-result.js';
import { MusicTranscriptionNotice } from '../../ai-studio-core/section-ai-testing-transcription-result.js';
import type { StudioCapabilityRunResult } from '../../ai-studio-core/runtime-types.js';
import { forgetMusicRecovery, readMusicRecovery, type MusicRecoveryEntry, type MusicRecoveryCapability } from './music-recovery.js';

export function MusicRecoveryPanel({ disabled, capability = 'music.generate' }: { readonly disabled: boolean; readonly capability?: MusicRecoveryCapability }) {
  const host = useAIStudioHost();
  const { translate: t } = host;
  const [entries, setEntries] = useState<readonly MusicRecoveryEntry[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<StudioCapabilityRunResult | null>(null);
  const abort = useRef<AbortController | null>(null);
  async function refresh() { setEntries(await readMusicRecovery(host.sdk.storage, capability)); }
  useEffect(() => {
    let active = true;
    const load = () => void readMusicRecovery(host.sdk.storage, capability).then((value) => { if (active) setEntries(value); })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : String(cause)); });
    load();
    const unsubscribe = host.app.events.subscribeAIConfigRefresh(load);
    return () => { active = false; unsubscribe(); };
  }, [host, disabled, capability]);
  async function recover(entry: MusicRecoveryEntry) {
    const controller = new AbortController(); abort.current = controller;
    setBusy(true); setError(''); setResult(null);
    try {
      const next = await host.sdk.runCapability({ capabilityId: capability, prompt: '', signal: controller.signal,
        parameters: { recoverySubmissionId: entry.clientSubmissionId } });
      setResult(next);
      await refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { abort.current = null; setBusy(false); }
  }
  const generatedScorePath = result?.ok && result.output.kind === 'artifacts' ? result.output.musicGeneration?.generatedScore?.relativePath : undefined;
  const isTranscription = result?.ok && result.output.kind === 'artifacts' && Boolean(result.output.musicTranscription);
  if (!entries.length && !error) return null;
  return <section className="space-y-3 border-t pt-4" aria-label={t('Music.recoveryTitle')}>
    <h3>{t('Music.recoveryTitle')}</h3>
    <p className="text-sm opacity-70">{t('Music.recoveryHint')}</p>
    <div className="max-h-48 space-y-2 overflow-y-auto">
      {[...entries].reverse().map((entry) => <div key={entry.clientSubmissionId} className="flex flex-wrap items-center gap-2">
        <time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString(host.locale)}</time>
        <Button disabled={disabled || busy} onClick={() => void recover(entry)}>{t(entry.result ? 'Music.openSaved' : 'Music.recover')}</Button>
        <Button disabled={disabled || busy} onClick={() => void forgetMusicRecovery(host.sdk.storage, entry.clientSubmissionId, capability).then(refresh)
          .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))}>{t('Music.forgetRecord')}</Button>
      </div>)}
    </div>
    {busy ? <div className="flex items-center gap-2"><span>{t('Music.recovering')}</span><Button onClick={() => abort.current?.abort()}>{t('Music.cancelJob')}</Button></div> : null}
    {error ? <p role="alert">{error}</p> : null}
    {result && !result.ok ? <p role="alert">{result.message}</p> : null}
    {result?.ok && result.output.kind === 'artifacts' ? <div className="space-y-3">
      <MusicGenerationNotice value={result.output.musicGeneration} />
      <MusicTranscriptionNotice value={result.output.musicTranscription} />
      {result.output.artifacts.filter((artifact) => !isTranscription && artifact.relativePath !== generatedScorePath).map((artifact) => <ArtifactMediaResult key={artifact.relativePath} artifact={artifact} fallbackLabel={artifact.relativePath} />)}
    </div> : null}
  </section>;
}
