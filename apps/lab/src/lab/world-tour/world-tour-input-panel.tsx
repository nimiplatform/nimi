import { useEffect, useState } from 'react';
import { InlineAlert } from '@nimiplatform/kit/ui';
import type { StudioParameterPanelProps } from '../../ai-studio-core/parameter-fields.js';
import type { StudioManagedArtifact } from '../../ai-studio-core/runtime-types.js';
import { useLabRendererHost } from '../../renderer/context.js';
import { useTranslation } from '../../shell/i18n/index.js';
import { readWorldInput, worldSource } from './world-tour-input.js';

export function WorldInputPreview({ source }: { source: StudioManagedArtifact }) {
  const { t } = useTranslation();
  const [url, setURL] = useState('');
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let active = true; let current = '';
    setURL(''); setFailed(false);
    void readWorldInput(source).then(bytes => {
      if (!active) return;
      current = URL.createObjectURL(new Blob([bytes], { type: source.mediaType })); setURL(current);
    }).catch(() => { if (active) setFailed(true); });
    return () => { active = false; if (current) URL.revokeObjectURL(current); };
  }, [source.relativePath, source.sha256]);
  return <div className="world-tour-input-preview">
    <p>{source.displayName}</p>
    {url ? <img src={url} alt={t('WorldTour.sourcePreview')} style={{ maxWidth: '100%', maxHeight: 220, objectFit: 'contain' }} /> : null}
    {failed ? <InlineAlert tone="warning">{t('WorldTour.sourceUnavailable')}</InlineAlert> : null}
  </div>;
}

export function WorldTourInputPanel({ parameters, onChange, disabled }: StudioParameterPanelProps) {
  const host = useLabRendererHost(); const { t } = useTranslation();
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const source = worldSource(parameters);
  const mode = String(parameters.inputMode || 'text');
  const select = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true); setError('');
    const cleared = Object.fromEntries(Object.entries(parameters).filter(([key]) => !key.startsWith('source')));
    onChange(cleared);
    try {
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || !file.size || file.size > 20_000_000) throw new Error(t('WorldTour.imageLimits'));
      const image = await createImageBitmap(file);
      const width = image.width, height = image.height; image.close();
      if (width * height > 16 * 1024 * 1024 || (mode === 'equirectangular-360' && width !== 2 * height)) throw new Error(t('WorldTour.panoLimits'));
      const bytes = new Uint8Array(await file.arrayBuffer());
      const extension = file.type === 'image/jpeg' ? 'jpg' : file.type.slice(6);
      const saved = await host.sdk.storage.assets.write({ relativePath: `world-tour/inputs/${crypto.randomUUID()}.${extension}`, body: bytes, mediaType: file.type, overwrite: false });
      onChange({ ...parameters, sourceRelativePath: saved.relativePath, sourceSizeBytes: saved.sizeBytes, sourceSHA256: saved.sha256,
        sourceMediaType: file.type, sourceName: file.name, sourceWidth: width, sourceHeight: height });
    } catch (cause) { setError(cause instanceof Error ? cause.message : t('WorldTour.sourceUnavailable')); }
    finally { setBusy(false); }
  };
  return <div className="world-tour-input">
    <label>{t('WorldTour.inputMode')} <select aria-label={t('WorldTour.inputMode')} value={mode} disabled={disabled || busy}
      onChange={event => { setError(''); onChange({ ...parameters, inputMode: event.target.value }); }}>
      <option value="text">{t('WorldTour.textInput')}</option><option value="ordinary">{t('WorldTour.imageInput')}</option>
      <option value="equirectangular-360">{t('WorldTour.panoInput')}</option>
    </select></label>
    {mode !== 'text' ? <>
      <p>{t(mode === 'equirectangular-360' ? 'WorldTour.panoLimits' : 'WorldTour.imageLimits')}</p>
      <input type="file" aria-label={t('WorldTour.chooseImage')} accept="image/png,image/jpeg,image/webp" disabled={disabled || busy} onChange={event => void select(event.target.files?.[0])} />
      {source ? <WorldInputPreview source={source} /> : <p>{t('WorldTour.sourceRequired')}</p>}
    </> : null}
    {busy ? <p role="status">{t('WorldTour.savingSource')}</p> : null}
    {error ? <InlineAlert tone="warning">{error}</InlineAlert> : null}
  </div>;
}
