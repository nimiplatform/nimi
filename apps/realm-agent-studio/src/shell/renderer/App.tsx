import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NimiThemeProvider, Surface } from '@nimiplatform/nimi-kit/ui';
import { OwnerPortfolio } from './features/portfolio/OwnerPortfolio.js';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

export function App() {
  return (
    <NimiThemeProvider accentPack="nimi-accent" defaultScheme="light">
      <QueryClientProvider client={queryClient}>
        <main className="flex h-full min-h-0 min-w-0 flex-col gap-5 p-5">
          <header className="flex min-w-0 flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <h1 className="m-0 text-3xl font-semibold">Realm Agent Studio</h1>
              <p className="m-0 mt-2 max-w-3xl text-[var(--nimi-text-secondary)]">
                Owner operation center for creator-owned public Realm Agents, with settings read from SDK MeService.getMyRealmAgent.
              </p>
            </div>
          </header>
          <Surface tone="canvas" padding="lg" className="flex min-h-0 min-w-0 flex-1">
            <OwnerPortfolio />
          </Surface>
        </main>
      </QueryClientProvider>
    </NimiThemeProvider>
  );
}
