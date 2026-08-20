import { useSyncExternalStore } from 'react';

import { useLabRendererHost } from '../../renderer/context.js';
import { WorldTourViewerRoute } from '../../lab/world-tour/world-tour-viewer-route.js';
import { LabWorkbench } from '../../lab/lab-workbench.js';

export function ProductArea() {
  const host = useLabRendererHost();
  const route = useSyncExternalStore(
    host.route.subscribe,
    host.route.get,
    host.route.get,
  );
  if (route.pathname.startsWith('/world-tour-viewer')) {
    return <WorldTourViewerRoute />;
  }
  return <LabWorkbench title="Nimi Lab" />;
}
