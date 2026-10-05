import { useEffect, useState } from 'react';
import { openNimiLocalAppAssetMediaUrl } from '@nimiplatform/kit/shell/renderer/bridge';
import type { StudioTypedOutput } from './runtime-types.js';
import { useAIStudioHost } from './host-context.js';

export function VisionLocateResultView({ output }: { output: Extract<StudioTypedOutput, {kind:'vision-locate'}> }) {
  const host = useAIStudioHost();
  const { translate: t } = host;
  const [imageFailed, setImageFailed] = useState(false);
  const [retained, setRetained] = useState<{ readonly sourceKey: string; readonly url: string } | null>(null);
  const source = output.sourceImage;
  const sourceKey = source ? JSON.stringify([source.relativePath, source.sha256, source.sizeBytes, source.mediaType]) : '';
  useEffect(() => {
    setRetained(null); setImageFailed(false);
    if (!source) return undefined;
    let active = true; let revoke: (() => Promise<void>) | undefined;
    void (async () => {
      const stat = await host.sdk.assets.stat(source.relativePath);
      if (stat.sha256 !== source.sha256 || stat.sizeBytes !== source.sizeBytes || stat.mediaType !== source.mediaType) throw new Error('Saved source image changed');
      const handle = await openNimiLocalAppAssetMediaUrl(source.relativePath);
      revoke = handle.revoke;
      if (active) setRetained({ sourceKey, url: handle.url }); else await handle.revoke();
    })().catch(() => { if (active) setImageFailed(true); });
    return () => { active = false; if (revoke) void revoke(); };
  }, [source, sourceKey, host]);
  const imageUrl = source ? retained?.sourceKey === sourceKey ? retained.url : null : output.imagePreviewUrl;
  const { width, height, locations, imageArtifactId } = output.result;
  return <figure className="studio-locate-result">
    {imageUrl && !imageFailed ? <div className="studio-locate-result__image" style={{ aspectRatio: `${width} / ${height}` }}>
      <img src={imageUrl} alt={t('VisionLocate.sourceImage')} onError={() => setImageFailed(true)} />
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={t('VisionLocate.overlay')}>
        {locations.map((location, index) => <g key={index}>
          <title>{location.label || t('VisionLocate.target', { index: index+1 })}</title>
          {location.type === 'box' ? <rect x={location.x1*width} y={location.y1*height} width={(location.x2-location.x1)*width} height={(location.y2-location.y1)*height} vectorEffect="non-scaling-stroke" /> : <circle cx={location.x*width} cy={location.y*height} r={Math.max(width,height)*0.007} vectorEffect="non-scaling-stroke" />}
        </g>)}
      </svg>
    </div> : <p>{t('VisionLocate.previewUnavailable')}</p>}
    <figcaption>{t(locations.length ? 'VisionLocate.found' : 'VisionLocate.noMatch', { count: locations.length })}</figcaption>
    <details><summary>{t('VisionLocate.coordinates')}</summary><pre>{JSON.stringify({ imageArtifactId, width, height, locations }, null, 2)}</pre></details>
  </figure>;
}
