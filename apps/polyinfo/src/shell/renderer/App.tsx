import { useEffect } from 'react';
import { AppProviders } from '@renderer/app-shell/app-providers.js';
import { AppRoutes } from '@renderer/app-shell/app-routes.js';
import { runPolyinfoBootstrap } from '@renderer/infra/bootstrap/polyinfo-bootstrap.js';
import { useAppStore } from '@renderer/app-shell/app-store.js';

function BootstrapGate({ children }: { children: React.ReactNode }) {
  const authStatus = useAppStore((state) => state.auth.status);
  const bootstrapReady = useAppStore((state) => state.bootstrapReady);
  const bootstrapError = useAppStore((state) => state.bootstrapError);

  useEffect(() => {
    void runPolyinfoBootstrap();
  }, []);

  if (bootstrapError) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-950 text-white">
        <div className="rounded-md border border-rose-400/25 bg-rose-400/10 px-6 py-5 text-sm text-rose-100">
          Bootstrap failed: {bootstrapError}
        </div>
      </div>
    );
  }

  if (!bootstrapReady || authStatus === 'bootstrapping') {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-slate-950 text-white">
        <div className="space-y-4 text-center">
          <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white" />
          <p className="text-sm text-slate-400">Preparing platform client and runtime…</p>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

export function App() {
  return (
    <AppProviders>
      <BootstrapGate>
        <AppRoutes />
      </BootstrapGate>
    </AppProviders>
  );
}
