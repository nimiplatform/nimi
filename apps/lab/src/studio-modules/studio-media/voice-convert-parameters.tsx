import { useEffect, useRef, useState } from 'react';
import { Button, SelectField } from '@nimiplatform/kit/ui';
import type { NimiVoiceConvertInputProfile } from '@nimiplatform/sdk/ai';
import { useAIStudioHost } from '../../ai-studio-core/host-context.js';
import { StudioNumberParameter, StudioParameterField, StudioTextParameter, type StudioParameterPanelProps } from '../../ai-studio-core/parameter-fields.js';
import { MusicRecoveryPanel } from './music-recovery-panel.js';
import type { StudioVoiceConvertParameters } from './parameters.js';

type VoiceTargetKind = NonNullable<StudioVoiceConvertParameters['targetKind']>;

export function VoiceConvertFields(props: StudioParameterPanelProps) {
  const host = useAIStudioHost(); const { translate: t } = host;
  const parameters = props.parameters as StudioVoiceConvertParameters;
  const update = props.onChange as (next: StudioVoiceConvertParameters) => void;
  const [profiles, setProfiles] = useState<readonly NimiVoiceConvertInputProfile[]>([]);
  const [voices, setVoices] = useState<readonly { voiceAssetId: string; creationSource: string; status: string }[]>([]);
  const [busy, setBusy] = useState<'source' | 'target' | null>(null);
  const [error, setError] = useState('');
  const sourceInput = useRef<HTMLInputElement>(null);
  const targetInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let active = true;
    const refresh = () => void host.sdk.aiConfig.getSnapshot().then(snapshot => {
      if (!active) return;
      const selected = snapshot.effectiveSelections.find(item => item.capabilityContract === 'audio.voice.convert');
      setProfiles(selected?.state === 'ready' && selected.resource?.oneofKind === 'local' ? selected.resource.local.musicInput?.voiceConvert ?? [] : []);
      setError('');
    }).catch((cause: unknown) => { if (active) { setProfiles([]); setError(String(cause)); } });
    refresh(); const unsubscribe = host.app.events.subscribeAIConfigRefresh(refresh);
    void host.sdk.listLocalAppVoiceAssets().then(assets => { if (active) setVoices(assets); }).catch(() => { if (active) setVoices([]); });
    return () => { active = false; unsubscribe(); };
  }, [host]);
  const targetKind: VoiceTargetKind = parameters.targetKind ?? 'reference-audio';
  const profile = profiles.find(item => item.targetKinds.includes(targetKind)) ?? profiles[0];
  const disabled = props.disabled || busy !== null;
  async function importAudio(file: File, kind: 'source' | 'target') {
    const extension = file.name.match(/\.(mp3|wav|flac)$/iu)?.[1]?.toLowerCase();
    const limit = kind === 'source' ? profile?.maxSourceBytes : profile?.maxTargetBytes;
    if (!extension || !profile || !limit || file.size < 1 || file.size > limit) { setError(t('VoiceConvert.fileInvalid')); return; }
    const mimeType = extension === 'mp3' ? 'audio/mpeg' : extension === 'flac' ? 'audio/flac' : 'audio/wav';
    // Do not leave the previous import executable while its replacement is
    // still being copied. The composer requires committed input assets.
    setBusy(kind); setError('');
    try {
      async function* chunks() {
        const reader = file.stream().getReader();
        try { while (true) { const next = await reader.read(); if (next.done) break; yield next.value; } }
        finally { await reader.cancel(); reader.releaseLock(); }
      }
      const asset = await host.sdk.assets.write({ relativePath: `studio/music/imports/${crypto.randomUUID()}/${kind}.${extension}`, body: chunks(), mediaType: mimeType, overwrite: false });
      update(kind === 'source'
        ? { ...parameters, sourceRelativePath: asset.relativePath, sourceName: file.name, sourceMimeType: mimeType }
        : { ...parameters, targetKind: 'reference-audio', targetRelativePath: asset.relativePath, targetName: file.name, targetMimeType: mimeType });
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(null); }
  }
  function updateSemitone(next: StudioVoiceConvertParameters) {
    const value = next.semitoneShift;
    if (value !== undefined && (!Number.isSafeInteger(value) || value < -12 || value > 12)) { setError(t('VoiceConvert.semitoneInvalid')); return; }
    setError(''); update(next);
  }
  return <div className="space-y-4">
    {!profile ? <p>{t('VoiceConvert.configureInputs')}</p> : <p>{t('VoiceConvert.inputHint', {
      sourceSeconds: profile.maxSourceSeconds, sourceMib: Math.floor(profile.maxSourceBytes / 1048576),
      targetSeconds: profile.maxTargetSeconds, targetMib: Math.floor(profile.maxTargetBytes / 1048576) })}</p>}
    <StudioParameterField label={t('VoiceConvert.source')}>
      <input ref={sourceInput} hidden type="file" accept=".mp3,.wav,.flac" onChange={event => {
        const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void importAudio(file, 'source');
      }} />
      <Button disabled={disabled || !profile} onClick={() => sourceInput.current?.click()}>{t(busy === 'source' ? 'Music.importing' : 'VoiceConvert.chooseSource')}</Button>
      {parameters.sourceRelativePath ? <p>{parameters.sourceName}</p> : null}
    </StudioParameterField>
    {profile ? <>
      {profile.supportsRange ? <>
        <StudioNumberParameter current={parameters} field="sourceStartSeconds" label={t('VoiceConvert.sourceStart')} onChange={update} disabled={disabled} />
        <StudioNumberParameter current={parameters} field="sourceEndSeconds" label={t('VoiceConvert.sourceEnd')} onChange={update} disabled={disabled} />
        <p className="text-sm opacity-70">{t('VoiceConvert.rangeHint')}</p>
      </> : null}
      <StudioParameterField label={t('VoiceConvert.targetKind')}>
        <SelectField value={targetKind} disabled={disabled}
          options={[...new Set(profiles.flatMap(item => item.targetKinds))].map(value => ({ value, label: t(`VoiceConvert.targetKinds.${value}`) }))}
          onValueChange={value => {
            const { targetRelativePath, targetName, targetMimeType, targetStartSeconds, targetEndSeconds, targetPresetVoiceId, targetVoiceAssetId, ...rest } = parameters;
            update({ ...rest, targetKind: value as VoiceTargetKind });
          }} />
      </StudioParameterField>
      {targetKind === 'reference-audio' ? <>
        <StudioParameterField label={t('VoiceConvert.target')}>
          <input ref={targetInput} hidden type="file" accept=".mp3,.wav,.flac" onChange={event => {
            const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void importAudio(file, 'target');
          }} />
          <Button disabled={disabled || !profile} onClick={() => targetInput.current?.click()}>{t(busy === 'target' ? 'Music.importing' : 'VoiceConvert.chooseTarget')}</Button>
          {parameters.targetRelativePath ? <p>{parameters.targetName}</p> : null}
        </StudioParameterField>
        {profile.supportsRange ? <>
          <StudioNumberParameter current={parameters} field="targetStartSeconds" label={t('VoiceConvert.targetStart')} onChange={update} disabled={disabled} />
          <StudioNumberParameter current={parameters} field="targetEndSeconds" label={t('VoiceConvert.targetEnd')} onChange={update} disabled={disabled} />
          <p className="text-sm opacity-70">{t('VoiceConvert.rangeHint')}</p>
        </> : null}
      </> : targetKind === 'preset' ? (
        <StudioTextParameter current={parameters} field="targetPresetVoiceId" label={t('VoiceConvert.presetVoiceId')} onChange={next => update({ ...next, targetKind: 'preset' })} disabled={disabled} />
      ) : (
        <StudioParameterField label={t('VoiceConvert.voiceAsset')}>
          <SelectField value={parameters.targetVoiceAssetId ?? ''} disabled={disabled || voices.length === 0}
            placeholder={voices.length ? t('VoiceConvert.selectVoiceAsset') : t('VoiceConvert.noVoiceAssets')}
            options={voices.map(voice => ({ value: voice.voiceAssetId, label: `${voice.voiceAssetId} · ${voice.creationSource} · ${voice.status}` }))}
            onValueChange={value => update({ ...parameters, targetKind: 'voice-asset', targetVoiceAssetId: value })} />
        </StudioParameterField>
      )}
      {profile.supportsSemitoneShift || parameters.semitoneShift !== undefined ? <>
        <StudioNumberParameter current={parameters} field="semitoneShift" label={t('VoiceConvert.semitone')} onChange={updateSemitone}
          disabled={disabled} min={profile.minSemitoneShift} max={profile.maxSemitoneShift} step={1} />
        <p className="text-sm opacity-70">{t('VoiceConvert.semitoneHint')}</p>
      </> : null}
    </> : null}
    <p className="text-sm opacity-70">{t('VoiceConvert.preparationHint')}</p>
    {error ? <p role="alert">{error}</p> : null}
    <MusicRecoveryPanel capability="audio.voice.convert" disabled={disabled} />
  </div>;
}
