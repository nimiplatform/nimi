import { useEffect, useMemo, useState } from 'react';
import { InlineAlert, Surface } from '@nimiplatform/kit/ui';
import { testerTestIds } from '../tester-test-ids.js';
import { claimWorldTourViewerLaunch, type ResolvedWorldTourFixture } from './world-tour-shared.js';
import { WorldTourViewerCanvas } from './world-tour-viewer-canvas.js';

function readQuery() {
  const hash = typeof window === 'undefined' ? '' : window.location.hash;
  const queryStart = hash.indexOf('?');
  return new URLSearchParams(queryStart >= 0 ? hash.slice(queryStart + 1) : '');
}

export function WorldTourViewerRoute() {
  const query = useMemo(readQuery, []);
  const [fixture, setFixture] = useState<ResolvedWorldTourFixture | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const manifestPath = query.get('manifestPath') || '';
    const launchToken = query.get('launchToken') || '';
    if (!manifestPath || !launchToken) {
      setError('World-tour viewer requires a standalone app launch token.');
      return;
    }
    void claimWorldTourViewerLaunch({ manifestPath, launchToken })
      .then(setFixture)
      .catch((claimError) => setError(claimError instanceof Error ? claimError.message : String(claimError || 'Failed to claim viewer launch.')));
  }, [query]);

  return (
    <section className="product-area" data-testid={testerTestIds.worldTourViewerRoot}>
      <Surface className="product-hero world-tour-viewer-hero" material="glass-thick" tone="hero" elevation="floating">
        <div>
          <p className="eyebrow">Nimi Tester</p>
          <h1>World Tour Viewer</h1>
          <p className="product-copy">Standalone app-owned viewer surface for local fixture inspection and render acceptance evidence.</p>
        </div>
      </Surface>
      {error ? (
        <InlineAlert tone="warning">
          <div className="runtime-alert-copy">
            <strong>Viewer launch unavailable</strong>
            <span>{error}</span>
          </div>
        </InlineAlert>
      ) : null}
      {fixture ? <WorldTourViewerCanvas fixture={fixture} /> : null}
    </section>
  );
}
