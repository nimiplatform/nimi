import { useEffect, useRef, useState } from 'react';
import { Button } from '@nimiplatform/kit/ui';
import { useAIStudioHost } from '../../ai-studio-core/host-context.js';
import { StudioBooleanParameter, StudioNumberParameter, StudioParameterField, type StudioParameterPanelProps } from '../../ai-studio-core/parameter-fields.js';
import { MusicRecoveryPanel } from './music-recovery-panel.js';
import type { StudioAudioSeparateParameters } from './parameters.js';

export function AudioSeparateFields(props: StudioParameterPanelProps) {
  const host = useAIStudioHost(); const { translate: t } = host;
  const parameters = props.parameters as StudioAudioSeparateParameters;
  const update = props.onChange as (next: StudioAudioSeparateParameters) => void;
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const sourceInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let active = true;
    // Closing the drawer and a commit can both refresh; only the newest read
    // applies, so a slower, older snapshot never undoes a newer one.
    let requestGeneration = 0;
    const refresh = () => {
      const generation = ++requestGeneration;
      void host.sdk.aiConfig.getSnapshot().then(snapshot => {
        if (!active || generation !== requestGeneration) return;
        const selected = snapshot.effectiveSelections.find(item => item.capabilityContract === 'audio.separate');
        setReady(selected?.state === 'ready');
        setError('');
      }).catch((cause: unknown) => { if (active && generation === requestGeneration) { setReady(false); setError(String(cause)); } });
    };
    refresh(); const unsubscribe = host.app.events.subscribeAIConfigRefresh(refresh);
    return () => { active = false; unsubscribe(); };
  }, [host]);
  const disabled = props.disabled || busy;
  async function importAudio(file: File) {
    const extension = file.name.match(/\.(mp3|wav|flac)$/iu)?.[1]?.toLowerCase();
    if (!extension || file.size < 1) { setError(t('AudioSeparate.fileInvalid')); return; }
    const mimeType = extension === 'mp3' ? 'audio/mpeg' : extension === 'flac' ? 'audio/flac' : 'audio/wav';
    // Do not leave the previous import executable while its replacement is
    // still being copied. The composer requires committed input assets.
    setBusy(true); setError('');
    try {
      async function* chunks() {
        const reader = file.stream().getReader();
        try { while (true) { const next = await reader.read(); if (next.done) break; yield next.value; } }
        finally { await reader.cancel(); reader.releaseLock(); }
      }
      const asset = await host.sdk.assets.write({ relativePath: `studio/music/imports/${crypto.randomUUID()}/source.${extension}`, body: chunks(), mediaType: mimeType, overwrite: false });
      update({ ...parameters, sourceRelativePath: asset.relativePath, sourceName: file.name, sourceMimeType: mimeType });
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  return <div className="space-y-4">
    {!ready ? <p>{t('AudioSeparate.configureInputs')}</p> : <p>{t('AudioSeparate.inputHint')}</p>}
    <StudioParameterField label={t('AudioSeparate.source')}>
      <input ref={sourceInput} hidden type="file" accept=".mp3,.wav,.flac" onChange={event => {
        const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void importAudio(file);
      }} />
      <Button disabled={disabled || !ready} onClick={() => sourceInput.current?.click()}>{t(busy ? 'Music.importing' : 'AudioSeparate.chooseSource')}</Button>
      {parameters.sourceRelativePath ? <p>{parameters.sourceName}</p> : null}
    </StudioParameterField>
    {ready ? <>
      <StudioNumberParameter current={parameters} field="startSeconds" label={t('AudioSeparate.start')} onChange={update} disabled={disabled} />
      <StudioNumberParameter current={parameters} field="endSeconds" label={t('AudioSeparate.end')} onChange={update} disabled={disabled} />
      <p className="text-sm opacity-70">{t('AudioSeparate.rangeHint')}</p>
      <StudioBooleanParameter current={parameters} field="includeInstrumentParts" label={t('AudioSeparate.includeInstrumentParts')} onChange={update} disabled={disabled} />
      <p className="text-sm opacity-70">{t('AudioSeparate.instrumentPartsHint')}</p>
    </> : null}
    <p className="text-sm opacity-70">{t('AudioSeparate.preparationHint')}</p>
    {error ? <p role="alert">{error}</p> : null}
    <MusicRecoveryPanel capability="audio.separate" disabled={disabled} />
  </div>;
}
