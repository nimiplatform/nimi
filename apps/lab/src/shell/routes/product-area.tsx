import { lazy, Suspense, useSyncExternalStore } from 'react';
import { LoadingSkeleton } from '@nimiplatform/kit/ui';

import { useLabRendererHost } from '../../renderer/context.js';
import { LabWorkbench } from '../../lab/lab-workbench.js';

const WorldTourViewerRoute = lazy(async () => ({
  default: (await import('../../lab/world-tour/world-tour-viewer-route.js')).WorldTourViewerRoute,
}));

export function ProductArea() {
  const host = useLabRendererHost();
  const route = useSyncExternalStore(
    host.route.subscribe,
    host.route.get,
    host.route.get,
  );
  if (route.pathname.startsWith('/world-tour-viewer')) {
    return (
      <Suspense fallback={<LoadingSkeleton className="h-full w-full" />}>
        <WorldTourViewerRoute />
      </Suspense>
    );
  }
  return <LabWorkbench title="Nimi Lab" />;
}
