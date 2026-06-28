import { AuthGate } from './auth/auth-gate.js';
import { AuthenticatedShell } from './authenticated-shell.js';

export function App() {
  return (
    <AuthGate>
      <AuthenticatedShell />
    </AuthGate>
  );
}
