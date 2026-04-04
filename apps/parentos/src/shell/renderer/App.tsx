import { useEffect } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createPlatformClient } from '@nimiplatform/sdk';
import { AppRoutes } from './app-shell/routes.js';
import { ShellLayout } from './app-shell/shell-layout.js';
import { useAppStore } from './app-shell/app-store.js';
import { dbInit, getFamily, getChildren } from './bridge/sqlite-bridge.js';
import { mapChildRow } from './bridge/mappers.js';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, staleTime: 5 * 60 * 1000 },
  },
});

function Bootstrap() {
  const { setBootstrapReady, setFamilyId, setChildren, setActiveChildId } = useAppStore();

  useEffect(() => {
    async function init() {
      try {
        // Initialize the SDK platform client. In Tauri context, the runtime
        // transport is auto-detected via __TAURI_INTERNALS__.
        // Realm is not used in ParentOS Phase 1 (local-only), so we allow anonymous.
        await createPlatformClient({
          appId: 'app.nimi.parentos',
          runtimeDefaults: {
            callerId: 'app.nimi.parentos',
            surfaceId: 'parentos.advisor',
          },
          allowAnonymousRealm: true,
        });
      } catch {
        // SDK init may fail in browser dev mode or if runtime is not available.
        // ParentOS core features (local data) work without the runtime.
      }

      try {
        await dbInit();
        const family = await getFamily();
        if (family) {
          setFamilyId(family.familyId);
          const rows = await getChildren(family.familyId);
          const children = rows.map(mapChildRow);
          setChildren(children);
          if (children.length > 0) {
            setActiveChildId(children[0]!.childId);
          }
        }
      } catch {
        // Bridge not available (running in browser dev mode without Tauri)
      }
      setBootstrapReady(true);
    }
    init();
  }, [setBootstrapReady, setFamilyId, setChildren, setActiveChildId]);

  return null;
}

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Bootstrap />
        <ShellLayout>
          <AppRoutes />
        </ShellLayout>
      </BrowserRouter>
    </QueryClientProvider>
  );
}
