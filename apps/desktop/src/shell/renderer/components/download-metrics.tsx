import { useEffect, useState, type ReactElement } from 'react';
import { useTranslation } from 'react-i18next';
import { ProgressIndicator } from '@nimiplatform/kit/ui';
import { formatBytes, formatEta, formatSpeed } from './download-format.js';

// Matches the Runtime download rate window; this only expires stale display.
export const DOWNLOAD_OBSERVATION_MAX_AGE_MS = 5_000;

export function downloadObservationIsFresh(observedAt: number | undefined, now: number): boolean {
  return observedAt !== undefined && observedAt > 0 && now - observedAt <= DOWNLOAD_OBSERVATION_MAX_AGE_MS && now >= observedAt;
}

/** Shared display only: each business owner supplies its own phase and facts. */
export function DownloadMetrics(props: {
  readonly name: string;
  readonly received?: number;
  readonly total?: number;
  readonly speed?: number;
  readonly eta?: number;
  readonly transferring: boolean;
  readonly available: boolean;
  readonly observedAt?: number;
  readonly activity?: 'download' | 'verify' | 'local';
  readonly idleLabel?: string;
  readonly showBar?: boolean;
}): ReactElement {
  const { t } = useTranslation();
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!props.transferring) return;
    const interval = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(interval);
  }, [props.transferring]);
  const received = props.received !== undefined && Number.isFinite(props.received) && props.received >= 0 ? props.received : undefined;
  const total = props.total !== undefined && Number.isFinite(props.total) && props.total > 0 ? props.total : undefined;
  const size = received === undefined ? t('Apps.downloads.bytesUnknown')
    : total === undefined ? t('Apps.downloads.totalUnknown', { received: formatBytes(received) })
      : `${formatBytes(received)} / ${formatBytes(total)}`;
  const fresh = props.available && downloadObservationIsFresh(props.observedAt, Math.max(now, Date.now()));
  const speed = props.transferring && fresh && (props.speed ?? 0) > 0 ? props.speed : undefined;
  const eta = speed !== undefined && total !== undefined && received !== undefined && total > received && (props.eta ?? 0) > 0 ? props.eta : undefined;
  const timing = !props.available || (props.transferring && !fresh) ? t('Apps.downloads.metricsUnavailable')
    : !props.transferring ? props.idleLabel
      : [speed === undefined ? null : formatSpeed(speed), eta === undefined ? t('Apps.downloads.estimating')
        : t(props.activity === 'verify' ? 'Apps.downloads.verifyEta' : props.activity === 'local' ? 'Apps.downloads.processEta' : 'Apps.downloads.eta', { eta: formatEta(eta) })].filter(Boolean).join(' · ');
  return <div className="min-w-0 space-y-2">
    {props.showBar !== false && total !== undefined && received !== undefined ? <ProgressIndicator value={received} max={total} aria-label={props.name} aria-valuetext={size} /> : null}
    <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 text-xs leading-5 tabular-nums text-[var(--nimi-text-secondary)]">
      <span>{size}</span>{timing ? <span>{timing}</span> : null}
    </div>
  </div>;
}
