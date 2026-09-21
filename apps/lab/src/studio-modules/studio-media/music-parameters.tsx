import { MusicRecoveryPanel } from './music-recovery-panel.js';
import { useEffect, useRef, useState } from 'react';
import { Button, SelectField, TextareaField } from '@nimiplatform/kit/ui';
import type { NimiMusicInputCapabilities } from '@nimiplatform/sdk/ai';
import { useAIStudioHost } from '../../ai-studio-core/host-context.js';
import { StudioBooleanParameter, StudioNumberParameter, StudioParameterField, type StudioParameterPanelProps } from '../../ai-studio-core/parameter-fields.js';
import type { StudioMusicGenerationParameters } from './parameters.js';

export function MusicFields(props: StudioParameterPanelProps) {
  const host = useAIStudioHost();
  const { translate: t } = host;
  const parameters = props.parameters as StudioMusicGenerationParameters;
  const update = props.onChange as (next: StudioMusicGenerationParameters) => void;
  const [capabilities, setCapabilities] = useState<NimiMusicInputCapabilities | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    let active = true;
    const refresh = () => {
      setLoading(true);
      void host.sdk.aiConfig.getSnapshot().then((snapshot) => {
        if (!active) return;
        const selection = snapshot.effectiveSelections.find((item) => item.capabilityContract === 'music.generate');
        const resource = selection?.resource;
        const next = resource?.oneofKind === 'local' ? resource.local.musicInput : resource?.oneofKind === 'cloud' ? resource.cloud.target?.musicInput : undefined;
        setCapabilities(selection?.state === 'ready' && next ? next : null);
        setError('');
      }).catch((cause: unknown) => {
        if (active) { setCapabilities(null); setError(cause instanceof Error ? cause.message : String(cause)); }
      }).finally(() => { if (active) setLoading(false); });
    };
    refresh();
    const unsubscribe = host.app.events.subscribeAIConfigRefresh(refresh);
    return () => { active = false; unsubscribe(); };
  }, [host]);
  const profile = capabilities?.generation.find((item) => item.scoreMode === (parameters.scoreRelativePath ? 'required' : 'unsupported'));
  const scoreProfile = capabilities?.generation.find((item) => item.scoreMode === 'required' && item.scoreFormats.includes('abc'));
  const disabled = props.disabled || importing || loading || !profile;
  async function importScore(file: File) {
    if (!scoreProfile || file.size < 1 || file.size > scoreProfile.maxScoreBytes) { setError(t('Music.scoreTooLarge')); return; }
    setImporting(true); setError('');
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      const asset = await host.sdk.assets.write({ relativePath: `studio/music/inputs/${crypto.randomUUID()}.abc`, body: bytes, mediaType: 'text/vnd.abc', overwrite: false });
      update({ ...parameters, scoreRelativePath: asset.relativePath, scoreName: file.name, scoreConditioning: 'melody-and-harmony', returnGeneratedScore: false });
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setImporting(false); }
  }
  return <div className="space-y-4">
    {loading ? <p>{t('Music.loadingInputs')}</p> : !capabilities ? <p>{t('Music.configureInputs')}</p> : null}
    <StudioParameterField label={t('Studio.parameters.fields.lyrics')}>
      <TextareaField value={parameters.lyrics ?? ''} disabled={disabled || parameters.instrumental === true}
        textareaClassName="min-h-36 font-mono" onChange={(event) => update({ ...parameters, lyrics: event.currentTarget.value })} />
    </StudioParameterField>
    <StudioNumberParameter current={parameters} field="durationSeconds" label={t('Music.duration', { max: profile?.maxDurationSeconds ?? '—' })} onChange={update} disabled={disabled} />
    <p className="text-sm opacity-70">{t('Music.durationHint')}</p>
    {profile?.supportsSeed ? <StudioNumberParameter current={parameters} field="seed" label={t('Music.seed')} onChange={update} disabled={disabled} /> : null}
    {profile?.supportsInstrumental ? <StudioBooleanParameter current={parameters} field="instrumental" label={t('Music.instrumental')} onChange={(next) => update({ ...next, ...(next.instrumental ? { lyrics: '' } : {}) })} disabled={disabled} /> : null}
    {scoreProfile ? <StudioParameterField label={t('Music.score')}>
      <input ref={input} type="file" accept=".abc,text/vnd.abc" hidden onChange={(event) => {
        const file = event.currentTarget.files?.[0]; event.currentTarget.value = ''; if (file) void importScore(file);
      }} />
      <div className="flex flex-wrap items-center gap-2">
        <Button disabled={props.disabled || importing} onClick={() => input.current?.click()}>{t(importing ? 'Music.importing' : 'Music.importScore')}</Button>
        {parameters.scoreRelativePath ? <><span>{parameters.scoreName || t('Music.importedScore')}</span><Button disabled={props.disabled} onClick={() => {
          const { scoreRelativePath, scoreName, scoreConditioning, ...rest } = parameters; update(rest);
        }}>{t('Music.clearScore')}</Button></> : null}
      </div>
      {parameters.scoreRelativePath ? <SelectField value={parameters.scoreConditioning ?? 'melody-and-harmony'} disabled={disabled}
        onChange={(event) => update({ ...parameters, scoreConditioning: event.currentTarget.value as 'melody-only' | 'melody-and-harmony' })}
        options={scoreProfile.scoreConditioning.map((value) => ({ value, label: t(value === 'melody-only' ? 'Music.melodyOnly' : 'Music.melodyHarmony') }))} /> : null}
      <p className="text-sm opacity-70">{t('Music.scoreHint')}</p>
    </StudioParameterField> : null}
    {profile?.supportsGeneratedScore ? <StudioBooleanParameter current={parameters} field="returnGeneratedScore" label={t('Music.returnScore')} onChange={update} disabled={disabled} /> : null}
    {error ? <p role="alert">{error}</p> : null}
    <MusicRecoveryPanel disabled={props.disabled || importing} />
  </div>;
}
