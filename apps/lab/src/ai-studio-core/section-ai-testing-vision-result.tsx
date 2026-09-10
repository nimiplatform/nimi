import { useState } from 'react';
import type { StudioTypedOutput } from './runtime-types.js';
import { useAIStudioHost } from './host-context.js';

export function VisionLocateResultView({ output }: { output: Extract<StudioTypedOutput, {kind:'vision-locate'}> }) {
  const { translate: t } = useAIStudioHost();
  const [imageFailed, setImageFailed] = useState(false);
  const { width, height, locations, imageArtifactId } = output.result;
  return <figure className="studio-locate-result">
    {output.imagePreviewUrl && !imageFailed ? <div className="studio-locate-result__image" style={{ aspectRatio: `${width} / ${height}` }}>
      <img src={output.imagePreviewUrl} alt={t('VisionLocate.sourceImage')} onError={() => setImageFailed(true)} />
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
