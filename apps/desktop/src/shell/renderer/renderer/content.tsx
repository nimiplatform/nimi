import { AppRoutes } from '../app-shell/routes/app-routes.js';

/** App-owned visual composition only. Host effects enter through renderer bindings. */
export function DesktopRendererContent() {
  return <AppRoutes />;
}
