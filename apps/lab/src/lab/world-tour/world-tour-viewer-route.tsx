import { useEffect, useMemo, useState } from 'react';
import { InlineAlert } from '@nimiplatform/kit/ui';
import { useTranslation } from '../../shell/i18n/index.js';
import { labTestIds } from '../lab-test-ids.js';
import type { ResolvedWorldTourFixture } from './world-tour-shared.js';
import { WorldTourViewerCanvas } from './world-tour-viewer-canvas.js';
import { useLabRendererHost } from '../../renderer/context.js';

function readQuery(search: readonly { readonly key: string; readonly value: string }[]) {
  return new Map(search.map(({ key, value }) => [key, value]));
}

export function WorldTourViewerRoute() {
  const rendererHost = useLabRendererHost();
  const { t } = useTranslation();
  const query = useMemo(() => readQuery(rendererHost.route.get().search), [rendererHost]);
  const [fixture, setFixture] = useState<ResolvedWorldTourFixture | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const manifestPath = query.get('manifestPath') || '';
    const launchToken = query.get('launchToken') || '';
    if (!manifestPath || !launchToken) {
      setError(t('WorldTour.launchTokenRequired'));
      return;
    }
    void rendererHost.app.commands.claimWorldTourViewerLaunch({ manifestPath, launchToken })
      .then(setFixture)
      .catch((claimError) => setError(claimError instanceof Error ? claimError.message : String(claimError || t('WorldTour.launchClaimFailed'))));
  }, [query, rendererHost, t]);

  return (
    <section className="product-area" data-testid={labTestIds.worldTourViewerRoot}>
      <h1 className="world-tour-page-title">{t('WorldTour.viewerTitle')}</h1>
      {error ? (
        <InlineAlert tone="warning">
          <div className="runtime-alert-copy">
            <strong>{t('WorldTour.launchUnavailableTitle')}</strong>
            <span>{error}</span>
          </div>
        </InlineAlert>
      ) : null}
      {fixture ? <WorldTourViewerCanvas fixture={fixture} /> : null}
    </section>
  );
}
