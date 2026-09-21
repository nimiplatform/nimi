import { useEffect, useRef, useState } from 'react';
import { Button, SelectField } from '@nimiplatform/kit/ui';
import type { NimiMusicTranscriptionInputProfile } from '@nimiplatform/sdk/ai';
import { useAIStudioHost } from '../../ai-studio-core/host-context.js';
import { StudioNumberParameter, StudioParameterField, type StudioParameterPanelProps } from '../../ai-studio-core/parameter-fields.js';
import { MusicRecoveryPanel } from './music-recovery-panel.js';
import type { StudioMusicTranscriptionParameters } from './parameters.js';

export function MusicTranscriptionFields(props: StudioParameterPanelProps) {
  const host = useAIStudioHost(); const { translate: t } = host;
  const parameters = props.parameters as StudioMusicTranscriptionParameters;
  const update = props.onChange as (next: StudioMusicTranscriptionParameters) => void;
  const [profiles, setProfiles] = useState<readonly NimiMusicTranscriptionInputProfile[]>([]);
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let active = true;
    const refresh = () => void host.sdk.aiConfig.getSnapshot().then(snapshot => {
      if (!active) return;
      const selected = snapshot.effectiveSelections.find(item => item.capabilityContract === 'music.transcribe');
      setProfiles(selected?.state === 'ready' && selected.resource?.oneofKind === 'local' ? selected.resource.local.musicInput?.transcription ?? [] : []);
      setError('');
    }).catch((cause: unknown) => { if (active) { setProfiles([]); setError(String(cause)); } });
    refresh(); const unsubscribe = host.app.events.subscribeAIConfigRefresh(refresh);
    return () => { active = false; unsubscribe(); };
  }, [host]);
  const profile = profiles.find(item => item.parts.includes(parameters.requestedPart ?? item.parts[0]!)) ?? profiles[0];
  const disabled = props.disabled || busy;
  async function importAudio(file: File) {
    const extension = file.name.match(/\.(mp3|wav|flac)$/iu)?.[1]?.toLowerCase();
    if (!extension || !profile || file.size < 1 || file.size > profile.maxSourceBytes) { setError(t('Transcription.fileInvalid')); return; }
    const mimeType = extension === 'mp3' ? 'audio/mpeg' : extension === 'flac' ? 'audio/flac' : 'audio/wav';
    // Do not leave the previous recording executable while its replacement is
    // still being copied. The composer requires a committed source asset.
    update({ requestedFormats: [...profile.formats], requestedPart: profile.parts[0] });
    setBusy(true); setError('');
    try {
      async function* chunks() {
        const reader = file.stream().getReader();
        try { while (true) { const next = await reader.read(); if (next.done) break; yield next.value; } }
        finally { await reader.cancel(); reader.releaseLock(); }
      }
      const asset = await host.sdk.assets.write({ relativePath: `studio/music/imports/${crypto.randomUUID()}/source.${extension}`, body: chunks(), mediaType: mimeType, overwrite: false });
      update({ sourceRelativePath: asset.relativePath, sourceName: file.name, sourceMimeType: mimeType,
        requestedFormats: [...profile.formats], requestedPart: profile.parts[0] });
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  }
  return <div className="space-y-4">
    {!profile ? <p>{t('Transcription.configureInputs')}</p> : <p>{t('Transcription.inputHint', { seconds: profile.maxDurationSeconds, mib: Math.floor(profile.maxSourceBytes / 1048576) })}</p>}
    <StudioParameterField label={t('Transcription.source')}>
      <input ref={fileInput} hidden type="file" accept=".mp3,.wav,.flac" onChange={event => {
        const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void importAudio(file);
      }} />
      <Button disabled={disabled || !profile} onClick={() => fileInput.current?.click()}>{t(busy ? 'Music.importing' : 'Transcription.chooseSource')}</Button>
      {parameters.sourceRelativePath ? <p>{parameters.sourceName}</p> : null}
    </StudioParameterField>
    {profile ? <>
      <StudioParameterField label={t('Transcription.part')}>
        <SelectField value={parameters.requestedPart ?? profile.parts[0]} disabled={disabled}
          options={[...new Set(profiles.flatMap(item => item.parts))].map(value => ({ value, label: t(`Transcription.parts.${value}`) }))}
          onChange={event => { const part = event.currentTarget.value as NonNullable<StudioMusicTranscriptionParameters['requestedPart']>; const next = profiles.find(item => item.parts.includes(part)); update({ ...parameters, requestedPart: part, requestedFormats: next ? [...next.formats] : [] }); }} />
      </StudioParameterField>
      <StudioParameterField label={t('Transcription.formats')}>
        <div className="flex flex-wrap gap-4">{profile.formats.map(format => <label key={format} className="flex items-center gap-2">
          <input type="checkbox" checked={parameters.requestedFormats?.includes(format) ?? false} disabled={disabled}
            onChange={event => update({ ...parameters, requestedFormats: event.currentTarget.checked ? [...(parameters.requestedFormats ?? []), format] : parameters.requestedFormats?.filter(item => item !== format) })} />
          {format === 'timeline' ? t('Transcription.timeline') : format.toUpperCase()}
        </label>)}</div>
      </StudioParameterField>
      {profile.supportsRange ? <>
        <StudioNumberParameter current={parameters} field="startSeconds" label={t('Transcription.start')} onChange={update} disabled={disabled} />
        <StudioNumberParameter current={parameters} field="endSeconds" label={t('Transcription.end')} onChange={update} disabled={disabled} />
        <p className="text-sm opacity-70">{t('Transcription.rangeHint')}</p>
      </> : null}
    </> : null}
    <p className="text-sm opacity-70">{t('Transcription.preparationHint')}</p>
    {error ? <p role="alert">{error}</p> : null}
    <MusicRecoveryPanel capability="music.transcribe" disabled={disabled} />
  </div>;
}
