import { useContext, useEffect, useRef, useState } from 'react';
import { StudioHistoryResultContext, StudioHistoryPanelContext } from './contexts.js';
import { Button } from '@nimiplatform/kit/ui';
import { useAIStudioHost } from './host-context.js';
import type { StudioCapabilityRunResult } from './runtime-types.js';
import { forgetStudioJobRecovery, readStudioJobRecovery, type StudioJobRecoveryEntry, type StudioJobRecoveryCapability } from './job-recovery.js';

export function StudioJobRecoveryPanel({ disabled, capability = 'music.generate' }: { readonly disabled: boolean; readonly capability?: StudioJobRecoveryCapability }) {
  const host = useAIStudioHost();
  const { translate: t } = host;
  const commitResult = useContext(StudioHistoryResultContext);
  const historyPanel = useContext(StudioHistoryPanelContext);
  const [entries, setEntries] = useState<readonly StudioJobRecoveryEntry[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<StudioCapabilityRunResult | null>(null);
  const panel = useRef<HTMLDetailsElement | null>(null);
  const abort = useRef<AbortController | null>(null);
  const observation = useRef<AbortController | null>(null);
  const snapshotSequence = useRef(0);
  const [observationIssue, setObservationIssue] = useState(false);
  useEffect(() => () => observation.current?.abort(), [capability]);
  async function refresh() {
    const sequence = ++snapshotSequence.current;
    const next = await readStudioJobRecovery(host.sdk.storage, capability);
    if (sequence === snapshotSequence.current) { setEntries(next); }
  }
  useEffect(() => {
    let active = true;
    const load = () => {
      const sequence = ++snapshotSequence.current;
      void readStudioJobRecovery(host.sdk.storage, capability).then((value) => {
      if (!active || sequence !== snapshotSequence.current) return;
      setEntries(value);
      setResult(previous => {
        if (!previous?.ok || !('jobId' in previous.output)) return previous;
        const jobId = previous.output.jobId;
        return value.some(entry => entry.result?.ok && 'jobId' in entry.result
          && entry.result.jobId === jobId) ? previous : null;
      });
    })
      .catch((cause: unknown) => { if (active && sequence === snapshotSequence.current) setError(cause instanceof Error ? cause.message : String(cause)); });
    };
    load();
    const unsubscribe = host.app.events.subscribeAIConfigRefresh(load);
    return () => { active = false; snapshotSequence.current++; unsubscribe(); };
  }, [host, disabled, capability, historyPanel?.imageRecords]);
  async function recover(entry: StudioJobRecoveryEntry) {
    if (observation.current) return;
    const controller = new AbortController(); abort.current = controller;
    const view = new AbortController(); observation.current = view;
    setBusy(true); setError(''); setResult(null); setObservationIssue(false);
    try {
      const next = await host.sdk.runCapability({ capabilityId: capability, prompt: '', signal: controller.signal, observationSignal: view.signal,
        onObservation: response => { if (!view.signal.aborted) setObservationIssue(Boolean(response.observationIssue)); },
        parameters: { recoverySubmissionId: entry.clientSubmissionId } });
      view.signal.throwIfAborted();
      if (next.ok) {
        controller.signal.throwIfAborted();
        if (!commitResult) throw new Error(t('Music.historyOwnerUnavailable'));
        await commitResult(next, entry.prompt ?? '', entry.runConfig);
      }
      if (view.signal.aborted) return;
      setResult(next);
      if (next.ok && panel.current) panel.current.open = false;
      await refresh();
    } catch (cause) {
      if (view.signal.aborted) return;
      const record = cause && typeof cause === 'object' ? cause as { reasonCode?: unknown; code?: unknown } : null;
      const code = String(record?.reasonCode ?? record?.code ?? '').toLowerCase().replaceAll('-', '_');
      setError(code === 'not_found'
        ? t('Music.recoveryJobNotFound') : cause instanceof Error ? cause.message : String(cause));
    }
    finally { if (observation.current === view) { abort.current = null; observation.current = null; if (!view.signal.aborted) setBusy(false); } }
  }
  if (!entries.length && !error) return null;
  const summaryState = busy ? t('Music.recovering')
    : error || (result && !result.ok) ? t('Music.recoveryNeedsAttention')
    : result?.ok ? t('Music.recovered') : '';
  return <details ref={panel} className="studio-recovery" aria-label={t('Music.recoveryTitle')}>
    <summary>
      {t('Music.recoveryTitle')} <span>({entries.length})</span>
      {summaryState ? <span className="studio-recovery__state" role="status" title={summaryState}>{summaryState}</span> : null}
    </summary>
    <div className="studio-recovery__body">
    <p className="text-sm opacity-70">{t('Music.recoveryHint')}</p>
    <div className="max-h-48 space-y-2 overflow-y-auto">
      {[...entries].reverse().map((entry) => <div key={entry.clientSubmissionId} className="flex flex-wrap items-center gap-2">
        <time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleString(host.locale)}</time>
        <Button disabled={disabled || busy} onClick={() => void recover(entry)}>{t(entry.result ? 'Music.openSaved' : 'Music.recover')}</Button>
        <Button disabled={disabled || busy} onClick={() => void forgetStudioJobRecovery(host.sdk.storage, entry.clientSubmissionId, capability).then(() => {
          setResult(null); setError(''); return refresh();
        })
          .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)))}>{t('Music.forgetRecord')}</Button>
      </div>)}
    </div>
    {busy ? <div className="flex items-center gap-2"><span>{t('Music.recovering')}</span><Button onClick={() => abort.current?.abort()}>{t('Music.cancelJob')}</Button></div> : null}
    {error ? <p role="alert">{error}</p> : null}
    {result && !result.ok ? <p role="alert">{result.diagnostics?.reasonCode === 'NOT_FOUND'
      ? t('Music.recoveryJobNotFound') : result.message}</p> : null}
    {observationIssue && busy ? <p role="status">{t('Music.observationIssue')}</p> : null}
    {result?.ok ? <p role="status">{t('Music.recovered')}</p> : null}
    </div>
  </details>;
}
