import { useSyncExternalStore } from 'react';

import { useTesterRendererHost } from '../../renderer/context.js';
import { WorldTourViewerRoute } from '../../tester/world-tour/world-tour-viewer-route.js';
import { TesterWorkbench } from '../../tester/tester-workbench.js';

export function ProductArea() {
  const host = useTesterRendererHost();
  const route = useSyncExternalStore(
    host.route.subscribe,
    host.route.get,
    host.route.get,
  );
  if (route.pathname.startsWith('/world-tour-viewer')) {
    return <WorldTourViewerRoute />;
  }
  return <TesterWorkbench title="Nimi Lab" />;
}
