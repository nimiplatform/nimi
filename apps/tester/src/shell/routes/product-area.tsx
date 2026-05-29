import { WorldTourViewerRoute } from '../../tester/world-tour/world-tour-viewer-route.js';
import { TesterWorkbench } from '../../tester/tester-workbench.js';

function isWorldTourViewerRoute() {
  return typeof window !== 'undefined' && window.location.hash.startsWith('#/world-tour-viewer');
}

export function ProductArea() {
  if (isWorldTourViewerRoute()) {
    return <WorldTourViewerRoute />;
  }
  return <TesterWorkbench title="Nimi App Lab" />;
}
