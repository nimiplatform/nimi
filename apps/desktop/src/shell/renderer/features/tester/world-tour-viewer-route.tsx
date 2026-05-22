import React from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { invokeTauri } from '@runtime/tauri-api';
import { E2E_IDS } from '@renderer/testability/e2e-ids';
import {
  asOptionalString,
  type ResolvedWorldTourFixture,
} from './world-tour-shared';
import { WorldTourViewerCanvas } from './world-tour-viewer-canvas';

type ResolveWorldTourFixtureResponse = ResolvedWorldTourFixture;

function useManifestPath(): string {
  const location = useLocation();
  return React.useMemo(() => {
    const params = new URLSearchParams(location.search);
    return asOptionalString(params.get('manifestPath'));
  }, [location.search]);
}

function useLaunchToken(): string {
  const location = useLocation();
  return React.useMemo(() => {
    const params = new URLSearchParams(location.search);
    return asOptionalString(params.get('launchToken'));
  }, [location.search]);
}

function closeViewerWindow(fallback: () => void) {
  try {
    window.close();
    window.setTimeout(() => {
      if (!window.closed) {
        fallback();
      }
    }, 150);
  } catch {
    fallback();
  }
}

export function WorldTourViewerRoute() {
  const navigate = useNavigate();
  const manifestPath = useManifestPath();
  const launchToken = useLaunchToken();
  const [fixture, setFixture] = React.useState<ResolvedWorldTourFixture | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState('');

  React.useEffect(() => {
    let cancelled = false;
    if (!manifestPath) {
      setError('Missing world-tour manifest path.');
      setLoading(false);
      return;
    }
    if (!launchToken) {
      setError('World Tour viewer requires a Tester-owned desktop launch token.');
      setLoading(false);
      return;
    }
    setLoading(true);
    setError('');
    void invokeTauri<ResolveWorldTourFixtureResponse>('claim_world_tour_viewer_launch', {
      payload: { manifestPath, launchToken },
    }).then((response) => {
      if (cancelled) return;
      setFixture(response);
      setLoading(false);
    }).catch((loadError) => {
      if (cancelled) return;
      setError(loadError instanceof Error ? loadError.message : String(loadError || 'Failed to resolve world-tour fixture.'));
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [launchToken, manifestPath]);

  const fallbackClose = React.useCallback(() => {
    navigate('/', { replace: true });
  }, [navigate]);

  if (loading) {
    return (
      <div data-testid={E2E_IDS.worldTourViewerRoot} className="flex min-h-screen items-center justify-center bg-[#03060b] text-sm text-white/72">
        Resolving world-tour fixture...
      </div>
    );
  }

  if (error) {
    return (
      <div data-testid={E2E_IDS.worldTourViewerRoot} className="flex min-h-screen items-center justify-center bg-[#03060b] px-6">
        <div className="max-w-[720px] rounded-[24px] border border-[var(--nimi-status-danger)] bg-black/30 px-5 py-4 text-sm text-[var(--nimi-status-danger)]">
          {error}
        </div>
      </div>
    );
  }

  if (!fixture) {
    return null;
  }

  return (
    <div data-testid={E2E_IDS.worldTourViewerRoot} className="min-h-screen bg-[#03060b] text-white">
      <WorldTourViewerCanvas fixture={fixture} onClose={() => closeViewerWindow(fallbackClose)} />
    </div>
  );
}
