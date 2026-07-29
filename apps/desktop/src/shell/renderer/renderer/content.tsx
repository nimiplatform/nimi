import { AppRoutes } from '../app-shell/routes/app-routes.js';
import { LocalDevelopmentApprovalCenter } from '../features/local-development/local-development-approval-center.js';
import { LocalAppPermissionApprovalCenter } from '../features/apps/local-app-permission-approval-center.js';

/**
 * App-owned visual composition only. Production bootstrap and host effects are
 * deliberately outside this closure and enter through renderer bindings.
 */
export function DesktopRendererContent() {
  return (
    <>
      <AppRoutes />
      <LocalAppPermissionApprovalCenter />
      <LocalDevelopmentApprovalCenter />
    </>
  );
}
