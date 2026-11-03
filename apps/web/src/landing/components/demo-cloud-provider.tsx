import type { CloudProvider } from '../content/demo-cloud-data.js';

export function CloudProviderMark({ provider, large = false }: { provider: CloudProvider; large?: boolean }) {
  return (
    <span className={large ? 'cloud-provider-mark cloud-provider-mark--large' : 'cloud-provider-mark'} aria-hidden="true">
      <svg viewBox="0 0 24 24" focusable="false">
        <text x="12" y="16.5" textAnchor="middle">{provider.name.slice(0, 2).toUpperCase()}</text>
        <use href={'/demo/cloud-provider-marks.svg#' + provider.provider} />
      </svg>
    </span>
  );
}
