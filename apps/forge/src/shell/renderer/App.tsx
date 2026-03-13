import { AppProviders } from '@renderer/app-shell/providers/app-providers.js';
import { AuthProvider } from '@renderer/app-shell/providers/auth-provider.js';
import { CreatorAccessGate } from '@renderer/app-shell/providers/creator-access-gate.js';
import { AppRoutes } from '@renderer/app-shell/routes/app-routes.js';

export function App() {
  return (
    <AppProviders>
      <AuthProvider>
        <CreatorAccessGate>
          <AppRoutes />
        </CreatorAccessGate>
      </AuthProvider>
    </AppProviders>
  );
}
