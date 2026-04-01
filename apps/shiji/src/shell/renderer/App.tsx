import { ShellErrorBoundary } from '@nimiplatform/nimi-kit/telemetry/error-boundary';
import { AppProviders } from '@renderer/app-shell/providers.js';
import { AuthGate } from '@renderer/app-shell/auth-gate.js';
import { AppRoutes } from '@renderer/app-shell/routes.js';

export function App() {
  return (
    <ShellErrorBoundary appName="ShiJi">
      <AppProviders>
        <AuthGate>
          <AppRoutes />
        </AuthGate>
      </AppProviders>
    </ShellErrorBoundary>
  );
}
