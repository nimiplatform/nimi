import { ShellErrorBoundary } from '@nimiplatform/nimi-kit/telemetry/error-boundary';
import { AppProviders } from '@renderer/app-shell/providers/app-providers.js';
import { AuthProvider } from '@renderer/app-shell/providers/auth-provider.js';
import { AppRoutes } from '@renderer/app-shell/routes/app-routes.js';

export function App() {
  return (
    <ShellErrorBoundary appName="Lookdev">
      <AppProviders>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </AppProviders>
    </ShellErrorBoundary>
  );
}
