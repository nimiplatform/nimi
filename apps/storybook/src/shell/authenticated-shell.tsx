import { AmbientBackground } from '@nimiplatform/kit/ui';
import { ProductArea } from './routes/product-area.js';

// Scaffold-managed desktop-grade shell frame.
// The app owns its full canvas directly: a kit AmbientBackground glass backdrop
// hosts the product area full-bleed. There is no competing scaffold chrome to
// hide — the previous app-chrome header + side-panel (which the workbench had to
// CSS-hide) are removed. Product chrome (navigation, command bar, identity) is
// owned by the product area, not duplicated here.
export function AuthenticatedShell() {
  return (
    <AmbientBackground
      variant="mesh"
      className="app-shell"
      data-testid="nimi-app-shell"
    >
      <ProductArea />
    </AmbientBackground>
  );
}
